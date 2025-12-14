"use strict";
// Gate Decision Ledgering - All ALLOW/DENY decisions recorded
// Ported from manual kernel verifier governance patterns
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGateDecision = createGateDecision;
exports.createGateDecisionScope = createGateDecisionScope;
exports.createLegacyGateDecision = createLegacyGateDecision;
exports.logGateDecision = logGateDecision;
exports.logLegacyGateDecision = logLegacyGateDecision;
exports.isEffectAuthorized = isEffectAuthorized;
exports.findPriorAuthorization = findPriorAuthorization;
exports.requiresAuthorization = requiresAuthorization;
const contentAddress_1 = require("./contentAddress");
const ids_1 = require("./ids");
/**
 * Create gate decision record (new governance format)
 */
function createGateDecision(gate, decision, scope, authorizer, reason, details) {
    return {
        gate_type: gate,
        decision,
        scope,
        authorizer,
        issued_at_utc: new Date(ids_1.globalTimeProvider.now()).toISOString(),
        reason,
        details
    };
}
/**
 * Create gate decision scope from target content
 */
function createGateDecisionScope(targetType, target, targetFile, grantedEffects) {
    return {
        target_type: targetType,
        target_id: (0, contentAddress_1.contentAddress)(target),
        target_file: targetFile,
        granted_effects: grantedEffects
    };
}
/**
 * Create legacy gate decision (for backwards compatibility)
 */
function createLegacyGateDecision(gate, decision, target, reason, details) {
    const targetId = typeof target === 'object' && target !== null && 'id' in target
        ? String(target.id)
        : 'unknown';
    const targetType = typeof target === 'object' && target !== null && 'type' in target
        ? String(target.type)
        : typeof target;
    return {
        gate_type: gate,
        decision,
        target: {
            type: targetType,
            id: targetId,
            contentAddress: (0, contentAddress_1.contentAddress)(target)
        },
        timestamp: ids_1.globalTimeProvider.now(),
        reason,
        details
    };
}
/**
 * Log gate decision to ledger (new format)
 */
async function logGateDecision(decision, ledger) {
    await ledger.append('GATE_DECISION', {
        ...decision,
        decision_id: (0, contentAddress_1.contentAddress)(decision)
    });
}
/**
 * Log legacy gate decision to ledger (backwards compatible)
 */
async function logLegacyGateDecision(decision, ledger) {
    await ledger.append({
        id: (0, contentAddress_1.contentAddress)(decision),
        timestamp: decision.timestamp,
        type: 'gate_decision',
        data: decision,
        hash: (0, contentAddress_1.contentAddress)(decision)
    });
}
/**
 * Check if a gate decision authorizes a specific effect
 */
function isEffectAuthorized(decision, effect) {
    if (decision.decision !== 'ALLOW')
        return false;
    if (!decision.scope.granted_effects)
        return false;
    return decision.scope.granted_effects.includes(effect);
}
/**
 * Find prior ALLOW decision for a target
 */
function findPriorAuthorization(decisions, targetId, gateType) {
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
/**
 * Check if action requires prior authorization
 */
function requiresAuthorization(gateType) {
    const authorizationGates = [
        'proposal_admission',
        'change_application',
        'llm_generation',
        'human_approval',
        'execution_attempt',
        'ledger_freeze'
    ];
    return authorizationGates.includes(gateType);
}
