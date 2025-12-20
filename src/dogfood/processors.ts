// Dogfood Processors - URCO and Collapse Chain implementations for self-improvement
// These processors understand ImprovementProposal structure and validate accordingly

import { Result, Ok, Err } from '../core/result'
import { globalTimeProvider } from '../core/ids'
import { contentAddress } from '../core/contentAddress'
import {
  PhaseProcessor,
  PhaseResult,
  PhaseArtifact,
  Entropy,
  URCOEngine,
  createURCO
} from '../core/urco'
import {
  CriticRole,
  VerifierRole,
  ExecutorRole,
  CritiqueResult,
  VerificationResult,
  ExecutionOutcome,
  Weakness,
  VerificationCheck,
  CollapseChain,
  createCollapseChain
} from '../core/collapseChain'
import { SixGateValidator, CodeValidationContext } from '../validation/sixGates'
import { isTCBPath } from '../core/decisionClassifier'
import { AutoApplier, ApplyResult } from '../selfbuild/applier'
import type { ImprovementProposal } from '../selfbuild/proposer'
import type { AuthorizationToken } from '../authorization/router'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ProposalURCOInput = {
  proposal: ImprovementProposal
  validationContext?: CodeValidationContext
}

export type ProposalCollapseContext = {
  proposal: ImprovementProposal
  authToken?: AuthorizationToken
  applier?: AutoApplier
  dryRun?: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// URCO PROCESSOR FOR PROPOSALS
// ═══════════════════════════════════════════════════════════════════════════

function createArtifact(
  phase: 'expand' | 'examine' | 'remove' | 'synthesize',
  observation: string,
  entropy: Entropy
): PhaseArtifact {
  return { phase, observation, entropy, timestamp: globalTimeProvider.now() }
}

export const proposalPhaseProcessor: PhaseProcessor<ProposalURCOInput> = {
  /**
   * EXPAND: Reveal unknowns in the proposal
   * - Check what the proposal affects
   * - Identify dependencies
   * - Surface hidden risks
   */
  async expand(input: ProposalURCOInput, context: Record<string, unknown>): Promise<PhaseResult<ProposalURCOInput>> {
    const artifacts: PhaseArtifact[] = []
    const { proposal } = input

    // Analyze what this proposal touches
    const isTCB = isTCBPath(proposal.targetFile)
    const changeType = proposal.proposedChange.type
    const codeLength = proposal.proposedChange.code.length
    const issueType = proposal.issue.type
    const severity = proposal.issue.severity

    artifacts.push(createArtifact('expand',
      `Target: ${proposal.targetFile} (${isTCB ? 'TCB' : 'non-TCB'})`,
      isTCB ? 0.9 : 0.4
    ))

    artifacts.push(createArtifact('expand',
      `Change: ${changeType}, ${codeLength} chars for ${issueType} (${severity})`,
      severity === 'critical' ? 0.7 : severity === 'high' ? 0.5 : 0.3
    ))

    // Check classification if available
    if (proposal.classification) {
      artifacts.push(createArtifact('expand',
        `Classification: ${proposal.classification.type}`,
        proposal.classification.type === 'irreversible' ? 0.8 : 0.4
      ))
    }

    // Check gate validation status
    if (proposal.gateValidation) {
      const passed = proposal.gateValidation.gateResults.filter(g => g.passed).length
      const total = proposal.gateValidation.gateResults.length
      artifacts.push(createArtifact('expand',
        `Gates: ${passed}/${total} passed`,
        proposal.gateValidation.valid ? 0.2 : 0.8
      ))
    }

    // Calculate overall entropy from expansion
    const entropy = isTCB ? 0.95 : proposal.gateValidation?.valid ? 0.3 : 0.7

    return {
      output: input,
      entropy,
      artifacts,
      metadata: { isTCB, changeType, codeLength, severity }
    }
  },

  /**
   * EXAMINE: Evaluate the proposal quality
   * - Re-validate gates
   * - Check code quality
   * - Assess risk
   */
  async examine(input: ProposalURCOInput, context: Record<string, unknown>): Promise<PhaseResult<ProposalURCOInput>> {
    const artifacts: PhaseArtifact[] = []
    const { proposal, validationContext } = input

    // Check prematurity
    if (proposal.prematurityCheck?.premature) {
      artifacts.push(createArtifact('examine',
        `Prematurity warning: ${proposal.prematurityCheck.reason}`,
        0.8
      ))
    }

    // Check consequences if available
    if (proposal.consequenceAnalysis) {
      const riskLevel = proposal.consequenceAnalysis.riskLevel
      artifacts.push(createArtifact('examine',
        `Consequence risk: ${riskLevel}`,
        riskLevel === 'critical' ? 0.9 : riskLevel === 'high' ? 0.7 : 0.4
      ))
    }

    // Check alternatives if available
    if (proposal.alternativeAnalysis) {
      const altCount = proposal.alternativeAnalysis.alternatives.length
      artifacts.push(createArtifact('examine',
        `${altCount} alternative approaches considered`,
        altCount > 0 ? 0.3 : 0.6
      ))
    }

    // Overall examination entropy
    const hasWarnings = proposal.prematurityCheck?.premature ||
      proposal.consequenceAnalysis?.riskLevel === 'critical'
    const entropy = hasWarnings ? 0.7 : 0.3

    artifacts.push(createArtifact('examine',
      hasWarnings ? 'Examination found concerns' : 'Examination passed',
      entropy
    ))

    return {
      output: input,
      entropy,
      artifacts,
      metadata: { hasWarnings }
    }
  },

  /**
   * REMOVE: Strip unnecessary complexity
   * - Flag issues that shouldn't block
   * - Simplify decision path
   */
  async remove(input: ProposalURCOInput, context: Record<string, unknown>): Promise<PhaseResult<ProposalURCOInput>> {
    const artifacts: PhaseArtifact[] = []
    const { proposal } = input

    // Identify non-blocking issues
    const minorGateIssues = proposal.gateValidation?.gateResults
      .filter(g => !g.passed && g.gateName.includes('advisory'))
      .length || 0

    if (minorGateIssues > 0) {
      artifacts.push(createArtifact('remove',
        `${minorGateIssues} advisory gate issues (non-blocking)`,
        0.3
      ))
    }

    // Check for over-engineering signals
    const codeLength = proposal.proposedChange.code.length
    const isOverEngineered = codeLength > 5000 && proposal.issue.severity !== 'critical'

    if (isOverEngineered) {
      artifacts.push(createArtifact('remove',
        `Large change (${codeLength} chars) for ${proposal.issue.severity} issue - may be over-engineered`,
        0.6
      ))
    }

    artifacts.push(createArtifact('remove',
      'Noise reduction complete',
      0.2
    ))

    return {
      output: input,
      entropy: 0.2,
      artifacts,
      metadata: { minorGateIssues, isOverEngineered }
    }
  },

  /**
   * SYNTHESIZE: Package for collapse chain
   * - Summarize findings
   * - Prepare for critic
   */
  async synthesize(input: ProposalURCOInput, context: Record<string, unknown>): Promise<PhaseResult<ProposalURCOInput>> {
    const artifacts: PhaseArtifact[] = []
    const { proposal } = input

    // Summarize readiness
    // Only HIGH confidence prematurity is blocking (matches AXIOM 5 in proposer.ts)
    const isHighConfidencePremature = proposal.prematurityCheck?.premature &&
      proposal.prematurityCheck.confidence === 'high'

    const isReady = proposal.gateValidation?.valid &&
      !isTCBPath(proposal.targetFile) &&
      !isHighConfidencePremature

    // Determine the blocking reason
    let blockingReason = ''
    if (!proposal.gateValidation?.valid) {
      blockingReason = 'gates failed'
    } else if (isTCBPath(proposal.targetFile)) {
      blockingReason = 'TCB protected'
    } else if (isHighConfidencePremature) {
      blockingReason = 'premature (high confidence)'
    }

    artifacts.push(createArtifact('synthesize',
      isReady
        ? `Proposal ready for collapse chain: ${proposal.issue.type} fix`
        : `Proposal NOT ready: ${blockingReason}`,
      isReady ? 0.1 : 0.8
    ))

    return {
      output: input,
      entropy: isReady ? 0.1 : 0.8,
      artifacts,
      metadata: { isReady }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLAPSE CHAIN ROLES FOR PROPOSALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Proposal Critic - Skeptical examiner that exposes weaknesses
 */
export function createProposalCritic(): CriticRole<ProposalURCOInput> {
  return {
    async critique(input: ProposalURCOInput, context: Record<string, unknown>): Promise<CritiqueResult> {
      const startTime = globalTimeProvider.now()
      const weaknesses: Weakness[] = []
      const { proposal } = input

      // FATAL: TCB protection
      if (isTCBPath(proposal.targetFile)) {
        weaknesses.push({
          id: 'tcb-protected',
          severity: 'fatal',
          category: 'security',
          description: `Target file is TCB-protected: ${proposal.targetFile}`,
          suggestion: 'TCB files cannot be modified autonomously'
        })
      }

      // FATAL: No gate validation
      if (!proposal.gateValidation) {
        weaknesses.push({
          id: 'no-gate-validation',
          severity: 'fatal',
          category: 'validation',
          description: 'Proposal has no gate validation results',
          suggestion: 'Run proposal through SixGateValidator first'
        })
      }

      // FATAL: Gates failed
      if (proposal.gateValidation && !proposal.gateValidation.valid) {
        const failedGates = proposal.gateValidation.gateResults
          .filter(g => !g.passed)
          .map(g => g.gateName)
          .join(', ')
        weaknesses.push({
          id: 'gates-failed',
          severity: 'fatal',
          category: 'validation',
          description: `Gate validation failed: ${failedGates || 'unknown'}`,
          suggestion: 'Fix gate failures before proceeding'
        })
      }

      // MAJOR: Prematurity warning
      if (proposal.prematurityCheck?.premature) {
        weaknesses.push({
          id: 'premature-change',
          severity: 'major',
          category: 'timing',
          description: proposal.prematurityCheck.reason || 'Change is premature',
          suggestion: proposal.prematurityCheck.deferralRecommendation || 'Wait for better timing'
        })
      }

      // MAJOR: Critical risk for non-critical issue
      if (proposal.consequenceAnalysis?.riskLevel === 'critical' &&
          proposal.issue.severity !== 'critical') {
        weaknesses.push({
          id: 'risk-severity-mismatch',
          severity: 'major',
          category: 'risk',
          description: 'Critical risk change for non-critical issue',
          suggestion: 'Consider if this change is necessary'
        })
      }

      // MINOR: No alternatives considered
      if (!proposal.alternativeAnalysis || proposal.alternativeAnalysis.alternatives.length === 0) {
        weaknesses.push({
          id: 'no-alternatives',
          severity: 'minor',
          category: 'completeness',
          description: 'No alternative approaches were considered',
          suggestion: 'Document why this approach was chosen'
        })
      }

      // MINOR: Large code change
      if (proposal.proposedChange.code.length > 3000) {
        weaknesses.push({
          id: 'large-change',
          severity: 'minor',
          category: 'complexity',
          description: `Large code change: ${proposal.proposedChange.code.length} characters`,
          suggestion: 'Consider breaking into smaller changes'
        })
      }

      const fatalCount = weaknesses.filter(w => w.severity === 'fatal').length
      const majorCount = weaknesses.filter(w => w.severity === 'major').length
      const minorCount = weaknesses.filter(w => w.severity === 'minor').length

      const endTime = globalTimeProvider.now()

      return {
        approved: fatalCount === 0,
        weaknesses,
        fatalCount,
        majorCount,
        minorCount,
        summary: fatalCount > 0
          ? `REJECTED: ${fatalCount} fatal weakness(es) - ${weaknesses.filter(w => w.severity === 'fatal').map(w => w.id).join(', ')}`
          : majorCount > 0
            ? `APPROVED WITH WARNINGS: ${majorCount} major concern(s)`
            : `APPROVED: Proposal passes critique`,
        timestamp: startTime,
        durationMs: endTime - startTime
      }
    }
  }
}

/**
 * Proposal Verifier - Establishes truth through verification checks
 */
export function createProposalVerifier(): VerifierRole<ProposalURCOInput> {
  return {
    async verify(input: ProposalURCOInput, critique: CritiqueResult, context: Record<string, unknown>): Promise<VerificationResult> {
      const startTime = globalTimeProvider.now()
      const checks: VerificationCheck[] = []
      const { proposal } = input

      // Check 1: Critique was performed
      checks.push({
        name: 'critique_performed',
        passed: critique.timestamp > 0,
        evidence: `Critique completed with ${critique.weaknesses.length} findings`
      })

      // Check 2: No fatal weaknesses
      checks.push({
        name: 'no_fatal_weaknesses',
        passed: critique.fatalCount === 0,
        evidence: critique.fatalCount === 0
          ? 'No fatal weaknesses'
          : `${critique.fatalCount} fatal weakness(es)`,
        error: critique.fatalCount > 0 ? 'Fatal weaknesses present' : undefined
      })

      // Check 3: Proposal has ID
      checks.push({
        name: 'proposal_has_id',
        passed: !!proposal.id,
        evidence: proposal.id ? `ID: ${proposal.id.slice(0, 16)}...` : 'No ID'
      })

      // Check 4: Gates passed
      checks.push({
        name: 'gates_passed',
        passed: proposal.gateValidation?.valid === true,
        evidence: proposal.gateValidation?.valid
          ? `${proposal.gateValidation.gateResults.filter(g => g.passed).length} gates passed`
          : 'Gates not passed',
        error: !proposal.gateValidation?.valid ? 'Gate validation failed' : undefined
      })

      // Check 5: Code is present
      checks.push({
        name: 'code_present',
        passed: proposal.proposedChange.code.length > 0,
        evidence: `${proposal.proposedChange.code.length} characters of code`
      })

      // Check 6: Source is LLM (not placeholder)
      checks.push({
        name: 'source_is_llm',
        passed: proposal.source === 'llm',
        evidence: `Source: ${proposal.source}`,
        error: proposal.source !== 'llm' ? 'Non-LLM source may be placeholder' : undefined
      })

      // Check 7: URCO provenance
      const urcoResult = context.urcoResult as { cycleId?: string } | undefined
      checks.push({
        name: 'urco_provenance',
        passed: !!urcoResult?.cycleId,
        evidence: urcoResult?.cycleId
          ? `URCO cycle: ${urcoResult.cycleId.slice(0, 16)}...`
          : 'No URCO provenance'
      })

      const passedCount = checks.filter(c => c.passed).length
      const failedCount = checks.filter(c => !c.passed).length
      const provenanceVerified = checks.find(c => c.name === 'urco_provenance')?.passed || false
      const truthEstablished = failedCount === 0

      const endTime = globalTimeProvider.now()

      return {
        approved: truthEstablished,
        checks,
        passedCount,
        failedCount,
        provenanceVerified,
        truthEstablished,
        summary: truthEstablished
          ? `VERIFIED: All ${passedCount} checks passed`
          : `REJECTED: ${failedCount} check(s) failed - ${checks.filter(c => !c.passed).map(c => c.name).join(', ')}`,
        timestamp: startTime,
        durationMs: endTime - startTime
      }
    }
  }
}

/**
 * Proposal Executor - Applies the change without interpretation
 */
export function createProposalExecutor(): ExecutorRole<ProposalURCOInput, ApplyResult> {
  return {
    async execute(input: ProposalURCOInput, verification: VerificationResult, context: Record<string, unknown>): Promise<ExecutionOutcome> {
      const startTime = globalTimeProvider.now()
      const { proposal } = input
      const collapseContext = context as ProposalCollapseContext

      // Dry run mode - don't actually apply
      if (collapseContext.dryRun) {
        return {
          executed: true,
          action: 'dry_run',
          result: { dryRun: true, proposalId: proposal.id },
          sideEffects: ['Logged proposal (dry run - no changes made)'],
          timestamp: startTime,
          durationMs: globalTimeProvider.now() - startTime
        }
      }

      // Need auth token and applier for real execution
      if (!collapseContext.authToken || !collapseContext.applier) {
        return {
          executed: false,
          action: 'apply_change',
          result: null,
          sideEffects: [],
          error: 'Missing authToken or applier - cannot execute',
          timestamp: startTime,
          durationMs: globalTimeProvider.now() - startTime
        }
      }

      // Execute the apply
      try {
        const applyResult = await collapseContext.applier.apply(proposal, collapseContext.authToken)

        if (!applyResult.ok) {
          return {
            executed: false,
            action: 'apply_change',
            result: null,
            sideEffects: [],
            error: applyResult.error.message,
            timestamp: startTime,
            durationMs: globalTimeProvider.now() - startTime
          }
        }

        const result = applyResult.value
        const sideEffects: string[] = []

        if (result.success) {
          sideEffects.push(`Modified: ${proposal.targetFile}`)
          sideEffects.push(`Commit: ${result.afterCommit?.slice(0, 8)}`)
          if (result.testResults) {
            sideEffects.push(`Tests: ${result.testResults.passed} passed, ${result.testResults.failed} failed`)
          }
        } else if (result.rolledBack) {
          sideEffects.push(`Rolled back: ${result.error}`)
        }

        return {
          executed: result.success,
          action: 'apply_change',
          result,
          sideEffects,
          error: result.success ? undefined : result.error,
          timestamp: startTime,
          durationMs: globalTimeProvider.now() - startTime
        }

      } catch (error) {
        return {
          executed: false,
          action: 'apply_change',
          result: null,
          sideEffects: [],
          error: error instanceof Error ? error.message : String(error),
          timestamp: startTime,
          durationMs: globalTimeProvider.now() - startTime
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create URCO engine for proposals
 */
export function createProposalURCO(): URCOEngine<ProposalURCOInput> {
  return createURCO(proposalPhaseProcessor, {
    maxDepth: 2,
    entropyThreshold: 0.15
  })
}

/**
 * Create Collapse Chain for proposals
 */
export function createProposalCollapseChain(): CollapseChain<ProposalURCOInput, ApplyResult> {
  return createCollapseChain(
    createProposalCritic(),
    createProposalVerifier(),
    createProposalExecutor()
  )
}

/**
 * Process a proposal through URCO then Collapse Chain
 * This is the full pipeline for self-improvement
 */
export async function processProposal(
  proposal: ImprovementProposal,
  context: ProposalCollapseContext
): Promise<Result<{
  urcoResult: ReturnType<URCOEngine<ProposalURCOInput>['process']> extends Promise<infer R> ? R : never
  collapseResult: ReturnType<CollapseChain<ProposalURCOInput, ApplyResult>['collapse']> extends Promise<infer R> ? R : never
}, Error>> {
  const urco = createProposalURCO()
  const chain = createProposalCollapseChain()

  // Phase 1: URCO - Reduce entropy, increase clarity
  const urcoResult = await urco.process({
    subject: { proposal },
    context: {}
  })

  if (!urcoResult.ok) {
    return Err(urcoResult.error)
  }

  // Phase 2: Collapse Chain - Reduce uncertainty into action
  const collapseResult = await chain.collapse(urcoResult.value.output, {
    ...context,
    urcoResult: urcoResult.value
  })

  if (!collapseResult.ok) {
    return Err(collapseResult.error)
  }

  return Ok({
    urcoResult: urcoResult,
    collapseResult: collapseResult
  })
}
