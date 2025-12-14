"use strict";
// Outcome Conformance - Validate proposal outcomes have required evidence
// Ported from manual kernel verifier governance patterns
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_TRANSITIONS = exports.RECOMMENDED_EVIDENCE_BY_STATUS = exports.REQUIRED_EVIDENCE_BY_STATUS = void 0;
exports.validateOutcomeConformance = validateOutcomeConformance;
exports.createProposalOutcome = createProposalOutcome;
exports.formatConformanceResult = formatConformanceResult;
exports.isTerminalStatus = isTerminalStatus;
exports.isValidTransition = isValidTransition;
/**
 * Required evidence by terminal status
 */
exports.REQUIRED_EVIDENCE_BY_STATUS = {
    COMPLETED: ['gate_result', 'file_manifest', 'exit_code'],
    FAILED: ['gate_result'],
    REJECTED: [],
    ROLLED_BACK: ['gate_result', 'file_manifest', 'code_diff']
};
/**
 * Optional/recommended evidence by status
 */
exports.RECOMMENDED_EVIDENCE_BY_STATUS = {
    COMPLETED: ['test_result', 'stdout_log'],
    FAILED: ['stderr_log', 'exit_code'],
    REJECTED: ['gate_result'],
    ROLLED_BACK: ['stderr_log', 'test_result']
};
/**
 * Validate outcome has required evidence
 */
function validateOutcomeConformance(outcome, evidenceArtifacts) {
    const required = exports.REQUIRED_EVIDENCE_BY_STATUS[outcome.status];
    const recommended = exports.RECOMMENDED_EVIDENCE_BY_STATUS[outcome.status];
    // Collect evidence kinds present
    const presentKinds = new Set();
    for (const evidenceId of outcome.evidence_ids) {
        const artifact = evidenceArtifacts.get(evidenceId);
        if (artifact) {
            presentKinds.add(artifact.evidence_kind);
        }
    }
    // Check for missing required evidence
    const missingRequired = [];
    for (const kind of required) {
        if (!presentKinds.has(kind)) {
            missingRequired.push(kind);
        }
    }
    // Check for missing recommended evidence
    const missingRecommended = [];
    for (const kind of recommended) {
        if (!presentKinds.has(kind)) {
            missingRecommended.push(kind);
        }
    }
    // Find extra evidence (not required or recommended)
    const expectedKinds = new Set([...required, ...recommended]);
    const extraEvidence = [];
    for (const kind of presentKinds) {
        if (!expectedKinds.has(kind)) {
            extraEvidence.push(kind);
        }
    }
    const ok = missingRequired.length === 0;
    return {
        ok,
        missing_required: missingRequired,
        missing_recommended: missingRecommended,
        extra_evidence: extraEvidence,
        details: ok
            ? undefined
            : `Missing required evidence: ${missingRequired.join(', ')}`
    };
}
/**
 * Create outcome from proposal state
 */
function createProposalOutcome(proposalId, status, evidenceIds) {
    const now = new Date().toISOString();
    const outcome = {
        proposal_id: proposalId,
        status,
        evidence_ids: evidenceIds
    };
    switch (status) {
        case 'COMPLETED':
            outcome.applied_at = now;
            break;
        case 'FAILED':
        case 'REJECTED':
            outcome.failed_at = now;
            break;
        case 'ROLLED_BACK':
            outcome.rolled_back_at = now;
            break;
    }
    return outcome;
}
/**
 * Format conformance result for display
 */
function formatConformanceResult(result) {
    const lines = [];
    lines.push(result.ok ? '✓ Outcome conformance PASSED' : '✗ Outcome conformance FAILED');
    if (result.missing_required.length > 0) {
        lines.push(`  Missing required: ${result.missing_required.join(', ')}`);
    }
    if (result.missing_recommended.length > 0) {
        lines.push(`  Missing recommended: ${result.missing_recommended.join(', ')}`);
    }
    if (result.extra_evidence.length > 0) {
        lines.push(`  Extra evidence: ${result.extra_evidence.join(', ')}`);
    }
    return lines.join('\n');
}
/**
 * Check if status is terminal (no further transitions allowed)
 */
function isTerminalStatus(status) {
    return ['COMPLETED', 'FAILED', 'REJECTED', 'ROLLED_BACK'].includes(status);
}
/**
 * Valid status transitions
 */
exports.STATUS_TRANSITIONS = {
    'pending': ['COMPLETED', 'FAILED', 'REJECTED'],
    'in_progress': ['COMPLETED', 'FAILED', 'ROLLED_BACK'],
    'applying': ['COMPLETED', 'ROLLED_BACK'],
    'COMPLETED': [], // Terminal
    'FAILED': [], // Terminal
    'REJECTED': [], // Terminal
    'ROLLED_BACK': [] // Terminal
};
/**
 * Check if status transition is valid
 */
function isValidTransition(from, to) {
    const allowed = exports.STATUS_TRANSITIONS[from];
    if (!allowed)
        return false;
    return allowed.includes(to);
}
