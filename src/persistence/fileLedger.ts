// Persistent File-Based Ledger - Append-only, immutable, verifiable

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { Result, Ok, Err } from '../core/result'
import { globalTimeProvider } from '../core/ids'

export type LedgerEntry = {
  id: string
  timestamp: number
  type: string
  data: unknown
  hash: string
  previousHash?: string
}

export class FileLedger {
  private ledgerPath: string
  private lastHash: string | null = null
  private entryCount: number = 0

  constructor(ledgerPath: string) {
    this.ledgerPath = ledgerPath

    // Ensure directory exists
    if (!fs.existsSync(ledgerPath)) {
      fs.mkdirSync(ledgerPath, { recursive: true })
    }

    // Load existing entries to get last hash
    this.initialize()
  }

  private initialize(): void {
    const files = fs.readdirSync(this.ledgerPath)
      .filter(f => f.endsWith('.json'))
      .sort()

    if (files.length > 0) {
      const lastFile = files[files.length - 1]
      const content = fs.readFileSync(path.join(this.ledgerPath, lastFile), 'utf-8')
      const entry = JSON.parse(content) as LedgerEntry
      this.lastHash = entry.hash
      this.entryCount = files.length
    }
  }

  /**
   * Append entry to ledger (atomic, immutable)
   */
  async append(entry: Omit<LedgerEntry, 'hash' | 'previousHash'>): Promise<Result<LedgerEntry, Error>> {
    try {
      // Compute hash (deterministic)
      const canonical = JSON.stringify({
        id: entry.id,
        timestamp: entry.timestamp,
        type: entry.type,
        data: entry.data
      })
      const hash = crypto.createHash('sha256').update(canonical).digest('hex')

      // Create full entry with hash chain
      const fullEntry: LedgerEntry = {
        ...entry,
        hash,
        previousHash: this.lastHash || undefined
      }

      // Atomic write: write to .tmp, then rename
      const filename = `${String(this.entryCount).padStart(8, '0')}-${entry.id}.json`
      const filepath = path.join(this.ledgerPath, filename)
      const tmpPath = `${filepath}.tmp`

      // Write to temp file
      fs.writeFileSync(tmpPath, JSON.stringify(fullEntry, null, 2), 'utf-8')

      // Verify written correctly
      const written = fs.readFileSync(tmpPath, 'utf-8')
      const parsed = JSON.parse(written) as LedgerEntry

      if (parsed.hash !== hash) {
        fs.unlinkSync(tmpPath)
        return Err(new Error('Hash verification failed after write'))
      }

      // Atomic rename
      fs.renameSync(tmpPath, filepath)

      // Update state
      this.lastHash = hash
      this.entryCount++

      return Ok(fullEntry)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Query entries by type
   */
  query(type?: string): LedgerEntry[] {
    const files = fs.readdirSync(this.ledgerPath)
      .filter(f => f.endsWith('.json'))
      .sort()

    const entries: LedgerEntry[] = []

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.ledgerPath, file), 'utf-8')
      const entry = JSON.parse(content) as LedgerEntry

      if (!type || entry.type === type) {
        entries.push(entry)
      }
    }

    return entries
  }

  /**
   * Verify hash chain integrity
   */
  verifyIntegrity(): Result<void, Error> {
    const files = fs.readdirSync(this.ledgerPath)
      .filter(f => f.endsWith('.json'))
      .sort()

    let previousHash: string | null = null

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.ledgerPath, file), 'utf-8')
      const entry = JSON.parse(content) as LedgerEntry

      // Verify hash is correct
      const canonical = JSON.stringify({
        id: entry.id,
        timestamp: entry.timestamp,
        type: entry.type,
        data: entry.data
      })
      const computedHash = crypto.createHash('sha256').update(canonical).digest('hex')

      if (computedHash !== entry.hash) {
        return Err(new Error(`Hash mismatch in ${file}`))
      }

      // Verify chain
      if (previousHash !== null && entry.previousHash !== previousHash) {
        return Err(new Error(`Chain break in ${file}`))
      }

      previousHash = entry.hash
    }

    return Ok(void 0)
  }

  count(): number {
    return this.entryCount
  }
}
