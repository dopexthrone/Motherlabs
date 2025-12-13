// Evidence Ledger - Append-only truth substrate

import { Evidence } from './types'

export class Ledger {
  private records: Evidence[] = []

  append(evidence: Evidence): void {
    // Deep freeze the record for true immutability
    const frozenEvidence = deepFreeze(evidence)
    this.records.push(frozenEvidence)
  }

  query(taskId: string): Evidence[] {
    // Return defensive copy to prevent external mutation
    return this.records
      .filter(r => r.taskId === taskId)
      .map(r => ({ ...r }))
  }

  all(): readonly Evidence[] {
    // Return defensive copy
    return [...this.records]
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
  return {
    id: `${taskId}-${type}-${Date.now()}`,
    taskId,
    type,
    timestamp: Date.now(),
    data
  }
}
