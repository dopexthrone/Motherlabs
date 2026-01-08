/**
 * Code Repair / Auto Bug Fix
 * ==========================
 *
 * Automatically generate patches when code fails verification or evaluation.
 * Uses error messages and test failures to guide repair attempts.
 */

import type { ModelAdapter, TransformContext } from '../adapters/model.js';
import type { EvalReport } from '../eval/index.js';
import type { VerificationResult } from '../agent/types.js';
import { randomBytes } from 'node:crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * A code repair attempt.
 */
export interface RepairAttempt {
  /**
   * Original code.
   */
  original: string;

  /**
   * Repaired code (if successful).
   */
  repaired?: string;

  /**
   * Whether repair was successful.
   */
  success: boolean;

  /**
   * What was fixed.
   */
  fixes_applied: string[];

  /**
   * Number of attempts made.
   */
  attempts: number;

  /**
   * Error message if repair failed.
   */
  error?: string;

  /**
   * Time taken in ms.
   */
  duration_ms: number;
}

/**
 * Diagnosis of what's wrong with the code.
 */
export interface CodeDiagnosis {
  /**
   * Type of issue detected.
   */
  issue_type:
    | 'syntax_error'
    | 'runtime_error'
    | 'type_error'
    | 'logic_error'
    | 'test_failure'
    | 'undefined_reference'
    | 'import_error'
    | 'unknown';

  /**
   * Specific error message.
   */
  error_message: string;

  /**
   * Line number if available.
   */
  line?: number;

  /**
   * Confidence in diagnosis (0-1).
   */
  confidence: number;

  /**
   * Suggested fix approach.
   */
  suggested_approach: string;
}

/**
 * Context item for repair (similar code from RAG).
 */
export interface RepairContextItem {
  /**
   * Content (code snippet).
   */
  content: string;

  /**
   * Source file.
   */
  source?: string;

  /**
   * Relevance score.
   */
  relevance?: number;
}

/**
 * Options for repair.
 */
export interface RepairOptions {
  /**
   * Maximum repair attempts.
   */
  maxAttempts?: number;

  /**
   * Timeout per attempt in ms.
   */
  timeout?: number;

  /**
   * Language for syntax-aware repair.
   */
  language?: string;

  /**
   * Original prompt/task for context.
   */
  originalPrompt?: string;

  /**
   * Test cases that must pass.
   */
  testCases?: Array<{ name: string; inputs: Record<string, unknown>; expected: unknown }>;

  /**
   * Similar working code examples for context (from RAG).
   */
  contextExamples?: RepairContextItem[];
}

// =============================================================================
// Diagnosis
// =============================================================================

/**
 * Diagnose issues from verification result.
 */
export function diagnoseFromVerification(verification: VerificationResult): CodeDiagnosis[] {
  const diagnoses: CodeDiagnosis[] = [];

  if (!verification.passed) {
    // Check verification checks for syntax errors
    for (const check of verification.checks) {
      if (!check.passed) {
        if (check.type === 'syntax') {
          diagnoses.push({
            issue_type: 'syntax_error',
            error_message: check.details ?? 'Code has syntax errors',
            confidence: 0.95,
            suggested_approach: 'Fix syntax issues based on parser errors',
          });
        } else if (check.type === 'test') {
          diagnoses.push({
            issue_type: 'test_failure',
            error_message: check.details ?? 'Tests failed',
            confidence: 0.85,
            suggested_approach: 'Analyze failing tests and fix logic errors',
          });
        } else if (check.type === 'static') {
          diagnoses.push({
            issue_type: 'type_error',
            error_message: check.details ?? 'Static analysis failed',
            confidence: 0.9,
            suggested_approach: 'Fix type annotations or value assignments',
          });
        }
      }
    }

    // Check issues for more specific errors
    for (const issue of verification.issues) {
      if (issue.severity === 'error') {
        const issueType = categorizeError(issue.message);
        const diagnosis: CodeDiagnosis = {
          issue_type: issueType,
          error_message: issue.message,
          confidence: 0.8,
          suggested_approach: issue.fix ?? getSuggestedApproach(issueType),
        };
        if (issue.line) diagnosis.line = issue.line;
        diagnoses.push(diagnosis);
      }
    }
  }

  // If no specific diagnosis, add generic
  if (diagnoses.length === 0 && !verification.passed) {
    diagnoses.push({
      issue_type: 'unknown',
      error_message: verification.issues[0]?.message ?? 'Code failed verification',
      confidence: 0.5,
      suggested_approach: 'Review code for common issues',
    });
  }

  return diagnoses;
}

