// Test Quality Analyzer - Gate 7
// Static analysis to measure test quality beyond "does it run"

import * as ts from 'typescript'
import { Result, Ok, Err } from '../core/result'

// ============================================================================
// TYPES
// ============================================================================

export type AssertionMetrics = {
  total: number
  trivial: number
  meaningful: number
  perTest: number
}

export type MockMetrics = {
  mockClasses: string[]
  mockFunctions: number
  realImports: string[]
  mockBiasRatio: number
}

export type CoverageMetrics = {
  targetFunctionsUsed: string[]
  targetFunctionsCovered: number
  targetFunctionsTotal: number
  coverageProxy: number
}

export type EdgeCaseMetrics = {
  hasNullCheck: boolean
  hasEmptyCheck: boolean
  hasErrorPath: boolean
  hasBoundaryCheck: boolean
  score: number
}

export type TestQualityMetrics = {
  assertions: AssertionMetrics
  mocks: MockMetrics
  coverage: CoverageMetrics
  edgeCases: EdgeCaseMetrics
}

export type TestQualityResult = {
  passed: boolean
  score: number
  metrics: TestQualityMetrics
  issues: string[]
}

// ============================================================================
// ASSERTION ANALYSIS
// ============================================================================

const ASSERTION_PATTERNS = [
  // Jest/Vitest expect
  /expect\s*\([^)]+\)\s*\.to[A-Z]/g,
  /expect\s*\([^)]+\)\s*\.not\./g,
  // Custom assert()
  /\bassert\s*\([^)]+\)/g,
  // Node assert
  /assert\.(strictEqual|deepEqual|deepStrictEqual|equal|ok|throws|rejects|doesNotThrow)/g,
  // Check functions (common pattern)
  /\bcheck\s*\([^)]+\)/g,
]

