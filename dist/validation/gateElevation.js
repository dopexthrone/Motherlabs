"use strict";
// Gate Elevation Protocol - Gate strictness matches decision weight
// CONSTITUTIONAL AUTHORITY - See docs/DECISION_PHILOSOPHY.md
// Enforces: AXIOM 1 (Deterministic Authority), AXIOM 4 (Mechanical Verification)
// TCB Component: Part of the 6-Gate Validation System
//
// From ROADMAP Step 9:
// - Reversible changes: Gates 1-4 required
// - Irreversible changes: Gates 1-6 required + human approval
// - Architectural changes: All gates + consequence surface + alternatives
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineGateRequirements = determineGateRequirements;
exports.checkGatesSatisfied = checkGatesSatisfied;
exports.checkAdditionalRequirementsSatisfied = checkAdditionalRequirementsSatisfied;
exports.formatGateElevation = formatGateElevation;
exports.getElevationSummary = getElevationSummary;
const result_1 = require("../core/result");
const decisionClassifier_1 = require("../core/decisionClassifier");
/**
 * Gate definitions with their purposes
 */
const GATE_DEFINITIONS = {
    schema_validation: {
        name: 'Schema Validation (Gate 1)',
        purpose: 'Validates code structure and exports'
    },
    syntax_validation: {
        name: 'Syntax Validation (Gate 2)',
        purpose: 'Ensures code is syntactically correct'
    },
    variable_resolution: {
        name: 'Variable Resolution (Gate 3)',
        purpose: 'Verifies all references are resolved'
    },
    test_execution: {
        name: 'Test Execution (Gate 4)',
        purpose: 'Runs tests in sandboxed environment'
    },
    urco_entropy: {
        name: 'URCO Entropy (Gate 5)',
        purpose: 'Measures intent clarity and ambiguity'
    },
    governance_check: {
        name: 'Governance Check (Gate 6)',
        purpose: 'Security scanning and axiom compliance'
    }
};
/**
 * Architectural change indicators
 */
const ARCHITECTURAL_INDICATORS = [
    { pattern: /export\s+type\s+\w+\s*=/, indicator: 'Exports new type definition' },
    { pattern: /export\s+interface\s+\w+/, indicator: 'Exports new interface' },
    { pattern: /AXIOM\s+\d+/i, indicator: 'References constitutional axiom' },
    { pattern: /CONSTITUTIONAL/i, indicator: 'Constitutional reference' },
    { pattern: /TCB\s+Component/i, indicator: 'TCB component marker' },
    { pattern: /class\s+\w+\s+extends/, indicator: 'Inheritance hierarchy change' },
    { pattern: /implements\s+\w+/, indicator: 'Interface implementation' },
];
/**
 * Determine gate requirements for a proposal
 * This is the core implementation of ROADMAP Step 9
 */
