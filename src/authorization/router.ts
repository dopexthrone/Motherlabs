// Authorization Router - Deny-by-default enforcement
// TCB Component: This file is part of the Trusted Computing Base
//
// INVARIANT: No execution without prior ALLOW decision in ledger
// INVARIANT: Missing authorization = DENY (deny-by-default)
// INVARIANT: Token required for all effect/tool execution

import { Result, Ok, Err } from '../core/result'
import { contentAddress } from '../core/contentAddress'
import { globalTimeProvider } from '../core/ids'
import type { GateDecision, AuthorizationGateType } from '../core/gateDecision'
import type { EffectType } from '../core/effects'

/**
 * Authorization token - proof that execution is authorized
 * Cannot be forged: contains content-addressed reference to ALLOW decision
 */
export type AuthorizationToken = {
  /** Token ID - content address of this token */
  readonly token_id: string
  /** Reference to the ALLOW decision that authorized this */
  readonly authorization_decision_id: string
  /** What target this authorizes */
  readonly target_id: string
  /** What gate type authorized this */
  readonly gate_type: AuthorizationGateType
  /** Effects granted by this authorization */
  readonly granted_effects: readonly EffectType[]
  /** When this token was issued */
  readonly issued_at: number
  /** Expiry (tokens are single-use but have time bound) */
  readonly expires_at: number
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
 */
export class AuthorizationRouter {
  private ledger: AuthorizationLedger
  private tokenValidityMs: number

  constructor(ledger: AuthorizationLedger, tokenValidityMs: number = 60000) {
    this.ledger = ledger
    this.tokenValidityMs = tokenValidityMs
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

    // Issue token
    const now = globalTimeProvider.now()
    const tokenData = {
      authorization_decision_id: contentAddress(allowDecision),
      target_id: targetId,
      gate_type: gateType,
      granted_effects: grantedEffects,
      issued_at: now,
      expires_at: now + this.tokenValidityMs
    }

    const token: AuthorizationToken = {
      token_id: contentAddress(tokenData),
      ...tokenData
    }

    return Ok(token)
  }

  /**
   * Verify a token is valid for execution
   */
  verifyToken(token: AuthorizationToken): Result<void, Error> {
    const now = globalTimeProvider.now()

    // Check expiry
    if (now > token.expires_at) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Token expired at ${new Date(token.expires_at).toISOString()}`
      ))
    }

    // Verify token integrity (recompute token_id)
    const { token_id, ...tokenData } = token
    const expectedId = contentAddress(tokenData)
    if (token_id !== expectedId) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Token integrity check failed. ` +
        `Token may have been tampered with.`
      ))
    }

    // Verify the original ALLOW decision still exists in ledger
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
