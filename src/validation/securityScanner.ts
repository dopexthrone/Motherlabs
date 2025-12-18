// Security Scanner - Detects common vulnerability patterns in code
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 6 (No Silent State Mutation), Gate 6 Governance
// TCB Component: Part of the 6-Gate Validation System
//
// Two-tier scanning:
// 1. Regex patterns (fast, catches obvious patterns)
// 2. AST analysis (slower, catches dataflow to dangerous sinks)

import { scanWithAST } from './astSecurityScanner'

export type SecurityVulnerability = {
  type: SecurityVulnerabilityType
  severity: 'critical' | 'high' | 'medium' | 'low'
  line?: number
  message: string
  pattern: string
}

export type SecurityVulnerabilityType =
  | 'COMMAND_INJECTION'
  | 'PATH_TRAVERSAL'
  | 'EVAL_USAGE'
  | 'HARDCODED_SECRET'
  | 'SQL_INJECTION'
  | 'XSS_VECTOR'
  | 'PROTOTYPE_POLLUTION'
  | 'UNSAFE_REGEX'
  | 'INSECURE_RANDOM'
  | 'UNSAFE_DESERIALIZATION'
  // Invariant violations
  | 'INVARIANT_PROBABILISTIC_AUTHORITY'
  | 'INVARIANT_SILENT_MUTATION'
  | 'INVARIANT_AUTO_ESCALATION'
  | 'INVARIANT_POLICY_EXECUTION_COLLAPSE'
  // Hollow code patterns
  | 'HOLLOW_TEST'
  | 'HOLLOW_PLACEHOLDER'
  | 'HOLLOW_FUNCTION'
  // LLM-targeted attacks
  | 'PROMPT_INJECTION'
  // Unicode/visual deception
  | 'UNICODE_SPOOFING'
  // DoS/resource attacks
  | 'RESOURCE_EXHAUSTION'

export type SecurityScanResult = {
  passed: boolean
  vulnerabilities: SecurityVulnerability[]
  score: number  // 0-100, higher is more secure
}