function determineGateRequirements(proposal, decisionType, prematurityCheck) {
    try {
        // 1. Detect if this is an architectural change
        const isArchitectural = detectArchitecturalChange(proposal);
        // 2. Get TCB classification
        const tcbClass = (0, decisionClassifier_1.getTCBClassification)(proposal.targetFile);
        // 3. Determine base elevation level
        let level;
        let humanApprovalRequired = false;
        let humanApprovalReason;
        if (isArchitectural || tcbClass === 'constitutional') {
            level = 'maximum';
            humanApprovalRequired = true;
            humanApprovalReason = isArchitectural
                ? 'Architectural change requires human review'
                : 'Constitutional change requires human approval';
        }
        else if (decisionType === 'irreversible' || tcbClass === 'authority') {
            level = 'elevated';
            humanApprovalRequired = true;
            humanApprovalReason = decisionType === 'irreversible'
                ? 'Irreversible decision requires human approval'
                : 'TCB authority change requires human approval';
        }
        else if (decisionType === 'premature') {
            // Premature decisions should be refused, not elevated
            level = 'maximum';
            humanApprovalRequired = true;
            humanApprovalReason = 'Premature decision requires exceptional justification';
        }
        else {
            level = 'standard';
        }
        // 4. Build gate requirements based on level
        const gates = buildGateRequirements(level, proposal, tcbClass);
        // 5. Build additional requirements
        const additionalRequirements = buildAdditionalRequirements(level, proposal, isArchitectural, prematurityCheck);
        // 6. Generate elevation reason
        const elevationReason = generateElevationReason(level, decisionType, tcbClass, isArchitectural);
        return (0, result_1.Ok)({
            level,
            gates,
            humanApprovalRequired,
            humanApprovalReason,
            additionalRequirements,
            elevationReason
        });
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Detect if a proposal represents an architectural change
 */
function detectArchitecturalChange(proposal) {
    const code = proposal.proposedChange.code;
    // Check for architectural indicators in code
    for (const { pattern } of ARCHITECTURAL_INDICATORS) {
        if (pattern.test(code)) {
            return true;
        }
    }
    // Refactoring TCB authority is architectural
    const tcbClass = (0, decisionClassifier_1.getTCBClassification)(proposal.targetFile);
    if (proposal.proposedChange.type === 'refactor' && tcbClass === 'authority') {
        return true;
    }
    // Large changes to core types are architectural
    if (proposal.targetFile.includes('src/core/') &&
        proposal.proposedChange.code.split('\n').length > 50) {
        return true;
    }
    // Schema changes are architectural
    if (tcbClass === 'schema') {
        return true;
    }
    return false;
}
/**
 * Build gate requirements based on elevation level
 */
function buildGateRequirements(level, proposal, tcbClass) {
    const requirements = [];
    // Gates 1-4 are always required
    requirements.push({
        gateName: 'schema_validation',
        required: true,
        reason: 'All code must have valid structure and exports'
    });
    requirements.push({
        gateName: 'syntax_validation',
        required: true,
        reason: 'All code must be syntactically correct'
    });
    requirements.push({
        gateName: 'variable_resolution',
        required: true,
        reason: 'All references must be resolvable'
    });
    requirements.push({
        gateName: 'test_execution',
        required: true,
        reason: 'Tests must pass in sandboxed environment'
    });
    // Gates 5-6 depend on level
    if (level === 'elevated' || level === 'maximum') {
        requirements.push({
            gateName: 'urco_entropy',
            required: true,
            reason: level === 'maximum'
                ? 'Architectural changes require clear intent'
                : 'Irreversible changes require low ambiguity'
        });
        requirements.push({
            gateName: 'governance_check',
            required: true,
            reason: level === 'maximum'
                ? 'Architectural changes require full security scan and axiom compliance'
                : 'Irreversible changes require governance verification'
        });
    }
    else {
        // Standard level - Gates 5-6 are advisory
        requirements.push({
            gateName: 'urco_entropy',
            required: false,
            reason: 'Advisory for reversible changes'
        });
        requirements.push({
            gateName: 'governance_check',
            required: false,
            reason: 'Advisory for reversible changes'
        });
    }
    return requirements;
}
/**
 * Build additional requirements beyond gates
 */
function buildAdditionalRequirements(level, proposal, isArchitectural, prematurityCheck) {
    const requirements = [];
    if (level === 'elevated' || level === 'maximum') {
        // Consequence surface required for elevated/maximum
        requirements.push({
            requirement: 'Consequence surface analysis',
            satisfied: proposal.consequenceAnalysis !== undefined,
            evidence: proposal.consequenceAnalysis
                ? `Risk level: ${proposal.consequenceAnalysis.riskLevel}`
                : undefined
        });
        // Alternative analysis required
        requirements.push({
            requirement: 'Alternative analysis',
            satisfied: proposal.alternativeAnalysis !== undefined,
            evidence: proposal.alternativeAnalysis
                ? `${proposal.alternativeAnalysis.alternatives.length} alternatives considered`
                : undefined
        });
    }
    if (level === 'maximum') {
        // Architectural changes need explicit type documentation
        if (isArchitectural) {
            requirements.push({
                requirement: 'Architectural impact documented',
                satisfied: proposal.rationale.length > 100,
                evidence: proposal.rationale.length > 100
                    ? 'Rationale exceeds 100 characters'
                    : undefined
            });
        }
        // Prematurity check must pass for maximum level
        if (prematurityCheck) {
            requirements.push({
                requirement: 'Prematurity check passed',
                satisfied: !prematurityCheck.premature || prematurityCheck.confidence === 'low',
                evidence: prematurityCheck.premature
                    ? `Premature: ${prematurityCheck.reason}`
                    : 'Not premature'
            });
        }
    }
    // TCB changes need classification awareness
    const tcbClass = (0, decisionClassifier_1.getTCBClassification)(proposal.targetFile);
    if (tcbClass !== 'non-tcb') {
        requirements.push({
            requirement: `TCB classification acknowledged: ${tcbClass}`,
            satisfied: true,
            evidence: `Target file is ${tcbClass} TCB component`
        });
    }
    return requirements;
}
/**
 * Generate human-readable elevation reason
 */
function generateElevationReason(level, decisionType, tcbClass, isArchitectural) {
    const reasons = [];
    if (level === 'maximum') {
        if (isArchitectural) {
            reasons.push('Architectural change detected');
        }
        if (tcbClass === 'constitutional') {
            reasons.push('Constitutional document modification');
        }
        if (decisionType === 'premature') {
            reasons.push('Decision classified as premature');
        }
    }
    else if (level === 'elevated') {
        if (decisionType === 'irreversible') {
            reasons.push('Irreversible decision');
        }
        if (tcbClass === 'authority') {
            reasons.push('TCB authority component');
        }
    }
    else {
        reasons.push('Reversible change to non-TCB component');
    }
    return `${level.toUpperCase()} elevation: ${reasons.join('; ')}`;
}
/**
 * Check if all gate requirements are satisfied
 */
function checkGatesSatisfied(elevation, gateResults) {
    const failedGates = [];
    for (const req of elevation.gates) {
        if (req.required) {
            const result = gateResults.find(g => g.gateName === req.gateName);
            if (!result || !result.passed) {
                failedGates.push(req.gateName);
            }
        }
    }
    return {
        satisfied: failedGates.length === 0,
        failedGates
    };
}
/**
 * Check if all additional requirements are satisfied
 */
function checkAdditionalRequirementsSatisfied(elevation) {
    const unsatisfied = elevation.additionalRequirements
        .filter(r => !r.satisfied)
        .map(r => r.requirement);
    return {
        satisfied: unsatisfied.length === 0,
        unsatisfied
    };
}
/**
 * Format gate elevation for human review
 */
function formatGateElevation(elevation) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('GATE ELEVATION PROTOCOL');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`Elevation Level: ${elevation.level.toUpperCase()}`);
    lines.push(`Reason: ${elevation.elevationReason}`);
    lines.push('');
    if (elevation.humanApprovalRequired) {
        lines.push('⚠ HUMAN APPROVAL REQUIRED');
        lines.push(`   Reason: ${elevation.humanApprovalReason}`);
        lines.push('');
    }
    lines.push('GATE REQUIREMENTS:');
    for (const gate of elevation.gates) {
        const status = gate.required ? '●' : '○';
        const label = gate.required ? 'REQUIRED' : 'ADVISORY';
        lines.push(`  ${status} ${gate.gateName} [${label}]`);
        lines.push(`      ${gate.reason}`);
    }
    lines.push('');
    if (elevation.additionalRequirements.length > 0) {
        lines.push('ADDITIONAL REQUIREMENTS:');
        for (const req of elevation.additionalRequirements) {
            const status = req.satisfied ? '✓' : '✗';
            lines.push(`  ${status} ${req.requirement}`);
            if (req.evidence) {
                lines.push(`      Evidence: ${req.evidence}`);
            }
        }
        lines.push('');
    }
    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
}
/**
 * Get elevation level summary for logging
 */
function getElevationSummary(elevation) {
    const requiredGates = elevation.gates.filter(g => g.required).length;
    const additionalReqs = elevation.additionalRequirements.length;
    const approval = elevation.humanApprovalRequired ? ' + human approval' : '';
    return `${elevation.level}: ${requiredGates} gates required, ${additionalReqs} additional requirements${approval}`;
}
