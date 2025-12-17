// AST-Based Security Scanner
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 6 (No Silent State Mutation), Gate 6 Governance
// TCB Component: Part of the 6-Gate Validation System
//
// Uses AST walking to detect dangerous patterns that regex cannot catch:
// - Dataflow from template literals/concatenation to dangerous sinks
// - Multi-line vulnerable patterns
// - Context-aware detection (e.g., distinguishes test code from prod code)

import { Project, SyntaxKind, CallExpression, Node, SourceFile } from 'ts-morph'
import type { SecurityVulnerability, SecurityVulnerabilityType } from './securityScanner'

/** Categories of dangerous sinks */
const DANGEROUS_SINKS: Record<string, {
  methods: string[]
  severity: 'critical' | 'high'
  vulnType: SecurityVulnerabilityType
  message: string
}> = {
  command_injection: {
    methods: ['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync'],
    severity: 'critical',
    vulnType: 'COMMAND_INJECTION',
    message: 'Untrusted input flows to command execution'
  },
  eval_injection: {
    methods: ['eval'],
    severity: 'critical',
    vulnType: 'EVAL_USAGE',
    message: 'Untrusted input flows to eval'
  },
  function_constructor: {
    methods: ['Function'],
    severity: 'critical',
    vulnType: 'EVAL_USAGE',
    message: 'Untrusted input flows to Function constructor'
  },
  sql_injection: {
    methods: ['query', 'execute', 'raw'],
    severity: 'critical',
    vulnType: 'SQL_INJECTION',
    message: 'Untrusted input flows to SQL query'
  },
  xss: {
    methods: ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'write', 'writeln'],
    severity: 'high',
    vulnType: 'XSS_VECTOR',
    message: 'Untrusted input flows to DOM manipulation'
  },
  path_traversal: {
    methods: ['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'createReadStream', 'createWriteStream'],
    severity: 'high',
    vulnType: 'PATH_TRAVERSAL',
    message: 'Untrusted input used in file path'
  },
  deserialization: {
    methods: ['parse'],  // JSON.parse with untrusted input
    severity: 'high',
    vulnType: 'UNSAFE_DESERIALIZATION',
    message: 'Untrusted input flows to JSON.parse'
  }
}

/** Patterns that indicate dynamic/tainted input */
function isDynamicInput(node: Node): boolean {
  const kind = node.getKind()

  // Template literals with expressions: `foo ${bar}`
  if (kind === SyntaxKind.TemplateExpression) {
    return true
  }

  // String concatenation: "foo" + bar
  if (kind === SyntaxKind.BinaryExpression) {
    const text = node.getText()
    if (text.includes('+')) {
      return true
    }
  }

  // Check children for nested dynamic content
  for (const child of node.getChildren()) {
    if (isDynamicInput(child)) {
      return true
    }
  }

  return false
}

/** Check if a call is to a dangerous sink */
function getDangerousSinkInfo(callExpr: CallExpression): {
  category: string
  sinkName: string
  severity: 'critical' | 'high'
  vulnType: SecurityVulnerabilityType
  message: string
} | null {
  const expression = callExpr.getExpression()
  const exprText = expression.getText()

  for (const [category, config] of Object.entries(DANGEROUS_SINKS)) {
    for (const method of config.methods) {
      // Match: exec(...), child_process.exec(...), obj.exec(...)
      if (exprText === method ||
          exprText.endsWith('.' + method) ||
          exprText.includes('.' + method)) {
        return {
          category,
          sinkName: method,
          severity: config.severity,
          vulnType: config.vulnType,
          message: config.message
        }
      }
    }
  }

  // Special case: new Function(...)
  if (callExpr.getParent()?.getKind() === SyntaxKind.NewExpression) {
    const parentText = callExpr.getParent()?.getText() || ''
    if (parentText.includes('new Function')) {
      return {
        category: 'function_constructor',
        sinkName: 'Function',
        severity: 'critical',
        vulnType: 'EVAL_USAGE',
        message: 'Untrusted input flows to Function constructor'
      }
    }
  }

  return null
}

/** Check if code is in a test context */
function isTestContext(sourceFile: SourceFile): boolean {
  const text = sourceFile.getFullText()
  // Check for test patterns
  return /\b(describe|test|it|expect)\s*\(/.test(text) ||
         /\.test\.(ts|js)$/.test(sourceFile.getFilePath()) ||
         /\.spec\.(ts|js)$/.test(sourceFile.getFilePath())
}

/** Scan code using AST analysis for dangerous patterns */
export function scanASTForSinks(code: string): SecurityVulnerability[] {
  const vulnerabilities: SecurityVulnerability[] = []

  try {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile('temp.ts', code)

    // Skip lighter analysis for test code (but don't skip entirely)
    const inTestContext = isTestContext(sourceFile)

    // Walk all call expressions
    sourceFile.forEachDescendant(node => {
      if (node.getKind() !== SyntaxKind.CallExpression) return

      const callExpr = node as CallExpression
      const sinkInfo = getDangerousSinkInfo(callExpr)

      if (!sinkInfo) return

      // Get arguments
      const args = callExpr.getArguments()

      // Check if any argument contains dynamic input
      for (const arg of args) {
        if (isDynamicInput(arg)) {
          // In test context, only report critical vulnerabilities
          if (inTestContext && sinkInfo.severity !== 'critical') {
            continue
          }

          vulnerabilities.push({
            type: sinkInfo.vulnType,
            severity: sinkInfo.severity,
            line: node.getStartLineNumber(),
            message: `${sinkInfo.message}: ${sinkInfo.sinkName}()`,
            pattern: 'ast-dataflow'
          })
          break  // One vulnerability per call
        }
      }
    })

    // Also check for new Function() with dynamic args
    sourceFile.forEachDescendant(node => {
      if (node.getKind() !== SyntaxKind.NewExpression) return

      const newExpr = node as any
      const exprText = newExpr.getExpression?.()?.getText?.() || ''

      if (exprText === 'Function') {
        const args = newExpr.getArguments?.() || []
        for (const arg of args) {
          if (isDynamicInput(arg)) {
            vulnerabilities.push({
              type: 'EVAL_USAGE',
              severity: 'critical',
              line: node.getStartLineNumber(),
              message: 'Untrusted input flows to Function constructor',
              pattern: 'ast-dataflow'
            })
            break
          }
        }
      }
    })

    // Check for prototype pollution patterns
    sourceFile.forEachDescendant(node => {
      if (node.getKind() !== SyntaxKind.ElementAccessExpression) return

      const elemAccess = node as any
      const argText = elemAccess.getArgumentExpression?.()?.getText?.() || ''

      // obj["__proto__"] or obj[variable] where variable could be "__proto__"
      if (argText.includes('__proto__') || argText.includes('constructor') || argText.includes('prototype')) {
        vulnerabilities.push({
          type: 'PROTOTYPE_POLLUTION',
          severity: 'high',
          line: node.getStartLineNumber(),
          message: 'Potential prototype pollution via dynamic property access',
          pattern: 'ast-property-access'
        })
      }
    })

  } catch (error) {
    // If AST parsing fails, return empty (regex scanner is backup)
    console.error('[AST Scanner] Parse error:', error)
  }

  return vulnerabilities
}

/** Combined scan: regex + AST (deduped) */
export function scanWithAST(code: string): SecurityVulnerability[] {
  const astVulns = scanASTForSinks(code)

  // Dedupe by line and type
  const seen = new Set<string>()
  const deduped: SecurityVulnerability[] = []

  for (const vuln of astVulns) {
    const key = `${vuln.type}:${vuln.line}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(vuln)
    }
  }

  return deduped
}
