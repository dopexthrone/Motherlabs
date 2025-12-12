// Evidence Ledger - Append-only truth substrate

import { Evidence } from './types'

export class Ledger {
  private records: Evidence[] = []

  append(evidence: Evidence): void {
    // Append-only: freeze the record
    this.records.push(Object.freeze(evidence))
  }

  query(taskId: string): Evidence[] {
    return this.records.filter(r => r.taskId === taskId)
  }

  all(): readonly Evidence[] {
    return this.records
  }

  count(): number {
    return this.records.length
  }
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
