"use strict";
// 6-Gate Validator - Prevents LLM escapes, enforces correctness
Object.defineProperty(exports, "__esModule", { value: true });
exports.SixGateValidator = void 0;
const ts_morph_1 = require("ts-morph");
const result_1 = require("../core/result");
const entropy_1 = require("../urco/entropy");
const extractor_1 = require("../urco/extractor");
const missingVars_1 = require("../urco/missingVars");
const contradictions_1 = require("../urco/contradictions");
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
        // GATE 4: Test Execution (placeholder for now)
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
            // Basic check: must export something
            const hasExport = /export\s+(function|const|class|type|interface)/.test(code);
            if (!hasExport) {
                return {
                    gateName: 'schema_validation',
                    passed: false,
                    required: true,
                    error: 'Code must export at least one declaration'
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
     * TypeScript must compile without errors
     */
    async gate2_syntaxValidation(code) {
        try {
            const project = new ts_morph_1.Project({
                useInMemoryFileSystem: true,
                compilerOptions: {
                    strict: true,
                    noImplicitAny: true
                }
            });
            const sourceFile = project.createSourceFile('temp.ts', code);
            const diagnostics = sourceFile.getPreEmitDiagnostics();
            if (diagnostics.length > 0) {
                return {
                    gateName: 'syntax_validation',
                    passed: false,
                    required: true,
                    error: `Syntax errors: ${diagnostics.length}`,
                    details: {
                        errors: diagnostics.slice(0, 3).map(d => d.getMessageText())
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
     */
    gate3_variableResolution(code, context) {
        try {
            const project = new ts_morph_1.Project({ useInMemoryFileSystem: true });
            const sourceFile = project.createSourceFile('temp.ts', code);
            const identifiers = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.Identifier);
            const undefinedRefs = [];
            for (const id of identifiers) {
                const name = id.getText();
                // Skip known types and imports
                if (context.existingTypes.includes(name))
                    continue;
                if (context.existingImports.includes(name))
                    continue;
                // Check if defined in this file
                const definitions = sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.FunctionDeclaration)
                    .concat(sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.VariableDeclaration))
                    .concat(sourceFile.getDescendantsOfKind(ts_morph_1.SyntaxKind.ClassDeclaration));
                const defined = definitions.some(d => d.getName?.() === name);
                if (!defined && !this.isBuiltin(name)) {
                    undefinedRefs.push(name);
                }
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
     * Gate 4: Test Execution (placeholder - requires sandbox)
     */
    async gate4_testExecution(_code) {
        // UNIMPLEMENTED: Requires execution engine integration
        // For now: pass (will implement when code generation added)
        return {
            gateName: 'test_execution',
            passed: true,
            required: false, // Not required until code generation active
            error: 'UNIMPLEMENTED: Test execution not yet integrated'
        };
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
            const MAX_ENTROPY = 0.4;
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
     * Code must not violate policies
     */
    gate6_governanceCheck(code, context) {
        try {
            const rules = context.governanceRules || [];
            const violations = [];
            for (const rule of rules) {
                if (rule === 'no_date_now' && /Date\.now\(\)/.test(code)) {
                    violations.push('Uses Date.now() (violates determinism)');
                }
                if (rule === 'determinism_required' && /Math\.random\(\)/.test(code)) {
                    violations.push('Uses Math.random() (violates determinism)');
                }
                if (rule === 'no_console' && /console\.(log|error|warn)/.test(code)) {
                    violations.push('Uses console.* (violates no logging policy)');
                }
            }
            if (violations.length > 0) {
                return {
                    gateName: 'governance_check',
                    passed: false,
                    required: true,
                    error: `Policy violations: ${violations.join('; ')}`,
                    details: { violations }
                };
            }
            return {
                gateName: 'governance_check',
                passed: true,
                required: true
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
            'undefined', 'null', 'true', 'false'
        ];
        return builtins.includes(name);
    }
}
exports.SixGateValidator = SixGateValidator;
