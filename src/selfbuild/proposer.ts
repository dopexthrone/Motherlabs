// Self-Improvement Proposer - Motherlabs proposes improvements to itself
// CONSTITUTIONAL GOVERNANCE - See docs/SELF_SCALING_RULESET.md
// Enforces: AXIOM 2 (Probabilistic Non-Authority), AXIOM 5 (Refusal First-Class)
// TCB Component: Self-modification subject to same gates as external artifacts
// Uses ConstrainedLLM for real code generation (AXIOM 5: Refuses if LLM unavailable)

import * as fs from 'fs'
import { analyzeFile } from '../analysis/codeAnalyzer'
import { SixGateValidator, CodeValidationContext } from '../validation/sixGates'
import { ConstrainedLLM } from '../llm/constrained'
import { contentAddress } from '../core/contentAddress'
import { Result, Ok, Err } from '../core/result'
import { globalTimeProvider } from '../core/ids'
import { classifyDecision, DecisionClassification, getRequiredGates } from '../core/decisionClassifier'
import { generateConsequenceSurface, ConsequenceAnalysis } from '../analysis/consequenceSurface'
import { generateAlternatives, ProposalWithAlternatives } from '../core/proposal'
import { checkPrematurity, PrematurityCheck } from '../validation/prematurityChecker'
import { determineGateRequirements, GateElevation } from '../validation/gateElevation'
import type { CodeIssue } from '../analysis/codeAnalyzer'

export type ImprovementProposal = {
  id: string
  targetFile: string
  issue: CodeIssue
  proposedChange: {
    type: 'add_function' | 'modify_function' | 'add_test' | 'refactor'
    code: string
    diff?: string
  }
  rationale: string
  timestamp: number
  gateValidation?: {
    valid: boolean
    gateResults: Array<{ gateName: string; passed: boolean; error?: string }>
  }
  source: 'llm' | 'deterministic'
  // Decision classification (Step 1 of ROADMAP)
  classification?: DecisionClassification
  gateRequirements?: {
    gates: string[]
    humanApprovalRequired: boolean
  }
  // Consequence surface (Step 2 of ROADMAP)
  consequenceAnalysis?: ConsequenceAnalysis
  // Alternative tracking (Step 3 of ROADMAP)
  alternativeAnalysis?: ProposalWithAlternatives
  // Prematurity check (Step 5 of ROADMAP)
  prematurityCheck?: PrematurityCheck
  // Gate elevation (Step 9 of ROADMAP)
  gateElevation?: GateElevation
}

export class SelfImprovementProposer {
  private validator: SixGateValidator
  private constrainedLLM: ConstrainedLLM | null

  constructor(constrainedLLM?: ConstrainedLLM) {
    this.validator = new SixGateValidator()
    this.constrainedLLM = constrainedLLM || null
  }

  /**
   * Analyze file and propose improvement for highest priority issue
   * Uses LLM if available, falls back to deterministic otherwise
   */
  async proposeImprovement(filepath: string): Promise<Result<ImprovementProposal, Error>> {
    try {
      // 1. Analyze file (deterministic)
      const analysis = analyzeFile(filepath)

      if (!analysis.ok) {
        return Err(analysis.error)
      }

      if (analysis.value.issues.length === 0) {
        return Err(new Error('No issues found - file is already optimal'))
      }

      // 2. Get highest priority issue
      const sortedIssues = analysis.value.issues.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
        return severityOrder[a.severity] - severityOrder[b.severity]
      })

      const topIssue = sortedIssues[0]

      // 3. Read existing code
      let existingCode = ''
      try {
        existingCode = fs.readFileSync(filepath, 'utf-8')
      } catch {
        existingCode = ''
      }

      // 4. Build validation context
      const context: CodeValidationContext = {
        existingImports: this.extractImports(existingCode),
        existingTypes: this.extractTypes(existingCode)
      }

      // 5. Generate fix via LLM (AXIOM 5: No hollow placeholders)
      // We REFUSE if no LLM is available - never generate placeholder code
      if (!this.constrainedLLM) {
        return Err(new Error(
          `AXIOM 5 REFUSAL: No LLM available for code generation. ` +
          `Refusing to generate hollow placeholder. Configure LLM or fix manually.`
        ))
      }

      // ATTEMPT LLM CODE GENERATION (through 6 gates)
      const llmResult = await this.constrainedLLM.generateCode({
        issue: topIssue,
        filepath,
        existingCode,
        context
      })

      if (!llmResult.ok) {
        // AXIOM 5: Refusal Is a First-Class Outcome
        // LLM failed - REFUSE rather than generate hollow placeholder
        return Err(new Error(
          `AXIOM 5 REFUSAL: LLM code generation failed (${llmResult.error.message}). ` +
          `Refusing to generate hollow placeholder. Fix requires LLM or manual intervention.`
        ))
      }

      // LLM succeeded and passed all gates
      const proposal = {
        type: this.issueToChangeType(topIssue.type),
        code: llmResult.value.code
      }
      const gateValidation = llmResult.value.validation

