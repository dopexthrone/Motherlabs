"use strict";
// Self-Improvement Proposer - Motherlabs proposes improvements to itself
// CONSTITUTIONAL GOVERNANCE - See docs/SELF_SCALING_RULESET.md
// Enforces: AXIOM 2 (Probabilistic Non-Authority), AXIOM 5 (Refusal First-Class)
// TCB Component: Self-modification subject to same gates as external artifacts
// Uses ConstrainedLLM for real code generation (AXIOM 5: Refuses if LLM unavailable)
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
exports.SelfImprovementProposer = void 0;
const fs = __importStar(require("fs"));
const codeAnalyzer_1 = require("../analysis/codeAnalyzer");
const sixGates_1 = require("../validation/sixGates");
const contentAddress_1 = require("../core/contentAddress");
const result_1 = require("../core/result");
const ids_1 = require("../core/ids");
class SelfImprovementProposer {
    validator;
    constrainedLLM;
    constructor(constrainedLLM) {
        this.validator = new sixGates_1.SixGateValidator();
        this.constrainedLLM = constrainedLLM || null;
    }
    /**
     * Analyze file and propose improvement for highest priority issue
     * Uses LLM if available, falls back to deterministic otherwise
     */
    async proposeImprovement(filepath) {
        try {
            // 1. Analyze file (deterministic)
            const analysis = (0, codeAnalyzer_1.analyzeFile)(filepath);
            if (!analysis.ok) {
                return (0, result_1.Err)(analysis.error);
            }
            if (analysis.value.issues.length === 0) {
                return (0, result_1.Err)(new Error('No issues found - file is already optimal'));
            }
            // 2. Get highest priority issue
            const sortedIssues = analysis.value.issues.sort((a, b) => {
                const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                return severityOrder[a.severity] - severityOrder[b.severity];
            });
            const topIssue = sortedIssues[0];
            // 3. Read existing code
            let existingCode = '';
            try {
                existingCode = fs.readFileSync(filepath, 'utf-8');
            }
            catch {
                existingCode = '';
            }
            // 4. Build validation context
            const context = {
                existingImports: this.extractImports(existingCode),
                existingTypes: this.extractTypes(existingCode)
            };
            // 5. Generate fix via LLM (AXIOM 5: No hollow placeholders)
            // We REFUSE if no LLM is available - never generate placeholder code
            if (!this.constrainedLLM) {
                return (0, result_1.Err)(new Error(`AXIOM 5 REFUSAL: No LLM available for code generation. ` +
                    `Refusing to generate hollow placeholder. Configure LLM or fix manually.`));
            }
            // ATTEMPT LLM CODE GENERATION (through 6 gates)
            const llmResult = await this.constrainedLLM.generateCode({
                issue: topIssue,
                filepath,
                existingCode,
                context
            });
            if (!llmResult.ok) {
                // AXIOM 5: Refusal Is a First-Class Outcome
                // LLM failed - REFUSE rather than generate hollow placeholder
                return (0, result_1.Err)(new Error(`AXIOM 5 REFUSAL: LLM code generation failed (${llmResult.error.message}). ` +
                    `Refusing to generate hollow placeholder. Fix requires LLM or manual intervention.`));
            }
            // LLM succeeded and passed all gates
            const proposal = {
                type: this.issueToChangeType(topIssue.type),
                code: llmResult.value.code
            };
            const gateValidation = llmResult.value.validation;
            // 6. Build final proposal
            const improvementProposal = {
                id: (0, contentAddress_1.contentAddress)({ issue: topIssue, change: proposal, timestamp: ids_1.globalTimeProvider.now() }),
                targetFile: filepath,
                issue: topIssue,
                proposedChange: proposal,
                rationale: this.generateRationale(topIssue),
                timestamp: ids_1.globalTimeProvider.now(),
                gateValidation,
                source: 'llm' // Always 'llm' - we refuse rather than generate hollow placeholders
            };
            return (0, result_1.Ok)(improvementProposal);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Map issue type to change type
     */
    issueToChangeType(issueType) {
        const mapping = {
            'NO_TESTS': 'add_test',
            'HIGH_COMPLEXITY': 'refactor',
            'NO_ERROR_HANDLING': 'modify_function',
            'DUPLICATE_CODE': 'refactor',
            'MISSING_TYPES': 'modify_function'
        };
        return mapping[issueType] || 'modify_function';
    }
    /**
     * Extract imports from existing code
     */
    extractImports(code) {
        const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from/g;
        const imports = [];
        let match;
        while ((match = importRegex.exec(code)) !== null) {
            if (match[1]) {
                // Named imports: { a, b, c }
                imports.push(...match[1].split(',').map(s => s.trim()));
            }
            else if (match[2]) {
                // Default import
                imports.push(match[2]);
            }
        }
        return imports;
    }
    /**
     * Extract type names from existing code
     */
    extractTypes(code) {
        const typeRegex = /(?:type|interface)\s+(\w+)/g;
        const types = ['number', 'string', 'boolean', 'void', 'null', 'undefined'];
        let match;
        while ((match = typeRegex.exec(code)) !== null) {
            types.push(match[1]);
        }
        return types;
    }
    // NOTE: generateDeterministicFix was REMOVED per AXIOM 5
    // The system now REFUSES rather than generating hollow placeholders.
    // See commit for rationale.
    /**
     * Generate rationale for improvement
     */
    generateRationale(issue) {
        const reasons = {
            NO_TESTS: 'Adding tests improves reliability and enables safe refactoring',
            HIGH_COMPLEXITY: 'Reducing complexity improves maintainability and reduces bugs',
            NO_ERROR_HANDLING: 'Adding error handling prevents crashes and improves robustness',
            DUPLICATE_CODE: 'Removing duplication reduces maintenance burden',
            MISSING_TYPES: 'Adding types improves type safety and catches errors early'
        };
        return reasons[issue.type] || 'Improves code quality';
    }
}
exports.SelfImprovementProposer = SelfImprovementProposer;