/**
 * Diagnose issues from eval report.
 */
export function diagnoseFromEval(evalReport: EvalReport): CodeDiagnosis[] {
  const diagnoses: CodeDiagnosis[] = [];

  if (!evalReport.passed) {
    // Check results from each evaluation method
    for (const evalResult of evalReport.results) {
      if (!evalResult.passed) {
        // Check individual tests within this eval result
        for (const test of evalResult.tests) {
          if (!test.passed) {
            const issueType = test.error ? categorizeError(test.error) : 'logic_error';
            const diagnosis: CodeDiagnosis = {
              issue_type: issueType,
              error_message: test.error ?? `Test ${test.name} failed`,
              confidence: 0.75,
              suggested_approach: getSuggestedApproach(issueType),
            };
            diagnoses.push(diagnosis);
          }
        }

        // If no specific test failures, add general eval failure
        if (evalResult.tests.length === 0) {
          diagnoses.push({
            issue_type: 'logic_error',
            error_message: evalResult.details || `${evalResult.method} evaluation failed`,
            confidence: 0.7,
            suggested_approach: 'Review algorithm logic and edge cases',
          });
        }
      }
    }
  }

  // Add generic if no diagnoses
  if (diagnoses.length === 0 && !evalReport.passed) {
    diagnoses.push({
      issue_type: 'unknown',
      error_message: evalReport.summary || 'Evaluation failed',
      confidence: 0.5,
      suggested_approach: 'Review code for common issues',
    });
  }

  return diagnoses;
}

/**
 * Categorize an error message into issue type.
 */
function categorizeError(error: string): CodeDiagnosis['issue_type'] {
  const lowerError = error.toLowerCase();

  if (lowerError.includes('syntaxerror') || lowerError.includes('syntax error')) {
    return 'syntax_error';
  }
  if (lowerError.includes('typeerror') || lowerError.includes('type error')) {
    return 'type_error';
  }
  if (
    lowerError.includes('referenceerror') ||
    lowerError.includes('is not defined') ||
    lowerError.includes('nameerror')
  ) {
    return 'undefined_reference';
  }
  if (lowerError.includes('importerror') || lowerError.includes('modulenotfounderror')) {
    return 'import_error';
  }
  if (
    lowerError.includes('assert') ||
    lowerError.includes('expected') ||
    lowerError.includes('does not match')
  ) {
    return 'test_failure';
  }
  if (
    lowerError.includes('runtimeerror') ||
    lowerError.includes('valueerror') ||
    lowerError.includes('indexerror')
  ) {
    return 'runtime_error';
  }

  return 'unknown';
}

/**
 * Get suggested repair approach for issue type.
 */
function getSuggestedApproach(issueType: CodeDiagnosis['issue_type']): string {
  switch (issueType) {
    case 'syntax_error':
      return 'Check brackets, quotes, colons, and indentation';
    case 'type_error':
      return 'Ensure types match expected interfaces and handle null/undefined';
    case 'undefined_reference':
      return 'Define missing variables or import required modules';
    case 'import_error':
      return 'Fix import paths or install missing dependencies';
    case 'test_failure':
      return 'Compare expected vs actual output and fix logic';
    case 'runtime_error':
      return 'Add boundary checks and handle edge cases';
    case 'logic_error':
      return 'Trace through algorithm and fix incorrect logic';
    default:
      return 'Review code carefully for issues';
  }
}

