"use strict";
// Consequence Surface Generator - Answer "what does this permanently forbid?"
// CONSTITUTIONAL AUTHORITY - See docs/DECISION_PHILOSOPHY.md
// Purpose: Makes closed doors visible and manageable
// TCB Component: Part of decision infrastructure
//
// From DECISION_PHILOSOPHY.md:
// "A closed door is terrifying when it's invisible.
//  It's manageable when it's named."
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateConsequenceSurface = generateConsequenceSurface;
exports.formatConsequenceSurface = formatConsequenceSurface;
const result_1 = require("../core/result");
const decisionClassifier_1 = require("../core/decisionClassifier");
/**
 * TCB impact patterns - what changes to TCB components forbid
 */
const TCB_CONSEQUENCE_PATTERNS = {
    // Validation changes affect what can be admitted
    'src/validation/': {
        enables: [
            'Modified admission criteria for code proposals',
            'New validation rules or relaxed existing rules',
            'Changed security scanning behavior'
        ],
        forbids: [
            'Previous gate behavior (if gates are modified)',
            'Code that passed old gates but fails new gates',
            'Rollback without careful migration'
        ],
        assumptions: [
            'New validation logic is correct',
            'No security regressions introduced',
            'Existing valid code still passes'
        ],
        validationCriteria: [
            'All existing tests pass',
            'No security scanner regressions',
            'Gate behavior is deterministic'
        ]
    },
    // Sandbox changes affect execution isolation
    'src/sandbox/': {
        enables: [
            'Modified execution isolation behavior',
            'New capability grants or restrictions',
            'Changed command allowlist/blocklist'
        ],
        forbids: [
            'Previous isolation guarantees (if weakened)',
            'Commands that were previously allowed (if restricted)',
            'Capability patterns that were safe'
        ],
        assumptions: [
            'Sandbox isolation remains intact',
            'No privilege escalation paths introduced',
            'Capability model remains sound'
        ],
        validationCriteria: [
            'Sandbox escape tests pass',
            'Capability restrictions enforced',
            'No unauthorized command execution'
        ]
    },
    // Persistence changes affect evidence integrity
    'src/persistence/': {
        enables: [
            'Modified evidence storage format',
            'New ledger entry types',
            'Changed hash chain behavior'
        ],
        forbids: [
            'Reading old format entries (if format changed)',
            'Previous hash chain verification (if algorithm changed)',
            'Evidence migration without explicit handling'
        ],
        assumptions: [
            'Append-only property preserved',
            'Hash chain integrity maintained',
            'Evidence remains immutable'
        ],
        validationCriteria: [
            'AXIOM 8 (Immutable Evidence) preserved',
            'Hash chain verification works',
            'Old entries still readable'
        ]
    },
    // Core type changes affect everything
    'src/core/': {
        enables: [
            'Modified fundamental types',
            'New result patterns or error handling',
            'Changed content addressing'
        ],
        forbids: [
            'Previous type signatures (if changed)',
            'Code depending on old type shapes',
            'Existing serialized data (if format changed)'
        ],
        assumptions: [
            'Type changes are backwards compatible',
            'Result pattern remains consistent',
            'Content addressing is deterministic'
        ],
        validationCriteria: [
            'TypeScript compilation succeeds',
            'All dependent code compiles',
            'Serialization/deserialization works'
        ]
    },
    // Self-improvement changes affect governance
    'src/selfbuild/': {
        enables: [
            'Modified self-improvement behavior',
            'New proposal generation logic',
            'Changed LLM interaction patterns'
        ],
        forbids: [
            'Previous proposal patterns',
            'Deterministic fallback behavior (if removed)',
            'LLM-free operation (if required)'
        ],
        assumptions: [
            'Self-improvement remains governed',
            'AXIOM 5 refusal still works',
            'Gates still apply to self-modifications'
        ],
        validationCriteria: [
            'Self-proposals pass all 6 gates',
            'AXIOM 5 refusal triggers correctly',
            'No hollow code generation'
        ]
    },
    // Constitutional document changes
    'docs/MOTHERLABS_CONSTITUTION.md': {
        enables: [
            'Modified constitutional axioms',
            'New authority definitions',
            'Changed scope exclusions'
        ],
        forbids: [
            'Previous axiom interpretations',
            'Code that relied on old axioms',
            'Authority patterns that are now invalid'
        ],
        assumptions: [
            'All 12 axioms preserved',
            'No scope expansion beyond intent',
            'Authority model remains deterministic'
        ],
        validationCriteria: [
            'All axioms still enforced in code',
            'Constitutional references updated',
            'No authority violations possible'
        ]
    },
    // Schema changes affect validation
    'schemas/': {
        enables: [
            'Modified data validation schemas',
            'New required or optional fields',
            'Changed type constraints'
        ],
        forbids: [
            'Data that matched old schema but not new',
            'Previous serialization formats',
            'Tools that depend on old schemas'
        ],
        assumptions: [
            'Schema changes are intentional',
            'Migrations are handled',
            'Validation remains strict'
        ],
        validationCriteria: [
            'All existing data validates',
            'Schema is valid JSON Schema',
            'Gate 1 uses updated schemas'
        ]
    }
};
/**
 * Change type consequences
 */
