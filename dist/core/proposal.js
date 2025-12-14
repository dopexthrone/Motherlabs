"use strict";
// Alternative Tracking - Document paths NOT taken and why
// CONSTITUTIONAL AUTHORITY - See docs/DECISION_PHILOSOPHY.md
// Purpose: Enable future "what if" analysis and revisitable decisions
// TCB Component: Part of decision infrastructure
//
// From DECISION_PHILOSOPHY.md:
// "Decisions become revisitable and diffable."
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAlternatives = generateAlternatives;
exports.formatAlternatives = formatAlternatives;
exports.hasAdequateAlternatives = hasAdequateAlternatives;
const result_1 = require("./result");
const consequenceSurface_1 = require("../analysis/consequenceSurface");
/**
 * Standard alternative patterns for common scenarios
 */
const ALTERNATIVE_PATTERNS = {
    // Alternatives for error handling issues
    'NO_ERROR_HANDLING': [
        {
            description: 'Add try-catch blocks',
            approach: 'Wrap async operations in try-catch with error logging',
            applicableWhen: () => true,
            pros: ['Simple to implement', 'Familiar pattern', 'Works with existing code'],
            cons: ['Can mask errors if not careful', 'Requires discipline to handle all cases']
        },
        {
            description: 'Use Result<T, E> pattern',
            approach: 'Return Result type instead of throwing exceptions',
            applicableWhen: () => true,
            pros: ['Explicit error handling', 'Type-safe', 'Aligns with constitutional patterns'],
            cons: ['Requires refactoring callers', 'More verbose']
        },
        {
            description: 'Defer error handling to caller',
            approach: 'Let errors propagate, handle at boundary',
            applicableWhen: (ctx) => !ctx.targetFile.includes('validation/'),
            pros: ['Simpler individual functions', 'Centralized handling'],
            cons: ['Errors may be lost', 'Harder to debug', 'Not suitable for TCB']
        }
    ],
    // Alternatives for high complexity issues
    'HIGH_COMPLEXITY': [
        {
            description: 'Extract helper functions',
            approach: 'Break complex function into smaller, focused helpers',
            applicableWhen: () => true,
            pros: ['Reduces cognitive load', 'Enables testing', 'Improves readability'],
            cons: ['More functions to maintain', 'May obscure flow']
        },
        {
            description: 'Use early returns',
            approach: 'Restructure with guard clauses and early returns',
            applicableWhen: () => true,
            pros: ['Reduces nesting', 'Clearer logic flow', 'Easy to implement'],
            cons: ['Multiple exit points', 'May miss cleanup']
        },
        {
            description: 'State machine pattern',
            approach: 'Model as explicit state transitions',
            applicableWhen: (ctx) => ctx.changeType === 'refactor',
            pros: ['Very explicit', 'Easy to test states', 'Handles edge cases'],
            cons: ['Significant refactor', 'May be overkill']
        },
        {
            description: 'Leave as-is with documentation',
            approach: 'Add comprehensive comments explaining complexity',
            applicableWhen: () => true,
            pros: ['No code changes', 'Preserves working code'],
            cons: ['Complexity remains', 'Technical debt persists']
        }
    ],
    // Alternatives for missing tests
    'NO_TESTS': [
        {
            description: 'Add unit tests',
            approach: 'Write focused unit tests for individual functions',
            applicableWhen: () => true,
            pros: ['Fast execution', 'Precise failure location', 'Good coverage'],
            cons: ['May miss integration issues', 'Requires mocking']
        },
        {
            description: 'Add integration tests',
            approach: 'Write tests that exercise multiple components together',
            applicableWhen: () => true,
            pros: ['Tests real behavior', 'Catches integration bugs'],
            cons: ['Slower', 'Harder to debug failures']
        },
        {
            description: 'Add property-based tests',
            approach: 'Use fuzzing/property testing for edge case discovery',
            applicableWhen: (ctx) => ctx.targetFile.includes('validation/') || ctx.targetFile.includes('core/'),
            pros: ['Finds edge cases', 'More thorough coverage'],
            cons: ['More complex to write', 'May find issues slowly']
        }
    ],
    // Alternatives for missing types
    'MISSING_TYPES': [
        {
            description: 'Add explicit type annotations',
            approach: 'Annotate all parameters and return types',
            applicableWhen: () => true,
            pros: ['Clear contracts', 'Better IDE support', 'Catches errors'],
            cons: ['More verbose', 'Maintenance overhead']
        },
        {
            description: 'Use type inference with JSDoc',
            approach: 'Add JSDoc comments for type information',
            applicableWhen: () => true,
            pros: ['Works with JavaScript', 'Self-documenting'],
            cons: ['Less strict', 'Can drift from code']
        },
        {
            description: 'Create dedicated type definitions',
            approach: 'Extract types to separate .d.ts or types.ts file',
            applicableWhen: (ctx) => ctx.targetFile.includes('core/'),
            pros: ['Reusable types', 'Clean separation'],
            cons: ['Another file to maintain', 'Import complexity']
        }
    ],
    // Alternatives for duplicate code
    'DUPLICATE_CODE': [
        {
            description: 'Extract shared function',
            approach: 'Create single function used by all duplicate locations',
            applicableWhen: () => true,
            pros: ['Single source of truth', 'Easy to update'],
            cons: ['May not fit all cases perfectly', 'Coupling']
        },
        {
            description: 'Create base class/mixin',
            approach: 'Use inheritance or composition for shared behavior',
            applicableWhen: () => true,
            pros: ['Structured reuse', 'Clear hierarchy'],
            cons: ['Adds complexity', 'Inheritance issues']
        },
        {
            description: 'Accept duplication',
            approach: 'Keep duplicates if they may diverge',
            applicableWhen: () => true,
            pros: ['Independence', 'No coupling', 'Flexibility'],
            cons: ['Maintenance burden', 'Inconsistency risk']
        }
    ]
};
/**
 * Generate alternatives for a proposal
 * This implements ROADMAP Step 3
 */
