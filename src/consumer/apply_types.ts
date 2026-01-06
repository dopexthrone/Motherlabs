/**
 * Apply Consumer Types
 * ====================
 *
 * Public types for apply result verification.
 * These types define the outcome of applying a patch to a target directory.
 *
 * See: docs/APPLY_SPEC.md
 */

// Re-export Violation type from bundle_types for consistency
export type { Violation } from './bundle_types.js';

/**
 * Current apply schema version.
 */
export const APPLY_SCHEMA_VERSION = '1.0.0';

/**
 * Apply outcome status.
 */
export type ApplyOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'REFUSED';

/**
 * Operation status for individual operations.
 */
export type ApplyOperationStatus = 'success' | 'skipped' | 'error';

/**
 * Operation type (matches PatchOpType).
 */
export type ApplyOpType = 'create' | 'modify' | 'delete';

/**
 * Result of a single operation within an apply.
 */
export interface ApplyOperationResult {
  /**
   * Operation type.
   */
  op: ApplyOpType;

  /**
   * Target path (relative).
   */
  path: string;

  /**
   * Operation status.
   */
  status: ApplyOperationStatus;

  /**
   * Hash of file before operation (null if didn't exist).
   * Format: sha256:{64 hex characters}
   */
  before_hash: string | null;

  /**
   * Hash of file after operation (null if deleted/error).
   * Format: sha256:{64 hex characters}
   */
  after_hash: string | null;

  /**
   * Bytes written (0 for delete or error).
   */
  bytes_written: number;

  /**
   * Error message if status is 'error'.
   */
  error?: string;
}

/**
 * Summary statistics for an apply operation.
 */
export interface ApplySummary {
  /**
   * Total operations in patch.
   */
  total_operations: number;

  /**
   * Operations that succeeded.
   */
  succeeded: number;

  /**
   * Operations that were skipped (dry-run or precondition failed).
   */
  skipped: number;

  /**
   * Operations that failed with error.
   */
  failed: number;

  /**
   * Total bytes written.
   */
  total_bytes_written: number;
}

/**
 * Violation of an apply invariant.
 */
export interface ApplyViolation {
  /**
   * Rule ID from APPLY_SPEC (e.g., "AS5").
   */
  rule_id: string;

  /**
   * Relevant path (optional).
   */
  path?: string;

  /**
   * Human-readable message.
   */
  message: string;
}

/**
 * Source information for the applied patch.
 */
export interface ApplyPatchSource {
  /**
   * Proposal ID that generated the patch.
   */
  proposal_id: string;

  /**
   * Hash of the proposal.
   */
  proposal_hash: string;
}

/**
 * Complete result of applying a patch to a target directory.
 */
export interface ApplyResult {
  /**
   * Schema version for this format.
   */
  apply_schema_version: string;

  /**
   * Overall outcome.
   */
  outcome: ApplyOutcome;

  /**
   * Whether this was a dry run (no writes).
   */
  dry_run: boolean;

  /**
   * Target root directory (relative, no absolute paths).
   */
  target_root: string;

  /**
   * Patch source info.
   */
  patch_source: ApplyPatchSource;

  /**
   * Per-operation results (sorted by path).
   */
  operation_results: ApplyOperationResult[];

  /**
   * Summary statistics.
   */
  summary: ApplySummary;

  /**
   * Violations if any (sorted by rule_id, path).
   */
  violations?: ApplyViolation[];

  /**
   * Error message if outcome is FAILED or REFUSED.
   */
  error?: string;
}

/**
 * Result of verifying an apply result against APPLY_SPEC.md.
 */
export type ApplyVerifyResult =
  | { ok: true }
  | { ok: false; violations: ApplyViolation[] };

/**
 * Options for apply verification.
 */
export interface ApplyVerifyOptions {
  /**
   * Skip checking that operation_results paths match patch operations.
   * Useful when verifying a result without the original patch.
   */
  skipPatchMatch?: boolean;
}

/**
 * Options for apply execution.
 */
export interface ApplyOptions {
  /**
   * Dry-run mode: generate report but no writes.
   */
  dryRun?: boolean;

  /**
   * Allow overwrite on create (converts to modify semantics).
   * Default: false (strict mode).
   */
  allowOverwrite?: boolean;
}
