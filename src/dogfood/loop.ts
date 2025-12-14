// Dogfooding Loop - Motherlabs continuously improves itself
// Uses ConstrainedLLM for real code generation when API key available

import { analyzeDirectory } from '../analysis/codeAnalyzer'
import { SelfImprovementProposer, ImprovementProposal } from '../selfbuild/proposer'
import { AutoApplier, ApplyResult } from '../selfbuild/applier'
import { ConstrainedLLM } from '../llm/constrained'
import { LLMAdapter } from '../llm'
import { JSONLLedger } from '../persistence/jsonlLedger'
import { globalTimeProvider } from '../core/ids'

export type DogfoodingConfig = {
  cycleInterval: number  // ms between improvement attempts
  requireHumanApproval: boolean
  maxImprovementsPerCycle: number
  ledgerPath: string
  anthropicApiKey?: string  // Optional - enables LLM code generation
}

export class DogfoodingLoop {
  private proposer: SelfImprovementProposer
  private applier: AutoApplier
  private ledger: JSONLLedger
  private config: DogfoodingConfig
  private running: boolean = false
  private hasLLM: boolean = false

  constructor(config: DogfoodingConfig) {
    this.config = config
    this.ledger = new JSONLLedger(config.ledgerPath)
    this.applier = new AutoApplier()

    // Initialize with ConstrainedLLM if API key provided
    if (config.anthropicApiKey) {
      const llmAdapter = new LLMAdapter(config.anthropicApiKey)
      const constrainedLLM = new ConstrainedLLM(llmAdapter, 'evidence/llm-generations.jsonl')
      this.proposer = new SelfImprovementProposer(constrainedLLM)
      this.hasLLM = true
    } else {
      this.proposer = new SelfImprovementProposer()
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
    console.log('═══════════════════════════════════════')
    console.log('')
    console.log(`  Interval: ${this.config.cycleInterval / 1000}s`)
    console.log(`  Human approval: ${this.config.requireHumanApproval}`)
    console.log(`  LLM enabled: ${this.hasLLM}`)
    console.log('')

    // Log startup
    await this.ledger.append('loop_started', {
      config: {
        cycleInterval: this.config.cycleInterval,
        requireHumanApproval: this.config.requireHumanApproval,
        hasLLM: this.hasLLM
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
    await this.ledger.append('improvement_applied', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      source: proposal.source,
      beforeCommit: result.beforeCommit,
      afterCommit: result.afterCommit,
      testResults: result.testResults,
      timestamp: globalTimeProvider.now()
    })
  }

  private async logRejection(proposal: ImprovementProposal, reason: string): Promise<void> {
    await this.ledger.append('proposal_rejected', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      source: proposal.source,
      reason,
      timestamp: globalTimeProvider.now()
    })
  }

  private async logRollback(proposal: ImprovementProposal, result: ApplyResult): Promise<void> {
    await this.ledger.append('improvement_rolled_back', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      source: proposal.source,
      reason: 'Tests failed',
      testResults: result.testResults,
      timestamp: globalTimeProvider.now()
    })
  }

  private async logFailure(type: string, message: string): Promise<void> {
    await this.ledger.append('cycle_failure', {
      type,
      message,
      timestamp: globalTimeProvider.now()
    })
  }

  /**
   * Sleep between cycles
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
