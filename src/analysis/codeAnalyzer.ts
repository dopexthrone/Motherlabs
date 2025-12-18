// Code Analyzer - Read and analyze TypeScript source

import { Project, SourceFile, SyntaxKind } from 'ts-morph'
import * as fs from 'fs'
import * as path from 'path'
import { Result, Ok, Err } from '../core/result'

export type CodeIssue = {
  type: 'NO_TESTS' | 'HIGH_COMPLEXITY' | 'DUPLICATE_CODE' | 'NO_ERROR_HANDLING' | 'MISSING_TYPES'
  severity: 'critical' | 'high' | 'medium' | 'low'
  line: number
  message: string
  fixable: boolean
}

export type CodeMetrics = {
  complexity: number
  linesOfCode: number
  functions: number
  testCoverage: number
}

export type CodeAnalysis = {
  filepath: string
  timestamp: number
  metrics: CodeMetrics
  issues: CodeIssue[]
}

/**
 * Analyze a TypeScript file
 */
export function analyzeFile(filepath: string): Result<CodeAnalysis, Error> {
  try {
    const project = new Project({
      tsConfigFilePath: path.join(__dirname, '../../tsconfig.json')
    })

    const sourceFile = project.addSourceFileAtPath(filepath)

    if (!sourceFile) {
      return Err(new Error(`Could not load file: ${filepath}`))
    }

    const metrics = calculateMetrics(sourceFile)
    const issues = detectIssues(sourceFile, filepath)

    return Ok({
      filepath,
      timestamp: Date.now(),  // DETERMINISM-EXEMPT: Analysis metadata
      metrics,
      issues
    })

  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Calculate code metrics (deterministic)
 */
function calculateMetrics(sourceFile: SourceFile): CodeMetrics {
  const functions = sourceFile.getFunctions()
  const classes = sourceFile.getClasses()
  const methods = classes.flatMap(c => c.getMethods())

  const allFunctions = [...functions, ...methods]

  // Cyclomatic complexity (simple calculation)
  let totalComplexity = 0
  for (const func of allFunctions) {
    totalComplexity += calculateFunctionComplexity(func)
  }

  const avgComplexity = allFunctions.length > 0
    ? totalComplexity / allFunctions.length
    : 0

  // Lines of code (excluding comments/blank)
  const text = sourceFile.getFullText()
  const lines = text.split('\n')
  const codeLines = lines.filter(line => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('//')
  })

  // Test coverage (check if test file exists)
  const testCoverage = hasTestFile(sourceFile.getFilePath()) ? 1.0 : 0.0

  return {
    complexity: avgComplexity,
    linesOfCode: codeLines.length,
    functions: allFunctions.length,
    testCoverage
  }
}

/**
 * Calculate cyclomatic complexity of a function
 */
function calculateFunctionComplexity(func: any): number {
  let complexity = 1  // Base complexity

  // Count decision points
  const body = func.getBody()
  if (!body) return complexity

  const bodyText = body.getText()

  // Simple heuristic: count if/for/while/case/&&/||/catch
  const decisionPatterns = [
    /\bif\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /&&/g,
    /\|\|/g,
    /\bcatch\s*\(/g
  ]

  for (const pattern of decisionPatterns) {
    const matches = bodyText.match(pattern)
    if (matches) {
      complexity += matches.length
    }
  }

  return complexity
}

/**
 * Check if test file exists for source file
 */
function hasTestFile(filepath: string): boolean {
  const basename = path.basename(filepath, '.ts')
  const dirname = path.dirname(filepath)

  const possibleTestPaths = [
    path.join(dirname, `${basename}.test.ts`),
    path.join(dirname, `__tests__/${basename}.test.ts`),
    path.join('tests', `${basename}.test.ts`)
  ]

  return possibleTestPaths.some(p => fs.existsSync(p))
}

/**
 * Detect issues in source file (deterministic)
 */
function detectIssues(sourceFile: SourceFile, filepath: string): CodeIssue[] {
  const issues: CodeIssue[] = []

  // Issue 1: No test file
  if (!hasTestFile(filepath)) {
    issues.push({
      type: 'NO_TESTS',
      severity: 'high',
      line: 1,
      message: `No test file found for ${path.basename(filepath)}`,
      fixable: true
    })
  }

  // Issue 2: High complexity functions
  const functions = sourceFile.getFunctions()
  const methods = sourceFile.getClasses().flatMap(c => c.getMethods())

  // Detect if this is an entry point file (has non-exported main function and main() call)
  const fileText = sourceFile.getFullText()
  const hasMainCall = /main\(\)\.catch/.test(fileText)
  const basename = path.basename(filepath)
  const isEntryPoint = hasMainCall && (basename === 'cli.ts' || basename === 'main.ts' || basename === 'index.ts')

  for (const func of [...functions, ...methods]) {
    const complexity = calculateFunctionComplexity(func)
    const funcName = func.getName() || 'anonymous'

    // Skip complexity issues for main functions in entry point files
    // These are orchestration functions that don't need to be exported
    const isExported = 'isExported' in func ? (func as { isExported(): boolean }).isExported() : false
    if (isEntryPoint && funcName === 'main' && !isExported) {
      continue
    }

    if (complexity > 10) {
      const line = func.getStartLineNumber()
      issues.push({
        type: 'HIGH_COMPLEXITY',
        severity: complexity > 20 ? 'high' : 'medium',
        line,
        message: `Function "${funcName}" has complexity ${complexity} (>10)`,
        fixable: true
      })
    }
  }

  // Issue 3: No error handling (try/catch or Result)
  for (const func of [...functions, ...methods]) {
    const body = func.getBody()
    if (!body) continue

    const bodyText = body.getText()
    const hasAsync = func.isAsync()
    const hasErrorHandling = /try\s*\{|Result<|\.catch\(/.test(bodyText)

    if (hasAsync && !hasErrorHandling) {
      issues.push({
        type: 'NO_ERROR_HANDLING',
        severity: 'medium',
        line: func.getStartLineNumber(),
        message: `Async function "${func.getName()}" lacks error handling`,
        fixable: true
      })
    }
  }

  return issues
}

/**
 * Analyze entire directory
 */
export function analyzeDirectory(dirPath: string): Result<CodeAnalysis[], Error> {
  try {
    const files = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith('.ts') && !f.name.endsWith('.test.ts'))
      .map(f => path.join(dirPath, f.name))

    const analyses: CodeAnalysis[] = []

    for (const file of files) {
      const result = analyzeFile(file)
      if (result.ok) {
        analyses.push(result.value)
      }
    }

    return Ok(analyses)

  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}