// =============================================================================
// Repair
// =============================================================================

/**
 * Code repair engine.
 */
export class CodeRepairer {
  private readonly adapter: ModelAdapter;

  constructor(adapter: ModelAdapter) {
    this.adapter = adapter;
  }

  /**
   * Attempt to repair code based on verification/eval failures.
   */
  async repair(
    code: string,
    diagnoses: CodeDiagnosis[],
    options: RepairOptions = {}
  ): Promise<RepairAttempt> {
    const startTime = performance.now();
    const maxAttempts = options.maxAttempts ?? 3;
    const language = options.language ?? 'python';

    let currentCode = code;
    const fixesApplied: string[] = [];
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Build repair prompt
        const prompt = this.buildRepairPrompt(currentCode, diagnoses, options, attempt);

        // Call model for repair
        const context: TransformContext = {
          intent_id: `repair_${randomBytes(4).toString('hex')}`,
          run_id: `repair_run_${attempt}`,
          mode: 'execute',
          constraints: ['Preserve original function signatures', 'Maintain backwards compatibility'],
          metadata: { language, repair_attempt: attempt },
        };

        const result = await this.adapter.transform(prompt, context);

        // Extract repaired code
        const repaired = this.extractCode(result.content, language);

        if (repaired && repaired !== currentCode) {
          // Track the fix
          const fixDescription = this.describeFix(currentCode, repaired, diagnoses);
          fixesApplied.push(fixDescription);
          currentCode = repaired;

          // Quick syntax check
          if (this.quickSyntaxCheck(repaired, language)) {
            return {
              original: code,
              repaired: currentCode,
              success: true,
              fixes_applied: fixesApplied,
              attempts: attempt,
              duration_ms: Math.round(performance.now() - startTime),
            };
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    // Return with whatever progress was made
    const result: RepairAttempt = {
      original: code,
      success: false,
      fixes_applied: fixesApplied,
      attempts: maxAttempts,
      duration_ms: Math.round(performance.now() - startTime),
    };

    if (currentCode !== code) {
      result.repaired = currentCode;
    }
    if (lastError) {
      result.error = lastError;
    }

    return result;
  }

  /**
   * Build the repair prompt.
   */
  private buildRepairPrompt(
    code: string,
    diagnoses: CodeDiagnosis[],
    options: RepairOptions,
    attempt: number
  ): string {
    const sections: string[] = [];
    const language = options.language ?? 'python';

    // System instruction
    sections.push(
      `You are an expert ${language} programmer specializing in debugging and fixing code. Your task is to repair the following code.`
    );

    // Original task context if available
    if (options.originalPrompt) {
      sections.push(`\n## Original Task\n${options.originalPrompt}`);
    }

    // The broken code
    sections.push(`\n## Code to Fix\n\`\`\`${language}\n${code}\n\`\`\``);

    // Diagnoses
    sections.push('\n## Issues Detected\n');
    for (let i = 0; i < diagnoses.length; i++) {
      const d = diagnoses[i];
      if (!d) continue;
      sections.push(`${i + 1}. **${d.issue_type}**: ${d.error_message}`);
      if (d.line) sections.push(`   Line: ${d.line}`);
      sections.push(`   Suggested fix: ${d.suggested_approach}`);
    }

    // Test cases if available
    if (options.testCases && options.testCases.length > 0) {
      sections.push('\n## Test Cases That Must Pass\n');
      for (const tc of options.testCases) {
        sections.push(`- ${tc.name}: ${JSON.stringify(tc.inputs)} → ${JSON.stringify(tc.expected)}`);
      }
    }

    // Similar working code examples (from RAG)
    if (options.contextExamples && options.contextExamples.length > 0) {
      sections.push('\n## Similar Working Code (for reference)\n');
      sections.push('These examples show similar patterns that work correctly:\n');
      for (let i = 0; i < Math.min(3, options.contextExamples.length); i++) {
        const ex = options.contextExamples[i];
        if (!ex) continue;
        if (ex.source) sections.push(`### From ${ex.source}`);
        sections.push(`\`\`\`${language}\n${ex.content.slice(0, 1500)}\n\`\`\`\n`);
      }
    }

    // Attempt hint
    if (attempt > 1) {
      sections.push(`\n(Attempt ${attempt} - previous fix did not fully resolve the issues)`);
    }

    // Output format
    sections.push(
      `\n## Output\nProvide the COMPLETE fixed ${language} code. Output ONLY the code in a code block, no explanations.`
    );

    return sections.join('\n');
  }

  /**
   * Extract code from LLM response.
   */
  private extractCode(response: string, language: string): string {
    const codeBlockRegex = new RegExp(`\`\`\`(?:${language})?\\s*\\n([\\s\\S]*?)\`\`\``, 'i');
    const match = response.match(codeBlockRegex);

    if (match && match[1]) {
      return match[1].trim();
    }

    const genericMatch = response.match(/```\s*\n([\s\S]*?)```/);
    if (genericMatch && genericMatch[1]) {
      return genericMatch[1].trim();
    }

    return response.trim();
  }

  /**
   * Quick syntax check.
   */
  private quickSyntaxCheck(code: string, language: string): boolean {
    if (language === 'python') {
      // Check for balanced brackets and quotes
      return this.checkBalanced(code);
    } else if (language === 'typescript' || language === 'javascript') {
      return this.checkBalanced(code);
    }
    return true;
  }

  /**
   * Check balanced brackets/braces/parens.
   */
  private checkBalanced(code: string): boolean {
    const stack: string[] = [];
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      if (!char) continue;

      // Handle string literals
      if ((char === '"' || char === "'" || char === '`') && (i === 0 || code[i - 1] !== '\\')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (inString) continue;

      if (char in pairs) {
        stack.push(pairs[char]!);
      } else if (char === ')' || char === ']' || char === '}') {
        if (stack.length === 0 || stack.pop() !== char) {
          return false;
        }
      }
    }

    return stack.length === 0;
  }

  /**
   * Describe what was fixed.
   */
  private describeFix(original: string, repaired: string, diagnoses: CodeDiagnosis[]): string {
    const originalLines = original.split('\n').length;
    const repairedLines = repaired.split('\n').length;
    const lineDiff = repairedLines - originalLines;

    const primaryIssue = diagnoses[0]?.issue_type ?? 'unknown';

    if (lineDiff > 0) {
      return `Added ${lineDiff} lines to fix ${primaryIssue}`;
    } else if (lineDiff < 0) {
      return `Removed ${Math.abs(lineDiff)} lines to fix ${primaryIssue}`;
    } else {
      return `Modified code to fix ${primaryIssue}`;
    }
  }
}

/**
 * Create a code repairer instance.
 */
export function createRepairer(adapter: ModelAdapter): CodeRepairer {
  return new CodeRepairer(adapter);
}

// =============================================================================
// Quick Repair (simplified API)
// =============================================================================

/**
 * Quick repair from verification failure.
 */
export async function quickRepairFromVerification(
  adapter: ModelAdapter,
  code: string,
  verification: VerificationResult,
  options: RepairOptions = {}
): Promise<RepairAttempt> {
  const diagnoses = diagnoseFromVerification(verification);
  const repairer = createRepairer(adapter);
  return repairer.repair(code, diagnoses, options);
}

/**
 * Quick repair from eval failure.
 */
export async function quickRepairFromEval(
  adapter: ModelAdapter,
  code: string,
  evalReport: EvalReport,
  options: RepairOptions = {}
): Promise<RepairAttempt> {
  const diagnoses = diagnoseFromEval(evalReport);
  const repairer = createRepairer(adapter);
  return repairer.repair(code, diagnoses, options);
}
