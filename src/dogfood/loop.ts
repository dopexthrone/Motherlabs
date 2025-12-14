// Dogfooding Loop - Motherlabs continuously improves itself
// Uses ConstrainedLLM for real code generation when API key available
// Supports Anthropic, OpenAI, and Ollama (local) providers
// Step 10 of ROADMAP_NEXT_10.md: Self-Improvement Validation Loop
// Integrated with governance system (Phases 1-6)

import { analyzeDirectory } from '../analysis/codeAnalyzer'
import { SelfImprovementProposer, ImprovementProposal } from '../selfbuild/proposer'
import { AutoApplier, ApplyResult } from '../selfbuild/applier'
import { ConstrainedLLM } from '../llm/constrained'
import { OpenAIAdapter, OpenAIModel } from '../adapters/openaiAdapter'
import { AnthropicAdapter, AnthropicModel } from '../adapters/anthropicAdapter'
import { OllamaAdapter, OllamaConfig, detectBestCodeModel } from '../adapters/ollamaAdapter'
import { JSONLLedger } from '../persistence/jsonlLedger'
import { globalTimeProvider } from '../core/ids'
import { contentAddress } from '../core/contentAddress'
import { createGateDecision, createGateDecisionScope } from '../core/gateDecision'
import { EFFECT_SETS } from '../core/effects'
import { createProposalOutcome, TerminalStatus } from '../verification/outcomeConformance'
import { createEvidenceArtifact, createGateResultArtifact, createLLMResponseArtifact } from '../persistence/evidenceArtifact'
import { getProviderManifest } from '../adapters/manifest'
import type { LLMProviderType } from '../llm/types'

export type DogfoodingConfig = {
  cycleInterval: number  // ms between improvement attempts
  requireHumanApproval: boolean
  maxImprovementsPerCycle: number
  ledgerPath: string
  anthropicApiKey?: string    // Optional - enables Anthropic Claude
  anthropicModel?: AnthropicModel // Optional - defaults to claude-sonnet-4-5-20250929
  openaiApiKey?: string       // Optional - enables OpenAI LLM
  openaiModel?: OpenAIModel   // Optional - defaults to gpt-4o
  ollamaEnabled?: boolean     // Optional - enables local Ollama LLM
  ollamaConfig?: Partial<OllamaConfig>  // Optional - Ollama configuration
}

export class DogfoodingLoop {
  private proposer: SelfImprovementProposer
  private applier: AutoApplier
  private ledger: JSONLLedger
  private config: DogfoodingConfig
  private running: boolean = false
  private hasLLM: boolean = false
  private llmProvider: LLMProviderType | null = null
  private llmModel: string | null = null

  constructor(config: DogfoodingConfig) {
    this.config = config
    this.ledger = new JSONLLedger(config.ledgerPath)
    this.applier = new AutoApplier()

    // Initialize with ConstrainedLLM - prefer OpenAI if multiple provided
    if (config.openaiApiKey) {
      const openaiAdapter = new OpenAIAdapter(config.openaiApiKey, config.openaiModel || 'gpt-4o')
      const constrainedLLM = new ConstrainedLLM(openaiAdapter, 'evidence/llm-generations.jsonl')
      this.proposer = new SelfImprovementProposer(constrainedLLM, this.ledger)
      this.hasLLM = true
      this.llmProvider = 'openai'
      this.llmModel = config.openaiModel || 'gpt-4o'
    } else if (config.anthropicApiKey) {
      const anthropicAdapter = new AnthropicAdapter(
        config.anthropicApiKey,
        config.anthropicModel || 'claude-sonnet-4-5-20250929'
      )
      const constrainedLLM = new ConstrainedLLM(anthropicAdapter, 'evidence/llm-generations.jsonl')
      this.proposer = new SelfImprovementProposer(constrainedLLM, this.ledger)
      this.hasLLM = true
      this.llmProvider = 'anthropic'
      this.llmModel = config.anthropicModel || 'claude-sonnet-4-5-20250929'
    } else if (config.ollamaEnabled) {
      // Local LLM via Ollama - Step 8 of ROADMAP
      // Offline-first: No external API dependency
      const ollamaAdapter = new OllamaAdapter(config.ollamaConfig)
      const constrainedLLM = new ConstrainedLLM(ollamaAdapter, 'evidence/llm-generations.jsonl')
      this.proposer = new SelfImprovementProposer(constrainedLLM, this.ledger)
      this.hasLLM = true
      this.llmProvider = 'ollama'
      this.llmModel = config.ollamaConfig?.model || 'codellama:13b'
    } else {
      this.proposer = new SelfImprovementProposer(undefined, this.ledger)
      this.hasLLM = false
    }
  }

