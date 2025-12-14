"use strict";
// Dogfooding Loop - Motherlabs continuously improves itself
// Uses ConstrainedLLM for real code generation when API key available
// Supports Anthropic, OpenAI, and Ollama (local) providers
// Step 10 of ROADMAP_NEXT_10.md: Self-Improvement Validation Loop
// Integrated with governance system (Phases 1-6)
Object.defineProperty(exports, "__esModule", { value: true });
exports.DogfoodingLoop = void 0;
const codeAnalyzer_1 = require("../analysis/codeAnalyzer");
const proposer_1 = require("../selfbuild/proposer");
const applier_1 = require("../selfbuild/applier");
const constrained_1 = require("../llm/constrained");
const openaiAdapter_1 = require("../adapters/openaiAdapter");
const anthropicAdapter_1 = require("../adapters/anthropicAdapter");
const ollamaAdapter_1 = require("../adapters/ollamaAdapter");
const jsonlLedger_1 = require("../persistence/jsonlLedger");
const ids_1 = require("../core/ids");
const gateDecision_1 = require("../core/gateDecision");
const effects_1 = require("../core/effects");
const outcomeConformance_1 = require("../verification/outcomeConformance");
const evidenceArtifact_1 = require("../persistence/evidenceArtifact");
class DogfoodingLoop {
    proposer;
    applier;
    ledger;
    config;
    running = false;
    hasLLM = false;
    llmProvider = null;
    llmModel = null;
    constructor(config) {
        this.config = config;
        this.ledger = new jsonlLedger_1.JSONLLedger(config.ledgerPath);
        this.applier = new applier_1.AutoApplier();
        // Initialize with ConstrainedLLM - prefer OpenAI if multiple provided
        if (config.openaiApiKey) {
            const openaiAdapter = new openaiAdapter_1.OpenAIAdapter(config.openaiApiKey, config.openaiModel || 'gpt-4o');
            const constrainedLLM = new constrained_1.ConstrainedLLM(openaiAdapter, 'evidence/llm-generations.jsonl');
            this.proposer = new proposer_1.SelfImprovementProposer(constrainedLLM, this.ledger);
            this.hasLLM = true;
            this.llmProvider = 'openai';
            this.llmModel = config.openaiModel || 'gpt-4o';
        }
        else if (config.anthropicApiKey) {
            const anthropicAdapter = new anthropicAdapter_1.AnthropicAdapter(config.anthropicApiKey, config.anthropicModel || 'claude-sonnet-4-5-20250929');
            const constrainedLLM = new constrained_1.ConstrainedLLM(anthropicAdapter, 'evidence/llm-generations.jsonl');
            this.proposer = new proposer_1.SelfImprovementProposer(constrainedLLM, this.ledger);
            this.hasLLM = true;
            this.llmProvider = 'anthropic';
            this.llmModel = config.anthropicModel || 'claude-sonnet-4-5-20250929';
        }
        else if (config.ollamaEnabled) {
            // Local LLM via Ollama - Step 8 of ROADMAP
            // Offline-first: No external API dependency
            const ollamaAdapter = new ollamaAdapter_1.OllamaAdapter(config.ollamaConfig);
            const constrainedLLM = new constrained_1.ConstrainedLLM(ollamaAdapter, 'evidence/llm-generations.jsonl');
            this.proposer = new proposer_1.SelfImprovementProposer(constrainedLLM, this.ledger);
            this.hasLLM = true;
            this.llmProvider = 'ollama';
            this.llmModel = config.ollamaConfig?.model || 'codellama:13b';
        }
        else {
            this.proposer = new proposer_1.SelfImprovementProposer(undefined, this.ledger);
            this.hasLLM = false;
        }
    }
    /**
     * Start continuous self-improvement loop
     */
    async start() {
        this.running = true;
        console.log('═══════════════════════════════════════');
        console.log('  MOTHERLABS DOGFOODING LOOP');
        console.log('  Step 10: Self-Improvement Validation');
        console.log('═══════════════════════════════════════');
        console.log('');
        console.log(`  Interval: ${this.config.cycleInterval / 1000}s`);
        console.log(`  Human approval: ${this.config.requireHumanApproval}`);
        console.log(`  LLM enabled: ${this.hasLLM}`);
        if (this.llmProvider) {
            console.log(`  LLM provider: ${this.llmProvider}`);
            console.log(`  Model: ${this.llmModel}`);
        }
        console.log('');
        // Log startup
        await this.ledger.append('loop_started', {
            config: {
                cycleInterval: this.config.cycleInterval,
                requireHumanApproval: this.config.requireHumanApproval,
                hasLLM: this.hasLLM,
                llmProvider: this.llmProvider
            },
            timestamp: ids_1.globalTimeProvider.now()
        });
        while (this.running) {
            await this.runCycle();
            await this.sleep(this.config.cycleInterval);
        }
    }
    /**
     * Stop the loop
     */
    stop() {
        this.running = false;
        console.log('Loop stopping...');
    }
    /**
     * Run single cycle (for testing)
     */
    async runOnce() {
        try {
            const result = await this.runCycleInternal();
            return result;
        }
        catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    /**
     * Run one improvement cycle
     */
    async runCycle() {
        const result = await this.runCycleInternal();
        if (!result.success && result.error) {
            console.error('Cycle failed:', result.error);
        }
    }
    /**
     * Internal cycle implementation
     */
    async runCycleInternal() {
        try {
            console.log('');
            console.log('═══ Improvement Cycle ═══');
            console.log('');
            // 1. ANALYZE SELF (deterministic)
            console.log('[1/6] Analyzing source code...');
            const analysis = (0, codeAnalyzer_1.analyzeDirectory)('src/');
            if (!analysis.ok) {
                const error = `Analysis failed: ${analysis.error.message}`;
                await this.logFailure('analysis_failed', error);
                return { success: false, error };
            }
            // Find all issues
            const allIssues = analysis.value.flatMap(a => a.issues);
            if (allIssues.length === 0) {
                console.log('✓ No issues found - system is optimal');
                await this.logEvent('no_issues_found');
                return { success: true };
            }
            console.log(`  Found ${allIssues.length} issues across ${analysis.value.length} files`);
            // 2. PROPOSE FIX (for highest priority issue)
            console.log('[2/6] Proposing improvement...');
            // Get file with highest priority issue
            const fileWithIssues = analysis.value.find(a => a.issues.length > 0);
            if (!fileWithIssues) {
                return { success: true };
            }
            const proposal = await this.proposer.proposeImprovement(fileWithIssues.filepath);
            if (!proposal.ok) {
                const error = `No improvement possible: ${proposal.error.message}`;
                await this.logEvent('no_improvement_possible', { reason: proposal.error.message });
                return { success: false, error };
            }
            console.log(`  Issue: ${proposal.value.issue.type}`);
            console.log(`  Source: ${proposal.value.source}`);
            console.log(`  File: ${proposal.value.targetFile}`);
            // 3. VALIDATE (6 gates already checked in proposer)
            console.log('[3/6] Validating proposal...');
            if (!proposal.value.gateValidation?.valid) {
                console.log('  ✗ Proposal failed gates - rejected');
                await this.logRejection(proposal.value, 'gate_validation_failed');
                return { success: false, error: 'Gate validation failed', proposal: proposal.value };
            }
            const passedGates = proposal.value.gateValidation.gateResults.filter(g => g.passed).length;
            const totalGates = proposal.value.gateValidation.gateResults.length;
            console.log(`  ✓ Passed ${passedGates}/${totalGates} gates`);
            // 4. HUMAN APPROVAL (if required)
            if (this.config.requireHumanApproval) {
                console.log('[4/6] Human approval required');
                console.log('  Proposal ready for review:');
                console.log(`  - Issue: ${proposal.value.issue.type}`);
                console.log(`  - File: ${proposal.value.targetFile}`);
                console.log(`  - Code length: ${proposal.value.proposedChange.code.length} chars`);
                console.log('');
                console.log('  (Approval workflow not yet implemented)');
                await this.logEvent('awaiting_approval', { proposalId: proposal.value.id });
                return { success: true, proposal: proposal.value };
            }
            // 5. APPLY WITH ROLLBACK
            console.log('[5/6] Applying change...');
            const applyResult = await this.applier.apply(proposal.value);
            if (!applyResult.ok) {
                const error = `Apply failed: ${applyResult.error.message}`;
                await this.logFailure('apply_failed', error);
                return { success: false, error, proposal: proposal.value };
            }
            if (!applyResult.value.success) {
                console.log('  ✗ Applied but tests failed - rolled back');
                await this.logRollback(proposal.value, applyResult.value);
                return {
                    success: false,
                    error: 'Tests failed after apply - rolled back',
                    proposal: proposal.value
                };
            }
            // 6. VERIFY IMPROVEMENT
            console.log('[6/6] Verifying improvement...');
            await this.logSuccess(proposal.value, applyResult.value);
            console.log('  ✓ Improvement applied successfully');
            console.log(`  Commit: ${applyResult.value.afterCommit?.slice(0, 8)}`);
            console.log('');
            return { success: true, proposal: proposal.value };
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            await this.logFailure('cycle_error', errorMsg);
            return { success: false, error: errorMsg };
        }
    }
    /**
     * Log events to ledger
     */
    async logEvent(eventType, data) {
        await this.ledger.append('dogfood_event', {
            event: eventType,
            timestamp: ids_1.globalTimeProvider.now(),
            data
        });
    }
    async logSuccess(proposal, result) {
        // Create evidence artifacts for governance compliance
        const evidenceIds = [];
        // Gate result artifact
        const gateArtifact = (0, evidenceArtifact_1.createGateResultArtifact)('all_gates', true, undefined, { gateResults: proposal.gateValidation?.gateResults });
        await this.ledger.appendArtifact(gateArtifact);
        evidenceIds.push(gateArtifact.artifact_id);
        // Log improvement with evidence
        await this.ledger.append('improvement_applied', {
            proposalId: proposal.id,
            issue: proposal.issue.type,
            source: proposal.source,
            beforeCommit: result.beforeCommit,
            afterCommit: result.afterCommit,
            testResults: result.testResults,
            evidenceIds,
            grantedEffects: effects_1.EFFECT_SETS.CODE_APPLICATION,
            exercisedEffects: ['CODE_MODIFY', 'GIT_COMMIT', 'LEDGER_APPEND'],
            timestamp: ids_1.globalTimeProvider.now()
        });
        // Create outcome record
        const outcome = (0, outcomeConformance_1.createProposalOutcome)(proposal.id, 'COMPLETED', evidenceIds);
        await this.ledger.append('proposal_outcome', outcome);
    }
    async logRejection(proposal, reason) {
        // Create gate result artifact for rejection
        const gateArtifact = (0, evidenceArtifact_1.createGateResultArtifact)('validation', false, reason, { gateResults: proposal.gateValidation?.gateResults });
        await this.ledger.appendArtifact(gateArtifact);
        await this.ledger.append('proposal_rejected', {
            proposalId: proposal.id,
            issue: proposal.issue.type,
            source: proposal.source,
            reason,
            evidenceIds: [gateArtifact.artifact_id],
            timestamp: ids_1.globalTimeProvider.now()
        });
        // Create outcome record
        const outcome = (0, outcomeConformance_1.createProposalOutcome)(proposal.id, 'REJECTED', [gateArtifact.artifact_id]);
        await this.ledger.append('proposal_outcome', outcome);
    }
    async logRollback(proposal, result) {
        // Create evidence artifact for rollback
        const rollbackArtifact = (0, evidenceArtifact_1.createEvidenceArtifact)(JSON.stringify({ testResults: result.testResults, reason: 'Tests failed' }), 'rollback_snapshot', { created_at_utc: new Date().toISOString(), description: 'Rollback after failed tests' });
        await this.ledger.appendArtifact(rollbackArtifact);
        await this.ledger.append('improvement_rolled_back', {
            proposalId: proposal.id,
            issue: proposal.issue.type,
            source: proposal.source,
            reason: 'Tests failed',
            testResults: result.testResults,
            evidenceIds: [rollbackArtifact.artifact_id],
            timestamp: ids_1.globalTimeProvider.now()
        });
        // Create outcome record
        const outcome = (0, outcomeConformance_1.createProposalOutcome)(proposal.id, 'ROLLED_BACK', [rollbackArtifact.artifact_id]);
        await this.ledger.append('proposal_outcome', outcome);
    }
    async logFailure(type, message) {
        await this.ledger.append('cycle_failure', {
            type,
            message,
            timestamp: ids_1.globalTimeProvider.now()
        });
    }
    /**
     * Record gate decision for governance tracking
     */
    async recordGateDecision(gateType, decision, proposalId, reason) {
        const scope = (0, gateDecision_1.createGateDecisionScope)('proposal', { id: proposalId }, undefined, decision === 'ALLOW' ? effects_1.EFFECT_SETS.CODE_APPLICATION : undefined);
        const gateDecision = (0, gateDecision_1.createGateDecision)(gateType, decision, scope, this.llmProvider ? `provider:${this.llmProvider}` : 'system', reason);
        await this.ledger.appendGateDecision(gateDecision);
    }
    /**
     * Sleep between cycles
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.DogfoodingLoop = DogfoodingLoop;
