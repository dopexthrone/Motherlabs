/**
 * Code Style Enforcement
 * ======================
 *
 * Format and lint generated code for consistency.
 * Uses external formatters via child_process.
 */

import { spawn } from 'node:child_process';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported languages for formatting.
 */
export type FormattableLanguage = 'python' | 'typescript' | 'javascript' | 'json';

/**
 * Style check result.
 */
export interface StyleResult {
  /**
   * Whether the code passes style checks.
   */
  passed: boolean;

  /**
   * Original code.
   */
  original: string;

  /**
   * Formatted code (if formatting succeeded).
   */
  formatted?: string;

  /**
   * Whether code was modified.
   */
  modified: boolean;

  /**
   * Style issues found.
   */
  issues: StyleIssue[];

  /**
   * Processing time in ms.
   */
  duration_ms: number;
}

/**
 * A style issue.
 */
export interface StyleIssue {
  /**
   * Line number (1-indexed).
   */
  line: number;

  /**
   * Column number (1-indexed).
   */
  column?: number;

  /**
   * Issue severity.
   */
  severity: 'error' | 'warning' | 'info';

  /**
   * Issue message.
   */
  message: string;

  /**
   * Rule that triggered the issue.
   */
  rule?: string;
}

/**
 * Format options.
 */
export interface FormatOptions {
  /**
   * Line width.
   */
  lineWidth?: number;

  /**
   * Use tabs instead of spaces.
   */
  useTabs?: boolean;

  /**
   * Tab width.
   */
  tabWidth?: number;

  /**
   * Timeout in ms.
   */
  timeout?: number;
}

// =============================================================================
// Formatters
// =============================================================================

/**
 * Format Python code using black (if available) or basic formatting.
 */
export async function formatPython(
  code: string,
  options: FormatOptions = {}
): Promise<StyleResult> {
  const startTime = performance.now();
  const lineWidth = options.lineWidth ?? 88;
  const timeout = options.timeout ?? 10000;

  try {
    // Try black first
    const result = await runCommand(
      'black',
      ['--line-length', String(lineWidth), '--quiet', '-'],
      code,
      timeout
    );

    if (result.exitCode === 0) {
      const formatted = result.stdout.trim();
      return {
        passed: true,
        original: code,
        formatted,
        modified: formatted !== code.trim(),
        issues: [],
        duration_ms: Math.round(performance.now() - startTime),
      };
    }
  } catch {
    // black not available
  }

  // Fallback: basic Python formatting with autopep8
  try {
    const result = await runCommand(
      'autopep8',
      ['--max-line-length', String(lineWidth), '-'],
      code,
      timeout
    );

    if (result.exitCode === 0) {
      const formatted = result.stdout.trim();
      return {
        passed: true,
        original: code,
        formatted,
        modified: formatted !== code.trim(),
        issues: [],
        duration_ms: Math.round(performance.now() - startTime),
      };
    }
  } catch {
    // autopep8 not available
  }

  // No formatter available - return original
  return {
    passed: true,
    original: code,
    formatted: code,
    modified: false,
    issues: [{ line: 0, severity: 'warning', message: 'No Python formatter available (install black or autopep8)' }],
    duration_ms: Math.round(performance.now() - startTime),
  };
}

/**
 * Format TypeScript/JavaScript code using prettier (if available).
 */
export async function formatTypeScript(
  code: string,
  options: FormatOptions = {}
): Promise<StyleResult> {
  const startTime = performance.now();
  const lineWidth = options.lineWidth ?? 100;
  const tabWidth = options.tabWidth ?? 2;
  const useTabs = options.useTabs ?? false;
  const timeout = options.timeout ?? 10000;

  try {
    const result = await runCommand(
      'npx',
      [
        'prettier',
        '--stdin-filepath', 'file.ts',
        '--print-width', String(lineWidth),
        '--tab-width', String(tabWidth),
        useTabs ? '--use-tabs' : '--no-use-tabs',
      ],
      code,
      timeout
    );

    if (result.exitCode === 0) {
      const formatted = result.stdout.trim();
      return {
        passed: true,
        original: code,
        formatted,
        modified: formatted !== code.trim(),
        issues: [],
        duration_ms: Math.round(performance.now() - startTime),
      };
    }
  } catch {
    // prettier not available
  }

  // No formatter available
  return {
    passed: true,
    original: code,
    formatted: code,
    modified: false,
    issues: [{ line: 0, severity: 'warning', message: 'No TypeScript formatter available (install prettier)' }],
    duration_ms: Math.round(performance.now() - startTime),
  };
}

