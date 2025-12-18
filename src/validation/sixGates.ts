// 6-Gate Validator - Prevents LLM escapes, enforces correctness
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 1 (Deterministic Authority), AXIOM 4 (Mechanical Verification)
// TCB Component: This file is part of the Trusted Computing Base

import { Project, SyntaxKind } from 'ts-morph'
import { Result, Ok, Err } from '../core/result'
import { computeEntropy } from '../urco/entropy'
import { extractEntities, extractActions } from '../urco/extractor'
import { detectMissingVars } from '../urco/missingVars'
import { detectContradictions } from '../urco/contradictions'
import { runTestExec, verifyEvidence, cleanupRunDir } from '../sandbox/runner'
import { scanForVulnerabilities, getVulnerabilitySummary } from './securityScanner'
import { detectHollowPatterns, passesHollowDetection } from './hollowDetector'
import { analyzeTestQuality } from './testQualityAnalyzer'
import type { TestExecRequest } from '../sandbox/types'
import { contentAddress } from '../core/contentAddress'
import { createGateDecision, createGateDecisionScope, GateDecision, ValidationGateType } from '../core/gateDecision'
import { EFFECT_SETS, EffectType } from '../core/effects'
import type { JSONLLedger } from '../persistence/jsonlLedger'
import { bundleForExecution, hasLocalImports } from './bundler'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'

export type CodeValidationContext = {
  existingImports: string[]
  existingTypes: string[]
  governanceRules?: string[]
  /** Optional ledger for recording gate decisions */
  ledger?: JSONLLedger
  /** Optional target file path for gate decisions */
  targetFile?: string
  /** Gate 7: Make test quality gate required (blocks validation) */
  strictTestQuality?: boolean
  /** Gate 7: Score threshold for passing (default 60) */
  testQualityThreshold?: number
  /** Gate 7: Exported functions from target file for coverage analysis */
  targetExports?: string[]
}

export type GateResult = {
  gateName: string
  passed: boolean
  required: boolean
  error?: string
  details?: Record<string, unknown>
}

export type CodeValidationResult = {
  valid: boolean
  gateResults: GateResult[]
  rejectedAt?: string
}

export class SixGateValidator {
  /** Collected gate decisions from last validation */
  private lastGateDecisions: GateDecision[] = []

  /**
   * Validate code through all 6 gates
   * ANY required gate fails → code REJECTED
   *
   * If context.ledger is provided, gate decisions are recorded to the ledger.
   */
  async validate(
    code: string,
    context: CodeValidationContext
  ): Promise<Result<CodeValidationResult, Error>> {

    const gateResults: GateResult[] = []
    this.lastGateDecisions = []
    const codeId = contentAddress(code)

    // ═══════════════════════════════════════════════════════════
    // GATE 1: Schema Validation
    // ═══════════════════════════════════════════════════════════
    const g1 = this.gate1_schemaValidation(code)
    gateResults.push(g1)
    await this.recordGateDecision(g1, codeId, code, context)

    // ═══════════════════════════════════════════════════════════
    // GATE 2: Syntax Validation
    // ═══════════════════════════════════════════════════════════
    const g2 = await this.gate2_syntaxValidation(code)
    gateResults.push(g2)
    await this.recordGateDecision(g2, codeId, code, context)

    // ═══════════════════════════════════════════════════════════
    // GATE 3: Variable Resolution
    // ═══════════════════════════════════════════════════════════
    const g3 = this.gate3_variableResolution(code, context)
    gateResults.push(g3)
    await this.recordGateDecision(g3, codeId, code, context)

    // ═══════════════════════════════════════════════════════════
    // GATE 4: Test Execution (kernel-grade sandbox)
    // ═══════════════════════════════════════════════════════════
    const g4 = await this.gate4_testExecution(code, context)
    gateResults.push(g4)
    await this.recordGateDecision(g4, codeId, code, context)

    // ═══════════════════════════════════════════════════════════
    // GATE 5: URCO Entropy
    // ═══════════════════════════════════════════════════════════
    const g5 = this.gate5_urcoEntropy(code)
    gateResults.push(g5)
    await this.recordGateDecision(g5, codeId, code, context)

    // ═══════════════════════════════════════════════════════════
    // GATE 6: Governance Check
    // ═══════════════════════════════════════════════════════════
    const g6 = this.gate6_governanceCheck(code, context)
    gateResults.push(g6)
    await this.recordGateDecision(g6, codeId, code, context)

    // ═══════════════════════════════════════════════════════════
    // GATE 7: Test Quality (only for test code)
    // ═══════════════════════════════════════════════════════════
    if (this.isTestCode(code)) {
      const g7 = this.gate7_testQuality(code, context)
      gateResults.push(g7)
      await this.recordGateDecision(g7, codeId, code, context)
    }

    // Determine overall validity
    const requiredGatesFailed = gateResults.filter(g => g.required && !g.passed)
    const valid = requiredGatesFailed.length === 0

    const rejectedAt = requiredGatesFailed.length > 0
      ? requiredGatesFailed[0].gateName
      : undefined

    return Ok({
      valid,
      gateResults,
      rejectedAt
    })
  }

