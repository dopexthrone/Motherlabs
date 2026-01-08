/**
 * Security Scanning
 * =================
 *
 * Scan generated code for security vulnerabilities.
 * Uses external scanners (Bandit for Python, ESLint security plugins for JS/TS).
 */

import { spawn } from 'node:child_process';

// =============================================================================
// Types
// =============================================================================

/**
 * Vulnerability severity levels.
 */
export type VulnerabilitySeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * A security vulnerability.
 */
export interface Vulnerability {
  /**
   * Vulnerability ID/code.
   */
  id: string;

  /**
   * Severity level.
   */
  severity: VulnerabilitySeverity;

  /**
   * Line number.
   */
  line: number;

  /**
   * Column number.
   */
  column?: number;

  /**
   * Vulnerability description.
   */
  message: string;

  /**
   * CWE ID if applicable.
   */
  cwe?: string;

  /**
   * Confidence level (low/medium/high).
   */
  confidence?: string;

  /**
   * Code snippet.
   */
  code_snippet?: string;
}

/**
 * Security scan result.
 */
export interface SecurityResult {
  /**
   * Whether the scan passed (no critical/high vulnerabilities).
   */
  passed: boolean;

  /**
   * Overall severity.
   */
  severity: VulnerabilitySeverity;

  /**
   * Found vulnerabilities.
   */
  vulnerabilities: Vulnerability[];

  /**
   * Counts by severity.
   */
  counts: Record<VulnerabilitySeverity, number>;

  /**
   * Scanner used.
   */
  scanner?: string;

  /**
   * Scan duration in ms.
   */
  duration_ms: number;
}

/**
 * Scan options.
 */
export interface ScanOptions {
  /**
   * Severity threshold - fail if vulnerabilities at or above this level.
   */
  failThreshold?: VulnerabilitySeverity;

  /**
   * Timeout in ms.
   */
  timeout?: number;

  /**
   * Skip certain vulnerability IDs.
   */
  skipIds?: string[];
}

// =============================================================================
// Severity Utilities
// =============================================================================

const SEVERITY_ORDER: VulnerabilitySeverity[] = ['none', 'low', 'medium', 'high', 'critical'];

/**
 * Compare severity levels.
 */
export function compareSeverity(a: VulnerabilitySeverity, b: VulnerabilitySeverity): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}

/**
 * Get the higher severity.
 */
export function maxSeverity(a: VulnerabilitySeverity, b: VulnerabilitySeverity): VulnerabilitySeverity {
  return compareSeverity(a, b) >= 0 ? a : b;
}

// =============================================================================
// Python Scanner (Bandit)
// =============================================================================

/**
 * Scan Python code using Bandit.
 */
export async function scanPython(code: string, options: ScanOptions = {}): Promise<SecurityResult> {
  const startTime = performance.now();
  const timeout = options.timeout ?? 30000;
  const failThreshold = options.failThreshold ?? 'high';
  const skipIds = new Set(options.skipIds ?? []);

  const vulnerabilities: Vulnerability[] = [];
  let scanner: string | undefined;

  try {
    // Write code to temp file and scan
    const { writeFile, unlink, mkdtemp } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const tempDir = await mkdtemp(join(tmpdir(), 'sec-scan-'));
    const tempFile = join(tempDir, 'code.py');

    await writeFile(tempFile, code);

    try {
      const result = await runCommand(
        'bandit',
        ['-f', 'json', '-q', tempFile],
        '',
        timeout
      );

      scanner = 'bandit';

      if (result.stdout) {
        try {
          const parsed = JSON.parse(result.stdout);
          if (Array.isArray(parsed.results)) {
            for (const r of parsed.results) {
              if (skipIds.has(r.test_id)) continue;

              const vuln: Vulnerability = {
                id: r.test_id,
                severity: mapBanditSeverity(r.issue_severity),
                line: r.line_number,
                message: r.issue_text,
              };
              if (r.col_offset) vuln.column = r.col_offset;
              if (r.issue_cwe?.id) vuln.cwe = `CWE-${r.issue_cwe.id}`;
              if (r.issue_confidence) vuln.confidence = r.issue_confidence.toLowerCase();
              if (r.code) vuln.code_snippet = r.code;
              vulnerabilities.push(vuln);
            }
          }
        } catch {
          // Invalid JSON
        }
      }
    } finally {
      // Cleanup temp file
      await unlink(tempFile).catch(() => {});
      const { rmdir } = await import('node:fs/promises');
      await rmdir(tempDir).catch(() => {});
    }
  } catch {
    // Bandit not available - try basic pattern matching
    scanner = 'builtin';
    const builtinVulns = scanPythonBuiltin(code);
    vulnerabilities.push(...builtinVulns.filter((v) => !skipIds.has(v.id)));
  }

  return buildResult(vulnerabilities, scanner, failThreshold, startTime);
}

