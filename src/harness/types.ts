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
 * Model mode for the harness.
 * Controls how model adapters are used.
 *
 * - 'none': No model calls (kernel-only processing)
 * - 'record': Record model interactions to file
 * - 'replay': Replay recorded model interactions
 *
 * Policy enforcement:
 * - 'strict' and 'default' policies MUST use 'none'
 * - 'dev' policy may use 'record' or 'replay'
 */
export type ModelMode = 'none' | 'record' | 'replay';

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

  /**
   * Model mode (default: 'none').
   * Enforced by policy: strict/default MUST use 'none'.
   */
  model_mode?: ModelMode;

  /**
   * Path to recording file for record/replay modes.
   * Required when model_mode is 'record' or 'replay'.
   */
  model_recording_path?: string;

  /**
   * If true, preserve the sandbox directory after execution.
   * The sandbox path will be returned in the result.
   * Caller is responsible for cleanup.
   */
  preserve_sandbox?: boolean;
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
 * Current run schema version.
 * Bump this when RunResult schema changes.
 */
export const RUN_SCHEMA_VERSION = '1.0.0';

/**
 * Complete result of a harness run.
 */
export interface HarnessRunResult {
  /**
   * Schema version for this RunResult format.
   * Required per RUN_SPEC.md RS1.
   */
  run_schema_version: string;

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

  /**
   * Sandbox path (only if preserve_sandbox was true and execution happened).
   * Caller is responsible for cleanup.
   */
  sandbox_path?: string;

  /**
   * Model mode used for this run.
   */
  model_mode: ModelMode;

  /**
   * Path to model I/O log (only if model_mode was 'record').
   * Format: JSONL with one entry per model interaction.
   */
  model_io_path?: string;
}

// =============================================================================
// Model I/O Types
// =============================================================================

/**
 * Entry in the model I/O log (JSONL format).
 * Records all model interactions for audit and replay.
 */
export interface ModelIOEntry {
  /**
   * Sequence number within the run.
   */
  sequence: number;

  /**
   * Timestamp (ISO 8601 UTC).
   */
  timestamp: string;

  /**
   * SHA-256 hash of the request (prompt + context).
   */
  request_sha256: string;

  /**
   * Model identifier.
   */
  model_id: string;

  /**
   * Request parameters (canonicalized).
   */
  parameters: {
    prompt_length: number;
    context_intent_id: string;
    context_mode: string;
  };

  /**
   * Raw response content.
   */
  raw_response: string;

  /**
   * SHA-256 hash of the response.
   */
  response_sha256: string;

  /**
   * Tokens used.
   */
  tokens: {
    input: number;
    output: number;
  };

  /**
   * Latency in milliseconds.
   */
  latency_ms: number;
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
