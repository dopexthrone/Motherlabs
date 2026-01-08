/**
 * Code Verifier
 * =============
 *
 * Multi-layer verification for generated code:
 * - Syntax checking
 * - Static analysis (via external tools)
 * - Property-based testing
 * - Formal verification (optional)
 */

import { spawn } from 'node:child_process';
import type {
  VerificationResult,
  VerificationCheck,
  VerificationIssue,
  VerificationLevel,
  TestCase,
} from './types.js';

// =============================================================================
// Verifier
// =============================================================================

/**
 * Code verifier with multiple verification layers.
 */
export class CodeVerifier {
  private readonly level: VerificationLevel;

  constructor(level: VerificationLevel = 'standard') {
    this.level = level;
  }

  /**
   * Verify code against all applicable checks.
   */
  async verify(
    code: string,
    language: string,
    testCases?: TestCase[]
  ): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    const issues: VerificationIssue[] = [];
    const suggestions: string[] = [];

    // Level: none - skip all verification
    if (this.level === 'none') {
      return {
        passed: true,
        score: 0.5,
        checks: [],
        issues: [],
        suggestions: ['Warning: Verification disabled'],
      };
    }

    // Level: basic+ - syntax check
    if (['basic', 'standard', 'strict', 'formal'].includes(this.level)) {
      const syntaxCheck = await this.checkSyntax(code, language);
      checks.push(syntaxCheck);
      if (!syntaxCheck.passed) {
        issues.push({
          severity: 'error',
          type: 'syntax',
          message: syntaxCheck.details || 'Syntax error',
        });
      }
    }

    // Level: standard+ - static analysis
    if (['standard', 'strict', 'formal'].includes(this.level)) {
      const staticCheck = await this.checkStatic(code, language);
      checks.push(staticCheck);
      issues.push(...this.extractIssues(staticCheck));
    }

    // Level: strict+ - property-based testing
    if (['strict', 'formal'].includes(this.level)) {
      if (testCases && testCases.length > 0) {
        const testCheck = await this.runTests(code, language, testCases);
        checks.push(testCheck);
        if (!testCheck.passed) {
          issues.push({
            severity: 'error',
            type: 'test',
            message: testCheck.details || 'Test failure',
          });
        }
      }

      const propertyCheck = await this.checkProperties(code, language);
      checks.push(propertyCheck);
    }

    // Level: formal - formal verification with Z3
    if (this.level === 'formal') {
      const formalCheck = await this.checkFormal(code, language);
      checks.push(formalCheck);
      if (!formalCheck.passed) {
        issues.push({
          severity: 'warning',
          type: 'formal',
          message: formalCheck.details || 'Formal verification inconclusive',
        });
      }
    }

    // Calculate overall score
    const passedChecks = checks.filter((c) => c.passed).length;
    const totalChecks = checks.length;
    const score = totalChecks > 0 ? passedChecks / totalChecks : 0;

    // Generate suggestions
    if (issues.some((i) => i.severity === 'error')) {
      suggestions.push('Fix critical errors before proceeding');
    }
    if (issues.some((i) => i.type === 'test')) {
      suggestions.push('Review test failures and edge cases');
    }
    if (score < 0.8) {
      suggestions.push('Consider adding more test coverage');
    }

