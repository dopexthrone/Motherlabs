// Determinism Audit - Build-time enforcement of deterministic patterns
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 3 (Determinism), AXIOM 6 (Reproducibility)
//
// AXIOM: Non-deterministic functions destroy reproducibility
// AXIOM: Time and randomness must flow through controlled providers

import * as fs from 'fs'
import * as path from 'path'
import { Result, Ok, Err } from '../core/result'

export type DeterminismViolation = {
  filepath: string
  line: number
  column: number
  pattern: string
  message: string
  severity: 'error' | 'warning'
  exemptionMarker?: string
}

export type AuditResult = {
  pass: boolean
  violations: DeterminismViolation[]
  filesScanned: number
  totalLines: number
}

/**
 * Patterns that introduce non-determinism
 * Each pattern includes exemption marker for legitimate uses
 */
const FORBIDDEN_PATTERNS: Array<{
  pattern: RegExp
  message: string
  severity: 'error' | 'warning'
  exemptionMarker: string
}> = [
  {
    pattern: /\bDate\.now\(\)/g,
    message: 'Date.now() introduces time-dependency. Use TimeProvider or globalTimeProvider.',
    severity: 'error',
    exemptionMarker: 'DETERMINISM-EXEMPT:TIME'
  },
  {
    pattern: /\bnew Date\(\)/g,
    message: 'new Date() introduces time-dependency. Use TimeProvider or globalTimeProvider.',
    severity: 'error',
    exemptionMarker: 'DETERMINISM-EXEMPT:TIME'
  },
  {
    pattern: /\bMath\.random\(\)/g,
    message: 'Math.random() introduces randomness. Use seeded RNG or deterministic alternative.',
    severity: 'error',
    exemptionMarker: 'DETERMINISM-EXEMPT:RANDOM'
  },
  {
    pattern: /\bcrypto\.randomBytes\(/g,
    message: 'crypto.randomBytes() introduces randomness. Use deterministic seed if needed for tests.',
    severity: 'error',
    exemptionMarker: 'DETERMINISM-EXEMPT:CRYPTO'
  },
  {
    pattern: /\bcrypto\.randomUUID\(/g,
    message: 'crypto.randomUUID() introduces randomness. Use contentAddress() for deterministic IDs.',
    severity: 'error',
    exemptionMarker: 'DETERMINISM-EXEMPT:UUID'
  },
  {
    pattern: /\bsetTimeout\s*\(/g,
    message: 'setTimeout introduces timing non-determinism. Consider synchronous alternatives for tests.',
    severity: 'warning',
    exemptionMarker: 'DETERMINISM-EXEMPT:ASYNC'
  },
  {
    pattern: /\bsetInterval\s*\(/g,
    message: 'setInterval introduces timing non-determinism. Consider event-driven alternatives.',
    severity: 'warning',
    exemptionMarker: 'DETERMINISM-EXEMPT:ASYNC'
  },
  {
    pattern: /\bprocess\.hrtime\(/g,
    message: 'process.hrtime() introduces time-dependency. Use TimeProvider for measurements.',
    severity: 'warning',
    exemptionMarker: 'DETERMINISM-EXEMPT:TIME'
  },
  {
    pattern: /\bperformance\.now\(\)/g,
    message: 'performance.now() introduces time-dependency. Use TimeProvider.',
    severity: 'warning',
    exemptionMarker: 'DETERMINISM-EXEMPT:TIME'
  }
]

/**
 * Files/directories exempt from determinism audit
 * These contain infrastructure that legitimately needs non-determinism
 */
const EXEMPT_PATHS = [
  'src/core/timeProvider.ts',      // TimeProvider itself uses Date.now
  'src/persistence/jsonlLedger.ts', // Ledger timestamps are metadata (segregated from hash)
  'tests/',                         // Tests may use timing for benchmarks
  'scripts/',                       // Build scripts may use timing
  'node_modules/',                  // External dependencies
  '.git/'                           // Git internals
]

/**
 * Check if a file path is exempt from audit
 */
function isExemptPath(filepath: string): boolean {
  const normalized = filepath.replace(/\\/g, '/')
  return EXEMPT_PATHS.some(exempt => normalized.includes(exempt))
}

/**
 * Check if a line has an exemption marker
 */
function hasExemption(line: string, previousLine: string | undefined, exemptionMarker: string): boolean {
  // Check current line for inline exemption
  if (line.includes(exemptionMarker) || line.includes('DETERMINISM-EXEMPT')) {
    return true
  }
  // Check previous line for comment-based exemption
  if (previousLine && (previousLine.includes(exemptionMarker) || previousLine.includes('DETERMINISM-EXEMPT'))) {
    return true
  }
  return false
}

/**
 * Audit a single file for determinism violations
 */
export function auditFile(filepath: string, content?: string): DeterminismViolation[] {
  if (isExemptPath(filepath)) {
    return []
  }

  const violations: DeterminismViolation[] = []
  const code = content ?? fs.readFileSync(filepath, 'utf-8')
  const lines = code.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const previousLine = i > 0 ? lines[i - 1] : undefined

    // Skip comment-only lines
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue
    }

    for (const { pattern, message, severity, exemptionMarker } of FORBIDDEN_PATTERNS) {
      // Reset regex state for global patterns
      pattern.lastIndex = 0

      let match
      while ((match = pattern.exec(line)) !== null) {
        // Check for exemption
        if (hasExemption(line, previousLine, exemptionMarker)) {
          continue
        }

        violations.push({
          filepath,
          line: i + 1,
          column: match.index + 1,
          pattern: match[0],
          message,
          severity,
          exemptionMarker
        })
      }
    }
  }

  return violations
}

/**
 * Audit a directory recursively for determinism violations
 */
export function auditDirectory(dirPath: string): AuditResult {
  const violations: DeterminismViolation[] = []
  let filesScanned = 0
  let totalLines = 0

  function scanDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!isExemptPath(fullPath)) {
          scanDir(fullPath)
        }
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        if (!isExemptPath(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8')
          totalLines += content.split('\n').length
          filesScanned++

          const fileViolations = auditFile(fullPath, content)
          violations.push(...fileViolations)
        }
      }
    }
  }

  scanDir(dirPath)

  const hasErrors = violations.some(v => v.severity === 'error')

  return {
    pass: !hasErrors,
    violations,
    filesScanned,
    totalLines
  }
}

