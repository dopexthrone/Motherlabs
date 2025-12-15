"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorizationRouter = void 0;
exports.initializeAuthorizationRouter = initializeAuthorizationRouter;
exports.getAuthorizationRouter = getAuthorizationRouter;
exports.isAuthorizationRouterInitialized = isAuthorizationRouterInitialized;
const result_1 = require("../core/result");
const contentAddress_1 = require("../core/contentAddress");
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
class AuthorizationRouter {
    ledger;
    constructor(ledger) {
        this.ledger = ledger;
    }
    /**
     * Request authorization for an action
     *
     * DENY-BY-DEFAULT: Returns Err if no prior ALLOW decision exists
     */
    requestAuthorization(targetId, gateType, requiredEffects) {
        // Find prior ALLOW decision for this target
        const decisionsResult = this.ledger.getGateDecisions();
        if (!decisionsResult.ok) {
            return (0, result_1.Err)(new Error(`AUTHORIZATION DENIED: Cannot read ledger gate decisions: ${decisionsResult.error.message}`));
        }
        const decisions = decisionsResult.value;
        const allowDecision = this.findPriorAllow(decisions, targetId, gateType);
        // DENY-BY-DEFAULT: No ALLOW decision = DENY
        if (!allowDecision) {
            return (0, result_1.Err)(new Error(`AUTHORIZATION DENIED: No prior ALLOW decision for target ${targetId} ` +
                `with gate type ${gateType}. ` +
                `Authorization Router enforces deny-by-default.`));
        }
        // Verify all required effects are granted
        const grantedEffects = allowDecision.scope.granted_effects || [];
        const missingEffects = requiredEffects.filter(e => !grantedEffects.includes(e));
        if (missingEffects.length > 0) {
            return (0, result_1.Err)(new Error(`AUTHORIZATION DENIED: Required effects [${missingEffects.join(', ')}] ` +
                `not granted by ALLOW decision. Granted: [${grantedEffects.join(', ')}]`));
        }
        // Issue token - DETERMINISTIC
        // Token ID computed from authorization truth only (no time)
        const authorizationTruth = {
            authorization_decision_id: (0, contentAddress_1.contentAddress)(allowDecision),
            target_id: targetId,
            gate_type: gateType,
            granted_effects: grantedEffects
        };
        const token = {
            token_id: (0, contentAddress_1.contentAddress)(authorizationTruth),
            ...authorizationTruth,
            // Metadata only - not part of token_id, not verified
            issued_at_metadata: Date.now()
        };
        return (0, result_1.Ok)(token);
    }
    /**
     * Verify a token is valid for execution
     *
     * DETERMINISM: Verification checks ledger state only, NOT wall-clock.
     * Authorization truth comes from the ledger. Time is adversarial.
     */
    verifyToken(token) {
        // Verify token integrity (recompute token_id from authorization truth only)
        // Note: issued_at_metadata is NOT part of token_id
        const authorizationTruth = {
            authorization_decision_id: token.authorization_decision_id,
            target_id: token.target_id,
            gate_type: token.gate_type,
            granted_effects: token.granted_effects
        };
        const expectedId = (0, contentAddress_1.contentAddress)(authorizationTruth);
        if (token.token_id !== expectedId) {
            return (0, result_1.Err)(new Error(`AUTHORIZATION DENIED: Token integrity check failed. ` +
                `Token may have been tampered with.`));
        }
        // Verify the original ALLOW decision still exists in ledger
        // This is the authoritative source of truth - NOT time
        const decisionsResult = this.ledger.getGateDecisions();
        if (!decisionsResult.ok) {
            return (0, result_1.Err)(new Error(`AUTHORIZATION DENIED: Cannot read ledger: ${decisionsResult.error.message}`));
        }
        const originalDecision = decisionsResult.value.find(d => (0, contentAddress_1.contentAddress)(d) === token.authorization_decision_id);
        if (!originalDecision) {
            return (0, result_1.Err)(new Error(`AUTHORIZATION DENIED: Original ALLOW decision no longer in ledger. ` +
                `Decision ID: ${token.authorization_decision_id}`));
        }
        return (0, result_1.Ok)(void 0);
    }
    /**
     * Find prior ALLOW decision for target
     */
    findPriorAllow(decisions, targetId, gateType) {
        // Search in reverse order (most recent first)
        for (let i = decisions.length - 1; i >= 0; i--) {
            const decision = decisions[i];
            if (decision.scope.target_id === targetId &&
                decision.gate_type === gateType &&
                decision.decision === 'ALLOW') {
                return decision;
            }
        }
        return undefined;
    }
}
exports.AuthorizationRouter = AuthorizationRouter;
/**
 * Singleton authorization router instance
 * Must be initialized with ledger before use
 */
let globalRouter = null;
function initializeAuthorizationRouter(ledger) {
    globalRouter = new AuthorizationRouter(ledger);
}
function getAuthorizationRouter() {
    if (!globalRouter) {
        throw new Error('Authorization Router not initialized. ' +
            'Call initializeAuthorizationRouter(ledger) first.');
    }
    return globalRouter;
}
/**
 * Check if authorization router is initialized
 */
function isAuthorizationRouterInitialized() {
    return globalRouter !== null;
}