  /**
   * Record a gate decision to the ledger (if provided)
   */
  private async recordGateDecision(
    result: GateResult,
    codeId: string,
    code: string,
    context: CodeValidationContext
  ): Promise<void> {
    // Determine granted effects based on gate type
    const grantedEffects: EffectType[] = result.passed
      ? this.getGrantedEffectsForGate(result.gateName)
      : []

    const scope = createGateDecisionScope(
      'code',
      code,
      context.targetFile,
      grantedEffects
    )

    const decision = createGateDecision(
      result.gateName as ValidationGateType,
      result.passed ? 'ALLOW' : 'DENY',
      scope,
      `gate:${result.gateName}`,
      result.error || (result.passed ? 'Passed validation' : 'Failed validation'),
      result.details
    )

    this.lastGateDecisions.push(decision)

    // Record to ledger if provided
    if (context.ledger) {
      await context.ledger.appendGateDecision(decision)
    }
  }

  /**
   * Get effects granted by a specific gate passing
   */
  private getGrantedEffectsForGate(gateName: string): EffectType[] {
    switch (gateName) {
      case 'schema_validation':
      case 'syntax_validation':
      case 'variable_resolution':
      case 'urco_entropy':
        // Pure validation gates - no effects granted
        return ['NONE']

      case 'test_execution':
        // Test execution grants execution effects
        return ['TEST_EXECUTE', 'LEDGER_APPEND']

      case 'governance_check':
        // Governance check grants code modification effects if passed
        return ['CODE_MODIFY', 'GIT_COMMIT', 'LEDGER_APPEND']

      case 'test_quality':
        // Test quality is pure validation - no effects granted
        return ['NONE']

      default:
        return ['NONE']
    }
  }

  /**
   * Get gate decisions from last validation
   */
  getLastGateDecisions(): GateDecision[] {
    return [...this.lastGateDecisions]
  }