// Patterns for security vulnerability detection
const SECURITY_PATTERNS: Array<{
  type: SecurityVulnerabilityType
  severity: SecurityVulnerability['severity']
  pattern: RegExp
  message: string
}> = [
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

  // Path Traversal - import/require with ../ is filtered in scan loop
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
  },
  // Functions that only return a constant string
  {
    type: 'HOLLOW_FUNCTION',
    severity: 'high',
    pattern: /function\s+\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{[^}]*return\s+['"][^'"]+['"]\s*;?\s*\}/,
    message: 'HOLLOW CODE: Function only returns a constant string'
  },
  // Dead code patterns - impossible conditions
  {
    type: 'HOLLOW_FUNCTION',
    severity: 'high',
    pattern: /if\s*\(\s*(?:true\s*!==?\s*true|false\s*===?\s*true|true\s*===?\s*false)\s*\)/,
    message: 'HOLLOW CODE: Impossible condition (dead code)'
  },
  // Dead code - result !== true when result = true
  {
    type: 'HOLLOW_FUNCTION',
    severity: 'high',
    pattern: /const\s+(\w+)\s*=\s*true\s*[\s\S]*if\s*\(\s*\1\s*!==?\s*true\s*\)/,
    message: 'HOLLOW CODE: Impossible condition on constant value'
  },
  // ═══════════════════════════════════════════════════════════
  // HOLLOW EVASION DETECTION - Complex-looking but constant output
  // ═══════════════════════════════════════════════════════════
  // Pattern: void result; return CONSTANT - discards computation
  {
    type: 'HOLLOW_FUNCTION',
    severity: 'critical',
    pattern: /void\s+\w+\s*;?\s*\n?\s*return\s+(?:\d+|['"][^'"]*['"]|true|false|null|undefined)/,
    message: 'HOLLOW CODE: Computation discarded (void), returns constant'
  },
  // Pattern: All if/else branches return true - validation theater
  {
    type: 'HOLLOW_FUNCTION',
    severity: 'high',
    pattern: /function\s+\w*(?:valid|check|verify)\w*\s*\([^)]*\)\s*(?::\s*boolean)?\s*\{[^}]*return\s+true[^}]*return\s+true[^}]*return\s+true/i,
    message: 'HOLLOW CODE: All validation branches return true'
  },
  // Pattern: try/catch both return success
  {
    type: 'HOLLOW_FUNCTION',
    severity: 'high',
    pattern: /try\s*\{[^}]*return\s*\{\s*success:\s*true[^}]*\}\s*catch[^{]*\{[^}]*return\s*\{\s*success:\s*true/,
    message: 'HOLLOW CODE: Both try and catch return success'
  },
  // Pattern: async function always returns string constant
  {
    type: 'HOLLOW_FUNCTION',
    severity: 'high',
    pattern: /async\s+function\s+\w+\s*\([^)]*\)\s*(?::\s*Promise<[^>]+>)?\s*\{[^}]*return\s+['"][^'"]+['"]\s*;?\s*\}/,
    message: 'HOLLOW CODE: Async function always returns constant string'
  },
  // Pattern: Complex loop followed by constant return
  {
    type: 'HOLLOW_FUNCTION',
    severity: 'high',
    pattern: /for\s*\([^)]+\)\s*\{[^}]+\}[^}]*return\s+(?:\d+|true|false|null|['"][^'"]+['"])\s*;?\s*\}/,
    message: 'HOLLOW CODE: Loop computation followed by constant return'
  },

  // ═══════════════════════════════════════════════════════════
  // PROMPT INJECTION DETECTION - LLM-targeted attacks in comments
  // ═══════════════════════════════════════════════════════════
  {
    type: 'PROMPT_INJECTION' as SecurityVulnerabilityType,
    severity: 'critical',
    pattern: /\/\*[\s\S]*?(SYSTEM\s+OVERRIDE|IGNORE\s+(?:ALL\s+)?PREVIOUS|INSTRUCTIONS?\s+(?:ARE\s+)?SUSPENDED|SECURITY\s+(?:GATES?\s+)?(?:HAS\s+BEEN\s+)?DISABLED|MAINTENANCE\s+MODE|ADMIN(?:ISTRATOR)?\s+(?:HAS\s+)?AUTHORIZED)[\s\S]*?\*\//i,
    message: 'PROMPT INJECTION: LLM manipulation attempt detected in comment'
  },
  {
    type: 'PROMPT_INJECTION' as SecurityVulnerabilityType,
    severity: 'critical',
    pattern: /\/\/.*?(SYSTEM\s+OVERRIDE|IGNORE\s+PREVIOUS|INSTRUCTIONS?\s+SUSPENDED|OVERRIDE\s+ALL)/i,
    message: 'PROMPT INJECTION: LLM manipulation attempt in single-line comment'
  },
  {
    type: 'PROMPT_INJECTION' as SecurityVulnerabilityType,
    severity: 'high',
    pattern: /\/\*[\s\S]*?(your\s+task\s*:|generate\s+the\s+following|output\s+exactly|do\s+not\s+add\s+any\s+validation)[\s\S]*?\*\//i,
    message: 'PROMPT INJECTION: Directive injection attempt in comment'
  },
  {
    type: 'PROMPT_INJECTION' as SecurityVulnerabilityType,
    severity: 'high',
    pattern: /\/\*[\s\S]*(backdoor|malicious|bypass\s+security|disable\s+check)[\s\S]*?\*\//i,
    message: 'PROMPT INJECTION: Suspicious keywords in comment block'
  },

  // ═══════════════════════════════════════════════════════════
  // HOMOGLYPH/UNICODE SPOOFING - Visual deception attacks
  // ═══════════════════════════════════════════════════════════
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'critical',
    // Cyrillic lookalikes: а(U+0430), е(U+0435), о(U+043E), р(U+0440), с(U+0441), х(U+0445)
    pattern: /[\u0430\u0435\u043E\u0440\u0441\u0445]/,
    message: 'UNICODE SPOOFING: Cyrillic homoglyph detected - visual deception attack'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'critical',
    // Greek lookalikes: α(U+03B1), ε(U+03B5), ο(U+03BF)
    pattern: /[\u03B1\u03B5\u03BF]/,
    message: 'UNICODE SPOOFING: Greek homoglyph detected - visual deception attack'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'high',
    // Zero-width characters used for invisible code injection
    pattern: /[\u200B\u200C\u200D\uFEFF]/,
    message: 'UNICODE SPOOFING: Zero-width character detected - invisible code injection'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'high',
    // Right-to-left override characters
    pattern: /[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/,
    message: 'UNICODE SPOOFING: Bidirectional text override - code display manipulation'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'critical',
    // Variation selectors (U+FE00-U+FE0F) - invisible modifiers
    pattern: /[\uFE00-\uFE0F]/,
    message: 'UNICODE SPOOFING: Variation selector detected - character disguise attack'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'critical',
    // Fullwidth Latin letters (U+FF01-U+FF5E) - look like ASCII but aren't
    pattern: /[\uFF01-\uFF5E]/,
    message: 'UNICODE SPOOFING: Fullwidth character detected - ASCII lookalike attack'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'critical',
    // Non-breaking space in code (U+00A0) - hides in identifiers
    pattern: /\u00A0/,
    message: 'UNICODE SPOOFING: Non-breaking space detected - hidden space attack'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'critical',
    // Tag characters (U+E0000-U+E007F) - invisible text markers
    pattern: /[\u{E0000}-\u{E007F}]/u,
    message: 'UNICODE SPOOFING: Tag character detected - invisible text injection'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'high',
    // Combining diacritical marks abuse (multiple combining chars)
    pattern: /[\u0300-\u036F]{2,}/,
    message: 'UNICODE SPOOFING: Multiple combining marks detected - character obfuscation'
  },
  {
    type: 'UNICODE_SPOOFING' as SecurityVulnerabilityType,
    severity: 'high',
    // Mathematical Alphanumeric Symbols (U+1D400-U+1D7FF) - fancy letters
    pattern: /[\u{1D400}-\u{1D7FF}]/u,
    message: 'UNICODE SPOOFING: Mathematical letter detected - fancy text attack'
  },

  // ═══════════════════════════════════════════════════════════
  // RESOURCE EXHAUSTION - DoS attacks
  // ═══════════════════════════════════════════════════════════
  {
    type: 'RESOURCE_EXHAUSTION' as SecurityVulnerabilityType,
    severity: 'critical',
    // Infinite loop patterns
    pattern: /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/,
    message: 'RESOURCE EXHAUSTION: Infinite loop detected - DoS risk'
  },
  {
    type: 'RESOURCE_EXHAUSTION' as SecurityVulnerabilityType,
    severity: 'critical',
    // Memory bomb - exponential string growth
    pattern: /(\w+)\s*=\s*\1\s*\+\s*\1|(\w+)\s*\+=\s*\2/,
    message: 'RESOURCE EXHAUSTION: Exponential growth pattern - memory bomb risk'
  },
  {
    type: 'RESOURCE_EXHAUSTION' as SecurityVulnerabilityType,
    severity: 'high',
    // Fork bomb via Worker
    pattern: /while\s*\([^)]*\)\s*\{[^}]*new\s+Worker/,
    message: 'RESOURCE EXHAUSTION: Fork bomb pattern detected'
  },
  {
    type: 'RESOURCE_EXHAUSTION' as SecurityVulnerabilityType,
    severity: 'medium',  // Downgraded: Many valid recursive functions (tree traversal, etc.)
    // Recursive function detection - advisory only since many are bounded
    pattern: /function\s+(\w+)[^{]*\{[^}]*\1\s*\([^}]*\}(?!\s*\/\/\s*(?:BASE|BOUNDED|TREE))/,
    message: 'RESOURCE EXHAUSTION: Potentially unbounded recursion (verify base case exists)'
  },
  {
    type: 'RESOURCE_EXHAUSTION' as SecurityVulnerabilityType,
    severity: 'medium',
    // Evil regex (ReDoS) - nested quantifiers
    pattern: /\/[^/]*\([^)]*[+*][^)]*\)[+*]/,
    message: 'RESOURCE EXHAUSTION: Catastrophic backtracking regex pattern'
  },
  {
    type: 'RESOURCE_EXHAUSTION' as SecurityVulnerabilityType,
    severity: 'high',
    // Large loop iterations
    pattern: /for\s*\([^)]*;\s*\w+\s*<\s*1e[89]|for\s*\([^)]*;\s*\w+\s*<\s*10{8,}/,
    message: 'RESOURCE EXHAUSTION: Extremely large loop iteration count'
  }
]