/**
 * Format violations for console output
 */
export function formatViolations(result: AuditResult): string {
  const lines: string[] = []

  lines.push('=' .repeat(70))
  lines.push('DETERMINISM AUDIT REPORT')
  lines.push('=' .repeat(70))
  lines.push('')
  lines.push(`Files scanned: ${result.filesScanned}`)
  lines.push(`Total lines: ${result.totalLines}`)
  lines.push(`Violations: ${result.violations.length}`)
  lines.push('')

  if (result.violations.length === 0) {
    lines.push('No determinism violations found.')
  } else {
    const errors = result.violations.filter(v => v.severity === 'error')
    const warnings = result.violations.filter(v => v.severity === 'warning')

    if (errors.length > 0) {
      lines.push(`ERRORS (${errors.length}):`)
      lines.push('-'.repeat(70))
      for (const v of errors) {
        lines.push(`  ${v.filepath}:${v.line}:${v.column}`)
        lines.push(`    Pattern: ${v.pattern}`)
        lines.push(`    ${v.message}`)
        lines.push(`    Exempt with: ${v.exemptionMarker}`)
        lines.push('')
      }
    }

    if (warnings.length > 0) {
      lines.push(`WARNINGS (${warnings.length}):`)
      lines.push('-'.repeat(70))
      for (const v of warnings) {
        lines.push(`  ${v.filepath}:${v.line}:${v.column}`)
        lines.push(`    Pattern: ${v.pattern}`)
        lines.push(`    ${v.message}`)
        lines.push('')
      }
    }
  }

  lines.push('=' .repeat(70))
  lines.push(result.pass ? 'AUDIT PASSED' : 'AUDIT FAILED')
  lines.push('=' .repeat(70))

  return lines.join('\n')
}

/**
 * Run determinism audit and return Result
 */
export function runDeterminismAudit(srcPath: string): Result<AuditResult, Error> {
  try {
    if (!fs.existsSync(srcPath)) {
      return Err(new Error(`Path does not exist: ${srcPath}`))
    }

    const stat = fs.statSync(srcPath)
    if (stat.isFile()) {
      const violations = auditFile(srcPath)
      return Ok({
        pass: !violations.some(v => v.severity === 'error'),
        violations,
        filesScanned: 1,
        totalLines: fs.readFileSync(srcPath, 'utf-8').split('\n').length
      })
    } else {
      return Ok(auditDirectory(srcPath))
    }
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}
