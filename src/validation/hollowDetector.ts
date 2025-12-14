// Hollow Code Detector - AST-based detection of hollow/placeholder code
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 5 (Refusal First-Class), Gate 6 Governance
// TCB Component: Part of the 6-Gate Validation System
//
// From ROADMAP Step 4:
// - Current scanner is line-based (known limitation)
// - Add AST-based hollow detection for multi-line patterns
// - Detect: empty function bodies, return-only functions, placeholder implementations

import * as ts from 'typescript'
import { Result, Ok, Err } from '../core/result'

/**
 * Hollow pattern types detected by AST analysis
 */
export type HollowPatternType =
  | 'EMPTY_FUNCTION'           // Function with empty body {}
  | 'RETURN_ONLY'              // Function only returns a constant
  | 'THROW_ONLY'               // Function only throws without logic
  | 'TODO_PLACEHOLDER'         // Contains TODO/FIXME without implementation
  | 'NOT_IMPLEMENTED'          // throw new Error('Not implemented')
  | 'EMPTY_CLASS'              // Class with no methods
  | 'STUB_IMPLEMENTATION'      // Returns undefined/null without logic
  | 'MOCK_TEST'                // Test with no assertions
  | 'TRIVIAL_GETTER'           // Getter that just returns a field
  | 'EMPTY_CATCH'              // Empty catch block

/**
 * A detected hollow pattern
 */
export type HollowPattern = {
  type: HollowPatternType
  severity: 'critical' | 'high' | 'medium' | 'low'
  location: {
    startLine: number
    endLine: number
    startColumn: number
    endColumn: number
  }
  nodeName?: string
  message: string
  code: string // The actual code that was flagged
}

/**
 * Result of hollow detection analysis
 */
export type HollowDetectionResult = {
  hasHollowPatterns: boolean
  patterns: HollowPattern[]
  hollowScore: number // 0-100, lower means more hollow
  summary: string
}

/**
 * Detect hollow patterns in TypeScript/JavaScript code
 * Uses AST parsing for multi-line pattern detection
 */