const CHANGE_TYPE_CONSEQUENCES = {
    'add_function': {
        enables: [
            'New functionality available',
            'New API surface exposed',
            'New import possibilities'
        ],
        forbids: [
            'Nothing (additive change)',
        ]
    },
    'add_test': {
        enables: [
            'New test coverage',
            'Regression detection for covered code',
            'Confidence in tested behavior'
        ],
        forbids: [
            'Behavior changes that would break new tests',
        ]
    },
    'modify_function': {
        enables: [
            'Changed function behavior',
            'Fixed bugs or issues',
            'Performance improvements'
        ],
        forbids: [
            'Previous function behavior',
            'Code that depended on old behavior',
            'Easy rollback (requires careful analysis)'
        ]
    },
    'refactor': {
        enables: [
            'Improved code structure',
            'Better maintainability',
            'Reduced complexity'
        ],
        forbids: [
            'Previous code structure',
            'References to old function/type names',
            'Easy git blame (history obscured)'
        ]
    }
};
/**
 * Generate consequence surface for a proposal
 * This is the core implementation of ROADMAP Step 2
 */
function generateConsequenceSurface(proposal) {
    try {
        const surface = {
            enables: [],
            forbids: [],
            assumptions: [],
            validationCriteria: []
        };
        // 1. Analyze TCB impact
        const tcbConsequences = analyzeTCBImpact(proposal.targetFile);
        if (tcbConsequences) {
            surface.enables.push(...tcbConsequences.enables);
            surface.forbids.push(...tcbConsequences.forbids);
            surface.assumptions.push(...tcbConsequences.assumptions);
            surface.validationCriteria.push(...tcbConsequences.validationCriteria);
        }
        // 2. Analyze change type impact
        const changeConsequences = analyzeChangeTypeImpact(proposal.proposedChange.type);
        surface.enables.push(...changeConsequences.enables);
        surface.forbids.push(...changeConsequences.forbids);
        // 3. Analyze code-specific consequences
        const codeConsequences = analyzeCodeImpact(proposal.proposedChange.code);
        surface.enables.push(...codeConsequences.enables);
        surface.forbids.push(...codeConsequences.forbids);
        surface.assumptions.push(...codeConsequences.assumptions);
        surface.validationCriteria.push(...codeConsequences.validationCriteria);
        // 4. Determine risk level
        const riskLevel = assessRiskLevel(proposal, surface);
        // 5. Assess reversibility
        const reversibilityAssessment = assessReversibility(proposal, surface);
        // 6. Deduplicate
        surface.enables = [...new Set(surface.enables)];
        surface.forbids = [...new Set(surface.forbids)];
        surface.assumptions = [...new Set(surface.assumptions)];
        surface.validationCriteria = [...new Set(surface.validationCriteria)];
        return (0, result_1.Ok)({
            proposal: {
                id: proposal.id,
                targetFile: proposal.targetFile,
                changeType: proposal.proposedChange.type
            },
            surface,
            riskLevel,
            reversibilityAssessment
        });
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Analyze TCB-specific impact
 */
function analyzeTCBImpact(filepath) {
    for (const [pathPattern, consequences] of Object.entries(TCB_CONSEQUENCE_PATTERNS)) {
        if (filepath.includes(pathPattern)) {
            return consequences;
        }
    }
    return null;
}
/**
 * Analyze change type impact
 */
function analyzeChangeTypeImpact(changeType) {
    return CHANGE_TYPE_CONSEQUENCES[changeType] || { enables: [], forbids: [] };
}
/**
 * Analyze code-specific consequences
 */
function analyzeCodeImpact(code) {
    const consequences = {
        enables: [],
        forbids: [],
        assumptions: [],
        validationCriteria: []
    };
    // Check for type exports (API surface changes)
    if (/export\s+(type|interface)\s+\w+/.test(code)) {
        consequences.enables.push('New public type definition');
        consequences.forbids.push('Changing type shape without migration');
        consequences.assumptions.push('Type is correctly defined');
        consequences.validationCriteria.push('TypeScript compilation succeeds');
    }
    // Check for function exports (API changes)
    if (/export\s+(function|const\s+\w+\s*=)/.test(code)) {
        consequences.enables.push('New public function/constant');
        consequences.assumptions.push('Function behaves as documented');
        consequences.validationCriteria.push('Function has test coverage');
    }
    // Check for axiom references (constitutional impact)
    if (/AXIOM\s+\d+/i.test(code)) {
        consequences.enables.push('Axiom enforcement in this location');
        consequences.forbids.push('Removing axiom without constitutional review');
        consequences.assumptions.push('Axiom interpretation is correct');
        consequences.validationCriteria.push('Axiom enforcement is mechanical, not heuristic');
    }
    // Check for async patterns (error handling requirements)
    if (/async\s+function|async\s+\(/.test(code)) {
        consequences.assumptions.push('Async errors are properly handled');
        consequences.validationCriteria.push('Error handling covers all async paths');
    }
    // Check for Result pattern usage
    if (/Result</.test(code)) {
        consequences.enables.push('Explicit error handling via Result type');
        consequences.assumptions.push('All error cases return Err()');
        consequences.validationCriteria.push('No exceptions thrown in Result-returning code');
    }
    // Check for external dependencies
    if (/import.*from\s+['"][^.\/]/.test(code)) {
        consequences.assumptions.push('External dependencies are stable');
        consequences.validationCriteria.push('Dependencies are pinned in package-lock.json');
    }
    // Check for file system operations
    if (/fs\.(read|write|unlink|mkdir|rmdir)/.test(code)) {
        consequences.enables.push('File system modifications');
        consequences.forbids.push('Safe operation without proper permissions');
        consequences.assumptions.push('File paths are validated');
        consequences.validationCriteria.push('No path traversal vulnerabilities');
    }
    // Check for capability references
    if (/capabilities|Capability/.test(code)) {
        consequences.enables.push('Capability-based access control');
        consequences.forbids.push('Bypassing capability checks');
        consequences.assumptions.push('Capabilities are explicitly granted');
        consequences.validationCriteria.push('AXIOM 9 (Explicit Capabilities) enforced');
    }
    return consequences;
}
/**
 * Assess overall risk level
 */
function assessRiskLevel(proposal, surface) {
    let riskScore = 0;
    // TCB changes increase risk
    const tcbClass = (0, decisionClassifier_1.getTCBClassification)(proposal.targetFile);
    switch (tcbClass) {
        case 'constitutional':
            riskScore += 40;
            break;
        case 'authority':
            riskScore += 30;
            break;
        case 'governed':
            riskScore += 20;
            break;
        case 'schema':
            riskScore += 15;
            break;
        case 'non-tcb':
            riskScore += 0;
            break;
    }
    // Issue severity increases risk
    switch (proposal.issue.severity) {
        case 'critical':
            riskScore += 20;
            break;
        case 'high':
            riskScore += 15;
            break;
        case 'medium':
            riskScore += 10;
            break;
        case 'low':
            riskScore += 5;
            break;
    }
    // Number of forbids increases risk
    riskScore += Math.min(surface.forbids.length * 3, 20);
    // Number of assumptions increases risk
    riskScore += Math.min(surface.assumptions.length * 2, 15);
    // Change type affects risk
    if (proposal.proposedChange.type === 'refactor') {
        riskScore += 10;
    }
    else if (proposal.proposedChange.type === 'modify_function') {
        riskScore += 5;
    }
    // Map score to level
    if (riskScore >= 60)
        return 'critical';
    if (riskScore >= 40)
        return 'high';
    if (riskScore >= 20)
        return 'medium';
    return 'low';
}
/**
 * Assess reversibility of the change
 */
function assessReversibility(proposal, surface) {
    const tcbClass = (0, decisionClassifier_1.getTCBClassification)(proposal.targetFile);
    // Constitutional changes are essentially irreversible
    if (tcbClass === 'constitutional') {
        return {
            canRevert: false,
            revertCost: 'impossible',
            revertMethod: 'Requires constitutional amendment process'
        };
    }
    // Schema changes are expensive to revert
    if (tcbClass === 'schema') {
        return {
            canRevert: true,
            revertCost: 'expensive',
            revertMethod: 'Requires data migration and version bump'
        };
    }
    // Authority TCB changes are expensive
    if (tcbClass === 'authority') {
        return {
            canRevert: true,
            revertCost: 'expensive',
            revertMethod: 'Git revert + full test suite + evidence review'
        };
    }
    // Governed TCB changes are moderately expensive
    if (tcbClass === 'governed') {
        return {
            canRevert: true,
            revertCost: 'moderate',
            revertMethod: 'Git revert + targeted testing'
        };
    }
    // Non-TCB add_test is trivially reversible
    if (proposal.proposedChange.type === 'add_test') {
        return {
            canRevert: true,
            revertCost: 'trivial',
            revertMethod: 'Delete test file'
        };
    }
    // Non-TCB add_function is trivially reversible
    if (proposal.proposedChange.type === 'add_function') {
        return {
            canRevert: true,
            revertCost: 'trivial',
            revertMethod: 'Remove function if unused, check callers if used'
        };
    }
    // Non-TCB modify/refactor is moderate
    return {
        canRevert: true,
        revertCost: 'moderate',
        revertMethod: 'Git revert or manual restoration'
    };
}
/**
 * Format consequence surface for human review
 */
function formatConsequenceSurface(analysis) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('CONSEQUENCE SURFACE ANALYSIS');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`Target: ${analysis.proposal.targetFile}`);
    lines.push(`Change Type: ${analysis.proposal.changeType}`);
    lines.push(`Risk Level: ${analysis.riskLevel.toUpperCase()}`);
    lines.push('');
    lines.push('ENABLES:');
    for (const item of analysis.surface.enables) {
        lines.push(`  ✓ ${item}`);
    }
    lines.push('');
    lines.push('FORBIDS:');
    for (const item of analysis.surface.forbids) {
        lines.push(`  ✗ ${item}`);
    }
    lines.push('');
    lines.push('ASSUMPTIONS:');
    for (const item of analysis.surface.assumptions) {
        lines.push(`  ? ${item}`);
    }
    lines.push('');
    lines.push('VALIDATION CRITERIA:');
    for (const item of analysis.surface.validationCriteria) {
        lines.push(`  ☐ ${item}`);
    }
    lines.push('');
    lines.push('REVERSIBILITY:');
    lines.push(`  Can Revert: ${analysis.reversibilityAssessment.canRevert ? 'Yes' : 'No'}`);
    lines.push(`  Revert Cost: ${analysis.reversibilityAssessment.revertCost}`);
    if (analysis.reversibilityAssessment.revertMethod) {
        lines.push(`  Method: ${analysis.reversibilityAssessment.revertMethod}`);
    }
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
}