/**
 * Map Bandit severity to our severity.
 */
function mapBanditSeverity(severity: string): VulnerabilitySeverity {
  switch (severity?.toUpperCase()) {
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    default:
      return 'none';
  }
}

/**
 * Built-in Python security patterns (fallback).
 */
function scanPythonBuiltin(code: string): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];
  const lines = code.split('\n');

  const patterns: Array<{
    pattern: RegExp;
    id: string;
    severity: VulnerabilitySeverity;
    message: string;
    cwe?: string;
  }> = [
    {
      pattern: /eval\s*\(/,
      id: 'B307',
      severity: 'high',
      message: 'Use of eval() detected - possible code injection',
      cwe: 'CWE-95',
    },
    {
      pattern: /exec\s*\(/,
      id: 'B102',
      severity: 'high',
      message: 'Use of exec() detected - possible code injection',
      cwe: 'CWE-95',
    },
    {
      pattern: /subprocess\.\w+.*shell\s*=\s*True/,
      id: 'B602',
      severity: 'high',
      message: 'Shell=True in subprocess - possible command injection',
      cwe: 'CWE-78',
    },
    {
      pattern: /os\.system\s*\(/,
      id: 'B605',
      severity: 'high',
      message: 'os.system() detected - possible command injection',
      cwe: 'CWE-78',
    },
    {
      pattern: /pickle\.load/,
      id: 'B301',
      severity: 'medium',
      message: 'pickle.load() detected - possible arbitrary code execution',
      cwe: 'CWE-502',
    },
    {
      pattern: /yaml\.load\s*\([^)]*Loader\s*=\s*yaml\.(?:Unsafe)?Loader/i,
      id: 'B506',
      severity: 'medium',
      message: 'Unsafe YAML loader - use yaml.safe_load() instead',
      cwe: 'CWE-502',
    },
    {
      pattern: /password\s*=\s*["'][^"']+["']/i,
      id: 'B105',
      severity: 'medium',
      message: 'Hardcoded password detected',
      cwe: 'CWE-259',
    },
    {
      pattern: /secret\s*=\s*["'][^"']+["']/i,
      id: 'B105',
      severity: 'medium',
      message: 'Hardcoded secret detected',
      cwe: 'CWE-259',
    },
    {
      pattern: /api_key\s*=\s*["'][^"']+["']/i,
      id: 'B105',
      severity: 'medium',
      message: 'Hardcoded API key detected',
      cwe: 'CWE-259',
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    for (const { pattern, id, severity, message, cwe } of patterns) {
      if (pattern.test(line)) {
        const vuln: Vulnerability = {
          id,
          severity,
          line: i + 1,
          message,
          code_snippet: line.trim(),
        };
        if (cwe) vuln.cwe = cwe;
        vulnerabilities.push(vuln);
      }
    }
  }

  return vulnerabilities;
}

// =============================================================================
// TypeScript/JavaScript Scanner
// =============================================================================

/**
 * Scan TypeScript/JavaScript code for security issues.
 */
export async function scanTypeScript(code: string, options: ScanOptions = {}): Promise<SecurityResult> {
  const startTime = performance.now();
  const failThreshold = options.failThreshold ?? 'high';
  const skipIds = new Set(options.skipIds ?? []);

  // Use built-in patterns (ESLint security plugin requires project setup)
  const vulnerabilities = scanJavaScriptBuiltin(code).filter((v) => !skipIds.has(v.id));

  return buildResult(vulnerabilities, 'builtin', failThreshold, startTime);
}

/**
 * Built-in JavaScript/TypeScript security patterns.
 */
function scanJavaScriptBuiltin(code: string): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];
  const lines = code.split('\n');

  const patterns: Array<{
    pattern: RegExp;
    id: string;
    severity: VulnerabilitySeverity;
    message: string;
    cwe?: string;
  }> = [
    {
      pattern: /eval\s*\(/,
      id: 'no-eval',
      severity: 'high',
      message: 'Use of eval() detected - possible code injection',
      cwe: 'CWE-95',
    },
    {
      pattern: /new\s+Function\s*\(/,
      id: 'no-new-func',
      severity: 'high',
      message: 'new Function() is similar to eval()',
      cwe: 'CWE-95',
    },
    {
      pattern: /innerHTML\s*=/,
      id: 'no-inner-html',
      severity: 'medium',
      message: 'innerHTML assignment - possible XSS',
      cwe: 'CWE-79',
    },
    {
      pattern: /document\.write\s*\(/,
      id: 'no-document-write',
      severity: 'medium',
      message: 'document.write() detected - possible XSS',
      cwe: 'CWE-79',
    },
    {
      pattern: /child_process\.exec\s*\(/,
      id: 'no-exec',
      severity: 'high',
      message: 'child_process.exec() - possible command injection',
      cwe: 'CWE-78',
    },
    {
      pattern: /password\s*[=:]\s*["'][^"']+["']/i,
      id: 'no-hardcoded-credentials',
      severity: 'medium',
      message: 'Hardcoded password detected',
      cwe: 'CWE-259',
    },
    {
      pattern: /secret\s*[=:]\s*["'][^"']+["']/i,
      id: 'no-hardcoded-credentials',
      severity: 'medium',
      message: 'Hardcoded secret detected',
      cwe: 'CWE-259',
    },
    {
      pattern: /api[_-]?key\s*[=:]\s*["'][^"']+["']/i,
      id: 'no-hardcoded-credentials',
      severity: 'medium',
      message: 'Hardcoded API key detected',
      cwe: 'CWE-259',
    },
    {
      pattern: /Math\.random\s*\(\)/,
      id: 'no-math-random',
      severity: 'low',
      message: 'Math.random() is not cryptographically secure',
      cwe: 'CWE-338',
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    for (const { pattern, id, severity, message, cwe } of patterns) {
      if (pattern.test(line)) {
        const vuln: Vulnerability = {
          id,
          severity,
          line: i + 1,
          message,
          code_snippet: line.trim(),
        };
        if (cwe) vuln.cwe = cwe;
        vulnerabilities.push(vuln);
      }
    }
  }

  return vulnerabilities;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Scan code for security vulnerabilities.
 */
export async function scanCode(
  code: string,
  language: 'python' | 'typescript' | 'javascript',
  options: ScanOptions = {}
): Promise<SecurityResult> {
  switch (language) {
    case 'python':
      return scanPython(code, options);
    case 'typescript':
    case 'javascript':
      return scanTypeScript(code, options);
    default:
      return {
        passed: true,
        severity: 'none',
        vulnerabilities: [],
        counts: { none: 0, low: 0, medium: 0, high: 0, critical: 0 },
        duration_ms: 0,
      };
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Build security result from vulnerabilities.
 */
function buildResult(
  vulnerabilities: Vulnerability[],
  scanner: string | undefined,
  failThreshold: VulnerabilitySeverity,
  startTime: number
): SecurityResult {
  const counts: Record<VulnerabilitySeverity, number> = {
    none: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  let maxSev: VulnerabilitySeverity = 'none';
  for (const v of vulnerabilities) {
    counts[v.severity]++;
    maxSev = maxSeverity(maxSev, v.severity);
  }

  const passed = compareSeverity(maxSev, failThreshold) < 0;

  const result: SecurityResult = {
    passed,
    severity: maxSev,
    vulnerabilities,
    counts,
    duration_ms: Math.round(performance.now() - startTime),
  };
  if (scanner) result.scanner = scanner;

  return result;
}

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

    if (stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}
