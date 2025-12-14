"use strict";
// Authorization Checks - Gate-based authorization verification
// Ported from manual kernel verifier governance patterns
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractGateDecisions = extractGateDecisions;
exports.checkProposalAdmissionAuthorization = checkProposalAdmissionAuthorization;
exports.checkChangeApplicationAuthorization = checkChangeApplicationAuthorization;
exports.checkLLMGenerationAuthorization = checkLLMGenerationAuthorization;
exports.checkHumanApprovalAuthorization = checkHumanApprovalAuthorization;
exports.checkEffectAuthorization = checkEffectAuthorization;
exports.verifyAllEffectsAuthorized = verifyAllEffectsAuthorized;
exports.createAuthorizationGateDecision = createAuthorizationGateDecision;
exports.checkWorkflowAuthorization = checkWorkflowAuthorization;
exports.getSelfImprovementWorkflow = getSelfImprovementWorkflow;
exports.getSelfImprovementWorkflowWithApproval = getSelfImprovementWorkflowWithApproval;
const gateDecision_1 = require("../core/gateDecision");
/**
 * Extract gate decisions from ledger records
 */
function extractGateDecisions(records) {
    const decisions = [];
    for (const record of records) {
        if (record.record_type === 'GATE_DECISION') {
            decisions.push(record.record);
        }
    }
    return decisions;
}
/**
 * Check if a proposal has admission authorization
 */
function checkProposalAdmissionAuthorization(proposalId, priorRecords) {
    const decisions = extractGateDecisions(priorRecords);
    const authorization = (0, gateDecision_1.findPriorAuthorization)(decisions, proposalId, 'proposal_admission');
    if (!authorization) {
        return {
            authorized: false,
            error: `No proposal_admission ALLOW found for proposal ${proposalId}`
        };
    }
    return {
        authorized: true,
        gateDecision: authorization
    };
}
/**
 * Check if a change application has authorization
 */
function checkChangeApplicationAuthorization(proposalId, priorRecords) {
    const decisions = extractGateDecisions(priorRecords);
    const authorization = (0, gateDecision_1.findPriorAuthorization)(decisions, proposalId, 'change_application');
    if (!authorization) {
        return {
            authorized: false,
            error: `No change_application ALLOW found for proposal ${proposalId}`
        };
    }
    return {
        authorized: true,
        gateDecision: authorization
    };
}
/**
 * Check if LLM generation has authorization
 */
function checkLLMGenerationAuthorization(promptHash, priorRecords) {
    const decisions = extractGateDecisions(priorRecords);
    const authorization = (0, gateDecision_1.findPriorAuthorization)(decisions, promptHash, 'llm_generation');
    if (!authorization) {
        return {
            authorized: false,
            error: `No llm_generation ALLOW found for prompt ${promptHash}`
        };
    }
    return {
        authorized: true,
        gateDecision: authorization
    };
}
/**
 * Check if human approval exists
 */
function checkHumanApprovalAuthorization(proposalId, priorRecords) {
    const decisions = extractGateDecisions(priorRecords);
    const authorization = (0, gateDecision_1.findPriorAuthorization)(decisions, proposalId, 'human_approval');
    if (!authorization) {
        return {
            authorized: false,
            error: `No human_approval ALLOW found for proposal ${proposalId}`
        };
    }
    return {
        authorized: true,
        gateDecision: authorization
    };
}
/**
 * Check if an effect is authorized by a gate decision
 */
function checkEffectAuthorization(effect, targetId, priorRecords) {
    const decisions = extractGateDecisions(priorRecords);
    // Find any ALLOW decision that grants this effect
    for (let i = decisions.length - 1; i >= 0; i--) {
        const decision = decisions[i];
        if (decision.scope.target_id === targetId &&
            decision.decision === 'ALLOW' &&
            decision.scope.granted_effects?.includes(effect)) {
            return {
                authorized: true,
                gateDecision: decision
            };
        }
    }
    return {
        authorized: false,
        error: `No gate decision grants ${effect} for ${targetId}`
    };
}
/**
 * Verify all effects are authorized
 */
function verifyAllEffectsAuthorized(exercisedEffects, targetId, priorRecords) {
    for (const effect of exercisedEffects) {
        if (effect === 'NONE')
            continue;
        const check = checkEffectAuthorization(effect, targetId, priorRecords);
        if (!check.authorized) {
            return check;
        }
    }
    return { authorized: true };
}
/**
 * Create authorization gate decision
 */
function createAuthorizationGateDecision(gateType, decision, targetId, authorizer, reason, grantedEffects) {
    return {
        gate_type: gateType,
        decision,
        scope: {
            target_type: gateType === 'llm_generation' ? 'code' : 'proposal',
            target_id: targetId,
            granted_effects: grantedEffects
        },
        authorizer,
        issued_at_utc: new Date().toISOString(),
        reason
    };
}
function checkWorkflowAuthorization(steps, priorRecords) {
    const decisions = extractGateDecisions(priorRecords);
    for (const step of steps) {
        const authorization = (0, gateDecision_1.findPriorAuthorization)(decisions, step.targetId, step.gateType);
        if (!authorization) {
            return {
                authorized: false,
                failedStep: step.step,
                error: `Step "${step.step}" requires ${step.gateType} ALLOW for ${step.targetId}`
            };
        }
    }
    return { authorized: true };
}
/**
 * Standard workflow for self-improvement
 */
function getSelfImprovementWorkflow(proposalId, codeId) {
    return [
        { step: 'admit_proposal', gateType: 'proposal_admission', targetId: proposalId },
        { step: 'generate_code', gateType: 'llm_generation', targetId: codeId },
        { step: 'apply_change', gateType: 'change_application', targetId: proposalId }
    ];
}
/**
 * Standard workflow with human approval
 */
function getSelfImprovementWorkflowWithApproval(proposalId, codeId) {
    return [
        { step: 'admit_proposal', gateType: 'proposal_admission', targetId: proposalId },
        { step: 'generate_code', gateType: 'llm_generation', targetId: codeId },
        { step: 'human_approve', gateType: 'human_approval', targetId: proposalId },
        { step: 'apply_change', gateType: 'change_application', targetId: proposalId }
    ];
}
