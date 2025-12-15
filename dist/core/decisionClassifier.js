"use strict";
// Decision Classifier - Mechanically separates reversible/irreversible/premature decisions
// CONSTITUTIONAL AUTHORITY - See docs/DECISION_PHILOSOPHY.md
// Enforces: AXIOM 5 (Refusal First-Class) for premature decisions
// TCB Component: This file is part of the Trusted Computing Base
//
// The core insight: Not all decisions are equal.
// - Reversible: Can be undone cheaply → proceed freely
// - Irreversible: Affects architecture/authority/scope → gate and document
// - Premature: Cannot be justified with current evidence → refuse or defer
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTCBClassification = exports.isTCBPath = void 0;
exports.classifyDecision = classifyDecision;
exports.getRequiredGates = getRequiredGates;
const result_1 = require("./result");
// Import TCB boundary from authoritative source
const tcbBoundary_1 = require("./tcbBoundary");
// Re-export TCB functions from authoritative source for backwards compatibility
var tcbBoundary_2 = require("./tcbBoundary");
Object.defineProperty(exports, "isTCBPath", { enumerable: true, get: function () { return tcbBoundary_2.isTCBPath; } });
Object.defineProperty(exports, "getTCBClassification", { enumerable: true, get: function () { return tcbBoundary_2.getTCBClassification; } });
/**
 * Architectural change indicators in code
 */
const ARCHITECTURAL_PATTERNS = [
    /AXIOM\s+\d+/i, // References axiom by number
    /CONSTITUTIONAL/i, // Constitutional reference
    /TCB\s+Component/i, // TCB marker
    /AUTHORITY/i, // Authority classification
    /export\s+type\s+\w+\s*=/, // Type definition export
    /export\s+interface/, // Interface export
];
/**
 * Patterns that suggest reversibility
 */
const REVERSIBLE_PATTERNS = [
    /\/\/\s*TODO/i, // TODO comments
    /console\.(log|debug)/, // Debug logging
    /\.test\.ts$/, // Test files
    /\.spec\.ts$/, // Spec files
];
/**
 * Classify a proposal's decision type
 *
 * This is the core implementation of DECISION_PHILOSOPHY.md
 */
