// Self-Improvement Proposer - Motherlabs proposes improvements to itself
// CONSTITUTIONAL GOVERNANCE - See docs/SELF_SCALING_RULESET.md
// Enforces: AXIOM 2 (Probabilistic Non-Authority), AXIOM 5 (Refusal First-Class)
// TCB Component: Self-modification subject to same gates as external artifacts
// Uses ConstrainedLLM for real code generation (AXIOM 5: Refuses if LLM unavailable)
// Integrated with governance system - records GATE_DECISION and EVIDENCE_ARTIFACT

import * as fs from 'fs'
import * as path from 'path'
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
import { createGateDecision, createGateDecisionScope } from '../core/gateDecision'
import { EFFECT_SETS } from '../core/effects'
import { createLLMResponseArtifact, createGateResultArtifact } from '../persistence/evidenceArtifact'
import { JSONLLedger } from '../persistence/jsonlLedger'
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
  private ledger: JSONLLedger | null

  constructor(constrainedLLM?: ConstrainedLLM, ledger?: JSONLLedger) {
    this.validator = new SixGateValidator()
    this.constrainedLLM = constrainedLLM || null
    this.ledger = ledger || null
  }

  /**
   * Set the governance ledger for recording gate decisions and artifacts
   */
  setLedger(ledger: JSONLLedger): void {
    this.ledger = ledger
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
      // Prioritize by: 1) issue type (prefer simpler fixes), 2) severity
      // This order ensures LLM can succeed with simpler tasks first
      const sortedIssues = analysis.value.issues.sort((a, b) => {
        // Issue type priority - simpler fixes first
        // NO_ERROR_HANDLING: Just add try/catch to existing function
        // MISSING_TYPES: Add type annotations
        // NO_TESTS: Requires generating entire test file with correct types
        const typeOrder: Record<string, number> = {
          'NO_ERROR_HANDLING': 0,  // Easiest - just add try/catch
          'MISSING_TYPES': 1,       // Add type annotations
          'NO_TESTS': 2,            // Hardest - requires new test file
        }
        const typeDiff = (typeOrder[a.type] ?? 5) - (typeOrder[b.type] ?? 5)
        if (typeDiff !== 0) return typeDiff

        // Within same type, prefer higher severity
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

      // 4. Build validation context (with ledger for governance tracking)
      // Gate 7: Progressive strictness - advisory for first test, required after
      const basename = path.basename(filepath, '.ts')
      const testFilePath = `tests/${basename}.test.ts`
      const hasExistingTest = fs.existsSync(testFilePath)

      const context: CodeValidationContext = {
        existingImports: this.extractImports(existingCode),
        existingTypes: this.extractTypes(existingCode),
        ledger: this.ledger || undefined,
        targetFile: filepath,
        // Gate 7: Test Quality settings
        strictTestQuality: hasExistingTest,  // Required if test exists, advisory otherwise
        testQualityThreshold: hasExistingTest ? 60 : 50  // Higher bar for subsequent tests
      }

      // NOTE: proposal_admission gate decision is now handled by ProposalBridge
      // in the dogfooding loop (step 4). The proposer's job is to propose and
      // validate, not to admit. Admission happens through the canonical ProposalV0
      // admission system after all gates pass.

      // 7. Generate fix via LLM (AXIOM 5: No hollow placeholders)
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
        // Record DENY gate decision for failed LLM generation
        if (this.ledger) {
          const codeId = contentAddress({ error: llmResult.error.message, filepath })
          await this.recordGateDecision(
            'llm_generation',
            'DENY',
            codeId,
            `LLM generation failed: ${llmResult.error.message}`
          )
        }

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

      // 8. Record ALLOW gate decision and evidence for successful LLM generation
      if (this.ledger) {
        const codeId = contentAddress(llmResult.value.code)

        // Record llm_generation ALLOW
        await this.recordGateDecision(
          'llm_generation',
          'ALLOW',
          codeId,
          `LLM generated code passed all ${gateValidation?.gateResults.length || 0} gates`
        )

        // Record LLM response artifact
        const llmArtifact = createLLMResponseArtifact(
          llmResult.value.code,
          this.constrainedLLM.getModel?.() || 'unknown',
          this.constrainedLLM.getProviderType?.() || 'unknown'
        )
        await this.ledger.appendArtifact(llmArtifact)

        // Record gate results artifact
        if (gateValidation) {
          const gateArtifact = createGateResultArtifact(
            'six_gate_validation',
            gateValidation.valid,
            gateValidation.rejectedAt,
            { gateResults: gateValidation.gateResults }
          )
          await this.ledger.appendArtifact(gateArtifact)
        }
      }

      // 9. Build final proposal
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

  /**
   * Record a gate decision to the governance ledger
   */
  private async recordGateDecision(
    gateType: 'proposal_admission' | 'llm_generation' | 'change_application' | 'human_approval',
    decision: 'ALLOW' | 'DENY',
    targetId: string,
    reason: string
  ): Promise<void> {
    if (!this.ledger) return

    const scope = createGateDecisionScope(
      gateType === 'llm_generation' ? 'code' : 'proposal',
      { id: targetId },
      undefined,
      decision === 'ALLOW' ? EFFECT_SETS.LLM_CODE_GENERATION : undefined
    )

    const gateDecision = createGateDecision(
      gateType,
      decision,
      scope,
      this.constrainedLLM ? `llm:${this.constrainedLLM.getProviderType?.() || 'unknown'}` : 'system',
      reason
    )

    await this.ledger.appendGateDecision(gateDecision)
  }
}
