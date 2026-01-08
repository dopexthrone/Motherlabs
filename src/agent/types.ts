/**
 * Agent Types
 * ===========
 *
 * Core types for the coding agent system.
 */

// =============================================================================
// Agent Configuration
// =============================================================================

/**
 * Agent operating mode.
 */
export type AgentMode = 'auto' | 'human-in-loop';

/**
 * Verification level.
 */
export type VerificationLevel = 'none' | 'basic' | 'standard' | 'strict' | 'formal';

/**
 * Agent configuration.
 */
export interface AgentConfig {
  /**
   * Operating mode.
   * - auto: Fully automated, verification gates only
   * - human-in-loop: Active learning selects what to review
   */
  mode: AgentMode;

  /**
   * Verification level.
   * - none: No verification (dangerous)
   * - basic: Syntax check only
   * - standard: Syntax + static analysis
   * - strict: Standard + property tests
   * - formal: Strict + formal verification (Z3)
   */
  verification_level: VerificationLevel;

  /**
   * Maximum generation attempts before escalating.
   */
  max_attempts: number;

  /**
   * Confidence threshold for auto-approval (0-1).
   * Below this, escalate to human.
   */
  confidence_threshold: number;

  /**
   * Languages to support.
   */
  languages: string[];

  /**
   * Enable context retrieval (RAG).
   */
  enable_rag: boolean;

  /**
   * Automatically run eval after generation.
   */
  auto_eval: boolean;

  /**
   * Automatically attempt to repair code when verification/eval fails.
   */
  auto_repair: boolean;

  /**
   * Automatically format and check code style.
   */
  auto_style: boolean;

  /**
   * Automatically scan for security vulnerabilities.
   */
  auto_security: boolean;

  /**
   * Security severity threshold - fail if vulnerabilities at or above this level.
   */
  security_threshold: 'low' | 'medium' | 'high' | 'critical';

  /**
   * Automatically add documentation to generated code.
   */
  auto_docs: boolean;

  /**
   * Maximum context tokens.
   */
  max_context_tokens: number;
}

/**
 * Default configuration.
 */
export const DEFAULT_CONFIG: AgentConfig = {
  mode: 'auto',
  verification_level: 'standard',
  max_attempts: 3,
  confidence_threshold: 0.85,
  languages: ['python', 'typescript', 'javascript'],
  enable_rag: true,
  auto_eval: false, // Off by default, enable for higher quality but slower
  auto_repair: true, // Auto-repair on by default for better success rate
  auto_style: true, // Format code automatically
  auto_security: true, // Scan for vulnerabilities
  security_threshold: 'high', // Fail on high/critical vulnerabilities
  auto_docs: false, // Documentation off by default (adds latency)
  max_context_tokens: 8192,
};

// =============================================================================
// Code Generation
// =============================================================================

/**
 * Code generation request.
 */
export interface GenerationRequest {
  /**
   * Unique request ID.
   */
  id: string;

  /**
   * What to generate (natural language).
   */
  prompt: string;

  /**
   * Target language.
   */
  language: string;

  /**
   * Additional context (files, docs, examples).
   */
  context?: ContextItem[];

  /**
   * Constraints to enforce.
   */
  constraints?: string[];

  /**
   * Expected function signature (if known).
   */
  signature?: string;

  /**
   * Test cases to satisfy (if known).
   */
  test_cases?: TestCase[];
}

/**
 * Context item for RAG.
 */
export interface ContextItem {
  /**
   * Item type.
   */
  type: 'file' | 'doc' | 'example' | 'snippet';

  /**
   * Content.
   */
  content: string;

  /**
   * Source path or URL.
   */
  source?: string;

  /**
   * Relevance score (0-1).
   */
  relevance?: number;
}

/**
 * Test case.
 */
export interface TestCase {
  /**
   * Test name.
   */
  name: string;

  /**
   * Input values.
   */
  inputs: Record<string, unknown>;

  /**
   * Expected output.
   */
  expected: unknown;

  /**
   * Description.
   */
  description?: string;
}

/**
 * Generated code result.
 */
export interface GenerationResult {
  /**
   * Request ID.
   */
  request_id: string;

  /**
   * Whether generation succeeded.
   */
  success: boolean;

  /**
   * Generated code.
   */
  code?: string;

  /**
   * Confidence score (0-1).
   */
  confidence: number;

  /**
   * Verification results.
   */
  verification: VerificationResult;

  /**
   * Number of attempts.
   */
  attempts: number;

  /**
   * Whether human review is needed.
   */
  needs_review: boolean;

  /**
   * Review reason (if needs_review).
   */
  review_reason?: string;

