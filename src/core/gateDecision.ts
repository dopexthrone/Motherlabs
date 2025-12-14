// Gate Decision Ledgering - All ALLOW/DENY decisions recorded
// Ported from manual kernel verifier governance patterns

import { contentAddress } from './contentAddress'
import { globalTimeProvider } from './ids'
import type { EffectType } from './effects'

/**
 * Validation gate types (6-gate validation system)
 */
export type ValidationGateType =
  | 'schema_validation'
  | 'syntax_validation'
  | 'variable_resolution'
  | 'test_execution'
  | 'urco_entropy'
  | 'governance_check'
  | 'determinism_check'
  | 'mock_bias_check'

/**
 * Authorization gate types (governance system)
 */
export type AuthorizationGateType =
  | 'proposal_admission'     // New proposal to ledger
  | 'change_application'     // Apply code change
  | 'llm_generation'         // LLM code generation
  | 'human_approval'         // Human approval gate
  | 'execution_attempt'      // Execute artifact
  | 'ledger_freeze'          // Freeze ledger state

/**
 * Combined gate type for all gates
 */
export type GateType = ValidationGateType | AuthorizationGateType

/**
 * Scope of a gate decision
 */
export type GateDecisionScope = {
  /** Type of target (proposal, code, file, execution) */
  target_type: 'proposal' | 'code' | 'file' | 'execution' | 'ledger'
  /** Content-addressed ID of target */
  target_id: string
  /** Optional file path if applicable */
  target_file?: string
  /** Effects granted by this decision (for ALLOW) */
  granted_effects?: EffectType[]
}

/**
 * Gate decision record (for ledger storage)
 */
export type GateDecision = {
  gate_type: GateType
  decision: 'ALLOW' | 'DENY'
  scope: GateDecisionScope
  /** Who/what authorized this decision */
  authorizer: string
  /** ISO 8601 timestamp */
  issued_at_utc: string
  /** Human-readable reason */
  reason: string
  /** Additional details */
  details?: Record<string, unknown>
}

/**
 * Legacy target format (for backwards compatibility)
 */
export type LegacyTarget = {
  type: string
  id: string
  contentAddress?: string
}

/**
 * Legacy gate decision format (for backwards compatibility)
 */
export type LegacyGateDecision = {
  gate_type: GateType
  decision: 'ALLOW' | 'DENY'
  target: LegacyTarget
  timestamp: number
  reason: string
  details?: Record<string, unknown>
}

/**
 * Create gate decision record (new governance format)
 */
export function createGateDecision(
  gate: GateType,
  decision: 'ALLOW' | 'DENY',
  scope: GateDecisionScope,
  authorizer: string,
  reason: string,
  details?: Record<string, unknown>
): GateDecision {
  return {
    gate_type: gate,
    decision,
    scope,
    authorizer,
    issued_at_utc: new Date(globalTimeProvider.now()).toISOString(),
    reason,
    details
  }
}

/**
 * Create gate decision scope from target content
 */
export function createGateDecisionScope(
  targetType: GateDecisionScope['target_type'],
  target: unknown,
  targetFile?: string,
  grantedEffects?: EffectType[]
): GateDecisionScope {
  return {
    target_type: targetType,
    target_id: contentAddress(target),
    target_file: targetFile,
    granted_effects: grantedEffects
  }
}

/**
 * Create legacy gate decision (for backwards compatibility)
 */
export function createLegacyGateDecision(
  gate: GateType,
  decision: 'ALLOW' | 'DENY',
  target: unknown,
  reason: string,
  details?: Record<string, unknown>
): LegacyGateDecision {
  const targetId = typeof target === 'object' && target !== null && 'id' in target
    ? String((target as Record<string, unknown>).id)
    : 'unknown'

  const targetType = typeof target === 'object' && target !== null && 'type' in target
    ? String((target as Record<string, unknown>).type)
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
 * Log gate decision to ledger (new format)
 */
export async function logGateDecision(
  decision: GateDecision,
  ledger: { append: (recordType: string, record: unknown) => Promise<unknown> }
): Promise<void> {
  await ledger.append('GATE_DECISION', {
    ...decision,
    decision_id: contentAddress(decision)
  })
}

/**
 * Log legacy gate decision to ledger (backwards compatible)
 */
export async function logLegacyGateDecision(
  decision: LegacyGateDecision,
  ledger: { append: (entry: unknown) => Promise<unknown> }
): Promise<void> {
  await ledger.append({
    id: contentAddress(decision),
    timestamp: decision.timestamp,
    type: 'gate_decision',
    data: decision,
    hash: contentAddress(decision)
  })
}

/**
 * Check if a gate decision authorizes a specific effect
 */
export function isEffectAuthorized(
  decision: GateDecision,
  effect: EffectType
): boolean {
  if (decision.decision !== 'ALLOW') return false
  if (!decision.scope.granted_effects) return false
  return decision.scope.granted_effects.includes(effect)
}

/**
 * Find prior ALLOW decision for a target
 */
export function findPriorAuthorization(
  decisions: GateDecision[],
  targetId: string,
  gateType: GateType
): GateDecision | undefined {
  // Search in reverse order (most recent first)
  for (let i = decisions.length - 1; i >= 0; i--) {
    const decision = decisions[i]
    if (
      decision.scope.target_id === targetId &&
      decision.gate_type === gateType &&
      decision.decision === 'ALLOW'
    ) {
      return decision
    }
  }
  return undefined
}

/**
 * Check if action requires prior authorization
 */
export function requiresAuthorization(gateType: GateType): boolean {
  const authorizationGates: GateType[] = [
    'proposal_admission',
    'change_application',
    'llm_generation',
    'human_approval',
    'execution_attempt',
    'ledger_freeze'
  ]
  return authorizationGates.includes(gateType)
}
