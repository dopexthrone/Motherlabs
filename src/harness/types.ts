/**
 * Harness Types
 * =============
 *
 * Type definitions for the harness orchestration layer.
 * The harness is NON-AUTHORITATIVE - it only orchestrates.
 * All decisions come from the kernel.
 */

// =============================================================================
// Input Types
// =============================================================================

/**
 * Execution mode for the harness.
 */
export type ExecutionMode = 'plan-only' | 'execute-sandbox';

/**
 * Policy profile name.
 */
export type PolicyProfileName = 'strict' | 'default' | 'dev';

/**
 * Input to the harness run.
 */
export interface HarnessRunInput {
  /**
   * Path to the intent file.
   */
  intent_path: string;

  /**
   * Execution mode.
   */
  mode: ExecutionMode;

  /**
   * Policy profile to use.
   */
  policy: PolicyProfileName;
}

// =============================================================================
// Policy Types
// =============================================================================

/**
 * Policy profile configuration.
 * Controls sandbox behavior and limits.
 */
export interface PolicyProfile {
  /**
   * Profile name.
   */
  name: PolicyProfileName;

  /**
   * Whether network access is allowed.
   */
  allow_network: boolean;

  /**
   * Timeout in milliseconds for entire execution.
   */
  timeout_ms: number;

  /**
   * Maximum number of output files.
   */
  max_output_files: number;

  /**
   * Maximum total output size in bytes.
   */
  max_total_output_bytes: number;

  /**
   * Allowed commands (if empty, all are allowed in dev mode).
   */
  allowed_commands: string[];

  /**
   * Allowed write roots (relative to sandbox).
   */
  allowed_write_roots: string[];
}

// =============================================================================
// Execution Evidence Types
// =============================================================================

/**
 * Hash of file content.
 * Format: "sha256:{hex}"
 */
export type ContentHash = string;

/**
 * Output file captured from execution.
 */
export interface OutputFile {
  /**
   * Relative path from sandbox root (forward slashes).
   */
  path: string;

  /**
   * SHA-256 hash of file content.
   */
  sha256: ContentHash;

  /**
   * Size in bytes.
   */
  size_bytes: number;
}

/**
 * Execution details captured by sandbox.
 */
export interface SandboxExecution {
  /**
   * Unique sandbox identifier.
   */
  sandbox_id: string;

  /**
   * Command that was executed.
   */
  cmd: string[];

  /**
   * Exit code.
   */
  exit_code: number;

  /**
   * SHA-256 hash of stdout.
   */
  stdout_sha256: ContentHash;

  /**
   * SHA-256 hash of stderr.
   */
  stderr_sha256: ContentHash;

  /**
   * Output files collected (sorted by path).
   */
  outputs: OutputFile[];

  /**
   * Total output bytes.
   */
  total_output_bytes: number;

  /**
   * Whether output was truncated due to limits.
   */
  output_truncated: boolean;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Kind of kernel result.
 */
export type KernelResultKind = 'CLARIFY' | 'REFUSE' | 'BUNDLE';

/**
 * Decision made by the harness (based on kernel validation).
 */
export interface DecisionRecord {
  /**
   * Whether the execution was accepted.
   */
  accepted: boolean;

  /**
   * Reasons for the decision.
   */
  reasons: string[];

  /**
   * Whether this decision was validated by kernel.
   */
  validated_by_kernel: boolean;
}

/**
 * Complete result of a harness run.
 */
export interface HarnessRunResult {
  /**
   * Unique run identifier.
   * Format: "hr_{timestamp}_{suffix}"
   */
  run_id: string;

  /**
   * Timestamp when run started (ISO 8601 UTC).
   * Note: For audit only, NOT used in any hashes.
   */
  started_at: string;

  /**
   * Timestamp when run completed (ISO 8601 UTC).
   */
  completed_at: string;

  /**
   * Kernel version used.
   */
  kernel_version: string;

  /**
   * Policy profile used.
   */
  policy: PolicyProfile;

  /**
   * Intent information.
   */
  intent: {
    /**
     * Path to intent file.
     */
    path: string;

    /**
     * SHA-256 hash of intent file content.
     */
    sha256: ContentHash;
  };

  /**
   * Bundle information (null if CLARIFY or REFUSE).
   */
  bundle: null | {
    /**
     * Bundle ID.
     */
    bundle_id: string;

    /**
     * SHA-256 hash of canonical bundle.
     */
    sha256: ContentHash;
  };

  /**
   * Kind of kernel result.
   */
  kernel_result_kind: KernelResultKind;

  /**
   * Unresolved questions (if CLARIFY).
   */
  clarify_questions?: string[];

  /**
   * Refusal reason (if REFUSE).
   */
  refuse_reason?: string;

  /**
   * Execution details (null if plan-only or no bundle).
   */
  execution: null | SandboxExecution;

  /**
   * Decision record.
   */
  decision: DecisionRecord;
}

// =============================================================================
// Ledger Types
// =============================================================================

/**
 * Entry in the harness ledger (append-only).
 */
export interface LedgerEntry {
  /**
   * Run ID.
   */
  run_id: string;

  /**
   * Timestamp (ISO 8601 UTC).
   */
  timestamp: string;

  /**
   * Intent SHA-256.
   */
  intent_sha256: ContentHash;

  /**
   * Bundle SHA-256 (null if no bundle).
   */
  bundle_sha256: ContentHash | null;

  /**
   * Kernel result kind.
   */
  result_kind: KernelResultKind;

  /**
   * Whether execution was accepted.
   */
  accepted: boolean;

  /**
   * Execution mode used.
   */
  mode: ExecutionMode;

  /**
   * Policy used.
   */
  policy: PolicyProfileName;
}
