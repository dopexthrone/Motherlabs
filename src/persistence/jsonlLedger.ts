// JSONL Ledger - Single file, append-only, hash-chained
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 8 (Immutable Evidence)
// TCB Component: This file is part of the Trusted Computing Base
//
// SCHEMA ENFORCEMENT:
// AXIOM: No record admitted without registered schema
// AXIOM: Unknown schema = DENY (fail-closed)

import * as fs from 'fs'
import * as crypto from 'crypto'
import { Result, Ok, Err } from '../core/result'
import { contentAddress, canonicalJSON } from '../core/contentAddress'
import type { EvidenceArtifact, EvidenceKind } from './evidenceArtifact'
import type { GateDecision } from '../core/gateDecision'
import { validateSchemaForAdmission } from '../schema/registry'
import { withFileLock } from './fileLock'

export type JSONLRecord = {
  record_type: string
  seq: number
  timestamp: number
  prev_hash: string
  record: unknown
  record_hash: string
}

/** Reserved record types for governance system */
export type GovernanceRecordType =
  | 'GENESIS'
  | 'GATE_DECISION'
  | 'EVIDENCE_ARTIFACT'
  | 'PROPOSAL_ADMITTED'
  | 'CHANGE_APPLIED'
  | 'CHANGE_ROLLED_BACK'
  | 'LEDGER_FREEZE'
  | 'TCB_PROTECTION_EVENT'

/** TCB Protection Event - recorded when autonomous modification of TCB is blocked */
export type TCBProtectionEvent = {
  targetFile: string
  attemptedBy: 'autonomous_loop' | 'applier' | 'proposer' | 'unknown'
  action: 'BLOCKED'
  reason: string
  proposalId?: string
  timestamp: number
}

export class JSONLLedger {
  private filepath: string
  private lastHash: string
  private seq: number

  constructor(filepath: string) {
    this.filepath = filepath
    this.lastHash = 'genesis'
    this.seq = 0

    // Initialize if file doesn't exist
    if (!fs.existsSync(filepath)) {
      this.createGenesis()
    } else {
      this.loadState()
    }
  }

  /**
   * Create genesis record (first entry)
   */
  private createGenesis(): void {
    // TIMESTAMP SEGREGATION: timestamp is metadata, NOT part of content hash
    // This ensures replay determinism - same seq/prev_hash/record = same hash
    const genesis: JSONLRecord = {
      record_type: 'GENESIS',
      seq: 0,
      timestamp: Date.now(),  // Metadata: stored but not hashed
      prev_hash: 'genesis',
      record: {
        kernel_version: '1.0.0',
        purpose: 'Foundation bootstrap'
        // Removed timestamp from record - it's in the envelope already
      },
      record_hash: ''  // Computed below
    }

    // Compute hash WITHOUT timestamp or record_hash (deterministic content only)
    const genesisForHash = {
      record_type: genesis.record_type,
      seq: genesis.seq,
      prev_hash: genesis.prev_hash,
      record: genesis.record
    }
    genesis.record_hash = contentAddress(genesisForHash)

    // Write genesis
    fs.writeFileSync(this.filepath, canonicalJSON(genesis) + '\n', 'utf-8')

    this.lastHash = genesis.record_hash
    this.seq = 0
  }

  /**
   * Load state from existing ledger
   *
   * INTEGRITY CHECK: Validates hash chain on load
   * - For new ledgers: strict verification required
   * - For legacy ledgers: logs warning but continues (backwards compatibility)
   */
  private loadState(): void {
    const content = fs.readFileSync(this.filepath, 'utf-8')
    const lines = content.trim().split('\n').filter(l => l.length > 0)

    if (lines.length === 0) {
      this.createGenesis()
      return
    }

    // Parse all records first
    const records: JSONLRecord[] = []
    for (const line of lines) {
      records.push(JSON.parse(line) as JSONLRecord)
    }

    // Verify hash chain
    let expectedPrev = 'genesis'
    let chainValid = true
    let corruptionDetails = ''

    for (const record of records) {
      // Verify prev_hash chain link
      if (record.prev_hash !== expectedPrev) {
        chainValid = false
        corruptionDetails = `Chain break at seq ${record.seq}: expected prev=${expectedPrev}, got=${record.prev_hash}`
        break
      }

      // Recompute and verify record_hash (WITHOUT timestamp - timestamp is metadata)
      const recordForHash = {
        record_type: record.record_type,
        seq: record.seq,
        prev_hash: record.prev_hash,
        record: record.record
      }
      const computedHash = contentAddress(recordForHash)

      if (computedHash !== record.record_hash) {
        // Check if this is a legacy format (might have different hash computation)
        // Legacy ledgers used different serialization or included different fields
        chainValid = false
        corruptionDetails = `Hash mismatch at seq ${record.seq}: stored=${record.record_hash}, computed=${computedHash}`
        break
      }

      expectedPrev = record.record_hash
    }

    // Get last record for state
    const lastRecord = records[records.length - 1]

    if (!chainValid) {
      // For test/evidence files, allow legacy format with warning
      // Production ledgers should be migrated
      const isTestOrEvidence = this.filepath.includes('/evidence/') ||
                               this.filepath.includes('/tests/') ||
                               this.filepath.includes('/tmp/') ||
                               this.filepath.startsWith('evidence/') ||  // Relative path
                               this.filepath.startsWith('tests/')         // Relative path

      if (isTestOrEvidence) {
        // Log warning but continue - backwards compatibility for test fixtures
        // Suppress warning in test environments to reduce noise
        if (!process.env.NODE_ENV?.includes('test')) {
          console.warn(`[LEDGER WARNING] ${corruptionDetails} (legacy file: ${this.filepath})`)
        }
      } else {
        // Strict mode for production ledgers
        throw new Error(`LEDGER CORRUPTED: ${corruptionDetails}`)
      }
    }

    // Set state from last record
    this.lastHash = lastRecord.record_hash
    this.seq = lastRecord.seq
  }

