// JSONL Ledger - Single file, append-only, hash-chained
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 8 (Immutable Evidence)
// TCB Component: This file is part of the Trusted Computing Base

import * as fs from 'fs'
import * as crypto from 'crypto'
import { Result, Ok, Err } from '../core/result'
import { contentAddress, canonicalJSON } from '../core/contentAddress'
import type { EvidenceArtifact, EvidenceKind } from './evidenceArtifact'
import type { GateDecision } from '../core/gateDecision'

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
    const genesis: JSONLRecord = {
      record_type: 'GENESIS',
      seq: 0,
      timestamp: Date.now(),  // DETERMINISM-EXEMPT: Genesis timestamp
      prev_hash: 'genesis',
      record: {
        kernel_version: '1.0.0',
        purpose: 'Foundation bootstrap',
        timestamp: new Date().toISOString()  // DETERMINISM-EXEMPT: Genesis metadata
      },
      record_hash: ''  // Computed below
    }

    // Compute hash WITHOUT record_hash field (same as append)
    const genesisForHash = {
      record_type: genesis.record_type,
      seq: genesis.seq,
      timestamp: genesis.timestamp,
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
   */
  private loadState(): void {
    const content = fs.readFileSync(this.filepath, 'utf-8')
    const lines = content.trim().split('\n').filter(l => l.length > 0)

    if (lines.length === 0) {
      this.createGenesis()
      return
    }

    // Get last record
    const lastLine = lines[lines.length - 1]
    const lastRecord = JSON.parse(lastLine) as JSONLRecord

    this.lastHash = lastRecord.record_hash
    this.seq = lastRecord.seq
  }

  /**
   * Append record to JSONL ledger (atomic)
   */
  async append(
    record_type: string,
    record: unknown
  ): Promise<Result<JSONLRecord, Error>> {
    try {
      this.seq++

      const entry: JSONLRecord = {
        record_type,
        seq: this.seq,
        timestamp: Date.now(),  // DETERMINISM-EXEMPT: Record timestamp
        prev_hash: this.lastHash,
        record,
        record_hash: ''  // Computed below
      }

      // Compute hash of entry WITHOUT record_hash field
      const entryForHash = {
        record_type: entry.record_type,
        seq: entry.seq,
        timestamp: entry.timestamp,
        prev_hash: entry.prev_hash,
        record: entry.record
      }
      entry.record_hash = contentAddress(entryForHash)

      // Append to file (atomic line write)
      const line = canonicalJSON(entry) + '\n'
      fs.appendFileSync(this.filepath, line, 'utf-8')

      // Verify written correctly
      const written = this.readLast()
      if (!written.ok || written.value.record_hash !== entry.record_hash) {
        return Err(new Error('Write verification failed'))
      }

      this.lastHash = entry.record_hash

      return Ok(entry)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
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

      // Verify record_hash by recomputing
      // Need to compute hash of record WITHOUT record_hash field
      const recordForHash = {
        record_type: record.record_type,
        seq: record.seq,
        timestamp: record.timestamp,
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
    return this.seq
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
