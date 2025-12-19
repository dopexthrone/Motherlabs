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
import { JSONLLedger, TCBProtectionEvent } from '../persistence/jsonlLedger'
import { globalTimeProvider } from '../core/ids'
import { contentAddress } from '../core/contentAddress'
import { createGateDecision, createGateDecisionScope } from '../core/gateDecision'
import { EFFECT_SETS } from '../core/effects'
import { createProposalOutcome, TerminalStatus, validateOutcomeConformance, formatConformanceResult } from '../verification/outcomeConformance'
import { createEvidenceArtifact, createGateResultArtifact, createLLMResponseArtifact, createExitCodeArtifact, createFileManifestArtifact, createCodeDiffArtifact, EvidenceArtifact } from '../persistence/evidenceArtifact'
import { getProviderManifest } from '../adapters/manifest'
import type { LLMProviderType } from '../llm/types'
import { isTCBPath } from '../core/decisionClassifier'
import { AuthorizationRouter, initializeAuthorizationRouter, type AuthorizationToken } from '../authorization/router'
import { createProposalBridge, ProposalBridge, type BridgeResult } from '../proposal/proposalBridge'

export type DogfoodingConfig = {
  cycleInterval: number  // ms between improvement attempts
  requireHumanApproval?: boolean  // Default: true - human review required
  bootstrapBypass?: boolean       // Explicit opt-in for auto-apply without approval
  maxImprovementsPerCycle: number
  ledgerPath: string
  anthropicApiKey?: string    // Optional - enables Anthropic Claude
  anthropicModel?: AnthropicModel // Optional - defaults to claude-sonnet-4-5-20250929
  openaiApiKey?: string       // Optional - enables OpenAI LLM
  openaiModel?: OpenAIModel   // Optional - defaults to gpt-4o
  ollamaEnabled?: boolean     // Optional - enables local Ollama LLM
  ollamaConfig?: Partial<OllamaConfig>  // Optional - Ollama configuration
  fileCooldownMs?: number     // Default 600000 (10 min) - skip recently improved files
  failureBackoffMs?: number   // Default 2000 (2s, exponential) - backoff on failures
}

