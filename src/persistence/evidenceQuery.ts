// Evidence Query System - Answer "why did we choose this six weeks ago?"
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 8 (Immutable Evidence), AXIOM 10 (Complete Audit)
// TCB Component: Part of the evidence/governance system
//
// From ROADMAP Step 6:
// - Query interface for ledger entries
// - Filter by: decision type, date range, file, consequence
// - Reconstruct decision context from evidence

import * as fs from 'fs'
import * as path from 'path'
import { Result, Ok, Err } from '../core/result'
import { JSONLLedger, JSONLRecord } from './jsonlLedger'
import { FileLedger, LedgerEntry } from './fileLedger'
import type { DecisionType } from '../core/decisionClassifier'

/**
 * Unified evidence entry - works with both ledger types
 */
export type EvidenceEntry = {
  id: string
  timestamp: number
  type: string
  hash: string
  previousHash?: string
  // The actual record data
  data: {
    proposalId?: string
    targetFile?: string
    decisionType?: DecisionType
    issueType?: string
    severity?: string
    source?: 'llm' | 'deterministic'
    gatesPassed?: string[]
    gatesFailed?: string[]
    rationale?: string
    // Consequence surface data
    enables?: string[]
    forbids?: string[]
    assumptions?: string[]
    // Alternative tracking
    alternativesConsidered?: number
    chosenRationale?: string
    // Raw record for unknown types
    [key: string]: unknown
  }
}

/**
 * Query filter options
 */
export type QueryFilter = {
  // Filter by target file
  targetFile?: string
  // Filter by decision type
  decisionType?: DecisionType
  // Filter by date range
  fromDate?: Date
  toDate?: Date
  // Filter by record type
  recordType?: string
  // Filter by issue severity
  severity?: 'critical' | 'high' | 'medium' | 'low'
  // Filter by source
  source?: 'llm' | 'deterministic'
  // Limit results
  limit?: number
  // Offset for pagination
  offset?: number
}

/**
 * Reconstructed decision context
 */
export type DecisionContext = {
  entry: EvidenceEntry
  // Related entries (same proposal/file)
  relatedEntries: EvidenceEntry[]
  // Consequence surface if available
  consequenceSurface?: {
    enables: string[]
    forbids: string[]
    assumptions: string[]
    validationCriteria: string[]
  }
  // Alternatives if available
  alternatives?: Array<{
    description: string
    rejectionReason: string
  }>
  // Gate validation results
  gateResults?: Array<{
    gateName: string
    passed: boolean
    error?: string
  }>
  // Timeline of related decisions
  timeline: Array<{
    timestamp: number
    type: string
    summary: string
  }>
}

/**
 * Query statistics
 */
export type QueryStats = {
  totalEntries: number
  matchingEntries: number
  byDecisionType: Record<string, number>
  byRecordType: Record<string, number>
  dateRange: {
    earliest: Date | null
    latest: Date | null
  }
}

/**
 * Evidence Query System
 * Provides a unified query interface across ledger types
 */
export class EvidenceQuery {
  private ledgerPath: string
  private ledgerType: 'jsonl' | 'file'
  private jsonlLedger?: JSONLLedger
  private fileLedger?: FileLedger

  constructor(ledgerPath: string) {
    this.ledgerPath = ledgerPath

    // Detect ledger type
    if (fs.existsSync(ledgerPath) && fs.statSync(ledgerPath).isFile()) {
      // JSONL ledger (single file)
      this.ledgerType = 'jsonl'
      this.jsonlLedger = new JSONLLedger(ledgerPath)
    } else {
      // File-based ledger (directory)
      this.ledgerType = 'file'
      this.fileLedger = new FileLedger(ledgerPath)
    }
  }

