"use strict";
// Security Scanner - Detects common vulnerability patterns in code
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 6 (No Silent State Mutation), Gate 6 Governance
// TCB Component: Part of the 6-Gate Validation System
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanForVulnerabilities = scanForVulnerabilities;
exports.getVulnerabilitySummary = getVulnerabilitySummary;
// Patterns for security vulnerability detection
const SECURITY_PATTERNS = [
    // Command Injection
    {
        type: 'COMMAND_INJECTION',
        severity: 'critical',
        pattern: /\bexec\s*\(\s*['"`][^'"`]*\s*\+/,
        message: 'String concatenation in exec() call - command injection risk'
    },
    {
        type: 'COMMAND_INJECTION',
        severity: 'critical',
        pattern: /\bexecSync\s*\(\s*['"`][^'"`]*\s*\+/,
        message: 'String concatenation in execSync() call - command injection risk'
    },
    {
        type: 'COMMAND_INJECTION',
        severity: 'critical',
        pattern: /\bexec\s*\([^)]*\+[^)]*\)/,
        message: 'Dynamic string in exec() - command injection risk'
    },
    {
        type: 'COMMAND_INJECTION',
        severity: 'critical',
        pattern: /\bexec\s*\(\s*`[^`]*\$\{/,
        message: 'Template literal in exec() call - command injection risk'
    },
    {
        type: 'COMMAND_INJECTION',
        severity: 'high',
        pattern: /\bspawn\s*\([^)]*\+[^)]*\)/,
        message: 'Dynamic string in spawn() - potential command injection'
    },
    // Path Traversal
    {
        type: 'PATH_TRAVERSAL',
        severity: 'high',
        pattern: /\.\.\//,
        message: 'Relative path traversal pattern detected'
    },
    {
        type: 'PATH_TRAVERSAL',
        severity: 'high',
        pattern: /path\.(join|resolve)\s*\([^)]*\+[^)]*\)/,
        message: 'String concatenation in path operation - potential path traversal'
    },
    // Eval Usage
    {
        type: 'EVAL_USAGE',
        severity: 'critical',
        pattern: /\beval\s*\(/,
        message: 'Direct eval() usage detected - code injection risk'
    },
    {
        type: 'EVAL_USAGE',
        severity: 'critical',
        pattern: /new\s+Function\s*\(/,
        message: 'Dynamic Function constructor - code injection risk'
    },
    {
        type: 'EVAL_USAGE',
        severity: 'high',
        pattern: /vm\.(runInContext|runInNewContext|runInThisContext)\s*\(/,
        message: 'VM code execution - ensure input is trusted'
    },
    // Hardcoded Secrets
    {
        type: 'HARDCODED_SECRET',
        severity: 'critical',
        pattern: /(password|secret|api[_-]?key|token|credential)\s*[:=]\s*['"][^'"]{8,}['"]/i,
        message: 'Hardcoded secret/credential detected'
    },
    {
        type: 'HARDCODED_SECRET',
        severity: 'high',
        pattern: /sk-[a-zA-Z0-9]{20,}/,
        message: 'Possible API key pattern detected'
    },
    {
        type: 'HARDCODED_SECRET',
        severity: 'high',
        pattern: /ghp_[a-zA-Z0-9]{36}/,
        message: 'GitHub personal access token pattern detected'
    },
    {
        type: 'HARDCODED_SECRET',
        severity: 'high',
        pattern: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/,
        message: 'Private key embedded in code'
    },
    // SQL Injection
    {
        type: 'SQL_INJECTION',
        severity: 'critical',
        pattern: /\.(query|execute)\s*\(\s*['"`][^'"`]*(SELECT|INSERT|UPDATE|DELETE)[^'"`]*\$\{/i,
        message: 'Template literal in SQL query - SQL injection risk'
    },
    {
        type: 'SQL_INJECTION',
        severity: 'critical',
        pattern: /\.(query|execute)\s*\([^)]*\+[^)]*\)/,
        message: 'String concatenation in SQL query - SQL injection risk'
    },
    // XSS Vectors
    {
        type: 'XSS_VECTOR',
        severity: 'high',
        pattern: /\.innerHTML\s*=/,
        message: 'innerHTML assignment - XSS risk'
    },
    {
        type: 'XSS_VECTOR',
        severity: 'high',
        pattern: /document\.write\s*\(/,
        message: 'document.write() usage - XSS risk'
    },
    {
        type: 'XSS_VECTOR',
        severity: 'medium',
        pattern: /dangerouslySetInnerHTML/,
        message: 'React dangerouslySetInnerHTML - XSS risk if not sanitized'
    },
    // Prototype Pollution
    {
        type: 'PROTOTYPE_POLLUTION',
        severity: 'high',
        pattern: /__proto__/,
        message: '__proto__ access detected - prototype pollution risk'
    },
    {
        type: 'PROTOTYPE_POLLUTION',
        severity: 'high',
        pattern: /\[['"]constructor['"]\]/,
        message: 'Dynamic constructor access - prototype pollution risk'
    },
    {
        type: 'PROTOTYPE_POLLUTION',
        severity: 'medium',
        pattern: /Object\.assign\s*\([^)]*,\s*[^)]*\)/,
        message: 'Object.assign with external input - verify source'
    },
    // Unsafe Regex (ReDoS)
    {
        type: 'UNSAFE_REGEX',
        severity: 'medium',
        pattern: /new\s+RegExp\s*\([^)]*\+[^)]*\)/,
        message: 'Dynamic RegExp construction - ReDoS risk'
    },
    // Insecure Random
    {
        type: 'INSECURE_RANDOM',
        severity: 'medium',
        pattern: /Math\.random\s*\(\)/,
        message: 'Math.random() for security-sensitive operation - use crypto'
    },
    // Unsafe Deserialization
    {
        type: 'UNSAFE_DESERIALIZATION',
        severity: 'high',
        pattern: /JSON\.parse\s*\([^)]*\)/,
        message: 'JSON.parse on untrusted input - verify source'
    },
    {
        type: 'UNSAFE_DESERIALIZATION',
        severity: 'critical',
        pattern: /require\s*\(\s*[^'"]/,
        message: 'Dynamic require - code injection risk'
    },
    // ═══════════════════════════════════════════════════════════
    // INVARIANT VIOLATIONS - Motherlabs structural invariants
    // ═══════════════════════════════════════════════════════════
    // Invariant 1: No Probabilistic Authority
    {
        type: 'INVARIANT_PROBABILISTIC_AUTHORITY',
        severity: 'critical',
        pattern: /if\s*\(\s*(confidence|probability|likelihood|score)\s*[><=]/,
        message: 'INVARIANT VIOLATION: Decision based on probabilistic score'
    },
    {
        type: 'INVARIANT_PROBABILISTIC_AUTHORITY',
        severity: 'high',
        pattern: /\.confidence\s*[><=]|\.probability\s*[><=]/,
        message: 'INVARIANT VIOLATION: Authority decision on confidence/probability'
    },
    // Invariant 3: No Silent Mutation
    {
        type: 'INVARIANT_SILENT_MUTATION',
        severity: 'critical',
        pattern: /writeFileSync\s*\([^)]*\)\s*(?!.*\/\/\s*MUTATION-LOGGED)/,
        message: 'INVARIANT VIOLATION: File write without MUTATION-LOGGED annotation'
    },
    // Invariant 9: No Auto-Escalation
    {
        type: 'INVARIANT_AUTO_ESCALATION',
        severity: 'critical',
        pattern: /requireHumanApproval\s*=\s*false\s*(?!.*\/\/\s*BOOTSTRAP-MODE)/,
        message: 'INVARIANT VIOLATION: Disabling human approval without BOOTSTRAP-MODE annotation'
    },
    {
        type: 'INVARIANT_AUTO_ESCALATION',
        severity: 'critical',
        pattern: /capabilities\s*\.push|capabilities\s*=.*NET/,
        message: 'INVARIANT VIOLATION: Dynamic capability escalation detected'
    },
    // Invariant 7: Policy/Execution Separation
    {
        type: 'INVARIANT_POLICY_EXECUTION_COLLAPSE',
        severity: 'high',
        pattern: /validate.*&&.*apply|if\s*\(.*valid.*\)\s*\{[^}]*write/,
        message: 'INVARIANT VIOLATION: Policy and execution may be collapsed'
    },
    // ═══════════════════════════════════════════════════════════
    // HOLLOW CODE DETECTION - Functions that do nothing meaningful
    // ═══════════════════════════════════════════════════════════
    // Hollow tests - functions that just return true/false
    {
        type: 'HOLLOW_TEST',
        severity: 'critical',
        pattern: /function\s+test\w*\s*\([^)]*\)\s*(?::\s*boolean)?\s*\{\s*(?:\/\/[^\n]*)?\s*return\s+true\s*;?\s*\}/,
        message: 'HOLLOW CODE: Test function returns true without assertions'
    },
    {
        type: 'HOLLOW_TEST',
        severity: 'critical',
        pattern: /(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*boolean)?\s*\{\s*return\s+(?:true|false)\s*;?\s*\}/,
        message: 'HOLLOW CODE: Function body only returns constant boolean'
    },
    // Placeholder functions
    {
        type: 'HOLLOW_PLACEHOLDER',
        severity: 'critical',
        pattern: /function\s+placeholder\s*\(/,
        message: 'HOLLOW CODE: Placeholder function detected'
    },
    {
        type: 'HOLLOW_PLACEHOLDER',
        severity: 'high',
        pattern: /\/\/\s*DETERMINISTIC:\s*Placeholder/,
        message: 'HOLLOW CODE: Deterministic placeholder marker detected'
    },
    {
        type: 'HOLLOW_PLACEHOLDER',
        severity: 'high',
        pattern: /\/\/\s*(?:Basic|Error)\s+(?:test\s+)?placeholder/i,
        message: 'HOLLOW CODE: Placeholder comment in test'
    },
    // Empty/trivial function bodies
    {
        type: 'HOLLOW_FUNCTION',
        severity: 'high',
        pattern: /(?:export\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*void)?\s*\{\s*(?:\/\/[^\n]*)?\s*\}/,
        message: 'HOLLOW CODE: Function with empty body'
    }
];
// Allowlist patterns that are safe despite matching vulnerability patterns
const SAFE_PATTERNS = [
    // Test/mock code is often fine
    /\.test\.(ts|js)|\.spec\.(ts|js)|__tests__|__mocks__/,
    // Pattern checks themselves are fine
    /DETERMINISM-EXEMPT|Pattern check only/,
    // Path operations with constants are fine
    /path\.(join|resolve)\s*\(\s*__dirname/,
    // Invariant exemptions (must be annotated)
    /MUTATION-LOGGED|BOOTSTRAP-MODE|INVARIANT-EXEMPT/,
];
/**
 * Scan code for security vulnerabilities
 */
function scanForVulnerabilities(code) {
    const vulnerabilities = [];
    const lines = code.split('\n');
    // Check if code matches any safe patterns (e.g., test files)
    const isSafeContext = SAFE_PATTERNS.some(p => p.test(code));
    for (const patternDef of SECURITY_PATTERNS) {
        // Skip some patterns in safe contexts
        if (isSafeContext && patternDef.severity !== 'critical') {
            continue;
        }
        // Check each line for the pattern
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comments
            if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) {
                continue;
            }
            if (patternDef.pattern.test(line)) {
                // Check for inline exemptions
                if (/SECURITY-EXEMPT/.test(line)) {
                    continue;
                }
                vulnerabilities.push({
                    type: patternDef.type,
                    severity: patternDef.severity,
                    line: i + 1,
                    message: patternDef.message,
                    pattern: patternDef.pattern.source
                });
            }
        }
    }
    // Calculate security score
    const score = calculateSecurityScore(vulnerabilities);
    // Determine if passed (no critical/high vulnerabilities)
    const hasCritical = vulnerabilities.some(v => v.severity === 'critical');
    const hasHigh = vulnerabilities.some(v => v.severity === 'high');
    const passed = !hasCritical && !hasHigh;
    return {
        passed,
        vulnerabilities,
        score
    };
}
/**
 * Calculate security score (0-100)
 */
function calculateSecurityScore(vulnerabilities) {
    if (vulnerabilities.length === 0) {
        return 100;
    }
    let deductions = 0;
    for (const vuln of vulnerabilities) {
        switch (vuln.severity) {
            case 'critical':
                deductions += 30;
                break;
            case 'high':
                deductions += 20;
                break;
            case 'medium':
                deductions += 10;
                break;
            case 'low':
                deductions += 5;
                break;
        }
    }
    return Math.max(0, 100 - deductions);
}
/**
 * Get human-readable summary of vulnerabilities
 */
function getVulnerabilitySummary(result) {
    if (result.vulnerabilities.length === 0) {
        return 'No security vulnerabilities detected';
    }
    const bySeverity = {
        critical: result.vulnerabilities.filter(v => v.severity === 'critical').length,
        high: result.vulnerabilities.filter(v => v.severity === 'high').length,
        medium: result.vulnerabilities.filter(v => v.severity === 'medium').length,
        low: result.vulnerabilities.filter(v => v.severity === 'low').length
    };
    const parts = [];
    if (bySeverity.critical > 0)
        parts.push(`${bySeverity.critical} critical`);
    if (bySeverity.high > 0)
        parts.push(`${bySeverity.high} high`);
    if (bySeverity.medium > 0)
        parts.push(`${bySeverity.medium} medium`);
    if (bySeverity.low > 0)
        parts.push(`${bySeverity.low} low`);
    return `Security issues: ${parts.join(', ')} (score: ${result.score}/100)`;
}