export function detectHollowPatterns(code: string, filename = 'input.ts'): Result<HollowDetectionResult, Error> {
  try {
    // Parse the code into an AST
    const sourceFile = ts.createSourceFile(
      filename,
      code,
      ts.ScriptTarget.Latest,
      true,
      filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )

    const patterns: HollowPattern[] = []

    // Walk the AST and detect hollow patterns
    function visit(node: ts.Node) {
      // Check function declarations
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        checkFunctionForHollow(node, sourceFile, patterns)
      }

      // Check arrow functions
      if (ts.isArrowFunction(node)) {
        checkArrowFunctionForHollow(node, sourceFile, patterns)
      }

      // Check function expressions
      if (ts.isFunctionExpression(node)) {
        checkFunctionForHollow(node, sourceFile, patterns)
      }

      // Check class declarations
      if (ts.isClassDeclaration(node)) {
        checkClassForHollow(node, sourceFile, patterns)
      }

      // Check try-catch for empty catch
      if (ts.isTryStatement(node)) {
        checkTryCatchForEmptyCatch(node, sourceFile, patterns)
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)

    // Calculate hollow score
    const hollowScore = calculateHollowScore(patterns, code)

    // Generate summary
    const summary = generateHollowSummary(patterns)

    return Ok({
      hasHollowPatterns: patterns.length > 0,
      patterns,
      hollowScore,
      summary
    })
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Check a function for hollow patterns
 */
function checkFunctionForHollow(
  node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
  patterns: HollowPattern[]
): void {
  const body = node.body
  if (!body) return // Abstract method or declaration

  // Get function name
  const name = node.name ? node.name.getText(sourceFile) : '<anonymous>'

  // Get location
  const location = getNodeLocation(node, sourceFile)
  const codeText = node.getText(sourceFile)

  // Check for empty body
  if (ts.isBlock(body) && body.statements.length === 0) {
    patterns.push({
      type: 'EMPTY_FUNCTION',
      severity: 'high',
      location,
      nodeName: name,
      message: `Function '${name}' has an empty body`,
      code: codeText
    })
    return
  }

  // Check for return-only body (single return statement)
  if (ts.isBlock(body) && body.statements.length === 1) {
    const stmt = body.statements[0]

    // Check for 'return constant'
    if (ts.isReturnStatement(stmt)) {
      const expr = stmt.expression
      if (!expr) {
        patterns.push({
          type: 'RETURN_ONLY',
          severity: 'medium',
          location,
          nodeName: name,
          message: `Function '${name}' only returns undefined`,
          code: codeText
        })
      } else if (isConstantExpression(expr)) {
        patterns.push({
          type: 'RETURN_ONLY',
          severity: 'high',
          location,
          nodeName: name,
          message: `Function '${name}' only returns a constant value`,
          code: codeText
        })
      } else if (ts.isIdentifier(expr) && (expr.text === 'undefined' || expr.text === 'null')) {
        patterns.push({
          type: 'STUB_IMPLEMENTATION',
          severity: 'high',
          location,
          nodeName: name,
          message: `Function '${name}' is a stub (returns ${expr.text})`,
          code: codeText
        })
      }
    }

    // Check for 'throw not implemented'
    if (ts.isThrowStatement(stmt)) {
      const expr = stmt.expression
      if (expr && isNotImplementedError(expr, sourceFile)) {
        patterns.push({
          type: 'NOT_IMPLEMENTED',
          severity: 'critical',
          location,
          nodeName: name,
          message: `Function '${name}' throws 'Not implemented' error`,
          code: codeText
        })
      } else {
        patterns.push({
          type: 'THROW_ONLY',
          severity: 'medium',
          location,
          nodeName: name,
          message: `Function '${name}' only throws without logic`,
          code: codeText
        })
      }
    }
  }

  // Check for TODO/FIXME without implementation
  const bodyText = body.getText(sourceFile)
  if (hasPlaceholderComment(bodyText)) {
    // Count actual statements (excluding variable declarations with no init)
    const meaningfulStatements = countMeaningfulStatements(body)
    if (meaningfulStatements <= 1) {
      patterns.push({
        type: 'TODO_PLACEHOLDER',
        severity: 'high',
        location,
        nodeName: name,
        message: `Function '${name}' contains TODO/FIXME with minimal implementation`,
        code: codeText
      })
    }
  }

  // Check for test function without assertions
  if (isTestFunction(name, node, sourceFile)) {
    if (!hasAssertions(body, sourceFile)) {
      patterns.push({
        type: 'MOCK_TEST',
        severity: 'critical',
        location,
        nodeName: name,
        message: `Test function '${name}' has no assertions`,
        code: codeText
      })
    }
  }
}

/**
 * Check arrow function for hollow patterns
 */
function checkArrowFunctionForHollow(
  node: ts.ArrowFunction,
  sourceFile: ts.SourceFile,
  patterns: HollowPattern[]
): void {
  const body = node.body
  const location = getNodeLocation(node, sourceFile)
  const codeText = node.getText(sourceFile)

  // Arrow function with empty block body
  if (ts.isBlock(body) && body.statements.length === 0) {
    patterns.push({
      type: 'EMPTY_FUNCTION',
      severity: 'high',
      location,
      message: 'Arrow function has an empty body',
      code: codeText
    })
    return
  }

  // Arrow function returning undefined/null directly
  if (!ts.isBlock(body)) {
    if (ts.isIdentifier(body) && (body.text === 'undefined' || body.text === 'null')) {
      patterns.push({
        type: 'STUB_IMPLEMENTATION',
        severity: 'medium',
        location,
        message: `Arrow function returns ${body.text}`,
        code: codeText
      })
    }
  }
}

/**
 * Check class for hollow patterns
 */
function checkClassForHollow(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  patterns: HollowPattern[]
): void {
  const name = node.name ? node.name.getText(sourceFile) : '<anonymous>'
  const location = getNodeLocation(node, sourceFile)
  const codeText = node.getText(sourceFile)

  // Count methods (exclude constructor)
  const methods = node.members.filter(
    m => ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m)
  )

  // Empty class with no methods
  if (methods.length === 0 && node.members.length === 0) {
    patterns.push({
      type: 'EMPTY_CLASS',
      severity: 'medium',
      location,
      nodeName: name,
      message: `Class '${name}' has no members`,
      code: codeText
    })
  }
}

/**
 * Check try-catch for empty catch block
 */
function checkTryCatchForEmptyCatch(
  node: ts.TryStatement,
  sourceFile: ts.SourceFile,
  patterns: HollowPattern[]
): void {
  if (node.catchClause) {
    const catchBlock = node.catchClause.block
    if (catchBlock.statements.length === 0) {
      const location = getNodeLocation(node.catchClause, sourceFile)
      patterns.push({
        type: 'EMPTY_CATCH',
        severity: 'high',
        location,
        message: 'Empty catch block swallows errors',
        code: node.catchClause.getText(sourceFile)
      })
    }
  }
}

/**
 * Check if an expression is a constant
 */
function isConstantExpression(expr: ts.Expression): boolean {
  // Literals
  if (ts.isNumericLiteral(expr) || ts.isStringLiteral(expr)) return true
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return true
  if (expr.kind === ts.SyntaxKind.NullKeyword) return true

  // Empty array/object literals
  if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 0) return true
  if (ts.isObjectLiteralExpression(expr) && expr.properties.length === 0) return true

  return false
}