  /**
   * Start continuous self-improvement loop
   */
  async start(): Promise<void> {
    this.running = true

    console.log('═══════════════════════════════════════')
    console.log('  MOTHERLABS DOGFOODING LOOP')
    console.log('  Step 10: Self-Improvement Validation')
    console.log('═══════════════════════════════════════')
    console.log('')
    console.log(`  Interval: ${this.config.cycleInterval / 1000}s`)
    console.log(`  Human approval: ${this.config.requireHumanApproval}`)
    console.log(`  LLM enabled: ${this.hasLLM}`)
    if (this.llmProvider) {
      console.log(`  LLM provider: ${this.llmProvider}`)
      console.log(`  Model: ${this.llmModel}`)
    }
    console.log('')

    // Log startup
    await this.ledger.append('loop_started', {
      config: {
        cycleInterval: this.config.cycleInterval,
        requireHumanApproval: this.config.requireHumanApproval,
        hasLLM: this.hasLLM,
        llmProvider: this.llmProvider
      },
      timestamp: globalTimeProvider.now()
    })

    while (this.running) {
      await this.runCycle()
      await this.sleep(this.config.cycleInterval)
    }
  }

  /**
   * Stop the loop
   */
  stop(): void {
    this.running = false
    console.log('Loop stopping...')
  }

  /**
   * Run single cycle (for testing)
   */
  async runOnce(): Promise<{ success: boolean; proposal?: ImprovementProposal; error?: string }> {
    try {
      const result = await this.runCycleInternal()
      return result
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Run one improvement cycle
   */
  async runCycle(): Promise<void> {
    const result = await this.runCycleInternal()
    if (!result.success && result.error) {
      console.error('Cycle failed:', result.error)
    }
  }

  /**
   * Internal cycle implementation
   */
  private async runCycleInternal(): Promise<{ success: boolean; proposal?: ImprovementProposal; error?: string }> {
    try {
      console.log('')
      console.log('═══ Improvement Cycle ═══')
      console.log('')

      // 1. ANALYZE SELF (deterministic)
      console.log('[1/6] Analyzing source code...')
      const analysis = analyzeDirectory('src/')

      if (!analysis.ok) {
        const error = `Analysis failed: ${analysis.error.message}`
        await this.logFailure('analysis_failed', error)
        return { success: false, error }
      }

      // Find all issues
      const allIssues = analysis.value.flatMap(a => a.issues)

      if (allIssues.length === 0) {
        console.log('✓ No issues found - system is optimal')
        await this.logEvent('no_issues_found')
        return { success: true }
      }

      console.log(`  Found ${allIssues.length} issues across ${analysis.value.length} files`)

      // 2. PROPOSE FIX (for highest priority issue)
      console.log('[2/6] Proposing improvement...')

      // Get file with highest priority issue
      const fileWithIssues = analysis.value.find(a => a.issues.length > 0)

      if (!fileWithIssues) {
        return { success: true }
      }

      const proposal = await this.proposer.proposeImprovement(fileWithIssues.filepath)

      if (!proposal.ok) {
        const error = `No improvement possible: ${proposal.error.message}`
        await this.logEvent('no_improvement_possible', { reason: proposal.error.message })
        return { success: false, error }
      }

      console.log(`  Issue: ${proposal.value.issue.type}`)
      console.log(`  Source: ${proposal.value.source}`)
      console.log(`  File: ${proposal.value.targetFile}`)

      // 3. VALIDATE (6 gates already checked in proposer)
      console.log('[3/6] Validating proposal...')

      if (!proposal.value.gateValidation?.valid) {
        console.log('  ✗ Proposal failed gates - rejected')
        await this.logRejection(proposal.value, 'gate_validation_failed')
        return { success: false, error: 'Gate validation failed', proposal: proposal.value }
      }

      const passedGates = proposal.value.gateValidation.gateResults.filter(g => g.passed).length
      const totalGates = proposal.value.gateValidation.gateResults.length
      console.log(`  ✓ Passed ${passedGates}/${totalGates} gates`)

      // 4. HUMAN APPROVAL (if required)
      if (this.config.requireHumanApproval) {
        console.log('[4/6] Human approval required')
        console.log('  Proposal ready for review:')
        console.log(`  - Issue: ${proposal.value.issue.type}`)
        console.log(`  - File: ${proposal.value.targetFile}`)
        console.log(`  - Code length: ${proposal.value.proposedChange.code.length} chars`)
        console.log('')
        console.log('  (Approval workflow not yet implemented)')
        await this.logEvent('awaiting_approval', { proposalId: proposal.value.id })
        return { success: true, proposal: proposal.value }
      }

      // 5. APPLY WITH ROLLBACK
      console.log('[5/6] Applying change...')

      const applyResult = await this.applier.apply(proposal.value)

      if (!applyResult.ok) {
        const error = `Apply failed: ${applyResult.error.message}`
        await this.logFailure('apply_failed', error)
        return { success: false, error, proposal: proposal.value }
      }

      if (!applyResult.value.success) {
        console.log('  ✗ Applied but tests failed - rolled back')
        await this.logRollback(proposal.value, applyResult.value)
        return {
          success: false,
          error: 'Tests failed after apply - rolled back',
          proposal: proposal.value
        }
      }

      // 6. VERIFY IMPROVEMENT
      console.log('[6/6] Verifying improvement...')

      await this.logSuccess(proposal.value, applyResult.value)

      console.log('  ✓ Improvement applied successfully')
      console.log(`  Commit: ${applyResult.value.afterCommit?.slice(0, 8)}`)
      console.log('')

      return { success: true, proposal: proposal.value }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      await this.logFailure('cycle_error', errorMsg)
      return { success: false, error: errorMsg }
    }
  }

  /**
   * Log events to ledger
   */
  private async logEvent(eventType: string, data?: unknown): Promise<void> {
    await this.ledger.append('dogfood_event', {
      event: eventType,
      timestamp: globalTimeProvider.now(),
      data
    })
  }

  private async logSuccess(proposal: ImprovementProposal, result: ApplyResult): Promise<void> {
    // Create evidence artifacts for governance compliance
    const evidenceIds: string[] = []

    // Gate result artifact
    const gateArtifact = createGateResultArtifact(
      'all_gates',
      true,
      undefined,
      { gateResults: proposal.gateValidation?.gateResults }
    )
    await this.ledger.appendArtifact(gateArtifact)
    evidenceIds.push(gateArtifact.artifact_id)

    // Log improvement with evidence
    await this.ledger.append('improvement_applied', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      source: proposal.source,
      beforeCommit: result.beforeCommit,
      afterCommit: result.afterCommit,
      testResults: result.testResults,
      evidenceIds,
      grantedEffects: EFFECT_SETS.CODE_APPLICATION,
      exercisedEffects: ['CODE_MODIFY', 'GIT_COMMIT', 'LEDGER_APPEND'],
      timestamp: globalTimeProvider.now()
    })

    // Create outcome record
    const outcome = createProposalOutcome(proposal.id, 'COMPLETED', evidenceIds)
    await this.ledger.append('proposal_outcome', outcome)
  }

  private async logRejection(proposal: ImprovementProposal, reason: string): Promise<void> {
    // Create gate result artifact for rejection
    const gateArtifact = createGateResultArtifact(
      'validation',
      false,
      reason,
      { gateResults: proposal.gateValidation?.gateResults }
    )
    await this.ledger.appendArtifact(gateArtifact)

    await this.ledger.append('proposal_rejected', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      source: proposal.source,
      reason,
      evidenceIds: [gateArtifact.artifact_id],
      timestamp: globalTimeProvider.now()
    })

    // Create outcome record
    const outcome = createProposalOutcome(proposal.id, 'REJECTED', [gateArtifact.artifact_id])
    await this.ledger.append('proposal_outcome', outcome)
  }