const TRIVIAL_PATTERNS = [
  /expect\s*\(\s*true\s*\)/,
  /expect\s*\(\s*false\s*\)/,
  /expect\s*\(\s*1\s*\)\s*\.toBe\s*\(\s*1\s*\)/,
  /expect\s*\(\s*['"`].*['"`]\s*\)\s*\.toBe\s*\(\s*['"`].*['"`]\s*\)/,
  /assert\s*\(\s*true\s*[,)]/,
  /assert\s*\(\s*false\s*[,)]/,
  /assert\.ok\s*\(\s*true\s*\)/,
  /check\s*\(\s*['"`][^'"]+['"`]\s*,\s*true\s*\)/,
]

function countAssertions(code: string): AssertionMetrics {
  let total = 0
  let trivial = 0

  // Count all assertions
  for (const pattern of ASSERTION_PATTERNS) {
    const matches = code.match(pattern) || []
    total += matches.length
  }

  // Count trivial assertions
  for (const pattern of TRIVIAL_PATTERNS) {
    const matches = code.match(pattern) || []
    trivial += matches.length
  }

  const meaningful = Math.max(0, total - trivial)

  // Count test functions to calculate per-test ratio
  const testFunctions = countTestFunctions(code)
  const perTest = testFunctions > 0 ? total / testFunctions : total

  return { total, trivial, meaningful, perTest }
}

function countTestFunctions(code: string): number {
  const patterns = [
    /\b(describe|test|it)\s*\(/g,
    /function\s+test\w+\s*\(/g,
    /async\s+function\s+test\w+\s*\(/g,
    /const\s+test\w+\s*=\s*(async\s+)?\(/g,
  ]

  let count = 0
  for (const pattern of patterns) {
    const matches = code.match(pattern) || []
    count += matches.length
  }

  // Fallback: if no test functions found but has assertions, count as 1
  if (count === 0) {
    const hasRunTests = /runTests\s*\(\s*\)/.test(code)
    if (hasRunTests) count = 1
  }

  return Math.max(1, count)
}

// ============================================================================
// MOCK BIAS DETECTION
// ============================================================================

function detectMockBias(code: string, sourceFile: ts.SourceFile): MockMetrics {
  const mockClasses: string[] = []
  const realImports: string[] = []
  let mockFunctions = 0

  // Find mock classes: class MockX extends Y or class MockX
  const mockClassPattern = /class\s+(Mock\w+)/g
  let match
  while ((match = mockClassPattern.exec(code)) !== null) {
    mockClasses.push(match[1])
  }

  // Find mock functions: jest.fn(), vi.fn(), sinon.stub(), etc.
  const mockFnPatterns = [
    /jest\.fn\s*\(/g,
    /vi\.fn\s*\(/g,
    /sinon\.(stub|mock|spy)\s*\(/g,
    /\.mockImplementation\s*\(/g,
    /\.mockReturnValue\s*\(/g,
  ]
  for (const pattern of mockFnPatterns) {
    const matches = code.match(pattern) || []
    mockFunctions += matches.length
  }

  // Find real imports (from ../src/ or similar)
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier
      if (ts.isStringLiteral(moduleSpecifier)) {
        const path = moduleSpecifier.text
        // Real imports typically come from src/ or relative paths
        if (path.includes('/src/') || path.startsWith('../src/') || path.startsWith('./src/')) {
          // Extract imported names
          const importClause = node.importClause
          if (importClause) {
            if (importClause.name) {
              realImports.push(importClause.name.text)
            }
            if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
              for (const element of importClause.namedBindings.elements) {
                realImports.push(element.name.text)
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  // Calculate mock bias ratio
  const totalMocks = mockClasses.length + mockFunctions
  const totalReal = realImports.length
  const mockBiasRatio = totalMocks + totalReal > 0
    ? totalMocks / (totalMocks + totalReal)
    : 0

  return { mockClasses, mockFunctions, realImports, mockBiasRatio }
}

// ============================================================================
// COVERAGE PROXY
// ============================================================================

function analyzeCoverageProxy(
  code: string,
  sourceFile: ts.SourceFile,
  targetExports: string[]
): CoverageMetrics {
  if (targetExports.length === 0) {
    return {
      targetFunctionsUsed: [],
      targetFunctionsCovered: 0,
      targetFunctionsTotal: 0,
      coverageProxy: 1.0  // No exports to check = assume covered
    }
  }

  const calledFunctions = new Set<string>()

  // Walk AST to find all function calls
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression
      if (ts.isIdentifier(expr)) {
        calledFunctions.add(expr.text)
      } else if (ts.isPropertyAccessExpression(expr)) {
        // Handle obj.method() - extract method name
        calledFunctions.add(expr.name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  // Also check for identifier usage (await someFunc(...))
  const identifierPattern = /\b([a-zA-Z_]\w*)\s*\(/g
  let match
  while ((match = identifierPattern.exec(code)) !== null) {
    calledFunctions.add(match[1])
  }

  // Check which target exports are called
  const covered = targetExports.filter(exp => calledFunctions.has(exp))

  return {
    targetFunctionsUsed: covered,
    targetFunctionsCovered: covered.length,
    targetFunctionsTotal: targetExports.length,
    coverageProxy: covered.length / targetExports.length
  }
}

// ============================================================================
// EDGE CASE DETECTION
// ============================================================================

function detectEdgeCases(code: string): EdgeCaseMetrics {
  // Null/undefined checks in test context
  const hasNullCheck = /\b(null|undefined)\b/.test(code) &&
    (/assert.*\b(null|undefined)\b/.test(code) ||
     /expect.*\b(null|undefined)\b/.test(code) ||
     /\b(null|undefined)\b.*assert/.test(code))

  // Empty value checks
  const hasEmptyCheck = (
    /['"]\s*['"]/.test(code) ||           // Empty string ''
    /\[\s*\]/.test(code) ||               // Empty array []
    /\{\s*\}/.test(code) ||               // Empty object {}
    /\.length\s*===?\s*0/.test(code) ||   // length === 0
    /\bempty\b/i.test(code)               // Word "empty"
  ) && (/assert|expect|check/.test(code))

  // Error path testing
  const hasErrorPath =
    /\.catch\s*\(/.test(code) ||
    /try\s*\{[^}]*\}\s*catch/.test(code) ||
    /\.rejects/.test(code) ||
    /\.toThrow/.test(code) ||
    /throws/.test(code) ||
    /Error\s*\(/.test(code)

  // Boundary checks
  const hasBoundaryCheck =
    /\b(zero|negative|max|min|boundary|edge|limit|overflow|underflow)\b/i.test(code) ||
    /\b0\b.*assert|assert.*\b0\b/.test(code) ||
    /\b-\d+\b.*assert|assert.*\b-\d+\b/.test(code)

  // Calculate score: 25 points per check, max 100
  let score = 0
  if (hasNullCheck) score += 25
  if (hasEmptyCheck) score += 25
  if (hasErrorPath) score += 25
  if (hasBoundaryCheck) score += 25

  return { hasNullCheck, hasEmptyCheck, hasErrorPath, hasBoundaryCheck, score }
}

// ============================================================================
// SCORING
// ============================================================================

function calculateAssertionScore(metrics: AssertionMetrics): number {
  if (metrics.total === 0) return 0

  // Base score from meaningful ratio
  const meaningfulRatio = metrics.meaningful / metrics.total
  let score = meaningfulRatio * 80  // Up to 80 points for meaningful ratio

  // Bonus for assertions per test
  if (metrics.perTest >= 3) score += 20
  else if (metrics.perTest >= 2) score += 10

  // Penalty for too many trivial
  if (metrics.trivial > metrics.meaningful) {
    score = Math.max(0, score - 20)
  }

  return Math.min(100, Math.round(score))
}

function calculateMockBiasScore(metrics: MockMetrics): number {
  const ratio = metrics.mockBiasRatio

  if (ratio < 0.3) return 100       // Mostly real code
  if (ratio < 0.5) return 70        // Balanced
  if (ratio < 0.7) return 40        // Mock-heavy
  return 10                         // Almost all mocks
}

function calculateCoverageScore(metrics: CoverageMetrics): number {
  if (metrics.targetFunctionsTotal === 0) return 100

  const proxy = metrics.coverageProxy
  if (proxy >= 0.8) return 100
  if (proxy >= 0.5) return 60
  if (proxy >= 0.3) return 40
  return 20
}

function calculateQualityScore(metrics: TestQualityMetrics): number {
  const assertionScore = calculateAssertionScore(metrics.assertions)
  const mockBiasScore = calculateMockBiasScore(metrics.mocks)
  const coverageScore = calculateCoverageScore(metrics.coverage)
  const edgeCaseScore = metrics.edgeCases.score

  // Weighted average
  const score = (
    assertionScore * 0.35 +
    mockBiasScore * 0.25 +
    coverageScore * 0.25 +
    edgeCaseScore * 0.15
  )

  return Math.round(score)
}

// ============================================================================
// ISSUE GENERATION
// ============================================================================

function generateIssues(metrics: TestQualityMetrics, score: number): string[] {
  const issues: string[] = []

  // Assertion issues
  if (metrics.assertions.total === 0) {
    issues.push('No assertions found. Add expect() or assert() calls.')
  } else if (metrics.assertions.trivial > metrics.assertions.meaningful) {
    issues.push(`Too many trivial assertions (${metrics.assertions.trivial}/${metrics.assertions.total}). Use meaningful comparisons.`)
  } else if (metrics.assertions.perTest < 2) {
    issues.push(`Low assertion density (${metrics.assertions.perTest.toFixed(1)}/test). Add more assertions per test.`)
  }

  // Mock issues
  if (metrics.mocks.mockBiasRatio > 0.7) {
    issues.push(`Mock-heavy test (${Math.round(metrics.mocks.mockBiasRatio * 100)}% mocks). Test with more real code.`)
  } else if (metrics.mocks.mockClasses.length > 3) {
    issues.push(`Many mock classes (${metrics.mocks.mockClasses.length}). Consider reducing mocking.`)
  }

  // Coverage issues
  if (metrics.coverage.targetFunctionsTotal > 0 && metrics.coverage.coverageProxy < 0.5) {
    const missing = metrics.coverage.targetFunctionsTotal - metrics.coverage.targetFunctionsCovered
    issues.push(`Low coverage proxy (${Math.round(metrics.coverage.coverageProxy * 100)}%). ${missing} target functions not called.`)
  }

  // Edge case issues
  if (metrics.edgeCases.score < 50) {
    const missing: string[] = []
    if (!metrics.edgeCases.hasNullCheck) missing.push('null/undefined')
    if (!metrics.edgeCases.hasEmptyCheck) missing.push('empty values')
    if (!metrics.edgeCases.hasErrorPath) missing.push('error paths')
    if (!metrics.edgeCases.hasBoundaryCheck) missing.push('boundaries')
    issues.push(`Missing edge cases: ${missing.join(', ')}.`)
  }

  return issues
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

export function analyzeTestQuality(
  testCode: string,
  targetExports: string[] = []
): Result<TestQualityResult, Error> {
  try {
    // Parse the test code
    const sourceFile = ts.createSourceFile(
      'test.ts',
      testCode,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )

    // Run all analyses
    const assertions = countAssertions(testCode)
    const mocks = detectMockBias(testCode, sourceFile)
    const coverage = analyzeCoverageProxy(testCode, sourceFile, targetExports)
    const edgeCases = detectEdgeCases(testCode)

    const metrics: TestQualityMetrics = {
      assertions,
      mocks,
      coverage,
      edgeCases
    }

    // Calculate overall score
    const score = calculateQualityScore(metrics)

    // Generate issues
    const issues = generateIssues(metrics, score)

    // Determine pass/fail (threshold checked by caller)
    const passed = score >= 50  // Basic sanity threshold

    return Ok({ passed, score, metrics, issues })

  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}

// ============================================================================
// EXPORT EXTRACTION HELPER
// ============================================================================

export function extractExportsFromCode(code: string): string[] {
  const exports: string[] = []

  try {
    const sourceFile = ts.createSourceFile(
      'source.ts',
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )

    function visit(node: ts.Node) {
      // Check for export modifier
      const hasExport = ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)

      if (hasExport) {
        if (ts.isFunctionDeclaration(node) && node.name) {
          exports.push(node.name.text)
        } else if (ts.isClassDeclaration(node) && node.name) {
          exports.push(node.name.text)
        } else if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              exports.push(decl.name.text)
            }
          }
        } else if (ts.isTypeAliasDeclaration(node)) {
          exports.push(node.name.text)
        } else if (ts.isInterfaceDeclaration(node)) {
          exports.push(node.name.text)
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  } catch {
    // Ignore parse errors, return empty
  }

  return exports
}
