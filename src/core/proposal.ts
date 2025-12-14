// Alternative Tracking - Document paths NOT taken and why
// CONSTITUTIONAL AUTHORITY - See docs/DECISION_PHILOSOPHY.md
// Purpose: Enable future "what if" analysis and revisitable decisions
// TCB Component: Part of decision infrastructure
//
// From DECISION_PHILOSOPHY.md:
// "Decisions become revisitable and diffable."

import { Result, Ok, Err } from './result'
import { ConsequenceSurface, generateConsequenceSurface } from '../analysis/consequenceSurface'
import type { ImprovementProposal } from '../selfbuild/proposer'

/**
 * An alternative path that was considered but not taken
 */
export type Alternative = {
  id: string
  description: string
  approach: string
  rejectionReason: string
  consequenceSurface: ConsequenceSurface
  tradeoffs: {
    pros: string[]
    cons: string[]
  }
}

/**
 * Proposal enriched with alternatives considered
 * Per ROADMAP Step 3: Alternative Tracking
 */
export type ProposalWithAlternatives = {
  proposal: ImprovementProposal
  alternatives: Alternative[]
  chosenRationale: string
  comparisonSummary: string
}

/**
 * Alternative generation context
 */
export type AlternativeContext = {
  targetFile: string
  issueType: string
  changeType: string
  currentApproach: string
}

/**
 * Standard alternative patterns for common scenarios
 */
const ALTERNATIVE_PATTERNS: Record<string, Array<{
  description: string
  approach: string
  applicableWhen: (ctx: AlternativeContext) => boolean
  pros: string[]
  cons: string[]
}>> = {
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
}

/**
 * Generate alternatives for a proposal
 * This implements ROADMAP Step 3
 */
export function generateAlternatives(
  proposal: ImprovementProposal
): Result<ProposalWithAlternatives, Error> {
  try {
    const context: AlternativeContext = {
      targetFile: proposal.targetFile,
      issueType: proposal.issue.type,
      changeType: proposal.proposedChange.type,
      currentApproach: proposal.rationale
    }

    // Get applicable alternative patterns
    const patterns = ALTERNATIVE_PATTERNS[proposal.issue.type] || []
    const applicablePatterns = patterns.filter(p => p.applicableWhen(context))

    // Generate alternatives with consequence surfaces
    const alternatives: Alternative[] = []
    let altIndex = 0

    for (const pattern of applicablePatterns) {
      // Create a mock proposal for this alternative to get its consequence surface
      const altProposal: ImprovementProposal = {
        ...proposal,
        id: `${proposal.id}-alt-${altIndex}`,
        rationale: pattern.description,
        proposedChange: {
          ...proposal.proposedChange,
          code: `// Alternative approach: ${pattern.approach}\n${proposal.proposedChange.code}`
        }
      }

      // Generate consequence surface for this alternative
      const consequenceResult = generateConsequenceSurface(altProposal)
      const consequenceSurface: ConsequenceSurface = consequenceResult.ok
        ? consequenceResult.value.surface
        : { enables: [], forbids: [], assumptions: [], validationCriteria: [] }

      // Build rejection reason based on comparison
      const rejectionReason = generateRejectionReason(pattern, proposal, context)

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
      })

      altIndex++
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
      })
    }

    // Generate comparison summary
    const comparisonSummary = generateComparisonSummary(proposal, alternatives)

    return Ok({
      proposal,
      alternatives,
      chosenRationale: generateChosenRationale(proposal),
      comparisonSummary
    })

  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Generate rejection reason for an alternative
 */
function generateRejectionReason(
  pattern: { description: string; pros: string[]; cons: string[] },
  proposal: ImprovementProposal,
  context: AlternativeContext
): string {
  const reasons: string[] = []

  // Check if current approach addresses cons of alternative
  if (pattern.cons.some(c => c.includes('verbose'))) {
    reasons.push('Current approach is more concise')
  }

  if (pattern.cons.some(c => c.includes('refactor'))) {
    reasons.push('Current approach requires less structural change')
  }

  if (pattern.cons.some(c => c.includes('complexity') || c.includes('overkill'))) {
    reasons.push('Current approach is proportional to the issue')
  }

  // TCB-specific rejections
  if (context.targetFile.includes('validation/') || context.targetFile.includes('sandbox/')) {
    if (pattern.cons.some(c => c.includes('mask') || c.includes('lost'))) {
      reasons.push('TCB requires explicit error handling, not error suppression')
    }
  }

  // If no specific reasons, use generic
  if (reasons.length === 0) {
    reasons.push('Current approach better fits the specific context')
  }

  return reasons.join('; ')
}

/**
 * Generate rationale for why the chosen approach was selected
 */
function generateChosenRationale(proposal: ImprovementProposal): string {
  const parts: string[] = []

  parts.push(`Chosen approach: ${proposal.proposedChange.type}`)

  if (proposal.classification) {
    parts.push(`Decision type: ${proposal.classification.type}`)
  }

  if (proposal.gateValidation?.valid) {
    parts.push('Passed all required gates')
  }

  parts.push(proposal.rationale)

  return parts.join('. ')
}

/**
 * Generate comparison summary across all alternatives
 */
function generateComparisonSummary(
  proposal: ImprovementProposal,
  alternatives: Alternative[]
): string {
  const lines: string[] = []

  lines.push(`Compared ${alternatives.length} alternative approaches:`)

  for (const alt of alternatives) {
    lines.push(`- ${alt.description}: Rejected (${alt.rejectionReason})`)
  }

  lines.push('')
  lines.push(`Selected: ${proposal.proposedChange.type} approach`)
  lines.push(`Rationale: ${proposal.rationale}`)

  return lines.join('\n')
}

/**
 * Format alternatives for human review
 */
export function formatAlternatives(result: ProposalWithAlternatives): string {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('ALTERNATIVE ANALYSIS')
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('')
  lines.push(`Target: ${result.proposal.targetFile}`)
  lines.push(`Issue: ${result.proposal.issue.type} (${result.proposal.issue.severity})`)
  lines.push('')
  lines.push('CHOSEN APPROACH:')
  lines.push(`  ${result.proposal.proposedChange.type}`)
  lines.push(`  ${result.chosenRationale}`)
  lines.push('')
  lines.push('ALTERNATIVES CONSIDERED:')
  lines.push('')

  for (const alt of result.alternatives) {
    lines.push(`  [${alt.id}] ${alt.description}`)
    lines.push(`      Approach: ${alt.approach}`)
    lines.push(`      Pros: ${alt.tradeoffs.pros.join(', ')}`)
    lines.push(`      Cons: ${alt.tradeoffs.cons.join(', ')}`)
    lines.push(`      Rejected: ${alt.rejectionReason}`)
    lines.push('')
  }

  lines.push('COMPARISON SUMMARY:')
  lines.push(result.comparisonSummary)
  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════')

  return lines.join('\n')
}

/**
 * Check if alternatives have been properly considered
 * Used for gate elevation - irreversible decisions require alternative analysis
 */
export function hasAdequateAlternatives(result: ProposalWithAlternatives): boolean {
  // Must have at least 2 alternatives considered
  if (result.alternatives.length < 2) {
    return false
  }

  // Each alternative must have a rejection reason
  for (const alt of result.alternatives) {
    if (!alt.rejectionReason || alt.rejectionReason.length === 0) {
      return false
    }
  }

  // Must have a comparison summary
  if (!result.comparisonSummary || result.comparisonSummary.length === 0) {
    return false
  }

  return true
}