/**
 * Format JSON.
 */
export function formatJSON(code: string, options: FormatOptions = {}): StyleResult {
  const startTime = performance.now();
  const tabWidth = options.tabWidth ?? 2;

  try {
    const parsed = JSON.parse(code);
    const formatted = JSON.stringify(parsed, null, tabWidth);

    return {
      passed: true,
      original: code,
      formatted,
      modified: formatted !== code,
      issues: [],
      duration_ms: Math.round(performance.now() - startTime),
    };
  } catch (error) {
    return {
      passed: false,
      original: code,
      modified: false,
      issues: [{
        line: 1,
        severity: 'error',
        message: error instanceof Error ? error.message : 'Invalid JSON',
      }],
      duration_ms: Math.round(performance.now() - startTime),
    };
  }
}

// =============================================================================
// Linters
// =============================================================================

/**
 * Lint Python code using flake8 or pylint.
 */
export async function lintPython(code: string, timeout: number = 10000): Promise<StyleIssue[]> {
  const issues: StyleIssue[] = [];

  try {
    // Try flake8
    const result = await runCommand('flake8', ['--stdin-display-name=code.py', '-'], code, timeout);

    if (result.stdout) {
      const lines = result.stdout.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const match = line.match(/code\.py:(\d+):(\d+): (\w+) (.+)/);
        if (match && match[1] && match[2] && match[3] && match[4]) {
          issues.push({
            line: parseInt(match[1], 10),
            column: parseInt(match[2], 10),
            severity: match[3].startsWith('E') ? 'error' : 'warning',
            message: match[4],
            rule: match[3],
          });
        }
      }
    }
  } catch {
    // flake8 not available
  }

  return issues;
}

/**
 * Lint TypeScript code using ESLint.
 */
export async function lintTypeScript(code: string, timeout: number = 10000): Promise<StyleIssue[]> {
  const issues: StyleIssue[] = [];

  try {
    const result = await runCommand(
      'npx',
      ['eslint', '--stdin', '--stdin-filename=file.ts', '--format=json'],
      code,
      timeout
    );

    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout);
        if (Array.isArray(parsed) && parsed[0]?.messages) {
          for (const msg of parsed[0].messages) {
            issues.push({
              line: msg.line ?? 1,
              column: msg.column,
              severity: msg.severity === 2 ? 'error' : 'warning',
              message: msg.message,
              rule: msg.ruleId,
            });
          }
        }
      } catch {
        // Invalid JSON output
      }
    }
  } catch {
    // eslint not available
  }

  return issues;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Format code based on language.
 */
export async function formatCode(
  code: string,
  language: FormattableLanguage,
  options: FormatOptions = {}
): Promise<StyleResult> {
  switch (language) {
    case 'python':
      return formatPython(code, options);
    case 'typescript':
    case 'javascript':
      return formatTypeScript(code, options);
    case 'json':
      return formatJSON(code, options);
    default:
      return {
        passed: true,
        original: code,
        formatted: code,
        modified: false,
        issues: [{ line: 0, severity: 'info', message: `No formatter for language: ${language}` }],
        duration_ms: 0,
      };
  }
}

/**
 * Check code style (format + lint).
 */
export async function checkStyle(
  code: string,
  language: FormattableLanguage,
  options: FormatOptions = {}
): Promise<StyleResult> {
  // First format
  const formatResult = await formatCode(code, language, options);

  // Then lint
  let lintIssues: StyleIssue[] = [];
  if (language === 'python') {
    lintIssues = await lintPython(formatResult.formatted ?? code);
  } else if (language === 'typescript' || language === 'javascript') {
    lintIssues = await lintTypeScript(formatResult.formatted ?? code);
  }

  // Combine results
  const allIssues = [...formatResult.issues, ...lintIssues];
  const hasErrors = allIssues.some((i) => i.severity === 'error');

  return {
    ...formatResult,
    passed: formatResult.passed && !hasErrors,
    issues: allIssues,
  };
}

// =============================================================================
// Utilities
// =============================================================================

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCommand(
  cmd: string,
  args: string[],
  stdin: string,
  timeout: number
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (error) => {
      reject(error);
    });

    // Write stdin and close
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}
