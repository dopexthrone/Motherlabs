// Dogfooding Loop - Motherlabs continuously improves itself

import { analyzeDirectory } from '../analysis/codeAnalyzer'
import { SelfImprovementProposer, ImprovementProposal } from '../selfbuild/proposer'
import { AutoApplier, ApplyResult } from '../selfbuild/applier'
import { JSONLLedger } from '../persistence/jsonlLedger'
import { globalTimeProvider } from '../core/ids'
import { Result } from '../core/result'

export type DogfoodingConfig = {
  cycleInterval: number  // ms between improvement attempts
  requireHumanApproval: boolean
  maxImprovementsPerCycle: number
  ledgerPath: string
}

export class DogfoodingLoop {
  private proposer: SelfImprovementProposer
  private applier: AutoApplier
  private ledger: JSONLLedger
  private config: DogfoodingConfig
  private running: boolean = false

  constructor(config: DogfoodingConfig) {
    this.config = config
    this.proposer = new SelfImprovementProposer()
    this.applier = new AutoApplier()
    this.ledger = new JSONLLedger(config.ledgerPath)
  }

  /**
   * Start continuous self-improvement loop
   */
  async start(): Promise<void> {
    this.running = true

    console.log('🔄 Dogfooding loop started')
    console.log(`   Interval: ${this.config.cycleInterval / 1000}s`)
    console.log(`   Human approval: ${this.config.requireHumanApproval}`)
    console.log('')

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
  }

  /**
   * Run one improvement cycle
   */
  async runCycle(): Promise<void> {
    try {
      console.log('═══ Improvement Cycle ═══')
      console.log('')

      // 1. ANALYZE SELF (deterministic)
      console.log('[1/6] Analyzing source code...')
      const analysis = analyzeDirectory('src/')

      if (!analysis.ok) {
        console.error('Analysis failed:', analysis.error.message)
        await this.logFailure('analysis_failed', analysis.error.message)
        return
      }

      // Find all issues
      const allIssues = analysis.value.flatMap(a => a.issues)

      if (allIssues.length === 0) {
        console.log('✓ No issues found - system is optimal')
        await this.logEvent('no_issues_found')
        return
      }

      console.log(`Found ${allIssues.length} issues`)

      // 2. PROPOSE FIX (for highest priority issue)
      console.log('[2/6] Proposing improvement...')

      // Get file with highest priority issue
      const fileWithIssues = analysis.value.find(a => a.issues.length > 0)

      if (!fileWithIssues) {
        return
      }

      const proposal = await this.proposer.proposeImprovement(fileWithIssues.filepath)

      if (!proposal.ok) {
        console.log('No improvement possible')
        await this.logEvent('no_improvement_possible')
        return
      }

      console.log(`Proposed: ${proposal.value.issue.type} fix`)

      // 3. VALIDATE (6 gates already checked in proposer)
      console.log('[3/6] Validating proposal...')

      if (!proposal.value.gateValidation?.valid) {
        console.log('✗ Proposal failed gates - rejected')
        await this.logRejection(proposal.value, 'gate_validation_failed')
        return
      }

      console.log('✓ Passed all 6 gates')

      // 4. HUMAN APPROVAL (if required)
      if (this.config.requireHumanApproval) {
        console.log('[4/6] Waiting for human approval...')
        console.log('   UNIMPLEMENTED: Approval workflow')
        console.log('   Skipping for now (will implement interactive approval)')
        return
      }

      // 5. APPLY WITH ROLLBACK
      console.log('[5/6] Applying change...')

      const applyResult = await this.applier.apply(proposal.value)

      if (!applyResult.ok) {
        console.error('Apply failed:', applyResult.error.message)
        await this.logFailure('apply_failed', applyResult.error.message)
        return
      }

      if (!applyResult.value.success) {
        console.log('✗ Applied but tests failed - rolled back')
        await this.logRollback(proposal.value, applyResult.value)
        return
      }

      // 6. VERIFY IMPROVEMENT
      console.log('[6/6] Verifying improvement...')

      await this.logSuccess(proposal.value, applyResult.value)

      console.log('✓ Improvement applied successfully')
      console.log(`   Commit: ${applyResult.value.afterCommit}`)
      console.log('')

    } catch (error) {
      console.error('Cycle error:', error instanceof Error ? error.message : error)
      await this.logFailure('cycle_error', error instanceof Error ? error.message : String(error))
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
      beforeCommit: result.beforeCommit,
      afterCommit: result.afterCommit,
      testResults: result.testResults
    })
  }

  private async logRejection(proposal: ImprovementProposal, reason: string): Promise<void> {
    await this.ledger.append('proposal_rejected', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      reason
    })
  }

  private async logRollback(proposal: ImprovementProposal, result: ApplyResult): Promise<void> {
    await this.ledger.append('improvement_rolled_back', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      reason: 'Tests failed',
      testResults: result.testResults
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
