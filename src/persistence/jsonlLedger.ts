// JSONL Ledger - Single file, append-only, hash-chained

import * as fs from 'fs'
import * as crypto from 'crypto'
import { Result, Ok, Err } from '../core/result'
import { contentAddress, canonicalJSON } from '../core/contentAddress'

export type JSONLRecord = {
  record_type: string
  seq: number
  timestamp: number
  prev_hash: string
  record: unknown
  record_hash: string
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

    genesis.record_hash = contentAddress(genesis)

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

      entry.record_hash = contentAddress(entry)

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

    let expectedPrev = 'genesis'

    for (const record of all.value) {
      // Verify prev_hash
      if (record.prev_hash !== expectedPrev) {
        return Err(new Error(`Hash chain break at seq ${record.seq}`))
      }

      // Verify record_hash
      const computed = contentAddress(record)
      if (computed !== record.record_hash) {
        return Err(new Error(`Hash mismatch at seq ${record.seq}`))
      }

      expectedPrev = record.record_hash
    }

    return Ok(void 0)
  }

  count(): number {
    return this.seq
  }
}