  /**
   * Error message (if failed).
   */
  error?: string;

  /**
   * Generation metadata.
   */
  metadata: {
    model: string;
    tokens_used: number;
    latency_ms: number;
    context_items: number;
  };
}

// =============================================================================
// Verification
// =============================================================================

/**
 * Verification result.
 */
export interface VerificationResult {
  /**
   * Overall verification passed.
   */
  passed: boolean;

  /**
   * Overall score (0-1).
   */
  score: number;

  /**
   * Individual check results.
   */
  checks: VerificationCheck[];

  /**
   * Issues found.
   */
  issues: VerificationIssue[];

  /**
   * Suggestions for improvement.
   */
  suggestions: string[];
}

/**
 * Individual verification check.
 */
export interface VerificationCheck {
  /**
   * Check name.
   */
  name: string;

  /**
   * Check type.
   */
  type: 'syntax' | 'static' | 'property' | 'formal' | 'test';

  /**
   * Whether check passed.
   */
  passed: boolean;

  /**
   * Check score (0-1).
   */
  score: number;

  /**
   * Details.
   */
  details?: string;

  /**
   * Duration in ms.
   */
  duration_ms: number;
}

/**
 * Verification issue.
 */
export interface VerificationIssue {
  /**
   * Issue severity.
   */
  severity: 'error' | 'warning' | 'info';

  /**
   * Issue type.
   */
  type: string;

  /**
   * Issue message.
   */
  message: string;

  /**
   * Line number (if applicable).
   */
  line?: number;

  /**
   * Column (if applicable).
   */
  column?: number;

  /**
   * Suggested fix.
   */
  fix?: string;
}

// =============================================================================
// Human-in-the-Loop
// =============================================================================

/**
 * Review request for human.
 */
export interface ReviewRequest {
  /**
   * Request ID.
   */
  id: string;

  /**
   * Original generation request.
   */
  generation_request: GenerationRequest;

  /**
   * Generated code to review.
   */
  code: string;

  /**
   * Verification results.
   */
  verification: VerificationResult;

  /**
   * Why review is needed.
   */
  reason: ReviewReason;

  /**
   * Confidence score.
   */
  confidence: number;

  /**
   * Priority (0-1, higher = more urgent).
   */
  priority: number;

  /**
   * Uncertainty score (for active learning).
   */
  uncertainty: number;
}

/**
 * Reason for human review.
 */
export type ReviewReason =
  | 'low_confidence'
  | 'verification_failed'
  | 'max_attempts_reached'
  | 'active_learning_selected'
  | 'user_requested';

/**
 * Human review response.
 */
export interface ReviewResponse {
  /**
   * Request ID.
   */
  request_id: string;

  /**
   * Review decision.
   */
  decision: 'approve' | 'reject' | 'modify';

  /**
   * Modified code (if decision is modify).
   */
  modified_code?: string;

  /**
   * Feedback for learning.
   */
  feedback?: string;

  /**
   * Reviewer ID.
   */
  reviewer_id?: string;

  /**
   * Review timestamp.
   */
  timestamp: number;
}

// =============================================================================
// Active Learning
// =============================================================================

/**
 * Active learning strategy.
 * - uncertainty_sampling: Review when confidence is low
 * - random: Random sampling for diversity
 */
export type ActiveLearningStrategy = 'uncertainty_sampling' | 'random';

/**
 * Active learning configuration.
 */
export interface ActiveLearningConfig {
  /**
   * Strategy to use.
   */
  strategy: ActiveLearningStrategy;

  /**
   * Maximum samples to request per batch.
   */
  batch_size: number;

  /**
   * Minimum uncertainty to trigger review.
   */
  uncertainty_threshold: number;

  /**
   * Whether to fine-tune model on feedback.
   */
  enable_fine_tuning: boolean;
}

// =============================================================================
// Agent State
// =============================================================================

/**
 * Agent state.
 */
export interface AgentState {
  /**
   * Agent ID.
   */
  id: string;

  /**
   * Current configuration.
   */
  config: AgentConfig;

  /**
   * Pending review requests.
   */
  pending_reviews: ReviewRequest[];

  /**
   * Generation statistics.
   */
  stats: {
    total_requests: number;
    successful: number;
    failed: number;
    human_reviewed: number;
    auto_approved: number;
    auto_repaired: number;
    prompts_refined: number;
    style_formatted: number;
    security_issues_found: number;
    docs_generated: number;
    patterns_learned: number;
    average_confidence: number;
    average_attempts: number;
  };

  /**
   * Whether agent is running.
   */
  running: boolean;
}
