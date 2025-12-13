// Evidence Ledger - Append-only truth substrate

import { Evidence } from './types'
import { globalIdGenerator, globalTimeProvider } from './core/ids'

const MAX_LEDGER_SIZE = 10_000  // Prevent memory exhaustion

export class Ledger {
  private records: Evidence[] = []
  private maxSize: number

  constructor(maxSize: number = MAX_LEDGER_SIZE) {
    this.maxSize = maxSize
  }

  append(evidence: Evidence): void {
    // FIXED: Enforce size limit to prevent memory exhaustion
    if (this.records.length >= this.maxSize) {
      throw new Error(`Ledger size limit reached (${this.maxSize}). Consider archiving old records.`)
    }

    // Deep freeze the record for true immutability
    const frozenEvidence = deepFreeze(evidence)
    this.records.push(frozenEvidence)
  }

  query(taskId: string): Evidence[] {
    // FIXED: Deep copy to prevent mutation of nested data
    return this.records
      .filter(r => r.taskId === taskId)
      .map(r => JSON.parse(JSON.stringify(r)))
  }

  all(): readonly Evidence[] {
    // FIXED: Deep copy to prevent mutation
    return this.records.map(r => JSON.parse(JSON.stringify(r)))
  }

  count(): number {
    return this.records.length
  }
}

/**
 * Deep freeze object and all nested properties
 */
function deepFreeze<T>(obj: T): T {
  // Freeze the object itself
  Object.freeze(obj)

  // Recursively freeze all properties
  Object.getOwnPropertyNames(obj).forEach(prop => {
    // SAFETY: Using 'as any' here is safe because:
    // - We're only reading properties (no mutation)
    // - We type-check the value before recursion (typeof check)
    // - This is bounded to object property iteration only
    // - Alternative would be Record<string, unknown> but loses type info
    const value = (obj as any)[prop]
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value)
    }
  })

  return obj
}

export function createEvidence(
  taskId: string,
  type: Evidence['type'],
  data: unknown
): Evidence {
  // FIXED: Use monotonic ID generator for determinism // DETERMINISM-EXEMPT: comment
  return {
    id: globalIdGenerator.evidenceId(taskId, type),
    taskId,
    type,
    timestamp: globalTimeProvider.now(),
    data
  }
}