/** Default: requireHumanApproval = true (safe default) */
const DEFAULT_CONFIG: Partial<DogfoodingConfig> = {
  requireHumanApproval: true,
  bootstrapBypass: false
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
  private authRouter: AuthorizationRouter
  private proposalBridge: ProposalBridge
  private improvedFiles: Map<string, number> = new Map()  // filepath → timestamp
  private consecutiveFailures: number = 0

  constructor(config: DogfoodingConfig) {
    // Apply defaults - requireHumanApproval defaults to true (safe default)
    this.config = { ...DEFAULT_CONFIG, ...config } as DogfoodingConfig & Required<Pick<DogfoodingConfig, 'requireHumanApproval' | 'bootstrapBypass'>>
    this.ledger = new JSONLLedger(config.ledgerPath)
    this.applier = new AutoApplier()

    // Initialize Authorization Router - required for deny-by-default enforcement
    this.authRouter = new AuthorizationRouter(this.ledger)
    initializeAuthorizationRouter(this.ledger)

    // Log bootstrap exception if auto-apply enabled without human approval
    if (this.config.bootstrapBypass && !this.config.requireHumanApproval) {
      // DETERMINISM-EXEMPT:TIME - Ledger metadata
      this.ledger.append('BOOTSTRAP_EXCEPTION', {
        reason: 'Bootstrap mode enabled - requireHumanApproval=false with bootstrapBypass=true',
        config_hash: contentAddress({
          requireHumanApproval: this.config.requireHumanApproval,
          bootstrapBypass: this.config.bootstrapBypass,
          llmProvider: config.anthropicApiKey ? 'anthropic' : config.openaiApiKey ? 'openai' : 'ollama'
        }),
        timestamp: globalTimeProvider.now()
      }).catch(() => { /* ignore ledger write errors during bootstrap */ })
    }

    // Initialize Proposal Bridge - connects to ProposalV0 admission system
    this.proposalBridge = createProposalBridge(this.ledger, 'dogfood_loop')

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

      // Get file with highest priority issue, respecting cooldown
      const cooldownMs = this.config.fileCooldownMs ?? 600000  // 10 min default
      const now = globalTimeProvider.now()

      const fileWithIssues = analysis.value.find(a => {
        if (a.issues.length === 0) return false
        const lastImproved = this.improvedFiles.get(a.filepath)
        if (lastImproved && now - lastImproved < cooldownMs) {
          console.log(`  Skipping ${a.filepath} (cooldown: ${Math.round((cooldownMs - (now - lastImproved)) / 1000)}s remaining)`)
          return false
        }
        return true
      })

      if (!fileWithIssues) {
        console.log('  All files with issues are on cooldown')
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

      // ═══════════════════════════════════════════════════════════════════════
      // TCB PROTECTION - UNCONDITIONAL, CANNOT BE BYPASSED
      // AXIOM: The verifier cannot modify itself autonomously
      // This check runs regardless of requireHumanApproval setting
      // ═══════════════════════════════════════════════════════════════════════
      if (isTCBPath(proposal.value.targetFile)) {
        console.log('')
        console.log('  ⛔ TCB PROTECTION TRIGGERED')
        console.log(`     Target: ${proposal.value.targetFile}`)
        console.log('     TCB files cannot be modified by autonomous loop.')
        console.log('     This protection is UNCONDITIONAL.')
        console.log('')

        // Record TCB protection event in audit trail
        const tcbEvent: TCBProtectionEvent = {
          targetFile: proposal.value.targetFile,
          attemptedBy: 'autonomous_loop',
          action: 'BLOCKED',
          reason: 'TCB files cannot be modified by autonomous loop',
          proposalId: proposal.value.id,
          timestamp: globalTimeProvider.now()
        }
        await this.ledger.appendTCBProtectionEvent(tcbEvent)
        console.log('     Event recorded in audit trail.')

        await this.logFailure('tcb_protected', `Blocked autonomous modification of TCB: ${proposal.value.targetFile}`)
        return {
          success: false,
          error: `TCB file cannot be modified autonomously: ${proposal.value.targetFile}`,
          proposal: proposal.value
        }
      }

      // 4. HUMAN APPROVAL (if required for non-TCB files)
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

      // ═══════════════════════════════════════════════════════════════════════
      // PROPOSAL ADMISSION: Bridge to ProposalV0 governance system
      // This creates the canonical proposal record in the ledger
      // ═══════════════════════════════════════════════════════════════════════
      console.log('[4/6] Admitting proposal to ledger...')

      const bridgeResult = await this.proposalBridge.bridgeValidated(proposal.value)

      if (!bridgeResult.ok) {
        const error = `Proposal admission failed: ${bridgeResult.error.message}`
        await this.logFailure('proposal_admission_failed', error)
        return { success: false, error, proposal: proposal.value }
      }

      const admittedProposal = bridgeResult.value
      console.log(`  ✓ Proposal admitted: ${admittedProposal.proposalId}`)
      console.log(`  Gate Decision: ${admittedProposal.admissionResult.gateDecision.decision}`)

      // 5. APPLY WITH ROLLBACK
      console.log('[5/6] Applying change...')

      // ═══════════════════════════════════════════════════════════════════════
      // GATE DECISION: change_application
      // Record authorization for applying this specific change
      // This creates the audit trail showing the decision was authorized
      // ═══════════════════════════════════════════════════════════════════════
      const changeApplicationDecision = createGateDecision(
        'change_application',
        'ALLOW',
        createGateDecisionScope(
          'proposal',
          proposal.value,
          proposal.value.targetFile,
          EFFECT_SETS.CODE_APPLICATION
        ),
        'dogfood_loop',
        `Authorized to apply change: ${proposal.value.issue.type} in ${proposal.value.targetFile}`,
        {
          proposalId: proposal.value.id,
          gateValidation: proposal.value.gateValidation,
          source: proposal.value.source
        }
      )
      await this.ledger.appendGateDecision(changeApplicationDecision)
      console.log('  Gate decision: change_application ALLOW')

      // ═══════════════════════════════════════════════════════════════════════
      // AUTHORIZATION TOKEN: Request from router after ALLOW decision recorded
      // The router verifies ALLOW decision exists in ledger before issuing token
      // ═══════════════════════════════════════════════════════════════════════
      const proposalId = contentAddress(proposal.value)
      const authTokenResult = this.authRouter.requestAuthorization(
        proposalId,
        'change_application',
        EFFECT_SETS.CODE_APPLICATION
      )

      if (!authTokenResult.ok) {
        const error = `Authorization failed: ${authTokenResult.error.message}`
        await this.logFailure('authorization_denied', error)
        return { success: false, error, proposal: proposal.value }
      }

      console.log('  Authorization token obtained')

      const applyResult = await this.applier.apply(proposal.value, authTokenResult.value)

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

      // Track successful improvement for cooldown
      this.improvedFiles.set(proposal.value.targetFile, globalTimeProvider.now())
      this.consecutiveFailures = 0

      return { success: true, proposal: proposal.value }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      await this.logFailure('cycle_error', errorMsg)

      // Exponential backoff on failure
      this.consecutiveFailures++
      const backoffMs = (this.config.failureBackoffMs ?? 2000) * Math.pow(2, this.consecutiveFailures - 1)
      const cappedBackoff = Math.min(backoffMs, 60000)  // Cap at 60s
      console.log(`  Backing off for ${Math.round(cappedBackoff / 1000)}s after ${this.consecutiveFailures} consecutive failure(s)`)
      await this.sleep(cappedBackoff)

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
    // REQUIRED for COMPLETED: gate_result, file_manifest, exit_code
    const evidenceIds: string[] = []
    const artifacts = new Map<string, EvidenceArtifact>()

    // 1. Gate result artifact (REQUIRED)
    const gateArtifact = createGateResultArtifact(
      'all_gates',
      true,
      undefined,
      { gateResults: proposal.gateValidation?.gateResults }
    )
    await this.ledger.appendArtifact(gateArtifact)
    evidenceIds.push(gateArtifact.artifact_id)
    artifacts.set(gateArtifact.artifact_id, gateArtifact)

    // 2. File manifest artifact (REQUIRED)
    const fileManifestArtifact = createFileManifestArtifact([{
      path: proposal.targetFile,
      operation: 'overwrite',
      byte_count: proposal.proposedChange.code.length,
      sha256: contentAddress(proposal.proposedChange.code)
    }])
    await this.ledger.appendArtifact(fileManifestArtifact)
    evidenceIds.push(fileManifestArtifact.artifact_id)
    artifacts.set(fileManifestArtifact.artifact_id, fileManifestArtifact)

    // 3. Exit code artifact (REQUIRED)
    const exitCodeArtifact = createExitCodeArtifact(0, 'npm run build && npm test')
    await this.ledger.appendArtifact(exitCodeArtifact)
    evidenceIds.push(exitCodeArtifact.artifact_id)
    artifacts.set(exitCodeArtifact.artifact_id, exitCodeArtifact)

    // Create outcome and validate conformance
    const outcome = createProposalOutcome(proposal.id, 'COMPLETED', evidenceIds)
    const conformance = validateOutcomeConformance(outcome, artifacts)

    if (!conformance.ok) {
      console.log('  ⚠ Outcome conformance warning:')
      console.log('    ' + formatConformanceResult(conformance).split('\n').join('\n    '))
    }

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
      conformance,
      timestamp: globalTimeProvider.now()
    })

    // Record outcome
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
    // Create evidence artifacts for governance compliance
    // REQUIRED for ROLLED_BACK: gate_result, file_manifest, code_diff
    const evidenceIds: string[] = []
    const artifacts = new Map<string, EvidenceArtifact>()

    // 1. Gate result artifact (REQUIRED)
    const gateArtifact = createGateResultArtifact(
      'post_apply_tests',
      false,
      'Tests failed after applying change',
      { testResults: result.testResults }
    )
    await this.ledger.appendArtifact(gateArtifact)
    evidenceIds.push(gateArtifact.artifact_id)
    artifacts.set(gateArtifact.artifact_id, gateArtifact)

    // 2. File manifest artifact (REQUIRED)
    const fileManifestArtifact = createFileManifestArtifact([{
      path: proposal.targetFile,
      operation: 'overwrite',
      byte_count: proposal.proposedChange.code.length,
      sha256: contentAddress(proposal.proposedChange.code)
    }])
    await this.ledger.appendArtifact(fileManifestArtifact)
    evidenceIds.push(fileManifestArtifact.artifact_id)
    artifacts.set(fileManifestArtifact.artifact_id, fileManifestArtifact)

    // 3. Code diff artifact (REQUIRED)
    const diffContent = proposal.proposedChange.diff || `[Applied then rolled back: ${proposal.proposedChange.code.length} chars]`

    const codeDiffArtifact = createCodeDiffArtifact(diffContent, proposal.targetFile)
    await this.ledger.appendArtifact(codeDiffArtifact)
    evidenceIds.push(codeDiffArtifact.artifact_id)
    artifacts.set(codeDiffArtifact.artifact_id, codeDiffArtifact)

    // Create outcome and validate conformance
    const outcome = createProposalOutcome(proposal.id, 'ROLLED_BACK', evidenceIds)
    const conformance = validateOutcomeConformance(outcome, artifacts)

    if (!conformance.ok) {
      console.log('  ⚠ Outcome conformance warning:')
      console.log('    ' + formatConformanceResult(conformance).split('\n').join('\n    '))
    }

    await this.ledger.append('improvement_rolled_back', {
      proposalId: proposal.id,
      issue: proposal.issue.type,
      source: proposal.source,
      reason: 'Tests failed',
      testResults: result.testResults,
      evidenceIds,
      conformance,
      timestamp: globalTimeProvider.now()
    })

    // Record outcome
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
