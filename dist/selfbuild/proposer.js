"use strict";
// Self-Improvement Proposer - Motherlabs proposes improvements to itself
// Uses ConstrainedLLM for real code generation, with deterministic fallback
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
            // 5. Generate fix - TRY LLM FIRST, then fall back to deterministic
            let proposal;
            let source = 'deterministic';
            let gateValidation;
            if (this.constrainedLLM) {
                // ATTEMPT LLM CODE GENERATION (through 6 gates)
                const llmResult = await this.constrainedLLM.generateCode({
                    issue: topIssue,
                    filepath,
                    existingCode,
                    context
                });
                if (llmResult.ok) {
                    // LLM succeeded and passed all gates
                    proposal = {
                        type: this.issueToChangeType(topIssue.type),
                        code: llmResult.value.code
                    };
                    source = 'llm';
                    gateValidation = llmResult.value.validation;
                }
                else {
                    // LLM failed - fall back to deterministic
                    console.warn(`[Proposer] LLM failed: ${llmResult.error.message}, using deterministic fallback`);
                    proposal = this.generateDeterministicFix(topIssue, filepath);
                }
            }
            else {
                // No LLM available - use deterministic
                proposal = this.generateDeterministicFix(topIssue, filepath);
            }
            // 6. If deterministic, still validate through gates
            if (source === 'deterministic') {
                const validation = await this.validator.validate(proposal.code, context);
                if (!validation.ok) {
                    return (0, result_1.Err)(new Error('Proposal validation failed: ' + validation.error.message));
                }
                gateValidation = validation.value;
            }
            // 7. Build final proposal
            const improvementProposal = {
                id: (0, contentAddress_1.contentAddress)({ issue: topIssue, change: proposal, timestamp: ids_1.globalTimeProvider.now() }),
                targetFile: filepath,
                issue: topIssue,
                proposedChange: proposal,
                rationale: this.generateRationale(topIssue),
                timestamp: ids_1.globalTimeProvider.now(),
                gateValidation,
                source
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
    /**
     * Generate deterministic fix (fallback when LLM unavailable or fails)
     */
    generateDeterministicFix(issue, filepath) {
        // Extract module name from filepath
        const basename = filepath.split('/').pop()?.replace('.ts', '') || 'module';
        if (issue.type === 'NO_TESTS') {
            // Generate minimal valid test file
            const testCode = `// Test for ${filepath}
// DETERMINISTIC: Placeholder - LLM generation failed or unavailable

export function test${capitalize(basename)}Basic(): boolean {
  // Basic test placeholder
  return true
}

export function test${capitalize(basename)}Error(): boolean {
  // Error case placeholder
  return true
}
`;
            return { type: 'add_test', code: testCode };
        }
        if (issue.type === 'HIGH_COMPLEXITY') {
            return {
                type: 'refactor',
                code: `// DETERMINISTIC: Refactoring needed for ${filepath}
// Issue: ${issue.message}
// Action: Break into smaller functions manually

export function placeholder(): void {
  // Placeholder for refactored code
}
`
            };
        }
        if (issue.type === 'NO_ERROR_HANDLING') {
            return {
                type: 'modify_function',
                code: `// DETERMINISTIC: Error handling needed
// Issue: ${issue.message}
// Action: Wrap in try/catch or use Result<T,E>

import { Result, Ok, Err } from '../core/result'

export function withErrorHandling<T>(fn: () => T): Result<T, Error> {
  try {
    return Ok(fn())
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}
`
            };
        }
        // Default fallback
        return {
            type: 'modify_function',
            code: `// DETERMINISTIC: Fix needed
// Issue: ${issue.message}
// File: ${filepath}

export function placeholder(): void {
  // Manual fix required
}
`
        };
    }
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
/**
 * Capitalize first letter
 */
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