      // 6. Build final proposal
      const improvementProposal: ImprovementProposal = {
        id: contentAddress({ issue: topIssue, change: proposal, timestamp: globalTimeProvider.now() }),
        targetFile: filepath,
        issue: topIssue,
        proposedChange: proposal,
        rationale: this.generateRationale(topIssue),
        timestamp: globalTimeProvider.now(),
        gateValidation,
        source: 'llm'  // Always 'llm' - we refuse rather than generate hollow placeholders
      }

      // 7. Classify the decision (Step 1 of ROADMAP - Decision Classification Gate)
      const classificationResult = classifyDecision(improvementProposal)
      if (classificationResult.ok) {
        improvementProposal.classification = classificationResult.value
        improvementProposal.gateRequirements = getRequiredGates(classificationResult.value)
      }

      // 8. Generate consequence surface (Step 2 of ROADMAP - Consequence Surface)
      // Only for irreversible decisions - makes closed doors visible
      if (improvementProposal.classification?.type === 'irreversible') {
        const consequenceResult = generateConsequenceSurface(improvementProposal)
        if (consequenceResult.ok) {
          improvementProposal.consequenceAnalysis = consequenceResult.value
        }

        // 9. Generate alternatives (Step 3 of ROADMAP - Alternative Tracking)
        // For irreversible decisions, document paths NOT taken
        const alternativeResult = generateAlternatives(improvementProposal)
        if (alternativeResult.ok) {
          improvementProposal.alternativeAnalysis = alternativeResult.value
        }
      }

      // 10. Check for prematurity (Step 5 of ROADMAP - Prematurity Detection)
      // Uses sophisticated signal-based detection
      const prematurityResult = checkPrematurity(
        improvementProposal,
        improvementProposal.alternativeAnalysis
      )
      if (prematurityResult.ok) {
        improvementProposal.prematurityCheck = prematurityResult.value

        // AXIOM 5 REFUSAL: Premature decisions with high confidence should be refused
        if (prematurityResult.value.premature && prematurityResult.value.confidence === 'high') {
          return Err(new Error(
            `AXIOM 5 REFUSAL: ${prematurityResult.value.reason} ` +
            `Recommendation: ${prematurityResult.value.deferralRecommendation}`
          ))
        }
      }

      // 11. Determine gate elevation (Step 9 of ROADMAP - Gate Elevation Protocol)
      // Gate strictness matches decision weight
      if (improvementProposal.classification) {
        const elevationResult = determineGateRequirements(
          improvementProposal,
          improvementProposal.classification.type,
          improvementProposal.prematurityCheck
        )
        if (elevationResult.ok) {
          improvementProposal.gateElevation = elevationResult.value
        }
      }

      return Ok(improvementProposal)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Map issue type to change type
   */
  private issueToChangeType(issueType: CodeIssue['type']): 'add_function' | 'modify_function' | 'add_test' | 'refactor' {
    const mapping: Record<CodeIssue['type'], 'add_function' | 'modify_function' | 'add_test' | 'refactor'> = {
      'NO_TESTS': 'add_test',
      'HIGH_COMPLEXITY': 'refactor',
      'NO_ERROR_HANDLING': 'modify_function',
      'DUPLICATE_CODE': 'refactor',
      'MISSING_TYPES': 'modify_function'
    }
    return mapping[issueType] || 'modify_function'
  }

  /**
   * Extract imports from existing code
   */
  private extractImports(code: string): string[] {
    const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from/g
    const imports: string[] = []
    let match

    while ((match = importRegex.exec(code)) !== null) {
      if (match[1]) {
        // Named imports: { a, b, c }
        imports.push(...match[1].split(',').map(s => s.trim()))
      } else if (match[2]) {
        // Default import
        imports.push(match[2])
      }
    }

    return imports
  }

  /**
   * Extract type names from existing code
   */
  private extractTypes(code: string): string[] {
    const typeRegex = /(?:type|interface)\s+(\w+)/g
    const types: string[] = ['number', 'string', 'boolean', 'void', 'null', 'undefined']
    let match

    while ((match = typeRegex.exec(code)) !== null) {
      types.push(match[1])
    }

    return types
  }

  // NOTE: generateDeterministicFix was REMOVED per AXIOM 5
  // The system now REFUSES rather than generating hollow placeholders.
  // See commit for rationale.

  /**
   * Generate rationale for improvement
   */
  private generateRationale(issue: CodeIssue): string {
    const reasons: Record<CodeIssue['type'], string> = {
      NO_TESTS: 'Adding tests improves reliability and enables safe refactoring',
      HIGH_COMPLEXITY: 'Reducing complexity improves maintainability and reduces bugs',
      NO_ERROR_HANDLING: 'Adding error handling prevents crashes and improves robustness',
      DUPLICATE_CODE: 'Removing duplication reduces maintenance burden',
      MISSING_TYPES: 'Adding types improves type safety and catches errors early'
    }

    return reasons[issue.type] || 'Improves code quality'
  }
}
