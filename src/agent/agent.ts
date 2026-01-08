/**
 * Coding Agent
 * ============
 *
 * Main agent that orchestrates code generation, verification,
 * and human-in-the-loop workflows.
 */

import { randomBytes } from 'node:crypto';
import type { ModelAdapter } from '../adapters/model.js';
import {
  CodeGenerator,
  createCodeGenerator,
  generateRequestId,
} from './generator.js';
import { CodeVerifier, createVerifier } from './verifier.js';
import { RAGRetriever, createRAGRetriever, type Document } from '../rag/index.js';
import { evaluate, quickValidate, type EvalReport, type EvaluatorConfig } from '../eval/index.js';
import {
  CodeRepairer,
  createRepairer,
  diagnoseFromVerification,
  diagnoseFromEval,
  type RepairAttempt,
  type RepairContextItem,
} from '../repair/index.js';
import {
  PromptLearner,
  createPromptLearner,
  type GenerationOutcome,
} from '../learn/index.js';
import {
  formatCode,
  checkStyle,
  type StyleResult,
} from '../style/index.js';
import {
  scanCode,
  type SecurityResult,
  type VulnerabilitySeverity,
} from '../security/index.js';
import {
  CodeDocumenter,
  createDocumenter,
  type DocResult,
} from '../docs/index.js';
import type {
  AgentConfig,
  AgentState,
  GenerationRequest,
  GenerationResult,
  ReviewRequest,
  ReviewResponse,
  ActiveLearningConfig,
  ContextItem,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// =============================================================================
// Agent
// =============================================================================

/**
 * Main coding agent.
 */
export class CodingAgent {
  private readonly id: string;
  private readonly adapter: ModelAdapter;
  private readonly generator: CodeGenerator;
  private readonly verifier: CodeVerifier;
  private readonly repairer: CodeRepairer;
  private readonly learner: PromptLearner;
  private readonly documenter: CodeDocumenter;
  private readonly rag: RAGRetriever;
  private readonly config: AgentConfig;
  private readonly activeConfig: ActiveLearningConfig;

  private pendingReviews: Map<string, ReviewRequest> = new Map();
  private stats = {
    total_requests: 0,
    successful: 0,
    failed: 0,
    human_reviewed: 0,
    auto_approved: 0,
    auto_repaired: 0,
    prompts_refined: 0,
    style_formatted: 0,
    security_issues_found: 0,
    docs_generated: 0,
    patterns_learned: 0,
    average_confidence: 0,
    average_attempts: 0,
  };
  private running = false;
  private ragReady = false;

  constructor(
    adapter: ModelAdapter,
    config: Partial<AgentConfig> = {},
    activeConfig: Partial<ActiveLearningConfig> = {}
  ) {
    this.id = `agent_${randomBytes(4).toString('hex')}`;
    this.adapter = adapter;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeConfig = {
      strategy: activeConfig.strategy ?? 'uncertainty_sampling',
      batch_size: activeConfig.batch_size ?? 5,
      uncertainty_threshold: activeConfig.uncertainty_threshold ?? 0.3,
      enable_fine_tuning: activeConfig.enable_fine_tuning ?? false,
    };

    this.generator = createCodeGenerator(adapter, this.config);
    this.verifier = createVerifier(this.config.verification_level);
    this.repairer = createRepairer(adapter);
    this.learner = createPromptLearner(1000);
    this.documenter = createDocumenter(adapter);
    this.rag = createRAGRetriever({
      embedding_provider: 'gemini',
      store_type: 'memory',
      chunking: { strategy: 'code', max_chunk_size: 1500, overlap: 200 },
    });
  }

  /**
   * Start the agent.
   * @param workspaceDir Optional directory to auto-index for RAG
   */
  async start(workspaceDir?: string): Promise<void> {
    this.running = true;
    console.log(`[Agent ${this.id}] Started in ${this.config.mode} mode`);

    // Auto-index workspace if RAG is enabled and directory provided
    if (this.config.enable_rag && workspaceDir) {
      console.log(`[Agent ${this.id}] Auto-indexing workspace: ${workspaceDir}`);
      await this.indexWorkspace(workspaceDir);
    }
  }

  /**
   * Index a workspace directory for RAG context retrieval.
   * Recursively finds and indexes code files.
   */
  async indexWorkspace(dir: string, extensions: string[] = ['.ts', '.js', '.py']): Promise<number> {
    const { readdir, readFile, stat } = await import('node:fs/promises');
    const { join, extname } = await import('node:path');

    let totalChunks = 0;

    const processDir = async (currentDir: string): Promise<void> => {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        // Skip common non-code directories
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'].includes(entry.name)) {
            await processDir(fullPath);
          }
          continue;
        }

        // Index files with matching extensions
        if (entry.isFile() && extensions.includes(extname(entry.name))) {
          try {
            const content = await readFile(fullPath, 'utf-8');
            const ext = extname(entry.name).slice(1);
            const language = ext === 'ts' ? 'typescript' : ext === 'js' ? 'javascript' : ext;

            const chunks = await this.indexDocument({
              id: fullPath,
              content,
              type: 'code',
              source: fullPath,
              language,
            });
            totalChunks += chunks;
          } catch {
            // Skip files that can't be read
          }
        }
      }
    };

    await processDir(dir);
    console.log(`[Agent ${this.id}] Indexed ${totalChunks} chunks from ${dir}`);
    return totalChunks;
  }

  /**
   * Stop the agent.
   */
  async stop(): Promise<void> {
    this.running = false;
    console.log(`[Agent ${this.id}] Stopped`);
  }

  /**
   * Generate code for a request.
   */
  async generate(request: Omit<GenerationRequest, 'id'>): Promise<GenerationResult> {
    if (!this.running) {
      throw new Error('Agent not running');
    }

    // Store original prompt for learning
    const originalPrompt = request.prompt;

    // Refine prompt based on learned patterns
    const refinedPrompt = this.learner.refine(request.prompt, request.language);
    const wasRefined = refinedPrompt !== request.prompt;
    if (wasRefined) {
      this.stats.prompts_refined++;
    }

    const fullRequest: GenerationRequest = {
      id: generateRequestId(),
      ...request,
      prompt: refinedPrompt,
    };

    this.stats.total_requests++;

    // Retrieve context if RAG is enabled and has indexed documents
    if (this.config.enable_rag && this.ragReady) {
      const context = await this.rag.getContext(originalPrompt, {
        limit: 5,
        min_similarity: 0.5,
        language_filter: [fullRequest.language],
      });
      fullRequest.context = context.map((c) => {
        const item: ContextItem = {
          type: c.type === 'code' ? 'file' : c.type === 'doc' ? 'doc' : 'snippet',
          content: c.content,
          relevance: c.relevance,
        };
        if (c.source) {
          item.source = c.source;
        }
        return item;
      });
    }

    // Generate code
    let result = await this.generator.generate(fullRequest);

    // Verify code
    if (result.success && result.code) {
      result.verification = await this.verifier.verify(
        result.code,
        fullRequest.language,
        fullRequest.test_cases
      );

      // Update confidence based on verification
      if (!result.verification.passed) {
        result.confidence *= 0.5;
        result.needs_review = true;
        result.review_reason = 'verification_failed';

        // Auto-repair if enabled
        if (this.config.auto_repair && result.code) {
          const diagnoses = diagnoseFromVerification(result.verification);
          const repairOptions: Parameters<typeof this.repairer.repair>[2] = {
            language: fullRequest.language,
            originalPrompt: fullRequest.prompt,
            maxAttempts: 2,
          };
          if (fullRequest.test_cases) repairOptions.testCases = fullRequest.test_cases;

          // Get similar working code from RAG for repair context
          if (this.config.enable_rag && this.ragReady) {
            const ragContext = await this.rag.getContext(originalPrompt, {
              limit: 3,
              min_similarity: 0.4,
              language_filter: [fullRequest.language],
            });
            if (ragContext.length > 0) {
              repairOptions.contextExamples = ragContext.map((c) => {
                const item: RepairContextItem = { content: c.content };
                if (c.source) item.source = c.source;
                if (c.relevance !== undefined) item.relevance = c.relevance;
                return item;
              });
            }
          }

          const repairResult = await this.repairer.repair(result.code, diagnoses, repairOptions);

          if (repairResult.success && repairResult.repaired) {
            // Re-verify the repaired code
            const repairedVerification = await this.verifier.verify(
              repairResult.repaired,
              fullRequest.language,
              fullRequest.test_cases
            );

            if (repairedVerification.passed) {
              result.code = repairResult.repaired;
              result.verification = repairedVerification;
              result.confidence = Math.min(0.85, result.confidence * 2); // Boost confidence back up
              result.needs_review = false;
              delete result.review_reason;
              this.stats.auto_repaired++;
              console.log(`[Agent ${this.id}] Auto-repaired code: ${repairResult.fixes_applied.join(', ')}`);
            }
          }
        }
      }

      // Auto-eval if enabled and verification passed
      if (this.config.auto_eval && result.verification.passed) {
        const fnMatch = fullRequest.prompt.match(/(?:function|def)\s+(\w+)|(\w+)\s*\(/);
        const functionName = fnMatch?.[1] ?? fnMatch?.[2] ?? 'main';

        const evalResult = await this.evaluate(result.code!, functionName);

        // Adjust confidence based on eval
        if (!evalResult.passed) {
          result.confidence *= 0.7;
          result.needs_review = true;
          result.review_reason = 'evaluation_failed';

          // Auto-repair from eval failure if enabled
          if (this.config.auto_repair && result.code) {
            const diagnoses = diagnoseFromEval(evalResult);
            const evalRepairOptions: Parameters<typeof this.repairer.repair>[2] = {
              language: fullRequest.language,
              originalPrompt: fullRequest.prompt,
              maxAttempts: 2,
            };
            if (fullRequest.test_cases) evalRepairOptions.testCases = fullRequest.test_cases;

            // Get similar working code from RAG for repair context
            if (this.config.enable_rag && this.ragReady) {
              const ragContext = await this.rag.getContext(originalPrompt, {
                limit: 3,
                min_similarity: 0.4,
                language_filter: [fullRequest.language],
              });
              if (ragContext.length > 0) {
                evalRepairOptions.contextExamples = ragContext.map((c) => {
                  const item: RepairContextItem = { content: c.content };
                  if (c.source) item.source = c.source;
                  if (c.relevance !== undefined) item.relevance = c.relevance;
                  return item;
                });
              }
            }

            const repairResult = await this.repairer.repair(result.code, diagnoses, evalRepairOptions);

            if (repairResult.success && repairResult.repaired) {
              // Re-evaluate the repaired code
              const repairedEval = await this.evaluate(repairResult.repaired, functionName);

              if (repairedEval.passed) {
                result.code = repairResult.repaired;
                result.confidence = Math.min(0.85, result.confidence * 1.5);
                result.needs_review = false;
                delete result.review_reason;
                this.stats.auto_repaired++;
                console.log(`[Agent ${this.id}] Auto-repaired code from eval failure: ${repairResult.fixes_applied.join(', ')}`);
              }
            }
          }
        } else if (evalResult.score > 0.9) {
          result.confidence = Math.min(1, result.confidence * 1.1);
        }
      }
    }

    // Post-processing pipeline: style, security, docs
    if (result.success && result.code) {
      const langForProcessing = this.mapLanguageForProcessing(fullRequest.language);

      // 1. Style formatting
      if (this.config.auto_style && langForProcessing) {
        try {
          const styleResult = await formatCode(result.code, langForProcessing);
          if (styleResult.formatted && styleResult.modified) {
            result.code = styleResult.formatted;
            this.stats.style_formatted++;
          }
        } catch {
          // Style formatting is best-effort, don't fail generation
        }
      }

      // 2. Security scanning
      if (this.config.auto_security && langForProcessing && langForProcessing !== 'json') {
        try {
          const securityResult = await scanCode(
            result.code,
            langForProcessing as 'python' | 'typescript' | 'javascript'
          );

          // Track security issues
          const totalIssues = securityResult.counts.low + securityResult.counts.medium +
                             securityResult.counts.high + securityResult.counts.critical;
          if (totalIssues > 0) {
            this.stats.security_issues_found += totalIssues;
          }

          // Check if we should fail based on threshold
          if (!securityResult.passed) {
            const thresholdSeverities: VulnerabilitySeverity[] = ['critical', 'high', 'medium', 'low'];
            const thresholdIndex = thresholdSeverities.indexOf(this.config.security_threshold);
            const maxSeverityIndex = thresholdSeverities.indexOf(securityResult.severity);

            if (maxSeverityIndex <= thresholdIndex && maxSeverityIndex >= 0) {
              result.needs_review = true;
              result.review_reason = `security_${securityResult.severity}`;
              result.confidence *= 0.6;
              console.log(`[Agent ${this.id}] Security issues found: ${totalIssues} (max severity: ${securityResult.severity})`);
            }
          }
        } catch {
          // Security scanning is best-effort
        }
      }

      // 3. Auto-documentation
      if (this.config.auto_docs && langForProcessing && langForProcessing !== 'json') {
        try {
          const docResult = langForProcessing === 'python'
            ? await this.documenter.documentPython(result.code, { skipExisting: true, useAI: true })
            : await this.documenter.documentTypeScript(result.code, { skipExisting: true, useAI: true });

          if (docResult.docs.length > 0) {
            result.code = docResult.documented;
            this.stats.docs_generated += docResult.docs.length;
          }
        } catch {
          // Documentation is best-effort
        }
      }
    }

    // Handle based on mode
    if (this.config.mode === 'human-in-loop') {
      result = await this.handleHumanInLoop(fullRequest, result);
    } else {
      result = this.handleAutoMode(fullRequest, result);
    }

    // Record outcome for learning
    const outcome: GenerationOutcome = {
      prompt: originalPrompt,
      language: fullRequest.language,
      succeeded: result.success && result.verification.passed,
      confidence: result.confidence,
      timestamp: Date.now(),
    };
    if (!result.verification.passed && result.review_reason) {
      outcome.error_type = this.categorizeReviewReason(result.review_reason);
      outcome.error_message = result.review_reason;
    }
    this.learner.record(outcome);

    // Update stats
    this.updateStats(result);

    return result;
  }

  /**
   * Categorize review reason into error type.
   */
  private categorizeReviewReason(reason: string): string {
    if (reason.includes('verification')) return 'verification_failed';
    if (reason.includes('eval')) return 'test_failure';
    if (reason.includes('confidence')) return 'low_confidence';
    if (reason.includes('syntax')) return 'syntax_error';
    if (reason.includes('type')) return 'type_error';
    return 'unknown';
  }

  /**
   * Map language to supported processing languages.
   */
  private mapLanguageForProcessing(language: string): 'python' | 'typescript' | 'javascript' | 'json' | null {
    const lang = language.toLowerCase();
    if (lang === 'python' || lang === 'py') return 'python';
    if (lang === 'typescript' || lang === 'ts') return 'typescript';
    if (lang === 'javascript' || lang === 'js') return 'javascript';
    if (lang === 'json') return 'json';
    return null;
  }

  /**
   * Handle auto mode logic.
   */
  private handleAutoMode(
    request: GenerationRequest,
    result: GenerationResult
  ): GenerationResult {
    if (result.success && result.confidence >= this.config.confidence_threshold && result.verification.passed) {
      // Auto-approve
      result.needs_review = false;
      this.stats.auto_approved++;
    } else if (result.needs_review) {
      // Queue for review but return result
      this.queueForReview(request, result);
    }

    return result;
  }

  /**
   * Handle human-in-the-loop mode.
   */
  private async handleHumanInLoop(
    request: GenerationRequest,
    result: GenerationResult
  ): Promise<GenerationResult> {
    // Calculate uncertainty for active learning
    const uncertainty = this.calculateUncertainty(result);

    // Decide if human review is needed
    const needsReview =
      result.needs_review ||
      uncertainty > this.activeConfig.uncertainty_threshold ||
      this.shouldActiveLearningSample(uncertainty);

    if (needsReview) {
      result.needs_review = true;
      result.review_reason = result.review_reason || 'active_learning_selected';
      this.queueForReview(request, result, uncertainty);
    }

    return result;
  }

  /**
   * Queue a result for human review.
   */
  private queueForReview(
    request: GenerationRequest,
    result: GenerationResult,
    uncertainty: number = 0
  ): void {
    const reviewRequest: ReviewRequest = {
      id: `review_${randomBytes(4).toString('hex')}`,
      generation_request: request,
      code: result.code || '',
      verification: result.verification,
      reason: (result.review_reason as ReviewRequest['reason']) || 'low_confidence',
      confidence: result.confidence,
      priority: this.calculatePriority(result, uncertainty),
      uncertainty,
    };

    this.pendingReviews.set(reviewRequest.id, reviewRequest);
    console.log(`[Agent ${this.id}] Queued for review: ${reviewRequest.id} (${reviewRequest.reason})`);
  }

  /**
   * Calculate uncertainty for active learning.
   */
  private calculateUncertainty(result: GenerationResult): number {
    // Simple uncertainty based on confidence
    // Lower confidence = higher uncertainty
    return 1 - result.confidence;
  }

  /**
   * Decide if active learning should sample this result.
   */
  private shouldActiveLearningSample(uncertainty: number): boolean {
    switch (this.activeConfig.strategy) {
      case 'uncertainty_sampling':
        return uncertainty > this.activeConfig.uncertainty_threshold;
      case 'random':
        return Math.random() < 0.1; // 10% random sampling
      default:
        return false;
    }
  }

  /**
   * Calculate review priority.
   */
  private calculatePriority(result: GenerationResult, uncertainty: number): number {
    let priority = 0.5;

    // Higher uncertainty = higher priority
    priority += uncertainty * 0.3;

    // Verification failures = higher priority
    if (!result.verification.passed) {
      priority += 0.2;
    }

    // More attempts = higher priority
    priority += (result.attempts / this.config.max_attempts) * 0.1;

    return Math.min(1, priority);
  }

  /**
   * Get pending review requests.
   */
  getPendingReviews(): ReviewRequest[] {
    return Array.from(this.pendingReviews.values())
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get next review request for human.
   */
  getNextReview(): ReviewRequest | undefined {
    const reviews = this.getPendingReviews();
    return reviews[0];
  }

  /**
   * Submit a human review response.
   */
  async submitReview(response: ReviewResponse): Promise<void> {
    const review = this.pendingReviews.get(response.request_id);
    if (!review) {
      throw new Error(`Review not found: ${response.request_id}`);
    }

    this.pendingReviews.delete(response.request_id);
    this.stats.human_reviewed++;

    console.log(`[Agent ${this.id}] Review submitted: ${response.request_id} (${response.decision})`);

    // Learn from feedback if enabled
    if (this.activeConfig.enable_fine_tuning && response.feedback) {
      await this.learnFromFeedback(review, response);
    }
  }

  /**
   * Learn from human feedback.
   * Records outcomes, extracts patterns from feedback, and indexes approved code.
   */
  private async learnFromFeedback(
    review: ReviewRequest,
    response: ReviewResponse
  ): Promise<void> {
    const prompt = review.generation_request.prompt;
    const language = review.generation_request.language;

    // 1. Record the outcome based on decision
    const outcome: GenerationOutcome = {
      prompt,
      language,
      succeeded: response.decision === 'approve',
      confidence: review.confidence,
      timestamp: response.timestamp,
    };

    // Add error info for rejected code
    if (response.decision === 'reject') {
      outcome.error_type = 'human_rejected';
      if (response.feedback) {
        outcome.error_message = response.feedback.slice(0, 500);
      }
    } else if (response.decision === 'modify') {
      // Modified = partial success
      outcome.succeeded = true;
      outcome.needed_repair = true;
      outcome.repair_succeeded = true;
    }

    this.learner.record(outcome);

    // 2. Try to extract patterns from feedback text
    if (response.feedback) {
      const patterns = this.extractPatternsFromFeedback(response.feedback, language);
      for (const pattern of patterns) {
        this.learner.addPattern(pattern);
      }
      this.stats.patterns_learned = (this.stats.patterns_learned || 0) + patterns.length;
    }

    // 3. Index approved/modified code in RAG for future context
    const codeToIndex = response.decision === 'modify' && response.modified_code
      ? response.modified_code
      : response.decision === 'approve'
      ? review.code
      : null;

    if (codeToIndex && this.config.enable_rag) {
      try {
        await this.rag.index({
          id: `feedback_${response.request_id}`,
          content: codeToIndex,
          type: 'code' as const,
          language,
          metadata: {
            source: 'human_feedback',
            decision: response.decision,
            prompt_summary: prompt.slice(0, 200),
            reviewed_at: response.timestamp,
          },
        });
      } catch {
        // Index failure is non-fatal
      }
    }

    console.log(`[Agent ${this.id}] Learned from feedback: ${response.decision}${response.feedback ? ' (with feedback)' : ''}`);
  }

  /**
   * Extract patterns from human feedback text.
   * Uses simple heuristics to identify reusable learning signals.
   */
  private extractPatternsFromFeedback(feedback: string, language: string): import('../learn/index.js').PromptPattern[] {
    const patterns: import('../learn/index.js').PromptPattern[] = [];
    const feedbackLower = feedback.toLowerCase();

    // Pattern detection heuristics
    const patternHints = [
      {
        triggers: ['handle null', 'null check', 'undefined', 'null safety'],
        id: `feedback_null_${Date.now()}`,
        description: 'Handle null/undefined values',
        additions: [`Always check for null/undefined values in ${language}`],
      },
      {
        triggers: ['edge case', 'boundary', 'empty', 'zero'],
        id: `feedback_edge_${Date.now()}`,
        description: 'Handle edge cases',
        additions: ['Handle edge cases including empty inputs and boundary conditions'],
      },
      {
        triggers: ['type', 'typing', 'annotation', 'return type'],
        id: `feedback_type_${Date.now()}`,
        description: 'Improve type annotations',
        additions: ['Include complete type annotations for parameters and return values'],
      },
      {
        triggers: ['error handling', 'try catch', 'exception', 'throw'],
        id: `feedback_error_${Date.now()}`,
        description: 'Add error handling',
        additions: ['Add proper error handling with meaningful error messages'],
      },
      {
        triggers: ['validation', 'validate', 'check input', 'sanitize'],
        id: `feedback_validate_${Date.now()}`,
        description: 'Validate inputs',
        additions: ['Validate all inputs before processing'],
      },
      {
        triggers: ['performance', 'efficient', 'optimize', 'slow'],
        id: `feedback_perf_${Date.now()}`,
        description: 'Consider performance',
        additions: ['Consider performance implications of the implementation'],
      },
      {
        triggers: ['security', 'injection', 'xss', 'sanitize'],
        id: `feedback_security_${Date.now()}`,
        description: 'Security considerations',
        additions: ['Follow security best practices and sanitize user inputs'],
      },
    ];

    for (const hint of patternHints) {
      const triggered = hint.triggers.some((t) => feedbackLower.includes(t));
      if (triggered) {
        patterns.push({
          id: hint.id,
          description: hint.description,
          triggers: hint.triggers,
          additions: hint.additions,
          success_rate: 0.7, // Start with reasonable default
          applications: 0,
        });
      }
    }

    return patterns;
  }

  /**
   * Index a document for RAG context retrieval.
   */
  async indexDocument(document: Document): Promise<number> {
    const chunks = await this.rag.index(document);
    if (chunks > 0) {
      this.ragReady = true;
    }
    return chunks;
  }

  /**
   * Index multiple documents for RAG.
   */
  async indexDocuments(documents: Document[]): Promise<number> {
    let total = 0;
    for (const doc of documents) {
      total += await this.indexDocument(doc);
    }
    return total;
  }

  /**
   * Get RAG statistics.
   */
  getRAGStats() {
    return this.rag.getStats();
  }

  /**
   * Get agent state.
   */
  getState(): AgentState {
    return {
      id: this.id,
      config: this.config,
      pending_reviews: this.getPendingReviews(),
      stats: { ...this.stats },
      running: this.running,
    };
  }

  /**
   * Update statistics.
   */
  private updateStats(result: GenerationResult): void {
    if (result.success) {
      this.stats.successful++;
    } else {
      this.stats.failed++;
    }

    // Update running averages
    const n = this.stats.total_requests;
    this.stats.average_confidence =
      ((this.stats.average_confidence * (n - 1)) + result.confidence) / n;
    this.stats.average_attempts =
      ((this.stats.average_attempts * (n - 1)) + result.attempts) / n;
  }

  // ===========================================================================
  // Internal Evaluation
  // ===========================================================================

  /**
   * Evaluate generated code using internal validation methods.
   *
   * Methods:
   * - differential: Compare against stdlib references
   * - property: Property-based testing (Hypothesis-style)
   * - self_consistency: Multiple generations agreement
   * - round_trip: Code → AST → Code validation
   */
  async evaluate(
    code: string,
    functionName: string,
    config?: Partial<EvaluatorConfig>
  ): Promise<EvalReport> {
    return evaluate(code, functionName, config);
  }

  /**
   * Quick validation check for generated code.
   */
  async quickValidate(
    code: string,
    functionName: string
  ): Promise<{ valid: boolean; issues: string[] }> {
    return quickValidate(code, functionName);
  }

  /**
   * Generate and evaluate in one call.
   */
  async generateAndEvaluate(
    request: Omit<GenerationRequest, 'id'>,
    evalConfig?: Partial<EvaluatorConfig>
  ): Promise<{ result: GenerationResult; evaluation?: EvalReport }> {
    const result = await this.generate(request);

    if (!result.success || !result.code) {
      return { result };
    }

    // Extract function name from prompt
    const fnMatch = request.prompt.match(/(?:function|def)\s+(\w+)|(\w+)\s*\(/);
    const functionName = fnMatch?.[1] ?? fnMatch?.[2] ?? 'main';

    const evaluation = await this.evaluate(result.code, functionName, evalConfig);

    // Adjust confidence based on evaluation
    if (!evaluation.passed) {
      result.confidence *= 0.7;
      result.needs_review = true;
      result.review_reason = 'evaluation_failed';
    } else if (evaluation.score > 0.9) {
      result.confidence = Math.min(1, result.confidence * 1.1);
    }

    return { result, evaluation };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a coding agent.
 */
export function createCodingAgent(
  adapter: ModelAdapter,
  config: Partial<AgentConfig> = {},
  activeConfig: Partial<ActiveLearningConfig> = {}
): CodingAgent {
  return new CodingAgent(adapter, config, activeConfig);
}