function classifyDecision(proposal) {
    try {
        const signals = [];
        // 1. Analyze target path
        const pathSignals = classifyPath(proposal.targetFile);
        signals.push(...pathSignals);
        // 2. Analyze proposed change content
        const codeSignals = classifyCodeChange(proposal.proposedChange.code);
        signals.push(...codeSignals);
        // 3. Analyze change type
        const changeTypeSignals = classifyChangeType(proposal.proposedChange.type);
        signals.push(...changeTypeSignals);
        // 4. Analyze issue severity
        const severitySignals = classifyIssueSeverity(proposal.issue.severity);
        signals.push(...severitySignals);
        // 5. Compute final classification
        return (0, result_1.Ok)(computeClassification(signals, proposal));
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Classify based on file path
 */
function classifyPath(filepath) {
    const signals = [];
    // Check TCB authority paths (strongest irreversibility signal)
    for (const path of tcbBoundary_1.TCB_AUTHORITY_PATHS) {
        if (filepath.includes(path)) {
            signals.push({
                signal: `Target is TCB authority path: ${path}`,
                weight: 'strong',
                direction: 'irreversible'
            });
        }
    }
    // Check TCB governed paths (moderate irreversibility)
    for (const path of tcbBoundary_1.TCB_GOVERNED_PATHS) {
        if (filepath.includes(path)) {
            signals.push({
                signal: `Target is TCB governed path: ${path}`,
                weight: 'moderate',
                direction: 'irreversible'
            });
        }
    }
    // Check constitutional documents (highest irreversibility)
    for (const path of tcbBoundary_1.CONSTITUTIONAL_PATHS) {
        if (filepath.includes(path)) {
            signals.push({
                signal: `Target is constitutional document: ${path}`,
                weight: 'strong',
                direction: 'irreversible'
            });
        }
    }
    // Check schema paths
    for (const path of tcbBoundary_1.SCHEMA_PATHS) {
        if (filepath.includes(path)) {
            signals.push({
                signal: `Target is schema definition: ${path}`,
                weight: 'moderate',
                direction: 'irreversible'
            });
        }
    }
    // Check for test files (generally reversible)
    if (filepath.match(/\.(test|spec)\.ts$/)) {
        signals.push({
            signal: 'Target is test file',
            weight: 'moderate',
            direction: 'reversible'
        });
    }
    // Check for non-TCB paths
    if (!tcbBoundary_1.TCB_AUTHORITY_PATHS.some(p => filepath.includes(p)) &&
        !tcbBoundary_1.TCB_GOVERNED_PATHS.some(p => filepath.includes(p)) &&
        !tcbBoundary_1.CONSTITUTIONAL_PATHS.some(p => filepath.includes(p)) &&
        !tcbBoundary_1.SCHEMA_PATHS.some(p => filepath.includes(p))) {
        signals.push({
            signal: 'Target is non-TCB path',
            weight: 'moderate',
            direction: 'reversible'
        });
    }
    return signals;
}
/**
 * Classify based on code content
 */
function classifyCodeChange(code) {
    const signals = [];
    // Check for architectural patterns
    for (const pattern of ARCHITECTURAL_PATTERNS) {
        if (pattern.test(code)) {
            signals.push({
                signal: `Code contains architectural pattern: ${pattern.source}`,
                weight: 'moderate',
                direction: 'irreversible'
            });
        }
    }
    // Check for reversible patterns
    for (const pattern of REVERSIBLE_PATTERNS) {
        if (pattern.test(code)) {
            signals.push({
                signal: `Code contains reversible pattern: ${pattern.source}`,
                weight: 'weak',
                direction: 'reversible'
            });
        }
    }
    // Check code size (large changes are harder to reverse)
    const lineCount = code.split('\n').length;
    if (lineCount > 100) {
        signals.push({
            signal: `Large code change (${lineCount} lines)`,
            weight: 'moderate',
            direction: 'irreversible'
        });
    }
    else if (lineCount < 10) {
        signals.push({
            signal: `Small code change (${lineCount} lines)`,
            weight: 'weak',
            direction: 'reversible'
        });
    }
    return signals;
}
/**
 * Classify based on change type
 */
function classifyChangeType(changeType) {
    const signals = [];
    switch (changeType) {
        case 'add_test':
            signals.push({
                signal: 'Change type is add_test (additive, reversible)',
                weight: 'moderate',
                direction: 'reversible'
            });
            break;
        case 'add_function':
            signals.push({
                signal: 'Change type is add_function (additive, generally reversible)',
                weight: 'weak',
                direction: 'reversible'
            });
            break;
        case 'modify_function':
            signals.push({
                signal: 'Change type is modify_function (mutation, less reversible)',
                weight: 'moderate',
                direction: 'irreversible'
            });
            break;
        case 'refactor':
            signals.push({
                signal: 'Change type is refactor (structural change)',
                weight: 'moderate',
                direction: 'irreversible'
            });
            break;
    }
    return signals;
}
/**
 * Classify based on issue severity
 */
function classifyIssueSeverity(severity) {
    const signals = [];
    switch (severity) {
        case 'critical':
            // Critical issues suggest we MUST act - not premature
            signals.push({
                signal: 'Issue severity is critical (action required)',
                weight: 'strong',
                direction: 'irreversible' // Action justified, but needs documentation
            });
            break;
        case 'high':
            signals.push({
                signal: 'Issue severity is high',
                weight: 'moderate',
                direction: 'irreversible'
            });
            break;
        case 'medium':
            signals.push({
                signal: 'Issue severity is medium',
                weight: 'weak',
                direction: 'reversible'
            });
            break;
        case 'low':
            // Low severity might indicate prematurity if forcing a change
            signals.push({
                signal: 'Issue severity is low (consider deferral)',
                weight: 'weak',
                direction: 'premature'
            });
            break;
    }
    return signals;
}
/**
 * Compute final classification from signals
 */
function computeClassification(signals, proposal) {
    // Count weighted signals
    let irreversibleScore = 0;
    let reversibleScore = 0;
    let prematureScore = 0;
    const weightValues = { strong: 3, moderate: 2, weak: 1 };
    for (const signal of signals) {
        const weight = weightValues[signal.weight];
        switch (signal.direction) {
            case 'irreversible':
                irreversibleScore += weight;
                break;
            case 'reversible':
                reversibleScore += weight;
                break;
            case 'premature':
                prematureScore += weight;
                break;
        }
    }
    // Determine type based on scores
    let type;
    let reason;
    let requiredEvidence;
    // Prematurity check: If premature signals exist AND no strong justification
    if (prematureScore > 0 && irreversibleScore < 4 && !proposal.gateValidation?.valid) {
        type = 'premature';
        reason = buildPrematureReason(signals);
        requiredEvidence = [
            'Blocking dependency that requires this now',
            'Evidence that alternatives have been considered',
            'Justification for why this cannot be deferred'
        ];
    }
    // Irreversibility check: Strong signals or TCB changes
    else if (irreversibleScore > reversibleScore && irreversibleScore >= 4) {
        type = 'irreversible';
        reason = buildIrreversibleReason(signals);
        requiredEvidence = [
            'Consequence surface (what this enables/forbids)',
            'Alternative analysis (what paths were considered)',
            'Validation criteria (what must be true for correctness)',
            'Human approval for TCB changes'
        ];
    }
    // Default to reversible
    else {
        type = 'reversible';
        reason = buildReversibleReason(signals);
        requiredEvidence = [
            'Gate passage (standard 6-gate validation)'
        ];
    }
    return { type, reason, requiredEvidence, signals };
}
/**
 * Build reason string for premature classification
 */
function buildPrematureReason(signals) {
    const prematureSignals = signals.filter(s => s.direction === 'premature');
    const reasons = prematureSignals.map(s => s.signal).join('; ');
    return `Decision appears premature: ${reasons}. Consider deferral.`;
}
/**
 * Build reason string for irreversible classification
 */
function buildIrreversibleReason(signals) {
    const irreversibleSignals = signals.filter(s => s.direction === 'irreversible');
    const strongSignals = irreversibleSignals.filter(s => s.weight === 'strong');
    if (strongSignals.length > 0) {
        return `Irreversible: ${strongSignals.map(s => s.signal).join('; ')}`;
    }
    return `Irreversible: Multiple moderate signals indicate architectural impact`;
}
/**
 * Build reason string for reversible classification
 */
function buildReversibleReason(signals) {
    const reversibleSignals = signals.filter(s => s.direction === 'reversible');
    if (reversibleSignals.length > 0) {
        return `Reversible: ${reversibleSignals.map(s => s.signal).join('; ')}`;
    }
    return 'Reversible: No strong irreversibility signals detected';
}
/**
 * Get required gate level for decision type
 * See ROADMAP Step 9: Gate Elevation Protocol
 */
function getRequiredGates(classification) {
    switch (classification.type) {
        case 'reversible':
            return {
                gates: ['schema_validation', 'syntax_validation', 'variable_resolution', 'test_execution'],
                humanApprovalRequired: false
            };
        case 'irreversible':
            return {
                gates: ['schema_validation', 'syntax_validation', 'variable_resolution', 'test_execution', 'urco_entropy', 'governance_check'],
                humanApprovalRequired: true
            };
        case 'premature':
            // Premature decisions should not proceed - return all gates + human approval
            // The caller should interpret this as REFUSE
            return {
                gates: ['schema_validation', 'syntax_validation', 'variable_resolution', 'test_execution', 'urco_entropy', 'governance_check'],
                humanApprovalRequired: true
            };
    }
}
