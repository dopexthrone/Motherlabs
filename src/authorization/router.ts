// Authorization Router - Deny-by-default enforcement
// TCB Component: This file is part of the Trusted Computing Base
//
// INVARIANT: No execution without prior ALLOW decision in ledger
// INVARIANT: Missing authorization = DENY (deny-by-default)
// INVARIANT: Token required for all effect/tool execution
// INVARIANT: Token is DETERMINISTIC - derived only from authorization truth, not time
//
// DETERMINISM AXIOM: Time is adversarial. Authorization truth comes from ledger only.
// Token verification checks ledger state, not wall-clock.

import { Result, Ok, Err } from '../core/result'
import { contentAddress } from '../core/contentAddress'
import type { GateDecision, AuthorizationGateType } from '../core/gateDecision'
import type { EffectType } from '../core/effects'

/**
 * Authorization token - proof that execution is authorized
 * Cannot be forged: contains content-addressed reference to ALLOW decision
 *
 * DETERMINISM: token_id is computed from authorization truth only:
 *   - authorization_decision_id
 *   - target_id
 *   - gate_type
 *   - granted_effects
 *
 * issued_at is METADATA ONLY - not part of token_id, not checked during verification
 */
export type AuthorizationToken = {
  /** Token ID - content address of authorization truth (deterministic) */
  readonly token_id: string
  /** Reference to the ALLOW decision that authorized this */
  readonly authorization_decision_id: string
  /** What target this authorizes */
  readonly target_id: string
  /** What gate type authorized this */
  readonly gate_type: AuthorizationGateType
  /** Effects granted by this authorization */
  readonly granted_effects: readonly EffectType[]
  /** METADATA ONLY: When this token was issued (not part of token_id, not verified) */
  readonly issued_at_metadata?: number
}

/**
 * Ledger interface for authorization router
 */
export interface AuthorizationLedger {
  getGateDecisions(): { ok: true; value: GateDecision[] } | { ok: false; error: Error }
}

/**
 * Authorization Router - enforces deny-by-default
 *
 * AXIOM: No action proceeds without explicit ALLOW token
 * AXIOM: Token can only be issued if prior ALLOW decision exists in ledger
 * AXIOM: Token validity derived from ledger state, not wall-clock
 *
 * DETERMINISM GUARANTEE:
 * Given identical ledger state, requestAuthorization() returns identical token_id.
 * This enables replay verification and audit.
 */
export class AuthorizationRouter {
  private ledger: AuthorizationLedger

  constructor(ledger: AuthorizationLedger) {
    this.ledger = ledger
  }

  /**
   * Request authorization for an action
   *
   * DENY-BY-DEFAULT: Returns Err if no prior ALLOW decision exists
   */
  requestAuthorization(
    targetId: string,
    gateType: AuthorizationGateType,
    requiredEffects: EffectType[]
  ): Result<AuthorizationToken, Error> {
    // Find prior ALLOW decision for this target
    const decisionsResult = this.ledger.getGateDecisions()
    if (!decisionsResult.ok) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Cannot read ledger gate decisions: ${decisionsResult.error.message}`
      ))
    }
    const decisions = decisionsResult.value
    const allowDecision = this.findPriorAllow(decisions, targetId, gateType)

    // DENY-BY-DEFAULT: No ALLOW decision = DENY
    if (!allowDecision) {
      return Err(new Error(
        `AUTHORIZATION DENIED: No prior ALLOW decision for target ${targetId} ` +
        `with gate type ${gateType}. ` +
        `Authorization Router enforces deny-by-default.`
      ))
    }

    // Verify all required effects are granted
    const grantedEffects = allowDecision.scope.granted_effects || []
    const missingEffects = requiredEffects.filter(e => !grantedEffects.includes(e))

    if (missingEffects.length > 0) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Required effects [${missingEffects.join(', ')}] ` +
        `not granted by ALLOW decision. Granted: [${grantedEffects.join(', ')}]`
      ))
    }

    // Issue token - DETERMINISTIC
    // Token ID computed from authorization truth only (no time)
    const authorizationTruth = {
      authorization_decision_id: contentAddress(allowDecision),
      target_id: targetId,
      gate_type: gateType,
      granted_effects: grantedEffects
    }

    const token: AuthorizationToken = {
      token_id: contentAddress(authorizationTruth),
      ...authorizationTruth,
      // Metadata only - not part of token_id, not verified
      issued_at_metadata: Date.now()
    }

    return Ok(token)
  }

  /**
   * Verify a token is valid for execution
   *
   * DETERMINISM: Verification checks ledger state only, NOT wall-clock.
   * Authorization truth comes from the ledger. Time is adversarial.
   */
  verifyToken(token: AuthorizationToken): Result<void, Error> {
    // Verify token integrity (recompute token_id from authorization truth only)
    // Note: issued_at_metadata is NOT part of token_id
    const authorizationTruth = {
      authorization_decision_id: token.authorization_decision_id,
      target_id: token.target_id,
      gate_type: token.gate_type,
      granted_effects: token.granted_effects
    }
    const expectedId = contentAddress(authorizationTruth)
    if (token.token_id !== expectedId) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Token integrity check failed. ` +
        `Token may have been tampered with.`
      ))
    }

    // Verify the original ALLOW decision still exists in ledger
    // This is the authoritative source of truth - NOT time
    const decisionsResult = this.ledger.getGateDecisions()
    if (!decisionsResult.ok) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Cannot read ledger: ${decisionsResult.error.message}`
      ))
    }
    const originalDecision = decisionsResult.value.find(d =>
      contentAddress(d) === token.authorization_decision_id
    )

    if (!originalDecision) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Original ALLOW decision no longer in ledger. ` +
        `Decision ID: ${token.authorization_decision_id}`
      ))
    }

    return Ok(void 0)
  }

  /**
   * Find prior ALLOW decision for target
   */
  private findPriorAllow(
    decisions: GateDecision[],
    targetId: string,
    gateType: AuthorizationGateType
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
}

/**
 * Singleton authorization router instance
 * Must be initialized with ledger before use
 */
let globalRouter: AuthorizationRouter | null = null

export function initializeAuthorizationRouter(ledger: AuthorizationLedger): void {
  globalRouter = new AuthorizationRouter(ledger)
}

export function getAuthorizationRouter(): AuthorizationRouter {
  if (!globalRouter) {
    throw new Error(
      'Authorization Router not initialized. ' +
      'Call initializeAuthorizationRouter(ledger) first.'
    )
  }
  return globalRouter
}

/**
 * Check if authorization router is initialized
 */
export function isAuthorizationRouterInitialized(): boolean {
  return globalRouter !== null
}