function generateAlternatives(proposal) {
    try {
        const context = {
            targetFile: proposal.targetFile,
            issueType: proposal.issue.type,
            changeType: proposal.proposedChange.type,
            currentApproach: proposal.rationale
        };
        // Get applicable alternative patterns
        const patterns = ALTERNATIVE_PATTERNS[proposal.issue.type] || [];
        const applicablePatterns = patterns.filter(p => p.applicableWhen(context));
        // Generate alternatives with consequence surfaces
        const alternatives = [];
        let altIndex = 0;
        for (const pattern of applicablePatterns) {
            // Create a mock proposal for this alternative to get its consequence surface
            const altProposal = {
                ...proposal,
                id: `${proposal.id}-alt-${altIndex}`,
                rationale: pattern.description,
                proposedChange: {
                    ...proposal.proposedChange,
                    code: `// Alternative approach: ${pattern.approach}\n${proposal.proposedChange.code}`
                }
            };
            // Generate consequence surface for this alternative
            const consequenceResult = (0, consequenceSurface_1.generateConsequenceSurface)(altProposal);
            const consequenceSurface = consequenceResult.ok
                ? consequenceResult.value.surface
                : { enables: [], forbids: [], assumptions: [], validationCriteria: [] };
            // Build rejection reason based on comparison
            const rejectionReason = generateRejectionReason(pattern, proposal, context);
            alternatives.push({
                id: `alt-${altIndex}`,
                description: pattern.description,
                approach: pattern.approach,
                rejectionReason,
                consequenceSurface,
                tradeoffs: {
                    pros: pattern.pros,
                    cons: pattern.cons
                }
            });
            altIndex++;
        }
        // Add "do nothing" alternative for non-critical issues
        if (proposal.issue.severity !== 'critical') {
            alternatives.push({
                id: `alt-${altIndex}`,
                description: 'Defer action',
                approach: 'Leave current code unchanged, revisit later',
                rejectionReason: proposal.issue.severity === 'high'
                    ? 'Issue severity warrants immediate action'
                    : 'Current evidence suggests addressing now is beneficial',
                consequenceSurface: {
                    enables: ['No code changes', 'Preserved stability', 'Time to gather more evidence'],
                    forbids: ['Issue resolution', 'Improved code quality'],
                    assumptions: ['Issue does not worsen over time', 'Resources available later'],
                    validationCriteria: ['Issue tracked for future review']
                },
                tradeoffs: {
                    pros: ['No risk of regression', 'No development time', 'Can gather more context'],
                    cons: ['Technical debt remains', 'Issue may worsen', 'May block other work']
                }
            });
        }
        // Generate comparison summary
        const comparisonSummary = generateComparisonSummary(proposal, alternatives);
        return (0, result_1.Ok)({
            proposal,
            alternatives,
            chosenRationale: generateChosenRationale(proposal),
            comparisonSummary
        });
    }
    catch (error) {
        return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Generate rejection reason for an alternative
 */
function generateRejectionReason(pattern, proposal, context) {
    const reasons = [];
    // Check if current approach addresses cons of alternative
    if (pattern.cons.some(c => c.includes('verbose'))) {
        reasons.push('Current approach is more concise');
    }
    if (pattern.cons.some(c => c.includes('refactor'))) {
        reasons.push('Current approach requires less structural change');
    }
    if (pattern.cons.some(c => c.includes('complexity') || c.includes('overkill'))) {
        reasons.push('Current approach is proportional to the issue');
    }
    // TCB-specific rejections
    if (context.targetFile.includes('validation/') || context.targetFile.includes('sandbox/')) {
        if (pattern.cons.some(c => c.includes('mask') || c.includes('lost'))) {
            reasons.push('TCB requires explicit error handling, not error suppression');
        }
    }
    // If no specific reasons, use generic
    if (reasons.length === 0) {
        reasons.push('Current approach better fits the specific context');
    }
    return reasons.join('; ');
}
/**
 * Generate rationale for why the chosen approach was selected
 */
function generateChosenRationale(proposal) {
    const parts = [];
    parts.push(`Chosen approach: ${proposal.proposedChange.type}`);
    if (proposal.classification) {
        parts.push(`Decision type: ${proposal.classification.type}`);
    }
    if (proposal.gateValidation?.valid) {
        parts.push('Passed all required gates');
    }
    parts.push(proposal.rationale);
    return parts.join('. ');
}
/**
 * Generate comparison summary across all alternatives
 */
function generateComparisonSummary(proposal, alternatives) {
    const lines = [];
    lines.push(`Compared ${alternatives.length} alternative approaches:`);
    for (const alt of alternatives) {
        lines.push(`- ${alt.description}: Rejected (${alt.rejectionReason})`);
    }
    lines.push('');
    lines.push(`Selected: ${proposal.proposedChange.type} approach`);
    lines.push(`Rationale: ${proposal.rationale}`);
    return lines.join('\n');
}
/**
 * Format alternatives for human review
 */
function formatAlternatives(result) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('ALTERNATIVE ANALYSIS');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`Target: ${result.proposal.targetFile}`);
    lines.push(`Issue: ${result.proposal.issue.type} (${result.proposal.issue.severity})`);
    lines.push('');
    lines.push('CHOSEN APPROACH:');
    lines.push(`  ${result.proposal.proposedChange.type}`);
    lines.push(`  ${result.chosenRationale}`);
    lines.push('');
    lines.push('ALTERNATIVES CONSIDERED:');
    lines.push('');
    for (const alt of result.alternatives) {
        lines.push(`  [${alt.id}] ${alt.description}`);
        lines.push(`      Approach: ${alt.approach}`);
        lines.push(`      Pros: ${alt.tradeoffs.pros.join(', ')}`);
        lines.push(`      Cons: ${alt.tradeoffs.cons.join(', ')}`);
        lines.push(`      Rejected: ${alt.rejectionReason}`);
        lines.push('');
    }
    lines.push('COMPARISON SUMMARY:');
    lines.push(result.comparisonSummary);
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
}
/**
 * Check if alternatives have been properly considered
 * Used for gate elevation - irreversible decisions require alternative analysis
 */
function hasAdequateAlternatives(result) {
    // Must have at least 2 alternatives considered
    if (result.alternatives.length < 2) {
        return false;
    }
    // Each alternative must have a rejection reason
    for (const alt of result.alternatives) {
        if (!alt.rejectionReason || alt.rejectionReason.length === 0) {
            return false;
        }
    }
    // Must have a comparison summary
    if (!result.comparisonSummary || result.comparisonSummary.length === 0) {
        return false;
    }
    return true;
}
