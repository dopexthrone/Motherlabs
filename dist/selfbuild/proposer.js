"use strict";
// Self-Improvement Proposer - Motherlabs proposes improvements to itself
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelfImprovementProposer = void 0;
const codeAnalyzer_1 = require("../analysis/codeAnalyzer");
const sixGates_1 = require("../validation/sixGates");
const contentAddress_1 = require("../core/contentAddress");
const result_1 = require("../core/result");
const ids_1 = require("../core/ids");
class SelfImprovementProposer {
    validator;
    constructor() {
        this.validator = new sixGates_1.SixGateValidator();
    }
    /**
     * Analyze file and propose improvement for highest priority issue
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
            // 3. Generate fix proposal (deterministic for now - will be LLM later)
            const proposal = this.generateFixProposal(topIssue, filepath);
            // 4. Validate through 6 gates
            const validation = await this.validator.validate(proposal.code, {
                existingImports: [],
                existingTypes: ['number', 'string', 'boolean']
            });
            if (!validation.ok) {
                return (0, result_1.Err)(new Error('Proposal validation failed'));
            }
            const improvementProposal = {
                id: (0, contentAddress_1.contentAddress)({ issue: topIssue, change: proposal }),
                targetFile: filepath,
                issue: topIssue,
                proposedChange: proposal,
                rationale: this.generateRationale(topIssue),
                timestamp: ids_1.globalTimeProvider.now(),
                gateValidation: validation.value
            };
            return (0, result_1.Ok)(improvementProposal);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Generate fix proposal for issue (deterministic)
     */
    generateFixProposal(issue, filepath) {
        if (issue.type === 'NO_TESTS') {
            // Generate test file
            const testCode = `// Test for ${filepath}
import { describe, test, expect } from '@jest/globals'

describe('${filepath}', () => {
  test('basic functionality', () => {
    // GENERATED: Placeholder test - replace with real assertions
    expect(true).toBe(true)
  })
})
`;
            return { type: 'add_test', code: testCode };
        }
        if (issue.type === 'HIGH_COMPLEXITY') {
            // Suggest refactoring (placeholder)
            return {
                type: 'refactor',
                code: `// Refactoring needed: ${issue.message}\n// Consider breaking into smaller functions`
            };
        }
        // Default: comment about the issue
        return {
            type: 'modify_function',
            code: `// Issue: ${issue.message}\n// UNIMPLEMENTED: Auto-fix for this issue type`
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