  private async logRollback(proposal: ImprovementProposal, result: ApplyResult): Promise<void> {
    // Create evidence artifact for rollback
    const rollbackArtifact = createEvidenceArtifact(
      JSON.stringify({ testResults: result.testResults, reason: 'Tests failed' }),
      'rollback_snapshot',
      { created_at_utc: new Date().toISOString(), description: 'Rollback after failed tests' }
    )
    await this.ledger.appendArtifact(rollbackArtifact)

    await this.ledger.append('improvement_rolled_back', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      source: proposal.source,
      reason: 'Tests failed',
      testResults: result.testResults,
      evidenceIds: [rollbackArtifact.artifact_id],
      timestamp: globalTimeProvider.now()
    })

    // Create outcome record
    const outcome = createProposalOutcome(proposal.id, 'ROLLED_BACK', [rollbackArtifact.artifact_id])
    await this.ledger.append('proposal_outcome', outcome)
  }

  private async logFailure(type: string, message: string): Promise<void> {
    await this.ledger.append('cycle_failure', {
      type,
      message,
      timestamp: globalTimeProvider.now()
    })
  }

  /**
   * Record gate decision for governance tracking
   */
  private async recordGateDecision(
    gateType: 'proposal_admission' | 'change_application' | 'llm_generation' | 'human_approval',
    decision: 'ALLOW' | 'DENY',
    proposalId: string,
    reason: string
  ): Promise<void> {
    const scope = createGateDecisionScope(
      'proposal',
      { id: proposalId },
      undefined,
      decision === 'ALLOW' ? EFFECT_SETS.CODE_APPLICATION : undefined
    )

    const gateDecision = createGateDecision(
      gateType,
      decision,
      scope,
      this.llmProvider ? `provider:${this.llmProvider}` : 'system',
      reason
    )

    await this.ledger.appendGateDecision(gateDecision)
  }

  /**
   * Sleep between cycles
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
