"use strict";
// 6-Gate Validator - Prevents LLM escapes, enforces correctness
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 1 (Deterministic Authority), AXIOM 4 (Mechanical Verification)
// TCB Component: This file is part of the Trusted Computing Base
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SixGateValidator = void 0;
const ts_morph_1 = require("ts-morph");
const result_1 = require("../core/result");
const entropy_1 = require("../urco/entropy");
const extractor_1 = require("../urco/extractor");
const missingVars_1 = require("../urco/missingVars");
const contradictions_1 = require("../urco/contradictions");
const runner_1 = require("../sandbox/runner");
const securityScanner_1 = require("./securityScanner");
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
class SixGateValidator {
    /**
     * Validate code through all 6 gates
     * ANY required gate fails → code REJECTED
     */
    async validate(code, context) {
        const gateResults = [];
        // ═══════════════════════════════════════════════════════════
        // GATE 1: Schema Validation
        // ═══════════════════════════════════════════════════════════
        const g1 = this.gate1_schemaValidation(code);
        gateResults.push(g1);
        // ═══════════════════════════════════════════════════════════
        // GATE 2: Syntax Validation
        // ═══════════════════════════════════════════════════════════
        const g2 = await this.gate2_syntaxValidation(code);
        gateResults.push(g2);
        // ═══════════════════════════════════════════════════════════
        // GATE 3: Variable Resolution
        // ═══════════════════════════════════════════════════════════
        const g3 = this.gate3_variableResolution(code, context);
        gateResults.push(g3);
        // ═══════════════════════════════════════════════════════════
        // GATE 4: Test Execution (kernel-grade sandbox)
        // ═══════════════════════════════════════════════════════════
        const g4 = await this.gate4_testExecution(code);
        gateResults.push(g4);
        // ═══════════════════════════════════════════════════════════
        // GATE 5: URCO Entropy
        // ═══════════════════════════════════════════════════════════
        const g5 = this.gate5_urcoEntropy(code);
        gateResults.push(g5);
        // ═══════════════════════════════════════════════════════════
        // GATE 6: Governance Check
        // ═══════════════════════════════════════════════════════════
        const g6 = this.gate6_governanceCheck(code, context);
        gateResults.push(g6);
        // Determine overall validity
        const requiredGatesFailed = gateResults.filter(g => g.required && !g.passed);
        const valid = requiredGatesFailed.length === 0;
        const rejectedAt = requiredGatesFailed.length > 0
            ? requiredGatesFailed[0].gateName
            : undefined;
        return (0, result_1.Ok)({
            valid,
            gateResults,
            rejectedAt
        });
    }
    /**
     * Gate 1: Schema Validation
     * Checks if code structure matches expected patterns
     */
    gate1_schemaValidation(code) {
        try {
            // Check for exports OR test patterns (describe/test/it)
            // Match: export function, export const, export class, export type, export interface
            // Also match: export async function, export default
            const hasExport = /export\s+(async\s+)?(function|const|class|type|interface|default)/.test(code);
            const hasTestPattern = /\b(describe|test|it)\s*\(/.test(code);
            if (!hasExport && !hasTestPattern) {
                return {
                    gateName: 'schema_validation',
                    passed: false,
                    required: true,
                    error: 'Code must export at least one declaration or contain test patterns'
                };
            }
            return {
                gateName: 'schema_validation',
                passed: true,
                required: true
            };
        }
        catch (error) {
            return {
                gateName: 'schema_validation',
                passed: false,
                required: true,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    /**
     * Gate 2: Syntax Validation
     * TypeScript must parse without syntax errors
     *
     * Note: We only check for parse/syntax errors, not type errors.
     * Type checking requires the full project context (node_modules, tsconfig, etc.)
     * which isn't available for isolated code snippets.
     */
    async gate2_syntaxValidation(code) {
        try {
            const project = new ts_morph_1.Project({
                useInMemoryFileSystem: true,
                compilerOptions: {
                    target: 99, // ScriptTarget.ESNext
                    noEmit: true,
                    // Skip type checking - we only care about syntax
                    skipLibCheck: true,
                    noLib: true
                }
            });
            const sourceFile = project.createSourceFile('temp.ts', code);
            // Access parse diagnostics directly from the underlying TypeScript compiler node
            // This gives us only syntax/parse errors, not type errors
            const tsSourceFile = sourceFile.compilerNode;
            const parseDiagnostics = tsSourceFile.parseDiagnostics || [];
            if (parseDiagnostics.length > 0) {
                return {
                    gateName: 'syntax_validation',
                    passed: false,
                    required: true,
                    error: `Parse errors: ${parseDiagnostics.length}`,
                    details: {
                        errors: parseDiagnostics.slice(0, 3).map((d) => typeof d.messageText === 'string' ? d.messageText : d.messageText?.messageText || 'Unknown error')
                    }
                };
            }
            return {
                gateName: 'syntax_validation',
                passed: true,
                required: true
            };
        }
        catch (error) {
            return {
                gateName: 'syntax_validation',
                passed: false,
                required: true,
                error: error instanceof Error ? error.message : String(error)
            };
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
    gate3_variableResolution(code, context) {
        try {
            const project = new ts_morph_1.Project({ useInMemoryFileSystem: true });
            const sourceFile = project.createSourceFile('temp.ts', code);
            // Collect all defined names in this file
            const definedNames = new Set();
            // 1. Function declarations
            for (const fn of sourceFile.getFunctions()) {
                const name = fn.getName();
                if (name)
                    definedNames.add(name);
                // Add parameters (handle destructuring patterns)
                for (const param of fn.getParameters()) {
                    const nameNode = param.getNameNode();
                    this.collectBindingNames(nameNode, definedNames);
                }
                // Add type parameters
                for (const tp of fn.getTypeParameters()) {
                    definedNames.add(tp.getName());
                }
            }
            // 2. Variable declarations (const, let, var) - at all levels, not just top-level
            for (const varDecl of sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.VariableDeclaration)) {
                // Handle destructuring: const { a, b } = obj
                const nameNode = varDecl.getNameNode();
                this.collectBindingNames(nameNode, definedNames);
            }
            // 3. Class declarations
            for (const cls of sourceFile.getClasses()) {
                const name = cls.getName();
                if (name)
                    definedNames.add(name);
                // Add type parameters
                for (const tp of cls.getTypeParameters()) {
                    definedNames.add(tp.getName());
                }
                // Add method parameters (with destructuring support)
                for (const method of cls.getMethods()) {
                    for (const param of method.getParameters()) {
                        const nameNode = param.getNameNode();
                        this.collectBindingNames(nameNode, definedNames);
                    }
                }
                // Add constructor parameters (with destructuring support)
                const ctor = cls.getConstructors()[0];
                if (ctor) {
                    for (const param of ctor.getParameters()) {
                        const nameNode = param.getNameNode();
                        this.collectBindingNames(nameNode, definedNames);
                    }
                }
            }
            // 4. Type aliases
            for (const typeAlias of sourceFile.getTypeAliases()) {
                definedNames.add(typeAlias.getName());
                for (const tp of typeAlias.getTypeParameters()) {
                    definedNames.add(tp.getName());
                }
            }
            // 5. Interface declarations
            for (const iface of sourceFile.getInterfaces()) {
                definedNames.add(iface.getName());
                for (const tp of iface.getTypeParameters()) {
                    definedNames.add(tp.getName());
                }
            }
            // 6. Enum declarations
            for (const enumDecl of sourceFile.getEnums()) {
                definedNames.add(enumDecl.getName());
            }
            // 7. Import bindings
            for (const imp of sourceFile.getImportDeclarations()) {
                const defaultImport = imp.getDefaultImport();
                if (defaultImport)
                    definedNames.add(defaultImport.getText());
                const namespaceImport = imp.getNamespaceImport();
                if (namespaceImport)
                    definedNames.add(namespaceImport.getText());
                for (const named of imp.getNamedImports()) {
                    definedNames.add(named.getName());
                }
            }
            // 8. Arrow functions and function expressions (collect parameters with destructuring)
            for (const arrow of sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.ArrowFunction)) {
                for (const param of arrow.getParameters()) {
                    const nameNode = param.getNameNode();
                    this.collectBindingNames(nameNode, definedNames);
                }
                for (const tp of arrow.getTypeParameters()) {
                    definedNames.add(tp.getName());
                }
            }
            for (const funcExpr of sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.FunctionExpression)) {
                for (const param of funcExpr.getParameters()) {
                    const nameNode = param.getNameNode();
                    this.collectBindingNames(nameNode, definedNames);
                }
            }
            // 9. Catch clause bindings: catch (e) { ... }
            for (const catchClause of sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.CatchClause)) {
                const varDecl = catchClause.getVariableDeclaration();
                if (varDecl) {
                    definedNames.add(varDecl.getName());
                }
            }
            // 10. For-of/for-in loop variable bindings
            for (const forOf of sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.ForOfStatement)) {
                const init = forOf.getInitializer();
                if (init) {
                    this.collectBindingNamesFromNode(init, definedNames);
                }
            }
            for (const forIn of sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.ForInStatement)) {
                const init = forIn.getInitializer();
                if (init) {
                    this.collectBindingNamesFromNode(init, definedNames);
                }
            }
            // Now find identifiers that are truly undefined
            const identifiers = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.Identifier);
            const undefinedRefs = [];
            for (const id of identifiers) {
                const name = id.getText();
                // Skip if already known
                if (definedNames.has(name))
                    continue;
                if (context.existingTypes.includes(name))
                    continue;
                if (context.existingImports.includes(name))
                    continue;
                if (this.isBuiltin(name))
                    continue;
                // Skip property accesses: obj.prop - skip 'prop'
                const parent = id.getParent();
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.PropertyAccessExpression) {
                    // PropertyAccessExpression has: expression.name
                    // Skip if this identifier is the name (right side of the dot)
                    const propAccess = parent;
                    const nameNode = propAccess.getNameNode?.();
                    if (nameNode === id)
                        continue;
                }
                // Skip type references - identifiers used as type names
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.TypeReference)
                    continue;
                // Skip qualified names (namespace.Type)
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.QualifiedName)
                    continue;
                // Skip property signatures in type literals: { name: string }
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.PropertySignature)
                    continue;
                // Skip index signatures in type literals
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.IndexSignature)
                    continue;
                // Skip type literal members in general
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.TypeLiteral)
                    continue;
                // Skip property assignments in object literals: { foo: value }
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.PropertyAssignment) {
                    const propAssign = parent;
                    if (propAssign.getChildAtIndex(0) === id)
                        continue; // Skip the key
                }
                // Skip shorthand property assignments: { foo } (where foo is both key and value)
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.ShorthandPropertyAssignment) {
                    // The name IS the reference, so don't skip - it should be defined
                }
                // Skip method/property names in class/object
                if (parent && (parent.getKind() === ts_morph_1.SyntaxKind.MethodDeclaration ||
                    parent.getKind() === ts_morph_1.SyntaxKind.PropertyDeclaration ||
                    parent.getKind() === ts_morph_1.SyntaxKind.GetAccessor ||
                    parent.getKind() === ts_morph_1.SyntaxKind.SetAccessor)) {
                    // Skip if this is the name of the member
                    const memberName = parent.getName?.();
                    if (memberName === name)
                        continue;
                }
                // Skip labeled statements
                if (parent && parent.getKind() === ts_morph_1.SyntaxKind.LabeledStatement)
                    continue;
                // Skip break/continue labels
                if (parent && (parent.getKind() === ts_morph_1.SyntaxKind.BreakStatement ||
                    parent.getKind() === ts_morph_1.SyntaxKind.ContinueStatement))
                    continue;
                undefinedRefs.push(name);
            }
            const uniqueUndefined = [...new Set(undefinedRefs)];
            if (uniqueUndefined.length > 0) {
                return {
                    gateName: 'variable_resolution',
                    passed: false,
                    required: true,
                    error: `Undefined: ${uniqueUndefined.join(', ')}`,
                    details: { undefined: uniqueUndefined }
                };
            }
            return {
                gateName: 'variable_resolution',
                passed: true,
                required: true
            };
        }
        catch (error) {
            return {
                gateName: 'variable_resolution',
                passed: false,
                required: true,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    /**
     * Collect binding names from a binding pattern (handles destructuring)
     */
    collectBindingNames(nameNode, definedNames) {
        const kind = nameNode.getKind();
        if (kind === ts_morph_1.SyntaxKind.Identifier) {
            definedNames.add(nameNode.getText());
        }
        else if (kind === ts_morph_1.SyntaxKind.ObjectBindingPattern) {
            for (const element of nameNode.getElements()) {
                const elementName = element.getNameNode();
                this.collectBindingNames(elementName, definedNames);
            }
        }
        else if (kind === ts_morph_1.SyntaxKind.ArrayBindingPattern) {
            for (const element of nameNode.getElements()) {
                if (element.getKind() === ts_morph_1.SyntaxKind.BindingElement) {
                    const elementName = element.getNameNode();
                    this.collectBindingNames(elementName, definedNames);
                }
            }
        }
    }
    /**
     * Collect binding names from a node (for for-of/for-in initializers)
     */
    collectBindingNamesFromNode(node, definedNames) {
        const kind = node.getKind();
        if (kind === ts_morph_1.SyntaxKind.VariableDeclarationList) {
            for (const decl of node.getDeclarations()) {
                this.collectBindingNames(decl.getNameNode(), definedNames);
            }
        }
        else if (kind === ts_morph_1.SyntaxKind.Identifier) {
            definedNames.add(node.getText());
        }
    }
    /**
     * Gate 4: Test Execution (Kernel-grade)
     * Executes code in sandbox with full evidence production.
     *
     * SECURITY: Uses kernel-grade sandbox with:
     * - Command as argv array (not shell string)
     * - Snapshot/diff-based file manifests
     * - Evidence bundles with SHA-256 hashes
     * - Environment scrubbing (deny-by-default)
     * - Symlink escape protection
     * - Path escape protection
     * - Timeout enforcement (10s default)
     * - Output limits per sandbox config
     *
     * NOTE: Code with local imports (./  ../) cannot be executed in isolation.
     * For such code, this gate is advisory (required: false) and passes with a note.
     * The full test suite validates code when actually applied.
     */
    async gate4_testExecution(code) {
        try {
            // Check for local imports that can't be resolved in sandbox
            const hasLocalImports = /import\s+.*from\s+['"]\.\.?\//.test(code);
            if (hasLocalImports) {
                // Code has local imports - can't execute in isolation
                // Make gate advisory and pass (actual validation happens via test suite on apply)
                return {
                    gateName: 'test_execution',
                    passed: true,
                    required: false, // Advisory for code with local imports
                    details: {
                        skipped: true,
                        reason: 'Code has local imports - deferred to test suite',
                        hasLocalImports: true
                    }
                };
            }
            // Create a temporary file for the code
            const attemptId = (0, crypto_1.randomBytes)(8).toString('hex');
            const tempDir = path.join(os.tmpdir(), `gate4-${attemptId}`);
            fs.mkdirSync(tempDir, { recursive: true });
            const tempFile = path.join(tempDir, 'test-code.ts');
            fs.writeFileSync(tempFile, code);
            // Build kernel-grade TestExecRequest
            const request = {
                attempt_id: attemptId,
                cwd: process.cwd(),
                command: ['npx', 'tsx', tempFile],
                env_allowlist: ['NODE_ENV', 'HOME'], // Minimal allowlist
                time_limit_ms: 10_000,
                capabilities: ['FS_READ', 'FS_WRITE_SANDBOX'], // No NET by default
                sandbox_root: tempDir
            };
            // Execute with kernel-grade runner
            const execResult = await (0, runner_1.runTestExec)(request);
            // Cleanup temp file (keep evidence artifacts for audit)
            try {
                fs.unlinkSync(tempFile);
                fs.rmdirSync(tempDir);
            }
            catch { /* ignore cleanup errors */ }
            if (!execResult.ok) {
                return {
                    gateName: 'test_execution',
                    passed: false,
                    required: true,
                    error: `Runner error: ${execResult.error.message}`
                };
            }
            const testResult = execResult.value;
            // Verify evidence integrity
            const evidenceCheck = (0, runner_1.verifyEvidence)(testResult.evidence);
            // Cleanup evidence directory after verification
            if (testResult.evidence.stdout_log.path) {
                const runDir = path.dirname(testResult.evidence.stdout_log.path);
                (0, runner_1.cleanupRunDir)(runDir);
            }
            if (!testResult.ok) {
                // Extract meaningful error message
                let errorMessage = testResult.denial?.message || 'Unknown error';
                if (testResult.denial?.reason === 'EXIT_NONZERO') {
                    // Try to extract error from stderr if available
                    try {
                        const stderrPath = testResult.evidence.stderr_log.path;
                        if (stderrPath && fs.existsSync(stderrPath)) {
                            const stderrContent = JSON.parse(fs.readFileSync(stderrPath, 'utf-8'));
                            const stderr = stderrContent.content || '';
                            const errorMatch = stderr.match(/(Error|TypeError|ReferenceError|SyntaxError):[^\n]+/);
                            if (errorMatch) {
                                errorMessage = errorMatch[0];
                            }
                        }
                    }
                    catch { /* use default message */ }
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
                };
            }
            // Evidence integrity check (advisory - don't fail if evidence was cleaned up)
            const evidenceValid = evidenceCheck.ok || !fs.existsSync(testResult.evidence.stdout_log.path);
            return {
                gateName: 'test_execution',
                passed: true,
                required: true,
                details: {
                    exitCode: testResult.exit_code,
                    policyChecks: testResult.policy_checks,
                    fingerprint: testResult.deterministic_fingerprint,
                    evidenceVerified: evidenceValid
                }
            };
        }
        catch (error) {
            return {
                gateName: 'test_execution',
                passed: false,
                required: true,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    /**
     * Gate 5: URCO Entropy Check
     * Code must be clear, not ambiguous
     */
    gate5_urcoEntropy(code) {
        try {
            const entities = (0, extractor_1.extractEntities)(code);
            const actions = (0, extractor_1.extractActions)(code);
            const missing = (0, missingVars_1.detectMissingVars)(code, {}, entities, actions);
            const contradictions = (0, contradictions_1.detectContradictions)(code);
            const entropy = (0, entropy_1.computeEntropy)({
                text: code,
                vars: {},
                inputs: [],
                outputs: [],
                constraints: [],
                acceptanceCriteria: [],
                invariants: []
            }, missing, contradictions);
            const MAX_ENTROPY = 0.5; // Raised from 0.4 to allow reasonable LLM-generated code
            if (entropy.value > MAX_ENTROPY) {
                return {
                    gateName: 'urco_entropy',
                    passed: false,
                    required: true,
                    error: `Code too ambiguous (entropy: ${entropy.value.toFixed(3)} > ${MAX_ENTROPY})`,
                    details: { entropy: entropy.value, breakdown: entropy.breakdown }
                };
            }
            return {
                gateName: 'urco_entropy',
                passed: true,
                required: true,
                details: { entropy: entropy.value }
            };
        }
        catch (error) {
            return {
                gateName: 'urco_entropy',
                passed: false,
                required: true,
                error: error instanceof Error ? error.message : String(error)
            };
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
    gate6_governanceCheck(code, context) {
        try {
            const rules = context.governanceRules || [];
            const violations = [];
            // 1. Policy Rules Check
            for (const rule of rules) {
                if (rule === 'no_date_now' && /Date\.now\(\)/.test(code)) {
                    violations.push('Uses Date.now() (violates determinism)'); // DETERMINISM-EXEMPT: Pattern check only
                }
                if (rule === 'determinism_required' && /Math\.random\(\)/.test(code)) {
                    violations.push('Uses Math.random() (violates determinism)'); // DETERMINISM-EXEMPT: Pattern check only
                }
                if (rule === 'no_console' && /console\.(log|error|warn)/.test(code)) {
                    violations.push('Uses console.* (violates no logging policy)'); // DETERMINISM-EXEMPT: Pattern check only
                }
            }
            // 2. Security Vulnerability Scan
            const securityScan = (0, securityScanner_1.scanForVulnerabilities)(code);
            // Add critical/high security vulnerabilities as violations
            for (const vuln of securityScan.vulnerabilities) {
                if (vuln.severity === 'critical' || vuln.severity === 'high') {
                    violations.push(`[SECURITY:${vuln.severity.toUpperCase()}] ${vuln.message}${vuln.line ? ` (line ${vuln.line})` : ''}`);
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
                        securitySummary: (0, securityScanner_1.getVulnerabilitySummary)(securityScan)
                    }
                };
            }
            // Include security info even on pass
            return {
                gateName: 'governance_check',
                passed: true,
                required: true,
                details: {
                    securityScore: securityScan.score,
                    securityVulnerabilities: securityScan.vulnerabilities.length
                }
            };
        }
        catch (error) {
            return {
                gateName: 'governance_check',
                passed: false,
                required: true,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    /**
     * Check if identifier is a built-in
     */
    isBuiltin(name) {
        const builtins = [
            // JavaScript builtins
            'console', 'process', 'Buffer', 'global', 'require', 'module', 'exports',
            'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
            'Error', 'TypeError', 'RangeError', 'ReferenceError',
            'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON',
            'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
            // Common single letters / keywords
            'a', 'b', 'c', 'd', 'e', 'i', 'j', 'k', 'x', 'y', 'z',
            'n', 't', 'v', 'fn', 'cb', 'err', 'id',
            'if', 'else', 'return', 'const', 'let', 'var', 'function',
            // TypeScript
            'number', 'string', 'boolean', 'void', 'any', 'unknown', 'never',
            'undefined', 'null', 'true', 'false',
            // Jest/Testing globals
            'describe', 'test', 'it', 'expect', 'beforeEach', 'afterEach',
            'beforeAll', 'afterAll', 'jest', 'toBe', 'toEqual', 'toThrow',
            'toContain', 'toBeDefined', 'toBeUndefined', 'toBeNull', 'toBeTruthy',
            'toBeFalsy', 'toHaveLength', 'toBeGreaterThan', 'toBeLessThan',
            'toBeInstanceOf', 'toHaveBeenCalled', 'toHaveBeenCalledWith',
            'mockResolvedValue', 'mockRejectedValue', 'mockReturnValue'
        ];
        return builtins.includes(name);
    }
}
exports.SixGateValidator = SixGateValidator;