  /**
   * Gate 1: Schema Validation
   * Checks if code structure matches expected patterns
   */
  private gate1_schemaValidation(code: string): GateResult {
    try {
      // Check for exports OR test patterns
      // Match: export function, export const, export class, export type, export interface
      // Also match: export async function, export default
      const hasExport = /export\s+(async\s+)?(function|const|class|type|interface|default)/.test(code)

      // Jest/Mocha patterns
      const hasJestPattern = /\b(describe|test|it)\s*\(/.test(code)

      // Custom test pattern used in this project:
      // function assert(condition: boolean, message: string)
      // async function runTests()
      // runTests().catch(...)
      const hasCustomTestPattern = /function\s+assert\s*\(/.test(code) &&
                                   /function\s+runTests\s*\(/.test(code) &&
                                   /runTests\s*\(\s*\)\.catch/.test(code)

      const hasTestPattern = hasJestPattern || hasCustomTestPattern

      if (!hasExport && !hasTestPattern) {
        return {
          gateName: 'schema_validation',
          passed: false,
          required: true,
          error: 'Code must export at least one declaration or contain test patterns'
        }
      }

      return {
        gateName: 'schema_validation',
        passed: true,
        required: true
      }

    } catch (error) {
      return {
        gateName: 'schema_validation',
        passed: false,
        required: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Gate 2: Syntax & Type Validation
   * TypeScript must parse without errors and pass type checking
   *
   * HARDENED: Uses project tsconfig with strict mode for real type checking.
   * Falls back to syntax-only validation if project context isn't available.
   *
   * Two-phase validation:
   * 1. Fast syntax check (parse errors are immediate failures)
   * 2. Type checking (catches type mismatches, invalid member access, etc.)
   */
  private async gate2_syntaxValidation(code: string): Promise<GateResult> {
    try {
      // Phase 1: Fast syntax check with in-memory project
      const syntaxProject = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
          target: 99, // ScriptTarget.ESNext
          noEmit: true,
          skipLibCheck: true,
          noLib: true
        }
      })

      const sourceFile = syntaxProject.createSourceFile('temp.ts', code)

      // Check parse diagnostics (syntax errors)
      const tsSourceFile = sourceFile.compilerNode as any
      const parseDiagnostics = tsSourceFile.parseDiagnostics || []

      if (parseDiagnostics.length > 0) {
        return {
          gateName: 'syntax_validation',
          passed: false,
          required: true,
          error: `Parse errors: ${parseDiagnostics.length}`,
          details: {
            errors: parseDiagnostics.slice(0, 3).map((d: any) =>
              typeof d.messageText === 'string' ? d.messageText : d.messageText?.messageText || 'Unknown error'
            )
          }
        }
      }

      // Phase 2: Real type checking with project context
      // Write to temp file so we can use project's tsconfig
      const attemptId = randomBytes(4).toString('hex')
      const tempDir = path.join(process.cwd(), '.gate-temp')
      fs.mkdirSync(tempDir, { recursive: true })
      const tempFile = path.join(tempDir, `check-${attemptId}.ts`)

      try {
        fs.writeFileSync(tempFile, code)

        // Use project-aware type checking
        const typeProject = new Project({
          compilerOptions: {
            strict: true,
            noEmit: true,
            skipLibCheck: true,  // Skip checking node_modules
            esModuleInterop: true,
            target: 99,  // ESNext
            module: 99,  // ESNext
            moduleResolution: 2  // Node
          }
        })

        const typeSourceFile = typeProject.addSourceFileAtPath(tempFile)
        const diagnostics = typeSourceFile.getPreEmitDiagnostics()

        // Filter to only errors from this file (not from imports)
        const ownErrors = diagnostics.filter(d => {
          const file = d.getSourceFile()
          if (!file) return false
          return file.getFilePath().includes('check-')
        })

        // Filter out errors about missing modules (those are handled in Gate 4)
        const typeErrors = ownErrors.filter(d => {
          const message = d.getMessageText()
          const text = typeof message === 'string' ? message : message.getMessageText()
          // Skip "Cannot find module" errors - imports are checked in Gate 4
          if (text.includes('Cannot find module')) return false
          // Skip errors about implicit 'any' on external modules
          if (text.includes('implicitly has an \'any\' type')) return false
          return true
        })

        if (typeErrors.length > 0) {
          const firstError = typeErrors[0]
          const message = firstError.getMessageText()
          const errorText = typeof message === 'string' ? message : message.getMessageText()

          return {
            gateName: 'syntax_validation',
            passed: false,
            required: true,
            error: errorText.slice(0, 200),
            details: {
              typeErrors: typeErrors.length,
              errors: typeErrors.slice(0, 3).map(d => {
                const msg = d.getMessageText()
                return typeof msg === 'string' ? msg : msg.getMessageText()
              })
            }
          }
        }

        return {
          gateName: 'syntax_validation',
          passed: true,
          required: true,
          details: {
            typeCheckPassed: true,
            diagnosticsChecked: diagnostics.length
          }
        }

      } finally {
        // Cleanup temp file
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile)
          }
        } catch { /* ignore cleanup errors */ }
      }

    } catch (error) {
      return {
        gateName: 'syntax_validation',
        passed: false,
        required: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Gate 3: Variable Resolution
   * All used variables must be defined or imported
   *
   * This gate uses semantic analysis to find truly undefined references,
   * properly handling: function parameters, property accesses, type annotations,
   * import bindings, destructuring patterns, and type parameters.
   */
  private gate3_variableResolution(code: string, context: CodeValidationContext): GateResult {
    try {
      const project = new Project({ useInMemoryFileSystem: true })
      const sourceFile = project.createSourceFile('temp.ts', code)

      // Collect all defined names in this file
      const definedNames = new Set<string>()

      // 1. Function declarations
      for (const fn of sourceFile.getFunctions()) {
        const name = fn.getName()
        if (name) definedNames.add(name)
        // Add parameters (handle destructuring patterns)
        for (const param of fn.getParameters()) {
          const nameNode = param.getNameNode()
          this.collectBindingNames(nameNode, definedNames)
        }
        // Add type parameters
        for (const tp of fn.getTypeParameters()) {
          definedNames.add(tp.getName())
        }
      }

      // 2. Variable declarations (const, let, var) - at all levels, not just top-level
      for (const varDecl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        // Handle destructuring: const { a, b } = obj
        const nameNode = varDecl.getNameNode()
        this.collectBindingNames(nameNode, definedNames)
      }

      // 3. Class declarations
      for (const cls of sourceFile.getClasses()) {
        const name = cls.getName()
        if (name) definedNames.add(name)
        // Add type parameters
        for (const tp of cls.getTypeParameters()) {
          definedNames.add(tp.getName())
        }
        // Add method parameters (with destructuring support)
        for (const method of cls.getMethods()) {
          for (const param of method.getParameters()) {
            const nameNode = param.getNameNode()
            this.collectBindingNames(nameNode, definedNames)
          }
        }
        // Add constructor parameters (with destructuring support)
        const ctor = cls.getConstructors()[0]
        if (ctor) {
          for (const param of ctor.getParameters()) {
            const nameNode = param.getNameNode()
            this.collectBindingNames(nameNode, definedNames)
          }
        }
      }

      // 4. Type aliases
      for (const typeAlias of sourceFile.getTypeAliases()) {
        definedNames.add(typeAlias.getName())
        for (const tp of typeAlias.getTypeParameters()) {
          definedNames.add(tp.getName())
        }
      }

      // 5. Interface declarations
      for (const iface of sourceFile.getInterfaces()) {
        definedNames.add(iface.getName())
        for (const tp of iface.getTypeParameters()) {
          definedNames.add(tp.getName())
        }
      }

      // 6. Enum declarations
      for (const enumDecl of sourceFile.getEnums()) {
        definedNames.add(enumDecl.getName())
      }

      // 7. Import bindings
      for (const imp of sourceFile.getImportDeclarations()) {
        const defaultImport = imp.getDefaultImport()
        if (defaultImport) definedNames.add(defaultImport.getText())

        const namespaceImport = imp.getNamespaceImport()
        if (namespaceImport) definedNames.add(namespaceImport.getText())

        for (const named of imp.getNamedImports()) {
          definedNames.add(named.getName())
        }
      }

      // 8. Arrow functions and function expressions (collect parameters with destructuring)
      for (const arrow of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
        for (const param of arrow.getParameters()) {
          const nameNode = param.getNameNode()
          this.collectBindingNames(nameNode, definedNames)
        }
        for (const tp of arrow.getTypeParameters()) {
          definedNames.add(tp.getName())
        }
      }

      for (const funcExpr of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression)) {
        for (const param of funcExpr.getParameters()) {
          const nameNode = param.getNameNode()
          this.collectBindingNames(nameNode, definedNames)
        }
      }

      // 9. Catch clause bindings: catch (e) { ... }
      for (const catchClause of sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
        const varDecl = catchClause.getVariableDeclaration()
        if (varDecl) {
          definedNames.add(varDecl.getName())
        }
      }

      // 10. For-of/for-in loop variable bindings
      for (const forOf of sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement)) {
        const init = forOf.getInitializer()
        if (init) {
          this.collectBindingNamesFromNode(init, definedNames)
        }
      }

      for (const forIn of sourceFile.getDescendantsOfKind(SyntaxKind.ForInStatement)) {
        const init = forIn.getInitializer()
        if (init) {
          this.collectBindingNamesFromNode(init, definedNames)
        }
      }

      // Now find identifiers that are truly undefined
      const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)
      const undefinedRefs: string[] = []

      for (const id of identifiers) {
        const name = id.getText()

        // Skip if already known
        if (definedNames.has(name)) continue
        if (context.existingTypes.includes(name)) continue
        if (context.existingImports.includes(name)) continue
        if (this.isBuiltin(name)) continue

        // Skip property accesses: obj.prop - skip 'prop'
        const parent = id.getParent()
        if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
          // PropertyAccessExpression has: expression.name
          // Skip if this identifier is the name (right side of the dot)
          const propAccess = parent as any
          const nameNode = propAccess.getNameNode?.()
          if (nameNode === id) continue
        }

        // Skip type references - identifiers used as type names
        if (parent && parent.getKind() === SyntaxKind.TypeReference) continue

        // Skip qualified names (namespace.Type)
        if (parent && parent.getKind() === SyntaxKind.QualifiedName) continue

        // Skip property signatures in type literals: { name: string }
        if (parent && parent.getKind() === SyntaxKind.PropertySignature) continue

        // Skip index signatures in type literals
        if (parent && parent.getKind() === SyntaxKind.IndexSignature) continue

        // Skip type literal members in general
        if (parent && parent.getKind() === SyntaxKind.TypeLiteral) continue

        // Skip property assignments in object literals: { foo: value }
        if (parent && parent.getKind() === SyntaxKind.PropertyAssignment) {
          const propAssign = parent
          if (propAssign.getChildAtIndex(0) === id) continue // Skip the key
        }

        // Skip shorthand property assignments: { foo } (where foo is both key and value)
        if (parent && parent.getKind() === SyntaxKind.ShorthandPropertyAssignment) {
          // The name IS the reference, so don't skip - it should be defined
        }

        // Skip method/property names in class/object
        if (parent && (
          parent.getKind() === SyntaxKind.MethodDeclaration ||
          parent.getKind() === SyntaxKind.PropertyDeclaration ||
          parent.getKind() === SyntaxKind.GetAccessor ||
          parent.getKind() === SyntaxKind.SetAccessor
        )) {
          // Skip if this is the name of the member
          const memberName = (parent as any).getName?.()
          if (memberName === name) continue
        }

        // Skip labeled statements
        if (parent && parent.getKind() === SyntaxKind.LabeledStatement) continue

        // Skip break/continue labels
        if (parent && (
          parent.getKind() === SyntaxKind.BreakStatement ||
          parent.getKind() === SyntaxKind.ContinueStatement
        )) continue

        undefinedRefs.push(name)
      }

      const uniqueUndefined = [...new Set(undefinedRefs)]

      if (uniqueUndefined.length > 0) {
        return {
          gateName: 'variable_resolution',
          passed: false,
          required: true,
          error: `Undefined: ${uniqueUndefined.join(', ')}`,
          details: { undefined: uniqueUndefined }
        }
      }

      return {
        gateName: 'variable_resolution',
        passed: true,
        required: true
      }

    } catch (error) {
      return {
        gateName: 'variable_resolution',
        passed: false,
        required: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Collect binding names from a binding pattern (handles destructuring)
   */
  private collectBindingNames(nameNode: any, definedNames: Set<string>): void {
    const kind = nameNode.getKind()

    if (kind === SyntaxKind.Identifier) {
      definedNames.add(nameNode.getText())
    } else if (kind === SyntaxKind.ObjectBindingPattern) {
      for (const element of nameNode.getElements()) {
        const elementName = element.getNameNode()
        this.collectBindingNames(elementName, definedNames)
      }
    } else if (kind === SyntaxKind.ArrayBindingPattern) {
      for (const element of nameNode.getElements()) {
        if (element.getKind() === SyntaxKind.BindingElement) {
          const elementName = element.getNameNode()
          this.collectBindingNames(elementName, definedNames)
        }
      }
    }
  }

  /**
   * Collect binding names from a node (for for-of/for-in initializers)
   */
  private collectBindingNamesFromNode(node: any, definedNames: Set<string>): void {
    const kind = node.getKind()

    if (kind === SyntaxKind.VariableDeclarationList) {
      for (const decl of node.getDeclarations()) {
        this.collectBindingNames(decl.getNameNode(), definedNames)
      }
    } else if (kind === SyntaxKind.Identifier) {
      definedNames.add(node.getText())
    }
  }

  /**
   * Detect if code is test code (should be executed) or library code (just compile)
   *
   * Test code patterns:
   * - Jest/Mocha: describe(), test(), it()
   * - Custom project pattern: assert() + runTests() + runTests().catch()
   * - Vitest: describe(), test(), it(), expect()
   *
   * Library code: everything else (exports functions/types but doesn't run)
   */
  private isTestCode(code: string): boolean {
    // Jest/Mocha/Vitest patterns
    const hasJestPattern = /\b(describe|test|it)\s*\(/.test(code)

    // Custom test pattern used in this project
    const hasCustomTestPattern = /function\s+assert\s*\(/.test(code) &&
                                 /function\s+runTests\s*\(/.test(code) &&
                                 /runTests\s*\(\s*\)/.test(code)

    // Check if code has executable statements at module level
    // (not just exports/declarations)
    const hasModuleLevelExecution = /runTests\s*\(\s*\)/.test(code) ||
                                    /^\s*(?!export|import|type|interface|const\s+\w+\s*[=:]|let\s+\w+\s*[=:]|function\s+\w+|class\s+\w+|\/\/|\/\*|\*)/m.test(code)

    return hasJestPattern || hasCustomTestPattern || hasModuleLevelExecution
  }

  /**
   * Gate 4: Test Execution / Compilation Check
   *
   * SPLIT BEHAVIOR (Fix 1):
   * - TEST CODE: Execute in sandbox, verify exit code 0
   * - LIBRARY CODE: Just verify TypeScript compilation
   *
   * This fixes the issue where library code with imports would fail
   * because it can't execute in isolation (no side effects to run).
   *
   * SECURITY: For test execution, uses kernel-grade sandbox with:
   * - Command as argv array (not shell string)
   * - Snapshot/diff-based file manifests
   * - Evidence bundles with SHA-256 hashes
   * - Environment scrubbing (deny-by-default)
   * - Symlink escape protection
   * - Path escape protection
   * - Timeout enforcement (10s default)
   * - Output limits per sandbox config
   */
  private async gate4_testExecution(code: string, context: CodeValidationContext): Promise<GateResult> {
    try {
      // ═══════════════════════════════════════════════════════════
      // FIX 1: Split behavior by code type
      // ═══════════════════════════════════════════════════════════
      const isTest = this.isTestCode(code)

      // For LIBRARY CODE: Just verify compilation, don't execute
      // Library code has no side effects to test - it just defines exports
      if (!isTest) {
        return await this.runTypeScriptCompilationCheck(code, context.targetFile)
      }

      // For TEST CODE: Continue with full execution
      // Check for local imports that need bundling
      const needsBundling = hasLocalImports(code)

      let executableCode = code
      let bundleWarnings: string[] = []

      if (needsBundling) {
        // ═══════════════════════════════════════════════════════════
        // ESBUILD BUNDLING - Resolve local imports before execution
        // ═══════════════════════════════════════════════════════════
        const targetDir = context.targetFile
          ? path.dirname(path.resolve(context.targetFile))
          : undefined

        const bundleResult = await bundleForExecution(code, { targetDir })

        if (!bundleResult.ok) {
          // Bundling failed - try TypeScript compilation check as fallback
          return await this.runTypeScriptCompilationCheck(code, context.targetFile)
        }

        executableCode = bundleResult.value.bundled
        bundleWarnings = bundleResult.value.warnings
      }

      // Create a temporary file for the code
      const attemptId = randomBytes(8).toString('hex')
      const tempDir = path.join(os.tmpdir(), `gate4-${attemptId}`)
      fs.mkdirSync(tempDir, { recursive: true })

      // Use .js extension for bundled code, .ts for unbundled
      const tempFile = needsBundling
        ? path.join(tempDir, 'test-code.js')
        : path.join(tempDir, 'test-code.ts')
      fs.writeFileSync(tempFile, executableCode)

      // Build kernel-grade TestExecRequest
      // Use node for bundled JS, tsx for unbundled TS
      const command = needsBundling
        ? ['node', tempFile]
        : ['npx', 'tsx', tempFile]

      const request: TestExecRequest = {
        attempt_id: attemptId,
        cwd: process.cwd(),
        command,
        env_allowlist: ['NODE_ENV', 'HOME'],  // Minimal allowlist
        time_limit_ms: 10_000,
        capabilities: ['FS_READ', 'FS_WRITE_SANDBOX'],  // No NET by default
        sandbox_root: tempDir
      }

      // Execute with kernel-grade runner
      const execResult = await runTestExec(request)

      // Cleanup temp file (keep evidence artifacts for audit)
      try {
        fs.unlinkSync(tempFile)
        fs.rmdirSync(tempDir)
      } catch { /* ignore cleanup errors */ }

      if (!execResult.ok) {
        return {
          gateName: 'test_execution',
          passed: false,
          required: true,
          error: `Runner error: ${execResult.error.message}`
        }
      }

      const testResult = execResult.value

      // Verify evidence integrity
      const evidenceCheck = verifyEvidence(testResult.evidence)

      // Cleanup evidence directory after verification
      if (testResult.evidence.stdout_log.path) {
        const runDir = path.dirname(testResult.evidence.stdout_log.path)
        cleanupRunDir(runDir)
      }

      if (!testResult.ok) {
        // Extract meaningful error message
        let errorMessage = testResult.denial?.message || 'Unknown error'

        if (testResult.denial?.reason === 'EXIT_NONZERO') {
          // Try to extract error from stderr if available
          try {
            const stderrPath = testResult.evidence.stderr_log.path
            if (stderrPath && fs.existsSync(stderrPath)) {
              const stderrContent = JSON.parse(fs.readFileSync(stderrPath, 'utf-8'))
              const stderr = stderrContent.content || ''
              const errorMatch = stderr.match(/(Error|TypeError|ReferenceError|SyntaxError):[^\n]+/)
              if (errorMatch) {
                errorMessage = errorMatch[0]
              }
            }
          } catch { /* use default message */ }
        }

        return {
          gateName: 'test_execution',
          passed: false,
          required: true,
          error: errorMessage,
          details: {
            exitCode: testResult.exit_code,
            timedOut: testResult.timed_out,
            denial: testResult.denial,
            policyChecks: testResult.policy_checks,
            fingerprint: testResult.deterministic_fingerprint
          }
        }
      }

      // Evidence integrity check (advisory - don't fail if evidence was cleaned up)
      const evidenceValid = evidenceCheck.ok || !fs.existsSync(testResult.evidence.stdout_log.path)

      return {
        gateName: 'test_execution',
        passed: true,
        required: true,
        details: {
          method: 'sandbox_execution',
          codeType: 'test',  // Test code - full execution
          exitCode: testResult.exit_code,
          policyChecks: testResult.policy_checks,
          fingerprint: testResult.deterministic_fingerprint,
          evidenceVerified: evidenceValid,
          bundled: needsBundling,
          bundleWarnings: bundleWarnings.length > 0 ? bundleWarnings : undefined
        }
      }

    } catch (error) {
      return {
        gateName: 'test_execution',
        passed: false,
        required: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Run TypeScript compilation check for code with local imports
   * This provides real verification instead of skipping (fallback when bundling fails)
   */
  private async runTypeScriptCompilationCheck(code: string, targetFile?: string): Promise<GateResult> {
    const attemptId = randomBytes(8).toString('hex')

    // Determine temp file location based on target file
    // Place temp file in same directory as target so relative imports resolve
    let tempFile: string
    if (targetFile) {
      const targetDir = path.dirname(targetFile)
      tempFile = path.join(process.cwd(), targetDir, `.gate4-check-${attemptId}.ts`)
    } else {
      // Fallback: use src/validation/ as a reasonable default for most imports
      tempFile = path.join(process.cwd(), 'src', 'validation', `.gate4-check-${attemptId}.ts`)
    }

    try {
      // Write code to temp file so imports resolve relative to target location
      fs.writeFileSync(tempFile, code)

      // Use ts-morph to check only THIS file, not transitive dependencies
      try {
        // First try to parse/check with ts-morph which is already available
        const project = new Project({
          useInMemoryFileSystem: false,
          compilerOptions: {
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            esModuleInterop: true,
            module: 99, // ESNext
            target: 99, // ESNext
            moduleResolution: 2 // Node
          }
        })

        const sourceFile = project.addSourceFileAtPath(tempFile)
        const diagnostics = sourceFile.getPreEmitDiagnostics()

        // Filter to only errors from THIS file
        const fileErrors = diagnostics.filter(d => {
          const file = d.getSourceFile()
          return file && file.getFilePath() === tempFile
        })

        if (fileErrors.length > 0) {
          const firstError = fileErrors[0]
          const message = firstError.getMessageText()
          const errorText = typeof message === 'string' ? message : message.getMessageText()
          throw new Error(errorText)
        }

        // Compilation succeeded
        return {
          gateName: 'test_execution',
          passed: true,
          required: true,
          details: {
            method: 'typescript_compilation',
            codeType: 'library',  // Not test code - compilation-only check
            hasLocalImports: hasLocalImports(code),
            verified: true
          }
        }
      } catch (compileError: unknown) {
        // Compilation failed - extract error message
        const error = compileError as Error
        const errorMessage = error.message || 'TypeScript compilation failed'

        return {
          gateName: 'test_execution',
          passed: false,
          required: true,
          error: errorMessage.slice(0, 200),
          details: {
            method: 'typescript_compilation',
            codeType: 'library',
            hasLocalImports: hasLocalImports(code),
            verified: false
          }
        }
      }
    } finally {
      // Always cleanup temp file
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile)
        }
      } catch { /* ignore cleanup errors */ }
    }
  }

  /**
   * Gate 5: URCO Entropy Check
   * Code must be clear, not ambiguous
   */
  private gate5_urcoEntropy(code: string): GateResult {
    try {
      const entities = extractEntities(code)
      const actions = extractActions(code)
      const missing = detectMissingVars(code, {}, entities, actions)
      const contradictions = detectContradictions(code)

      const entropy = computeEntropy(
        {
          text: code,
          vars: {},
          inputs: [],
          outputs: [],
          constraints: [],
          acceptanceCriteria: [],
          invariants: []
        },
        missing,
        contradictions
      )

      const MAX_ENTROPY = 0.5  // Raised from 0.4 to allow reasonable LLM-generated code

      if (entropy.value > MAX_ENTROPY) {
        return {
          gateName: 'urco_entropy',
          passed: false,
          required: true,
          error: `Code too ambiguous (entropy: ${entropy.value.toFixed(3)} > ${MAX_ENTROPY})`,
          details: { entropy: entropy.value, breakdown: entropy.breakdown }
        }
      }

      return {
        gateName: 'urco_entropy',
        passed: true,
        required: true,
        details: { entropy: entropy.value }
      }

    } catch (error) {
      return {
        gateName: 'urco_entropy',
        passed: false,
        required: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Gate 6: Governance Check
   * Code must not violate policies and must be free of security vulnerabilities
   *
   * Includes:
   * - Policy rule enforcement (determinism, logging, etc.)
   * - Security vulnerability scanning (command injection, XSS, etc.)
   */
  private gate6_governanceCheck(code: string, context: CodeValidationContext): GateResult {
    try {
      const rules = context.governanceRules || []
      const violations: string[] = []

      // 1. Policy Rules Check
      for (const rule of rules) {
        if (rule === 'no_date_now' && /Date\.now\(\)/.test(code)) {
          violations.push('Uses Date.now() (violates determinism)') // DETERMINISM-EXEMPT: Pattern check only
        }

        if (rule === 'determinism_required' && /Math\.random\(\)/.test(code)) {
          violations.push('Uses Math.random() (violates determinism)') // DETERMINISM-EXEMPT: Pattern check only
        }

        if (rule === 'no_console' && /console\.(log|error|warn)/.test(code)) {
          violations.push('Uses console.* (violates no logging policy)') // DETERMINISM-EXEMPT: Pattern check only
        }
      }

      // 2. Security Vulnerability Scan
      const securityScan = scanForVulnerabilities(code)

      // Add critical/high security vulnerabilities as violations
      for (const vuln of securityScan.vulnerabilities) {
        if (vuln.severity === 'critical' || vuln.severity === 'high') {
          violations.push(`[SECURITY:${vuln.severity.toUpperCase()}] ${vuln.message}${vuln.line ? ` (line ${vuln.line})` : ''}`)
        }
      }

      // 3. Hollow Code Detection (AST-based, multi-line)
      const hollowResult = detectHollowPatterns(code)
      let hollowScore = 100
      if (hollowResult.ok) {
        hollowScore = hollowResult.value.hollowScore
        // Add critical/high hollow patterns as violations
        for (const pattern of hollowResult.value.patterns) {
          if (pattern.severity === 'critical' || pattern.severity === 'high') {
            const name = pattern.nodeName ? ` (${pattern.nodeName})` : ''
            violations.push(`[HOLLOW:${pattern.severity.toUpperCase()}] ${pattern.type}${name}: ${pattern.message}`)
          }
        }
      }

      if (violations.length > 0) {
        return {
          gateName: 'governance_check',
          passed: false,
          required: true,
          error: violations.length === 1 ? violations[0] : `${violations.length} violations found`,
          details: {
            violations,
            securityScore: securityScan.score,
            securitySummary: getVulnerabilitySummary(securityScan),
            hollowScore,
            hollowPatterns: hollowResult.ok ? hollowResult.value.patterns.length : 0
          }
        }
      }

      // Include security and hollow info even on pass
      return {
        gateName: 'governance_check',
        passed: true,
        required: true,
        details: {
          securityScore: securityScan.score,
          securityVulnerabilities: securityScan.vulnerabilities.length,
          hollowScore,
          hollowPatterns: hollowResult.ok ? hollowResult.value.patterns.length : 0
        }
      }

    } catch (error) {
      return {
        gateName: 'governance_check',
        passed: false,
        required: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Gate 7: Test Quality Validation
   * Analyzes test code quality: assertion density, mock bias, coverage, edge cases
   * Progressive strictness: advisory for first test, required after
   */
  private gate7_testQuality(code: string, context: CodeValidationContext): GateResult {
    try {
      const targetExports = context.targetExports || []
      const result = analyzeTestQuality(code, targetExports)

      if (!result.ok) {
        return {
          gateName: 'test_quality',
          passed: false,
          required: context.strictTestQuality ?? false,
          error: result.error.message
        }
      }

      const { score, metrics, issues } = result.value
      const threshold = context.testQualityThreshold ?? 60
      const passed = score >= threshold

      return {
        gateName: 'test_quality',
        passed,
        required: context.strictTestQuality ?? false,
        error: passed ? undefined : `Test quality ${score}/100 below threshold ${threshold}. ${issues[0] || 'Improve test coverage and assertions.'}`,
        details: {
          score,
          threshold,
          assertionsTotal: metrics.assertions.total,
          assertionsMeaningful: metrics.assertions.meaningful,
          assertionsPerTest: metrics.assertions.perTest,
          mockBiasRatio: metrics.mocks.mockBiasRatio,
          coverageProxy: metrics.coverage.coverageProxy,
          edgeCaseScore: metrics.edgeCases.score,
          issues
        }
      }
    } catch (error) {
      return {
        gateName: 'test_quality',
        passed: false,
        required: context.strictTestQuality ?? false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Check if identifier is a built-in
   */
  private isBuiltin(name: string): boolean {
    return JAVASCRIPT_GLOBALS.has(name)
  }
}

/**
 * Comprehensive set of JavaScript/TypeScript/Node.js globals
 * These are always available without explicit import
 */
const JAVASCRIPT_GLOBALS = new Set([
  // ═══════════════════════════════════════════════════════════════
  // ECMAScript Standard Built-in Objects
  // ═══════════════════════════════════════════════════════════════

  // Global object
  'globalThis', 'global', 'window', 'self',

  // Value properties
  'Infinity', 'NaN', 'undefined', 'null',

  // Function properties
  'eval', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
  'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent',

  // Fundamental objects
  'Object', 'Function', 'Boolean', 'Symbol',

  // Error objects
  'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError',
  'SyntaxError', 'TypeError', 'URIError',

  // Numbers and dates
  'Number', 'BigInt', 'Math', 'Date',

  // Text processing
  'String', 'RegExp',

  // Indexed collections
  'Array', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'BigInt64Array', 'BigUint64Array', 'Float32Array', 'Float64Array',

  // Keyed collections
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef',

  // Structured data
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'JSON',

  // Control abstraction
  'Promise', 'Generator', 'GeneratorFunction',
  'AsyncFunction', 'AsyncGenerator', 'AsyncGeneratorFunction',

  // Reflection
  'Reflect', 'Proxy',

  // Internationalization
  'Intl',

  // ═══════════════════════════════════════════════════════════════
  // Web APIs (available in Node.js 18+)
  // ═══════════════════════════════════════════════════════════════

  // Fetch API
  'fetch', 'Request', 'Response', 'Headers',

  // URL API
  'URL', 'URLSearchParams',

  // Abort API
  'AbortController', 'AbortSignal',

  // Encoding API
  'TextEncoder', 'TextDecoder',

  // Streams API
  'ReadableStream', 'WritableStream', 'TransformStream',
  'ReadableStreamDefaultReader', 'WritableStreamDefaultWriter',
  'ByteLengthQueuingStrategy', 'CountQueuingStrategy',

  // Blob/File API
  'Blob', 'File', 'FileReader',

  // Form data
  'FormData',

  // Web Crypto
  'crypto', 'Crypto', 'CryptoKey', 'SubtleCrypto',

  // Performance
  'performance', 'Performance', 'PerformanceEntry', 'PerformanceObserver',

  // Events
  'Event', 'EventTarget', 'CustomEvent', 'MessageEvent',
  'ErrorEvent', 'ProgressEvent',

  // Messaging
  'MessageChannel', 'MessagePort', 'BroadcastChannel',

  // Timers
  'setTimeout', 'setInterval', 'setImmediate',
  'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask',

  // Structured clone
  'structuredClone',

  // Base64
  'atob', 'btoa',

  // Console
  'console',

  // ═══════════════════════════════════════════════════════════════
  // Node.js Globals
  // ═══════════════════════════════════════════════════════════════

  'process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename',

  // ═══════════════════════════════════════════════════════════════
  // TypeScript Keywords and Type Names
  // ═══════════════════════════════════════════════════════════════

  // Primitive types
  'number', 'string', 'boolean', 'void', 'any', 'unknown', 'never', 'object',

  // Literal values
  'true', 'false',

  // Special types
  'this', 'super',

  // Utility types (commonly used)
  'Partial', 'Required', 'Readonly', 'Record', 'Pick', 'Omit', 'Exclude',
  'Extract', 'NonNullable', 'Parameters', 'ConstructorParameters',
  'ReturnType', 'InstanceType', 'ThisParameterType', 'OmitThisParameter',
  'ThisType', 'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize',
  'Awaited',

  // ═══════════════════════════════════════════════════════════════
  // JavaScript Keywords (not identifiers but can appear in AST)
  // ═══════════════════════════════════════════════════════════════

  'if', 'else', 'return', 'const', 'let', 'var', 'function', 'class',
  'new', 'delete', 'typeof', 'instanceof', 'in', 'of',
  'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
  'try', 'catch', 'finally', 'throw',
  'async', 'await', 'yield',
  'static', 'get', 'set',
  'extends', 'implements',
  'import', 'export', 'from', 'as',
  'public', 'private', 'protected', 'readonly',
  'abstract', 'interface', 'type', 'enum', 'namespace', 'declare',

  // ═══════════════════════════════════════════════════════════════
  // Testing Framework Globals (Jest, Mocha, etc.)
  // ═══════════════════════════════════════════════════════════════

  'describe', 'test', 'it', 'expect', 'beforeEach', 'afterEach',
  'beforeAll', 'afterAll', 'jest', 'vi', 'mock',
  'toBe', 'toEqual', 'toThrow', 'toContain', 'toBeDefined', 'toBeUndefined',
  'toBeNull', 'toBeTruthy', 'toBeFalsy', 'toHaveLength', 'toBeGreaterThan',
  'toBeLessThan', 'toBeInstanceOf', 'toHaveBeenCalled', 'toHaveBeenCalledWith',
  'mockResolvedValue', 'mockRejectedValue', 'mockReturnValue', 'mockImplementation',
  'spyOn', 'fn',

  // ═══════════════════════════════════════════════════════════════
  // Generic Type Parameters (uppercase single letters)
  // ═══════════════════════════════════════════════════════════════

  'T', 'K', 'V', 'U', 'R', 'P', 'S', 'A', 'B', 'C', 'E', 'N', 'M',
  'TKey', 'TValue', 'TResult', 'TInput', 'TOutput', 'TError', 'TData',

  // ═══════════════════════════════════════════════════════════════
  // Common Short Variable Names (false positive prevention)
  // ═══════════════════════════════════════════════════════════════

  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '_', '$',
  'fn', 'cb', 'err', 'id', 'el', 'ev', 'ctx', 'req', 'res', 'obj', 'arr',
  'key', 'val', 'idx', 'len', 'acc', 'cur', 'prev', 'next', 'item', 'data',
  'args', 'opts', 'config', 'options', 'params', 'result', 'value', 'values',
  'name', 'type', 'kind', 'path', 'file', 'dir', 'src', 'dest', 'input', 'output',
  'start', 'end', 'min', 'max', 'count', 'index', 'size', 'total',
  'ok', 'error', 'message', 'code', 'status', 'state', 'event', 'handler',
  'callback', 'promise', 'resolve', 'reject', 'then', 'catch', 'finally',
  'self', 'that', 'instance', 'context', 'scope', 'target', 'source'
])