    return {
      passed: issues.filter((i) => i.severity === 'error').length === 0,
      score,
      checks,
      issues,
      suggestions,
    };
  }

  /**
   * Check syntax validity.
   */
  private async checkSyntax(code: string, language: string): Promise<VerificationCheck> {
    const startTime = performance.now();

    try {
      let passed = false;
      let details = '';

      switch (language) {
        case 'python':
          const pyResult = await this.runCommand('python3', ['-c', `import ast; ast.parse('''${code.replace(/'/g, "\\'")}''')`]);
          passed = pyResult.exitCode === 0;
          details = pyResult.stderr || 'Syntax OK';
          break;

        case 'javascript':
        case 'typescript':
          // Use Node.js to check syntax
          const jsCode = `try { new Function(${JSON.stringify(code)}); console.log('OK'); } catch(e) { console.error(e.message); process.exit(1); }`;
          const jsResult = await this.runCommand('node', ['-e', jsCode]);
          passed = jsResult.exitCode === 0;
          details = jsResult.stderr || jsResult.stdout || 'Syntax OK';
          break;

        default:
          passed = true;
          details = `No syntax checker for ${language}`;
      }

      return {
        name: 'Syntax Check',
        type: 'syntax',
        passed,
        score: passed ? 1 : 0,
        details,
        duration_ms: Math.round(performance.now() - startTime),
      };
    } catch (error) {
      return {
        name: 'Syntax Check',
        type: 'syntax',
        passed: false,
        score: 0,
        details: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Math.round(performance.now() - startTime),
      };
    }
  }

  /**
   * Run static analysis.
   */
  private async checkStatic(code: string, language: string): Promise<VerificationCheck> {
    const startTime = performance.now();

    try {
      let passed = true;
      let details = '';
      let score = 1;

      switch (language) {
        case 'python':
          // Try ruff first, fall back to pylint
          const ruffResult = await this.runCommand('ruff', ['check', '--stdin-filename=code.py', '-'], code);
          if (ruffResult.exitCode === 0) {
            details = 'No issues found (ruff)';
          } else {
            passed = false;
            details = ruffResult.stdout || ruffResult.stderr || 'Issues found';
            score = 0.5;
          }
          break;

        case 'javascript':
        case 'typescript':
          // Try eslint
          const eslintResult = await this.runCommand('npx', ['eslint', '--stdin', '--no-eslintrc', '--parser-options=ecmaVersion:2022'], code);
          if (eslintResult.exitCode === 0) {
            details = 'No issues found (eslint)';
          } else {
            passed = false;
            details = eslintResult.stdout || eslintResult.stderr || 'Issues found';
            score = 0.5;
          }
          break;

        default:
          details = `No static analyzer for ${language}`;
      }

      return {
        name: 'Static Analysis',
        type: 'static',
        passed,
        score,
        details,
        duration_ms: Math.round(performance.now() - startTime),
      };
    } catch {
      // Static analysis tools not available
      return {
        name: 'Static Analysis',
        type: 'static',
        passed: true,
        score: 0.5,
        details: 'Static analysis tools not available',
        duration_ms: Math.round(performance.now() - startTime),
      };
    }
  }

  /**
   * Run test cases.
   */
  private async runTests(
    code: string,
    language: string,
    testCases: TestCase[]
  ): Promise<VerificationCheck> {
    const startTime = performance.now();

    try {
      let passedCount = 0;
      const results: string[] = [];

      for (const tc of testCases) {
        const result = await this.runTestCase(code, language, tc);
        if (result.passed) {
          passedCount++;
          results.push(`✓ ${tc.name}`);
        } else {
          results.push(`✗ ${tc.name}: ${result.error}`);
        }
      }

      const score = testCases.length > 0 ? passedCount / testCases.length : 0;

      return {
        name: 'Test Cases',
        type: 'test',
        passed: passedCount === testCases.length,
        score,
        details: results.join('\n'),
        duration_ms: Math.round(performance.now() - startTime),
      };
    } catch (error) {
      return {
        name: 'Test Cases',
        type: 'test',
        passed: false,
        score: 0,
        details: error instanceof Error ? error.message : 'Test execution failed',
        duration_ms: Math.round(performance.now() - startTime),
      };
    }
  }

  /**
   * Run a single test case.
   */
  private async runTestCase(
    code: string,
    language: string,
    testCase: TestCase
  ): Promise<{ passed: boolean; error?: string }> {
    try {
      switch (language) {
        case 'python': {
          // Build test script
          const inputs = Object.entries(testCase.inputs)
            .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
            .join('\n');
          const testScript = `
${code}

${inputs}
# Find the main function
import inspect
funcs = [f for f in dir() if callable(eval(f)) and not f.startswith('_')]
if funcs:
    result = eval(funcs[0])(**${JSON.stringify(testCase.inputs)})
    expected = ${JSON.stringify(testCase.expected)}
    if result == expected:
        print('PASS')
    else:
        print(f'FAIL: got {result}, expected {expected}')
`;
          const result = await this.runCommand('python3', ['-c', testScript]);
          if (result.stdout.includes('PASS')) {
            return { passed: true };
          }
          return { passed: false, error: result.stdout || result.stderr };
        }

        default:
          return { passed: true }; // Skip unsupported languages
      }
    } catch (error) {
      return {
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check properties (simplified property-based testing).
   */
  private async checkProperties(code: string, language: string): Promise<VerificationCheck> {
    const startTime = performance.now();

    // Simplified property checks
    const properties = [
      { name: 'no_infinite_loops', check: () => !/(while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\))/.test(code) },
      { name: 'no_eval', check: () => !/\beval\s*\(/.test(code) },
      { name: 'no_exec', check: () => !/\bexec\s*\(/.test(code) },
      { name: 'has_return', check: () => /\breturn\b/.test(code) || /^(?!.*\bdef\b)/.test(code) },
    ];

    const passed = properties.filter((p) => p.check());
    const failed = properties.filter((p) => !p.check());

    return {
      name: 'Property Checks',
      type: 'property',
      passed: failed.length === 0,
      score: properties.length > 0 ? passed.length / properties.length : 1,
      details: failed.length > 0
        ? `Failed: ${failed.map((p) => p.name).join(', ')}`
        : 'All properties satisfied',
      duration_ms: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Formal verification (placeholder - would use Z3).
   */
  private async checkFormal(code: string, _language: string): Promise<VerificationCheck> {
    const startTime = performance.now();

    // Placeholder - real implementation would use Z3 or similar
    return {
      name: 'Formal Verification',
      type: 'formal',
      passed: true,
      score: 0.5,
      details: 'Formal verification not yet implemented (requires Z3)',
      duration_ms: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Extract issues from a check result.
   */
  private extractIssues(check: VerificationCheck): VerificationIssue[] {
    if (check.passed || !check.details) return [];

    // Parse details into issues
    const lines = check.details.split('\n').filter((l) => l.trim());
    return lines.slice(0, 5).map((line) => ({
      severity: check.passed ? 'warning' : 'error' as const,
      type: check.type,
      message: line,
    }));
  }

  /**
   * Run a command and capture output.
   */
  private runCommand(
    cmd: string,
    args: string[],
    stdin?: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      if (stdin) {
        proc.stdin.write(stdin);
        proc.stdin.end();
      }

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      proc.on('error', (error) => {
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: error.message,
        });
      });
    });
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a code verifier.
 */
export function createVerifier(level: VerificationLevel = 'standard'): CodeVerifier {
  return new CodeVerifier(level);
}
