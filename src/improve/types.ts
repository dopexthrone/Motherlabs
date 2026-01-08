/**
 * Self-Improvement Protocol Types
 * ================================
 *
 * Types for the governed self-improvement loop.
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Improvement cycle phases.
 */
export type ImprovementPhase =
  | 'discover'
  | 'select'
  | 'implement'
  | 'validate'
  | 'integrate'
  | 'complete'
  | 'failed';

/**
 * Gate check result.
 */
export interface GateResult {
  /**
   * Whether the gate passed.
   */
  passed: boolean;

  /**
   * Reason for pass/fail.
   */
  reason: string;

  /**
   * Metrics that informed the decision.
   */
  metrics?: Record<string, number>;
}

/**
 * Improvement candidate from discovery.
 */
export interface ImprovementCandidate {
  /**
   * Unique ID.
   */
  id: string;

  /**
   * Short name.
   */
  name: string;

  /**
   * Description of the improvement.
   */
  description: string;

  /**
   * Score from exploration (0-1).
   */
  score: number;

  /**
   * Technologies/approaches involved.
   */
  technologies: string[];

  /**
   * Key decisions/changes.
   */
  decisions: string[];

  /**
   * Estimated complexity (1-5).
   */
  complexity: number;

  /**
   * Files likely to change.
   */
  affected_files: string[];
}

/**
 * Implementation plan for a candidate.
 */
export interface ImplementationPlan {
  /**
   * Candidate being implemented.
   */
  candidate: ImprovementCandidate;

  /**
   * Ordered steps.
   */
  steps: ImplementationStep[];

  /**
   * Rollback procedure.
   */
  rollback: RollbackPlan;

  /**
   * Estimated risk (1-5).
   */
  risk_level: number;

  /**
   * Dependencies.
   */
  dependencies: string[];
}

/**
 * Single implementation step.
 */
export interface ImplementationStep {
  /**
   * Step number.
   */
  order: number;

  /**
   * Description.
   */
  description: string;

  /**
   * File to modify.
   */
  file: string;

  /**
   * Type of change.
   */
  change_type: 'create' | 'modify' | 'delete';

  /**
   * Code or instructions.
   */
  code?: string;

  /**
   * Whether step is reversible.
   */
  reversible: boolean;
}

/**
 * Rollback plan.
 */
export interface RollbackPlan {
  /**
   * Steps to undo changes.
   */
  steps: string[];

  /**
   * Git-based rollback available.
   */
  git_revert: boolean;

  /**
   * Backup files created.
   */
  backups: string[];
}

/**
 * Validation result.
 */
export interface ValidationResult {
  /**
   * Overall pass/fail.
   */
  passed: boolean;

  /**
   * Score before change.
   */
  score_before: number;

  /**
   * Score after change.
   */
  score_after: number;

  /**
   * Score delta.
   */
  delta: number;

  /**
   * Individual test results.
   */
  tests: {
    name: string;
    passed: boolean;
    before?: number;
    after?: number;
  }[];

  /**
   * Build status.
   */
  build_passed: boolean;

  /**
   * Regression detected.
   */
  regression: boolean;
}

/**
 * Integration result.
 */
export interface IntegrationResult {
  /**
   * Whether integration succeeded.
   */
  success: boolean;

  /**
   * Commit hash if committed.
   */
  commit_hash?: string;

  /**
   * Files changed.
   */
  files_changed: string[];

  /**
   * Evidence trail.
   */
  evidence: {
    candidate_id: string;
    score_improvement: number;
    validation_result: ValidationResult;
    timestamp: string;
  };
}

// =============================================================================
// Cycle State
// =============================================================================

/**
 * Full state of an improvement cycle.
 */
export interface ImprovementCycle {
  /**
   * Cycle ID.
   */
  id: string;

  /**
   * Target component being improved.
   */
  target: string;

  /**
   * Current phase.
   */
  phase: ImprovementPhase;

  /**
   * Started at.
   */
  started_at: string;

  /**
   * Completed at.
   */
  completed_at?: string;

  /**
   * Discovery results.
   */
  candidates?: ImprovementCandidate[];

  /**
   * Selected candidate.
   */
  selected?: ImprovementCandidate;

  /**
   * Implementation plan.
   */
  plan?: ImplementationPlan;

  /**
   * Validation result.
   */
  validation?: ValidationResult;

  /**
   * Integration result.
   */
  integration?: IntegrationResult;

  /**
   * Gate results for each phase.
   */
  gates: Record<ImprovementPhase, GateResult>;

  /**
   * Error if failed.
   */
  error?: string;

  /**
   * Iteration number in session.
   */
  iteration: number;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Protocol configuration.
 */
export interface ImprovementConfig {
  /**
   * Minimum candidate score to proceed (0-1).
   */
  min_candidate_score: number;

  /**
   * Minimum score delta to accept (can be negative for "no regression").
   */
  min_score_delta: number;

  /**
   * Maximum iterations per session.
   */
  max_iterations: number;

  /**
   * Require human approval for integration.
   */
  require_human_approval: boolean;

  /**
   * Auto-rollback on validation failure.
   */
  auto_rollback: boolean;

  /**
   * Exploration config overrides.
   */
  exploration?: {
    max_depth?: number;
    max_survivors?: number;
    early_stopping?: boolean;
  };

  /**
   * Components that cannot be modified.
   */
  protected_components: string[];

  /**
   * Dry run mode (no actual changes).
   */
  dry_run: boolean;
}

/**
 * Default configuration.
 */
export const DEFAULT_IMPROVEMENT_CONFIG: ImprovementConfig = {
  min_candidate_score: 0.6,
  min_score_delta: 0, // No regression
  max_iterations: 5,
  require_human_approval: true,
  auto_rollback: true,
  exploration: {
    max_depth: 4,
    max_survivors: 5,
    early_stopping: true,
  },
  protected_components: ['improve', 'STOP_EVOLUTION'],
  dry_run: false,
};

// =============================================================================
// Events
// =============================================================================

/**
 * Event emitted during improvement cycle.
 */
export interface ImprovementEvent {
  /**
   * Event type.
   */
  type:
    | 'cycle_started'
    | 'phase_entered'
    | 'gate_checked'
    | 'candidate_found'
    | 'candidate_selected'
    | 'implementation_started'
    | 'implementation_step'
    | 'validation_started'
    | 'validation_complete'
    | 'integration_started'
    | 'integration_complete'
    | 'cycle_complete'
    | 'cycle_failed'
    | 'rollback_started'
    | 'rollback_complete';

  /**
   * Cycle ID.
   */
  cycle_id: string;

  /**
   * Timestamp.
   */
  timestamp: string;

  /**
   * Event data.
   */
  data: Record<string, unknown>;
}

/**
 * Event handler type.
 */
export type ImprovementEventHandler = (event: ImprovementEvent) => void;