/**
 * Check if throw expression is a "Not implemented" error
 */
function isNotImplementedError(expr: ts.Expression, sourceFile: ts.SourceFile): boolean {
  if (!ts.isNewExpression(expr)) return false

  const text = expr.getText(sourceFile).toLowerCase()
  return text.includes('not implemented') ||
         text.includes('notimplemented') ||
         text.includes('not yet implemented') ||
         text.includes('stub') ||
         text.includes('todo')
}

/**
 * Check for TODO/FIXME/placeholder comments
 */
function hasPlaceholderComment(text: string): boolean {
  const patterns = [
    /\/\/\s*TODO/i,
    /\/\/\s*FIXME/i,
    /\/\/\s*placeholder/i,
    /\/\/\s*stub/i,
    /\/\/\s*not\s+implemented/i,
    /\/\*[\s\S]*TODO[\s\S]*\*\//i,
    /\/\*[\s\S]*FIXME[\s\S]*\*\//i,
  ]
  return patterns.some(p => p.test(text))
}

/**
 * Count meaningful statements in a block
 */
function countMeaningfulStatements(block: ts.Block): number {
  let count = 0
  for (const stmt of block.statements) {
    // Exclude variable declarations with no initializer
    if (ts.isVariableStatement(stmt)) {
      const hasInit = stmt.declarationList.declarations.some(d => d.initializer)
      if (hasInit) count++
    } else if (!ts.isEmptyStatement(stmt)) {
      count++
    }
  }
  return count
}

/**
 * Check if this is a test function
 */
function isTestFunction(
  name: string,
  node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression,
  sourceFile: ts.SourceFile
): boolean {
  // Check name patterns
  if (/^(test|it|describe|should|spec)/i.test(name)) return true

  // Check if inside a test framework call
  const parent = node.parent
  if (parent && ts.isCallExpression(parent)) {
    const callName = parent.expression.getText(sourceFile)
    if (/^(test|it|describe|beforeEach|afterEach)$/.test(callName)) return true
  }

  return false
}

/**
 * Check if a block contains assertions
 */
