"use strict";
// Axiom Checker - Automated violation tests for Motherlabs axioms
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: All 12 Axioms via pattern detection
// TCB Component: This file is part of the Trusted Computing Base
// See AXIOMS.md for full specification
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAxiomViolations = checkAxiomViolations;
exports.getAxiomViolationSummary = getAxiomViolationSummary;
exports.formatAxiomViolations = formatAxiomViolations;
/**
 * Check code for axiom violations
 * Returns violations that can be detected statically
 */
function checkAxiomViolations(code) {
    const violations = [];
    // ═══════════════════════════════════════════════════════════
    // Axiom 1: Deterministic Authority
    // Violation: Decision based on probabilistic score
    // ═══════════════════════════════════════════════════════════
    if (/if\s*\(\s*(confidence|probability|likelihood|score)\s*[><=]/.test(code)) {
        violations.push({
            axiom: 1,
            name: 'Deterministic Authority',
            severity: 'critical',
            message: 'Decision based on probabilistic score - admission must be deterministic',
            evidence: code.match(/if\s*\(\s*(confidence|probability|likelihood|score)\s*[><=][^)]+\)/)?.[0]
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 2: Probabilistic Systems Non-Authoritative
    // Violation: LLM output directly causes state change
    // ═══════════════════════════════════════════════════════════
    if (/llm\.(generate|complete|chat).*\.(write|apply|execute|commit)/i.test(code)) {
        violations.push({
            axiom: 2,
            name: 'Non-Authoritative LLMs',
            severity: 'critical',
            message: 'LLM output directly chained to state mutation - authority leak'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 3: Mechanical Verification Before Irreversible Action
    // Violation: Write/commit without gate check
    // ═══════════════════════════════════════════════════════════
    if (/writeFileSync|fs\.write|git\s+commit/.test(code) &&
        !/validate|gate|check/.test(code)) {
        violations.push({
            axiom: 3,
            name: 'Mechanical Verification',
            severity: 'high',
            message: 'Irreversible action without apparent verification gate'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 4: Explicit Intent or Halt
    // Violation: Default/fallback values for critical parameters
    // ═══════════════════════════════════════════════════════════
    if (/\|\|\s*['"][^'"]+['"].*(?:path|file|target|env|scope)/i.test(code)) {
        violations.push({
            axiom: 4,
            name: 'Explicit Intent or Halt',
            severity: 'medium',
            message: 'Default value for potentially critical parameter - should halt if missing'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 5: Refusal Is First-Class
    // Violation: Catch-all that proceeds anyway
    // ═══════════════════════════════════════════════════════════
    if (/catch\s*\([^)]*\)\s*\{[^}]*continue|catch\s*\([^)]*\)\s*\{[^}]*return\s+true/.test(code)) {
        violations.push({
            axiom: 5,
            name: 'Refusal First-Class',
            severity: 'high',
            message: 'Error caught and suppressed - should refuse instead of proceeding'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 6: No Silent State Mutation
    // Violation: Write without logging/evidence
    // ═══════════════════════════════════════════════════════════
    if (/writeFileSync\s*\([^)]*\)/.test(code) &&
        !/ledger|evidence|log|MUTATION-LOGGED/.test(code)) {
        violations.push({
            axiom: 6,
            name: 'No Silent Mutation',
            severity: 'critical',
            message: 'File write without evidence trail - all mutations must be logged'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 7: Separation of Decision and Execution
    // Violation: Same function validates and executes
    // ═══════════════════════════════════════════════════════════
    if (/function\s+\w+[^{]*\{[^}]*(validate|check|verify)[^}]*(write|apply|execute|commit)[^}]*\}/s.test(code)) {
        violations.push({
            axiom: 7,
            name: 'Decision/Execution Separation',
            severity: 'high',
            message: 'Single function appears to both validate and execute - separate concerns'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 8: Evidence Immutable
    // Violation: Evidence mutation operations
    // ═══════════════════════════════════════════════════════════
    if (/ledger\.(update|delete|remove|clear|splice)|evidence\.(update|delete|remove)/.test(code)) {
        violations.push({
            axiom: 8,
            name: 'Immutable Evidence',
            severity: 'critical',
            message: 'Evidence mutation detected - evidence must be append-only'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 9: Explicit Capability
    // Violation: Dynamic capability acquisition
    // ═══════════════════════════════════════════════════════════
    if (/capabilities\s*\.push|capabilities\s*\[\s*\w+\s*\]\s*=|addCapability|grantPermission/.test(code)) {
        violations.push({
            axiom: 9,
            name: 'Explicit Capability',
            severity: 'critical',
            message: 'Dynamic capability escalation - capabilities must be declared, not acquired'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 10: Model Independence
    // Violation: Model-specific logic in authority code
    // ═══════════════════════════════════════════════════════════
    if (/(gpt-4|claude|gemini|llama).*\?(admit|reject|allow|deny)/i.test(code)) {
        violations.push({
            axiom: 10,
            name: 'Model Independence',
            severity: 'high',
            message: 'Model-specific admission logic - authority must be model-agnostic'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 11: No Implicit Memory
    // Violation: Hidden state persistence
    // ═══════════════════════════════════════════════════════════
    if (/localStorage|sessionStorage|global\.\w+\s*=|process\.env\.\w+\s*=/.test(code)) {
        violations.push({
            axiom: 11,
            name: 'No Implicit Memory',
            severity: 'high',
            message: 'Implicit state persistence detected - all memory must be explicit'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 12: Policy Over Convenience
    // Violation: Skip/bypass flags
    // ═══════════════════════════════════════════════════════════
    if (/skipValidation|bypassGate|forceApply|--no-verify|--force/.test(code)) {
        violations.push({
            axiom: 12,
            name: 'Policy Over Convenience',
            severity: 'critical',
            message: 'Bypass flag detected - no shortcuts that skip verification'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 13: No Anthropomorphism
    // Violation: Intelligence assumptions in authority code
    // ═══════════════════════════════════════════════════════════
    if (/system\s+(understand|think|decide|know|believe|intend)/i.test(code)) {
        violations.push({
            axiom: 13,
            name: 'No Anthropomorphism',
            severity: 'medium',
            message: 'Anthropomorphic language in authority code - rely on constraints, not understanding'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 14: Sandbox by Default
    // Violation: Destructive operations outside sandbox
    // ═══════════════════════════════════════════════════════════
    if (/(rm\s+-rf|DELETE\s+FROM|DROP\s+TABLE|rmSync.*recursive)/i.test(code) &&
        !/sandbox|test|mock/.test(code)) {
        violations.push({
            axiom: 14,
            name: 'Sandbox by Default',
            severity: 'critical',
            message: 'Destructive operation outside sandbox context'
        });
    }
    // ═══════════════════════════════════════════════════════════
    // Axiom 15: Local Authority
    // Violation: External service making admission decisions
    // ═══════════════════════════════════════════════════════════
    if (/await\s+fetch.*\.(admit|allow|approve)|external.*decision|remote.*authority/.test(code)) {
        violations.push({
            axiom: 15,
            name: 'Local Authority',
            severity: 'critical',
            message: 'External service appears to control admission - authority must be local'
        });
    }
    return {
        passed: violations.filter(v => v.severity === 'critical').length === 0,
        violations
    };
}
/**
 * Get violation summary
 */
function getAxiomViolationSummary(result) {
    if (result.violations.length === 0) {
        return 'All axioms satisfied';
    }
    const critical = result.violations.filter(v => v.severity === 'critical').length;
    const high = result.violations.filter(v => v.severity === 'high').length;
    const medium = result.violations.filter(v => v.severity === 'medium').length;
    const parts = [];
    if (critical > 0)
        parts.push(`${critical} critical`);
    if (high > 0)
        parts.push(`${high} high`);
    if (medium > 0)
        parts.push(`${medium} medium`);
    return `Axiom violations: ${parts.join(', ')}`;
}
/**
 * Format violations for display
 */
function formatAxiomViolations(violations) {
    if (violations.length === 0) {
        return 'No axiom violations detected';
    }
    return violations.map(v => `[AXIOM ${v.axiom}] ${v.severity.toUpperCase()}: ${v.name}\n  ${v.message}${v.evidence ? `\n  Evidence: ${v.evidence}` : ''}`).join('\n\n');
}