  /**
   * Get all entries (normalized to EvidenceEntry)
   */
  private getAllEntries(): Result<EvidenceEntry[], Error> {
    try {
      if (this.ledgerType === 'jsonl' && this.jsonlLedger) {
        const result = this.jsonlLedger.readAll()
        if (!result.ok) return Err(result.error)

        return Ok(result.value.map(r => this.normalizeJSONLRecord(r)))
      } else if (this.ledgerType === 'file' && this.fileLedger) {
        const entries = this.fileLedger.query()
        return Ok(entries.map(e => this.normalizeFileLedgerEntry(e)))
      }

      return Err(new Error('No ledger initialized'))
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Normalize JSONL record to EvidenceEntry
   */
  private normalizeJSONLRecord(record: JSONLRecord): EvidenceEntry {
    const data = record.record as Record<string, unknown>

    return {
      id: String(record.seq),
      timestamp: record.timestamp,
      type: record.record_type,
      hash: record.record_hash,
      previousHash: record.prev_hash !== 'genesis' ? record.prev_hash : undefined,
      data: {
        proposalId: data.proposalId as string | undefined,
        targetFile: data.targetFile as string | undefined,
        decisionType: data.decisionType as DecisionType | undefined,
        issueType: data.issueType as string | undefined,
        severity: data.severity as string | undefined,
        source: data.source as 'llm' | 'deterministic' | undefined,
        gatesPassed: data.gatesPassed as string[] | undefined,
        gatesFailed: data.gatesFailed as string[] | undefined,
        rationale: data.rationale as string | undefined,
        enables: data.enables as string[] | undefined,
        forbids: data.forbids as string[] | undefined,
        assumptions: data.assumptions as string[] | undefined,
        alternativesConsidered: data.alternativesConsidered as number | undefined,
        chosenRationale: data.chosenRationale as string | undefined,
        ...data
      }
    }
  }

  /**
   * Normalize FileLedger entry to EvidenceEntry
   */
  private normalizeFileLedgerEntry(entry: LedgerEntry): EvidenceEntry {
    const data = entry.data as Record<string, unknown>

    return {
      id: entry.id,
      timestamp: entry.timestamp,
      type: entry.type,
      hash: entry.hash,
      previousHash: entry.previousHash,
      data: {
        proposalId: data.proposalId as string | undefined,
        targetFile: data.targetFile as string | undefined,
        decisionType: data.decisionType as DecisionType | undefined,
        issueType: data.issueType as string | undefined,
        severity: data.severity as string | undefined,
        source: data.source as 'llm' | 'deterministic' | undefined,
        gatesPassed: data.gatesPassed as string[] | undefined,
        gatesFailed: data.gatesFailed as string[] | undefined,
        rationale: data.rationale as string | undefined,
        enables: data.enables as string[] | undefined,
        forbids: data.forbids as string[] | undefined,
        assumptions: data.assumptions as string[] | undefined,
        alternativesConsidered: data.alternativesConsidered as number | undefined,
        chosenRationale: data.chosenRationale as string | undefined,
        ...data
      }
    }
  }

  /**
   * Query entries by file path
   */
  byFile(filepath: string): Result<EvidenceEntry[], Error> {
    const allResult = this.getAllEntries()
    if (!allResult.ok) return Err(allResult.error)

    const matching = allResult.value.filter(e =>
      e.data.targetFile === filepath ||
      e.data.targetFile?.includes(filepath)
    )

    return Ok(matching)
  }

  /**
   * Query entries by date range
   */
  byDateRange(from: Date, to: Date): Result<EvidenceEntry[], Error> {
    const allResult = this.getAllEntries()
    if (!allResult.ok) return Err(allResult.error)

    const fromTime = from.getTime()
    const toTime = to.getTime()

    const matching = allResult.value.filter(e =>
      e.timestamp >= fromTime && e.timestamp <= toTime
    )

    return Ok(matching)
  }

  /**
   * Query entries by decision type
   */
  byDecisionType(decisionType: DecisionType): Result<EvidenceEntry[], Error> {
    const allResult = this.getAllEntries()
    if (!allResult.ok) return Err(allResult.error)

    const matching = allResult.value.filter(e =>
      e.data.decisionType === decisionType
    )

    return Ok(matching)
  }

  /**
   * Query entries by record type
   */
  byRecordType(recordType: string): Result<EvidenceEntry[], Error> {
    const allResult = this.getAllEntries()
    if (!allResult.ok) return Err(allResult.error)

    const matching = allResult.value.filter(e => e.type === recordType)

    return Ok(matching)
  }

  /**
   * Query with multiple filters
   */
  query(filter: QueryFilter): Result<EvidenceEntry[], Error> {
    const allResult = this.getAllEntries()
    if (!allResult.ok) return Err(allResult.error)

    let results = allResult.value

    // Apply filters
    if (filter.targetFile) {
      results = results.filter(e =>
        e.data.targetFile === filter.targetFile ||
        e.data.targetFile?.includes(filter.targetFile!)
      )
    }

    if (filter.decisionType) {
      results = results.filter(e => e.data.decisionType === filter.decisionType)
    }

    if (filter.fromDate) {
      const fromTime = filter.fromDate.getTime()
      results = results.filter(e => e.timestamp >= fromTime)
    }

    if (filter.toDate) {
      const toTime = filter.toDate.getTime()
      results = results.filter(e => e.timestamp <= toTime)
    }

    if (filter.recordType) {
      results = results.filter(e => e.type === filter.recordType)
    }

    if (filter.severity) {
      results = results.filter(e => e.data.severity === filter.severity)
    }

    if (filter.source) {
      results = results.filter(e => e.data.source === filter.source)
    }

    // Apply pagination
    if (filter.offset) {
      results = results.slice(filter.offset)
    }

    if (filter.limit) {
      results = results.slice(0, filter.limit)
    }

    return Ok(results)
  }

  /**
   * Reconstruct decision context from an entry
   * This answers: "why did we make this decision?"
   */
  reconstructContext(entryId: string): Result<DecisionContext, Error> {
    const allResult = this.getAllEntries()
    if (!allResult.ok) return Err(allResult.error)

    // Find the target entry
    const entry = allResult.value.find(e => e.id === entryId)
    if (!entry) {
      return Err(new Error(`Entry not found: ${entryId}`))
    }

    // Find related entries (same file or proposal)
    const relatedEntries = allResult.value.filter(e =>
      e.id !== entryId && (
        (entry.data.targetFile && e.data.targetFile === entry.data.targetFile) ||
        (entry.data.proposalId && e.data.proposalId === entry.data.proposalId)
      )
    )

    // Extract consequence surface if available
    const consequenceSurface = (entry.data.enables || entry.data.forbids) ? {
      enables: entry.data.enables || [],
      forbids: entry.data.forbids || [],
      assumptions: entry.data.assumptions || [],
      validationCriteria: []
    } : undefined

    // Build timeline
    const timeline = [entry, ...relatedEntries]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(e => ({
        timestamp: e.timestamp,
        type: e.type,
        summary: this.summarizeEntry(e)
      }))

    // Extract gate results if available
    const gateResults = entry.data.gatesPassed || entry.data.gatesFailed ? [
      ...(entry.data.gatesPassed || []).map(g => ({ gateName: g, passed: true })),
      ...(entry.data.gatesFailed || []).map(g => ({ gateName: g, passed: false }))
    ] : undefined

    return Ok({
      entry,
      relatedEntries,
      consequenceSurface,
      gateResults,
      timeline
    })
  }

  /**
   * Get statistics about the evidence store
   */
  getStats(): Result<QueryStats, Error> {
    const allResult = this.getAllEntries()
    if (!allResult.ok) return Err(allResult.error)

    const entries = allResult.value

    const byDecisionType: Record<string, number> = {}
    const byRecordType: Record<string, number> = {}
    let earliest: number | null = null
    let latest: number | null = null

    for (const entry of entries) {
      // Count by decision type
      const dt = entry.data.decisionType || 'unknown'
      byDecisionType[dt] = (byDecisionType[dt] || 0) + 1

      // Count by record type
      byRecordType[entry.type] = (byRecordType[entry.type] || 0) + 1

      // Track date range
      if (earliest === null || entry.timestamp < earliest) {
        earliest = entry.timestamp
      }
      if (latest === null || entry.timestamp > latest) {
        latest = entry.timestamp
      }
    }

    return Ok({
      totalEntries: entries.length,
      matchingEntries: entries.length,
      byDecisionType,
      byRecordType,
      dateRange: {
        earliest: earliest ? new Date(earliest) : null,
        latest: latest ? new Date(latest) : null
      }
    })
  }

  /**
   * Search entries by text pattern (in rationale, file path, etc.)
   */
  search(pattern: string): Result<EvidenceEntry[], Error> {
    const allResult = this.getAllEntries()
    if (!allResult.ok) return Err(allResult.error)

    const regex = new RegExp(pattern, 'i')

    const matching = allResult.value.filter(e =>
      regex.test(e.data.targetFile || '') ||
      regex.test(e.data.rationale || '') ||
      regex.test(e.data.issueType || '') ||
      regex.test(e.type)
    )

    return Ok(matching)
  }

  /**
   * Get entries that affected a specific file
   */
  getFileHistory(filepath: string): Result<EvidenceEntry[], Error> {
    const result = this.byFile(filepath)
    if (!result.ok) return Err(result.error)

    // Sort by timestamp (oldest first)
    const sorted = result.value.sort((a, b) => a.timestamp - b.timestamp)

    return Ok(sorted)
  }

  /**
   * Summarize an entry for display
   */
  private summarizeEntry(entry: EvidenceEntry): string {
    const parts: string[] = []

    if (entry.type) parts.push(`[${entry.type}]`)
    if (entry.data.targetFile) parts.push(entry.data.targetFile)
    if (entry.data.issueType) parts.push(entry.data.issueType)
    if (entry.data.decisionType) parts.push(`(${entry.data.decisionType})`)

    return parts.join(' ') || 'Unknown entry'
  }

  /**
   * Verify ledger integrity
   */
  verifyIntegrity(): Result<void, Error> {
    if (this.ledgerType === 'jsonl' && this.jsonlLedger) {
      return this.jsonlLedger.verifyChain()
    } else if (this.ledgerType === 'file' && this.fileLedger) {
      return this.fileLedger.verifyIntegrity()
    }

    return Err(new Error('No ledger initialized'))
  }

  /**
   * Get count of entries
   */
  count(): number {
    if (this.ledgerType === 'jsonl' && this.jsonlLedger) {
      return this.jsonlLedger.count()
    } else if (this.ledgerType === 'file' && this.fileLedger) {
      return this.fileLedger.count()
    }
    return 0
  }
}

/**
 * Format evidence entry for display
 */
export function formatEvidenceEntry(entry: EvidenceEntry): string {
  const lines: string[] = []
  const date = new Date(entry.timestamp).toISOString()

  lines.push('═══════════════════════════════════════════════════════════')
  lines.push(`EVIDENCE ENTRY: ${entry.id}`)
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('')
  lines.push(`Type: ${entry.type}`)
  lines.push(`Timestamp: ${date}`)
  lines.push(`Hash: ${entry.hash.substring(0, 16)}...`)

  if (entry.data.targetFile) {
    lines.push(`Target File: ${entry.data.targetFile}`)
  }

  if (entry.data.decisionType) {
    lines.push(`Decision Type: ${entry.data.decisionType}`)
  }

  if (entry.data.issueType) {
    lines.push(`Issue: ${entry.data.issueType} (${entry.data.severity || 'unknown'})`)
  }

  if (entry.data.rationale) {
    lines.push('')
    lines.push('Rationale:')
    lines.push(`  ${entry.data.rationale}`)
  }

  if (entry.data.enables?.length || entry.data.forbids?.length) {
    lines.push('')
    lines.push('Consequence Surface:')
    if (entry.data.enables?.length) {
      lines.push(`  Enables: ${entry.data.enables.join(', ')}`)
    }
    if (entry.data.forbids?.length) {
      lines.push(`  Forbids: ${entry.data.forbids.join(', ')}`)
    }
  }

  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════')

  return lines.join('\n')
}

/**
 * Format decision context for display
 */
export function formatDecisionContext(context: DecisionContext): string {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('DECISION CONTEXT RECONSTRUCTION')
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('')

  // Main entry
  lines.push('PRIMARY DECISION:')
  lines.push(`  ID: ${context.entry.id}`)
  lines.push(`  Type: ${context.entry.type}`)
  lines.push(`  Date: ${new Date(context.entry.timestamp).toISOString()}`)
  lines.push(`  File: ${context.entry.data.targetFile || 'N/A'}`)

  if (context.entry.data.rationale) {
    lines.push(`  Rationale: ${context.entry.data.rationale}`)
  }

  lines.push('')

  // Consequence surface
  if (context.consequenceSurface) {
    lines.push('CONSEQUENCE SURFACE:')
    lines.push(`  Enables: ${context.consequenceSurface.enables.join(', ') || 'None'}`)
    lines.push(`  Forbids: ${context.consequenceSurface.forbids.join(', ') || 'None'}`)
    lines.push(`  Assumptions: ${context.consequenceSurface.assumptions.join(', ') || 'None'}`)
    lines.push('')
  }

  // Gate results
  if (context.gateResults?.length) {
    lines.push('GATE VALIDATION:')
    for (const gate of context.gateResults) {
      const status = gate.passed ? '✓' : '✗'
      lines.push(`  ${status} ${gate.gateName}${gate.error ? `: ${gate.error}` : ''}`)
    }
    lines.push('')
  }

  // Timeline
  if (context.timeline.length > 1) {
    lines.push('TIMELINE:')
    for (const event of context.timeline) {
      const date = new Date(event.timestamp).toISOString()
      lines.push(`  ${date}: ${event.summary}`)
    }
    lines.push('')
  }

  // Related entries
  if (context.relatedEntries.length > 0) {
    lines.push(`RELATED ENTRIES: ${context.relatedEntries.length}`)
    for (const related of context.relatedEntries.slice(0, 5)) {
      lines.push(`  - ${related.id}: ${related.type}`)
    }
    if (context.relatedEntries.length > 5) {
      lines.push(`  ... and ${context.relatedEntries.length - 5} more`)
    }
  }

  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════')

  return lines.join('\n')
}