function hasAssertions(block: ts.Block, sourceFile: ts.SourceFile): boolean {
  const text = block.getText(sourceFile)
  const assertionPatterns = [
    /\bassert\s*\(/,
    /\bexpect\s*\(/,
    /\.toBe\s*\(/,
    /\.toEqual\s*\(/,
    /\.toContain\s*\(/,
    /\.toThrow\s*\(/,
    /\.toHaveBeenCalled/,
    /\.rejects\./,
    /\.resolves\./,
    /should\./,
    /\.should\./,
  ]
  return assertionPatterns.some(p => p.test(text))
}

/**
 * Get location of a node
 */
function getNodeLocation(node: ts.Node, sourceFile: ts.SourceFile): HollowPattern['location'] {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd())
  return {
    startLine: start.line + 1,
    endLine: end.line + 1,
    startColumn: start.character + 1,
    endColumn: end.character + 1
  }
}

/**
 * Calculate hollow score (0-100, lower = more hollow)
 */
function calculateHollowScore(patterns: HollowPattern[], code: string): number {
  if (patterns.length === 0) return 100

  let deductions = 0
  for (const pattern of patterns) {
    switch (pattern.severity) {
      case 'critical': deductions += 30; break
      case 'high': deductions += 20; break
      case 'medium': deductions += 10; break
      case 'low': deductions += 5; break
    }
  }

  // Normalize by code size (small files with hollow patterns are worse)
  const lines = code.split('\n').length
  const sizeFactor = Math.min(1, lines / 50) // Files under 50 lines get full penalty

  return Math.max(0, 100 - Math.floor(deductions * sizeFactor))
}

/**
 * Generate human-readable summary
 */
function generateHollowSummary(patterns: HollowPattern[]): string {
  if (patterns.length === 0) {
    return 'No hollow patterns detected'
  }

  const bySeverity = {
    critical: patterns.filter(p => p.severity === 'critical').length,
    high: patterns.filter(p => p.severity === 'high').length,
    medium: patterns.filter(p => p.severity === 'medium').length,
    low: patterns.filter(p => p.severity === 'low').length
  }

  const parts: string[] = []
  if (bySeverity.critical > 0) parts.push(`${bySeverity.critical} critical`)
  if (bySeverity.high > 0) parts.push(`${bySeverity.high} high`)
  if (bySeverity.medium > 0) parts.push(`${bySeverity.medium} medium`)
  if (bySeverity.low > 0) parts.push(`${bySeverity.low} low`)

  return `Hollow patterns: ${parts.join(', ')}`
}

/**
 * Format hollow detection result for display
 */
export function formatHollowResult(result: HollowDetectionResult): string {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('HOLLOW CODE DETECTION')
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('')
  lines.push(`Status: ${result.hasHollowPatterns ? 'HOLLOW PATTERNS FOUND' : 'CLEAN'}`)
  lines.push(`Hollow Score: ${result.hollowScore}/100`)
  lines.push(`Summary: ${result.summary}`)
  lines.push('')

  if (result.patterns.length > 0) {
    lines.push('DETECTED PATTERNS:')
    for (const pattern of result.patterns) {
      const loc = `${pattern.location.startLine}-${pattern.location.endLine}`
      const name = pattern.nodeName ? ` (${pattern.nodeName})` : ''
      lines.push(`  [${pattern.severity.toUpperCase()}] ${pattern.type}${name}`)
      lines.push(`      Lines ${loc}: ${pattern.message}`)
    }
    lines.push('')
  }

  lines.push('═══════════════════════════════════════════════════════════')

  return lines.join('\n')
}

/**
 * Check if code passes hollow detection (no critical/high patterns)
 */
export function passesHollowDetection(result: HollowDetectionResult): boolean {
  const hasCritical = result.patterns.some(p => p.severity === 'critical')
  const hasHigh = result.patterns.some(p => p.severity === 'high')
  return !hasCritical && !hasHigh
}