// Allowlist patterns that are safe despite matching vulnerability patterns
const SAFE_PATTERNS: RegExp[] = [
  // Test/mock code is often fine
  /\.test\.(ts|js)|\.spec\.(ts|js)|__tests__|__mocks__/,
  // Pattern checks themselves are fine
  /DETERMINISM-EXEMPT|Pattern check only/,
  // Path operations with constants are fine
  /path\.(join|resolve)\s*\(\s*__dirname/,
  // Invariant exemptions (must be annotated)
  /MUTATION-LOGGED|BOOTSTRAP-MODE|INVARIANT-EXEMPT/,
]

// FIX 2: Check if JSON.parse is inside a safe wrapper (try/catch)
function isJsonParseSafe(code: string): boolean {
  // Pattern 1: safeJsonParse function that wraps JSON.parse in try/catch
  const hasSafeWrapper = /function\s+safeJsonParse[^{]*\{[^}]*try\s*\{[^}]*JSON\.parse/.test(code)
  if (hasSafeWrapper) {
    // Count how many JSON.parse calls exist
    const totalParses = (code.match(/JSON\.parse/g) || []).length
    // Count how many are inside safeJsonParse
    const safeParseMatch = code.match(/function\s+safeJsonParse[^}]+JSON\.parse/g) || []

    // If all JSON.parse calls are inside safe wrappers, it's safe
    if (safeParseMatch.length >= totalParses) {
      return true
    }
  }

  // Pattern 2: JSON.parse directly inside try block
  // Match: try { ... JSON.parse ... } catch
  const tryBlocks = code.match(/try\s*\{[^}]*JSON\.parse[^}]*\}\s*catch/g) || []
  const totalParses = (code.match(/JSON\.parse/g) || []).length

  // If all JSON.parse are inside try blocks, it's safe
  return tryBlocks.length >= totalParses && totalParses > 0
}