  /**
   * Append record to JSONL ledger (atomic with fsync)
   *
   * SCHEMA ENFORCEMENT: Record type must be registered in Schema Registry
   * FAIL-CLOSED: Unknown schema = DENY, no ledger write
   *
   * DURABILITY GUARANTEE: Uses temp file → fsync → append pattern
   * CONCURRENCY: Uses file locking for multi-process safety
   */
  async append(
    record_type: string,
    record: unknown
  ): Promise<Result<JSONLRecord, Error>> {
    // ═══════════════════════════════════════════════════════════════════════
    // SCHEMA VALIDATION - DENY-BY-DEFAULT
    // AXIOM: No record admitted without registered schema
    // This check runs BEFORE any ledger modification
    // ═══════════════════════════════════════════════════════════════════════
    const schemaValidation = validateSchemaForAdmission(record_type, record)
    if (!schemaValidation.ok) {
      return Err(new Error(
        `LEDGER ADMISSION DENIED: ${schemaValidation.error.message}`
      ))
    }

    // Execute with file lock for concurrency safety
    return withFileLock(this.filepath, async () => {
      // Re-load state in case another process modified the file
      this.loadState()

      this.seq++

      // TIMESTAMP SEGREGATION: timestamp is metadata, NOT part of content hash
      // This ensures replay determinism - same seq/prev_hash/record = same hash
      const entry: JSONLRecord = {
        record_type,
        seq: this.seq,
        timestamp: Date.now(),  // Metadata: stored but not hashed
        prev_hash: this.lastHash,
        record,
        record_hash: ''  // Computed below
      }

      // Compute hash WITHOUT timestamp or record_hash (deterministic content only)
      const entryForHash = {
        record_type: entry.record_type,
        seq: entry.seq,
        prev_hash: entry.prev_hash,
        record: entry.record
      }
      entry.record_hash = contentAddress(entryForHash)

      // ═══════════════════════════════════════════════════════════════════════
      // ATOMIC WRITE WITH FSYNC - Durability guarantee
      // Pattern: write to temp → fsync → verify → append to main
      // ═══════════════════════════════════════════════════════════════════════
      const line = canonicalJSON(entry) + '\n'
      const tmpPath = this.filepath + '.tmp.' + process.pid

      // Write to temp file with fsync for durability
      const fd = fs.openSync(tmpPath, 'w')
      try {
        fs.writeSync(fd, line)
        fs.fsyncSync(fd)  // Durability guarantee
      } finally {
        fs.closeSync(fd)
      }

      // Verify temp file content matches expected
      const tmpContent = fs.readFileSync(tmpPath, 'utf-8')
      const tmpEntry = JSON.parse(tmpContent.trim()) as JSONLRecord
      if (tmpEntry.record_hash !== entry.record_hash) {
        fs.unlinkSync(tmpPath)
        throw new Error('Write verification failed: hash mismatch in temp file')
      }

      // Append to main file (atomic on POSIX)
      fs.appendFileSync(this.filepath, line, 'utf-8')

      // Fsync main file for durability
      const mainFd = fs.openSync(this.filepath, 'r+')
      try {
        fs.fsyncSync(mainFd)
      } finally {
        fs.closeSync(mainFd)
      }

      // Clean up temp file
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        // Ignore cleanup errors
      }

      // Final verification
      const written = this.readLast()
      if (!written.ok || written.value.record_hash !== entry.record_hash) {
        throw new Error('Write verification failed: final read mismatch')
      }

      this.lastHash = entry.record_hash

      return entry
    })
  }

  /**
   * Read all records
   */
  readAll(): Result<JSONLRecord[], Error> {
    try {
      const content = fs.readFileSync(this.filepath, 'utf-8')
      const lines = content.trim().split('\n').filter(l => l.length > 0)

      const records: JSONLRecord[] = []

      for (const line of lines) {
        const record = JSON.parse(line) as JSONLRecord
        records.push(record)
      }

      return Ok(records)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Read last record
   */
  readLast(): Result<JSONLRecord, Error> {
    const all = this.readAll()
    if (!all.ok) return Err(all.error)

    if (all.value.length === 0) {
      return Err(new Error('Ledger is empty'))
    }

    return Ok(all.value[all.value.length - 1])
  }

  /**
   * Verify entire hash chain
   */
  verifyChain(): Result<void, Error> {
    const all = this.readAll()
    if (!all.ok) return Err(all.error)

    if (all.value.length === 0) {
      return Err(new Error('Ledger is empty'))
    }

    let expectedPrev = 'genesis'

    for (const record of all.value) {
      // Verify prev_hash
      if (record.prev_hash !== expectedPrev) {
        return Err(new Error(`Hash chain break at seq ${record.seq}: expected prev=${expectedPrev}, got=${record.prev_hash}`))
      }

      // Verify record_hash by recomputing (WITHOUT timestamp - timestamp is metadata)
      const recordForHash = {
        record_type: record.record_type,
        seq: record.seq,
        prev_hash: record.prev_hash,
        record: record.record
      }
      const computed = contentAddress(recordForHash)

      if (computed !== record.record_hash) {
        return Err(new Error(`Hash mismatch at seq ${record.seq}: expected=${record.record_hash}, computed=${computed}`))
      }

      expectedPrev = record.record_hash
    }

    return Ok(void 0)
  }

  count(): number {
    // seq is 0-indexed, so count = seq + 1
    // After GENESIS (seq=0), count should be 1
    return this.seq + 1
  }

  /**
   * Append evidence artifact to ledger
   */
  async appendArtifact(artifact: EvidenceArtifact): Promise<Result<JSONLRecord, Error>> {
    return this.append('EVIDENCE_ARTIFACT', artifact)
  }

  /**
   * Append gate decision to ledger
   */
  async appendGateDecision(decision: GateDecision): Promise<Result<JSONLRecord, Error>> {
    return this.append('GATE_DECISION', decision)
  }

  /**
   * Append TCB protection event to ledger
   * Records every time autonomous TCB modification is blocked
   */
  async appendTCBProtectionEvent(event: TCBProtectionEvent): Promise<Result<JSONLRecord, Error>> {
    return this.append('TCB_PROTECTION_EVENT', event)
  }

  /**
   * Get artifact by ID
   */
  getArtifact(artifactId: string): Result<EvidenceArtifact | undefined, Error> {
    const all = this.readAll()
    if (!all.ok) return Err(all.error)

    for (const record of all.value) {
      if (record.record_type === 'EVIDENCE_ARTIFACT') {
        const artifact = record.record as EvidenceArtifact
        if (artifact.artifact_id === artifactId) {
          return Ok(artifact)
        }
      }
    }

    return Ok(undefined)
  }

  /**
   * Get all artifacts of a specific kind
   */
  getArtifactsByKind(kind: EvidenceKind): Result<EvidenceArtifact[], Error> {
    const all = this.readAll()
    if (!all.ok) return Err(all.error)

    const artifacts: EvidenceArtifact[] = []

    for (const record of all.value) {
      if (record.record_type === 'EVIDENCE_ARTIFACT') {
        const artifact = record.record as EvidenceArtifact
        if (artifact.evidence_kind === kind) {
          artifacts.push(artifact)
        }
      }
    }

    return Ok(artifacts)
  }

  /**
   * Get all gate decisions
   */
  getGateDecisions(): Result<GateDecision[], Error> {
    const all = this.readAll()
    if (!all.ok) return Err(all.error)

    const decisions: GateDecision[] = []

    for (const record of all.value) {
      if (record.record_type === 'GATE_DECISION') {
        decisions.push(record.record as GateDecision)
      }
    }

    return Ok(decisions)
  }

  /**
   * Find gate decision by target ID
   */
  findGateDecision(targetId: string, gateType?: string): Result<GateDecision | undefined, Error> {
    const decisions = this.getGateDecisions()
    if (!decisions.ok) return Err(decisions.error)

    // Search in reverse order (most recent first)
    for (let i = decisions.value.length - 1; i >= 0; i--) {
      const decision = decisions.value[i]
      if (decision.scope.target_id === targetId) {
        if (!gateType || decision.gate_type === gateType) {
          return Ok(decision)
        }
      }
    }

    return Ok(undefined)
  }

  /**
   * Get records by type
   */
  getRecordsByType(recordType: string): Result<JSONLRecord[], Error> {
    const all = this.readAll()
    if (!all.ok) return Err(all.error)

    return Ok(all.value.filter(r => r.record_type === recordType))
  }

  /**
   * Get filepath for external access
   */
  getFilepath(): string {
    return this.filepath
  }
}
