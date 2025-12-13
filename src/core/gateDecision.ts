// Gate Decision Ledgering - All ALLOW/DENY decisions recorded

import { contentAddress } from './contentAddress'
import { globalTimeProvider } from './ids'

export type GateType =
  | 'schema_validation'
  | 'syntax_validation'
  | 'variable_resolution'
  | 'test_execution'
  | 'urco_entropy'
  | 'governance_check'
  | 'determinism_check'
  | 'mock_bias_check'

export type GateDecision = {
  gate_type: GateType
  decision: 'ALLOW' | 'DENY'
  target: {
    type: string
    id: string
    contentAddress?: string
  }
  timestamp: number
  reason: string
  details?: Record<string, unknown>
}

/**
 * Create gate decision record (ledgered for audit trail)
 */
export function createGateDecision(
  gate: GateType,
  decision: 'ALLOW' | 'DENY',
  target: unknown,
  reason: string,
  details?: Record<string, unknown>
): GateDecision {
  const targetId = typeof target === 'object' && target !== null && 'id' in target
    ? String((target as any).id)
    : 'unknown'

  const targetType = typeof target === 'object' && target !== null && 'type' in target
    ? String((target as any).type)
    : typeof target

  return {
    gate_type: gate,
    decision,
    target: {
      type: targetType,
      id: targetId,
      contentAddress: contentAddress(target)
    },
    timestamp: globalTimeProvider.now(),
    reason,
    details
  }
}

/**
 * Log gate decision to ledger
 */
export async function logGateDecision(
  decision: GateDecision,
  ledger: { append: (entry: any) => Promise<any> }
): Promise<void> {
  await ledger.append({
    id: contentAddress(decision),
    timestamp: decision.timestamp,
    type: 'gate_decision',
    data: decision,
    hash: contentAddress(decision)
  })
}