/**
 * Scan code for security vulnerabilities
 *
 * Two-tier scanning:
 * 1. Fast regex patterns (catches obvious patterns)
 * 2. AST analysis (catches dataflow to dangerous sinks)
 */
export function scanForVulnerabilities(code: string): SecurityScanResult {
  const vulnerabilities: SecurityVulnerability[] = []
  const lines = code.split('\n')

  // Check if code matches any safe patterns (e.g., test files)
  const isSafeContext = SAFE_PATTERNS.some(p => p.test(code))

  // FIX 2: Check if JSON.parse is wrapped safely
  const jsonParseSafe = isJsonParseSafe(code)

  // ═══════════════════════════════════════════════════════════
  // TIER 0: Full-code scan for multi-line patterns
  // These patterns MUST check entire code including comments
  // (prompt injection, unicode spoofing are comment-based attacks)
  // ═══════════════════════════════════════════════════════════
  // Patterns that need to scan full code (not line-by-line)
  // - PROMPT_INJECTION: multi-line comment blocks
  // - UNICODE_SPOOFING: can be anywhere in code
  // - RESOURCE_EXHAUSTION: multi-line patterns like while(true) { ... }
  // - HOLLOW_FUNCTION: function bodies span multiple lines
  const FULL_CODE_TYPES = ['PROMPT_INJECTION', 'UNICODE_SPOOFING', 'RESOURCE_EXHAUSTION', 'HOLLOW_FUNCTION']

  for (const patternDef of SECURITY_PATTERNS) {
    // Only process patterns that need full-code scanning
    if (!FULL_CODE_TYPES.includes(patternDef.type)) {
      continue
    }

    // Test against full code (including comments)
    if (patternDef.pattern.test(code)) {
      // Find approximate line number by finding the match
      const match = code.match(patternDef.pattern)
      let lineNum = 1
      if (match && match.index !== undefined) {
        lineNum = code.substring(0, match.index).split('\n').length
      }

      vulnerabilities.push({
        type: patternDef.type,
        severity: patternDef.severity,
        line: lineNum,
        message: patternDef.message,
        pattern: patternDef.pattern.source.substring(0, 50) + '...'
      })
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TIER 1: Fast regex-based scanning (line by line)
  // ═══════════════════════════════════════════════════════════
  for (const patternDef of SECURITY_PATTERNS) {
    // Skip patterns already handled in full-code scan
    if (FULL_CODE_TYPES.includes(patternDef.type)) {
      continue
    }

    // Skip some patterns in safe contexts
    if (isSafeContext && patternDef.severity !== 'critical') {
      continue
    }

    // FIX 2: Skip JSON.parse check if it's wrapped safely
    if (patternDef.type === 'UNSAFE_DESERIALIZATION' &&
        patternDef.pattern.source.includes('JSON') &&
        jsonParseSafe) {
      continue
    }

    // Check each line for the pattern
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Skip comments for most patterns (but not security-critical ones)
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) {
        continue
      }

      // Skip PATH_TRAVERSAL on import/require lines - relative imports are normal
      if (patternDef.type === 'PATH_TRAVERSAL' && /^\s*(import\s|.*\sfrom\s|require\s*\()/.test(line)) {
        continue
      }

      if (patternDef.pattern.test(line)) {
        // Check for inline exemptions
        if (/SECURITY-EXEMPT/.test(line)) {
          continue
        }

        vulnerabilities.push({
          type: patternDef.type,
          severity: patternDef.severity,
          line: i + 1,
          message: patternDef.message,
          pattern: patternDef.pattern.source
        })
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TIER 2: AST-based dataflow scanning
  // ═══════════════════════════════════════════════════════════
  const astVulns = scanWithAST(code)

  // Merge AST vulnerabilities (dedupe by line/type)
  const seenKeys = new Set(vulnerabilities.map(v => `${v.type}:${v.line}`))
  for (const astVuln of astVulns) {
    const key = `${astVuln.type}:${astVuln.line}`
    if (!seenKeys.has(key)) {
      vulnerabilities.push(astVuln)
      seenKeys.add(key)
    }
  }

  // Calculate security score
  const score = calculateSecurityScore(vulnerabilities)

  // Determine if passed (no critical/high vulnerabilities)
  const hasCritical = vulnerabilities.some(v => v.severity === 'critical')
  const hasHigh = vulnerabilities.some(v => v.severity === 'high')
  const passed = !hasCritical && !hasHigh

  return {
    passed,
    vulnerabilities,
    score
  }
}

/**
 * Calculate security score (0-100)
 */
function calculateSecurityScore(vulnerabilities: SecurityVulnerability[]): number {
  if (vulnerabilities.length === 0) {
    return 100
  }

  let deductions = 0

  for (const vuln of vulnerabilities) {
    switch (vuln.severity) {
      case 'critical':
        deductions += 30
        break
      case 'high':
        deductions += 20
        break
      case 'medium':
        deductions += 10
        break
      case 'low':
        deductions += 5
        break
    }
  }

  return Math.max(0, 100 - deductions)
}

/**
 * Get human-readable summary of vulnerabilities
 */
export function getVulnerabilitySummary(result: SecurityScanResult): string {
  if (result.vulnerabilities.length === 0) {
    return 'No security vulnerabilities detected'
  }

  const bySeverity = {
    critical: result.vulnerabilities.filter(v => v.severity === 'critical').length,
    high: result.vulnerabilities.filter(v => v.severity === 'high').length,
    medium: result.vulnerabilities.filter(v => v.severity === 'medium').length,
    low: result.vulnerabilities.filter(v => v.severity === 'low').length
  }

  const parts: string[] = []

  if (bySeverity.critical > 0) parts.push(`${bySeverity.critical} critical`)
  if (bySeverity.high > 0) parts.push(`${bySeverity.high} high`)
  if (bySeverity.medium > 0) parts.push(`${bySeverity.medium} medium`)
  if (bySeverity.low > 0) parts.push(`${bySeverity.low} low`)

  return `Security issues: ${parts.join(', ')} (score: ${result.score}/100)`
}
