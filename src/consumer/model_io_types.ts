/**
 * Model IO Consumer Types
 * =======================
 *
 * Minimal public types for model recording session verification.
 * These types are for consumers verifying model_io.json artifacts.
 *
 * See: docs/MODEL_IO_SPEC.md
 */

/**
 * Current model IO spec version.
 */
export const MODEL_IO_SCHEMA_VERSION = '1.0.0';

/**
 * Content hash format.
 */
export type ContentHash = `sha256:${string}`;

/**
 * Recording mode.
 */
export type ModelIOMode = 'record' | 'replay';

/**
 * Valid modes.
 */
export const VALID_MODES: readonly ModelIOMode[] = ['record', 'replay'] as const;

/**
 * Size limits per MODEL_IO_SPEC.md MI11.
 */
export const MODEL_IO_LIMITS = {
  /** Maximum interactions per session */
  MAX_INTERACTIONS: 10000,
  /** Maximum bytes per response content */
  MAX_RESPONSE_BYTES: 1_000_000,
  /** Maximum total response bytes per session */
  MAX_TOTAL_BYTES: 100_000_000,
} as const;

/**
 * Session statistics (ephemeral, not included in hash).
 */
export interface ModelIOStats {
  total_interactions: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_latency_ms: number;
}

/**
 * A recorded interaction.
 */
export interface ModelIOInteraction {
  /** Sequence index (0-based, monotonically increasing) */
  i: number;
  /** SHA256 hash of the prompt */
  prompt_hash: ContentHash;
  /** SHA256 hash of the response content */
  response_hash: ContentHash;
  /** Response content (UTF-8 string) */
  response_content: string;
  /** Tokens consumed in request (optional, ephemeral) */
  tokens_input?: number;
  /** Tokens generated in response (optional, ephemeral) */
  tokens_output?: number;
  /** Latency in milliseconds (optional, ephemeral) */
  latency_ms?: number;
}

/**
 * Core interaction fields for hashing (excludes ephemeral fields).
 */
export interface ModelIOInteractionCore {
  i: number;
  prompt_hash: ContentHash;
  response_hash: ContentHash;
  response_content: string;
}

/**
 * A complete model IO recording session.
 */
export interface ModelIOSession {
  /** Schema version */
  model_io_schema_version: string;
  /** Unique adapter instance identifier */
  adapter_id: string;
  /** Human-readable model identifier */
  model_id: string;
  /** Recording or replay mode */
  mode: ModelIOMode;
  /** Ordered list of recorded interactions */
  interactions: ModelIOInteraction[];
  /** Session start timestamp (optional, ephemeral) */
  created_at_utc?: string;
  /** Session end timestamp (optional, ephemeral) */
  ended_at_utc?: string;
  /** Summary statistics (optional, ephemeral) */
  stats?: ModelIOStats;
}

/**
 * Core session fields for hashing (excludes ephemeral fields).
 */
export interface ModelIOCore {
  model_io_schema_version: string;
  adapter_id: string;
  model_id: string;
  mode: ModelIOMode;
  interactions: ModelIOInteractionCore[];
}

/**
 * Model IO violation.
 */
export interface ModelIOViolation {
  /** Rule ID from MODEL_IO_SPEC.md (e.g., "MI1", "MI5") */
  rule_id: string;
  /** Relevant path (optional, e.g., "$.interactions[0].i") */
  path?: string;
  /** Human-readable description */
  message: string;
}

/**
 * Result of verifying a model IO session (success).
 */
export interface ModelIOVerifySuccess {
  ok: true;
  /** Number of interactions verified */
  interactions_count: number;
  /** Computed ModelIOHash */
  model_io_hash: ContentHash;
}

/**
 * Result of verifying a model IO session (failure).
 */
export interface ModelIOVerifyFailure {
  ok: false;
  /** List of violations */
  violations: ModelIOViolation[];
}

/**
 * Result of verifying a model IO session.
 */
export type ModelIOVerifyResult = ModelIOVerifySuccess | ModelIOVerifyFailure;

/**
 * Options for model IO verification.
 */
export interface ModelIOVerifyOptions {
  /**
   * Whether to verify response hash integrity (MI7).
   * Default: true
   */
  verifyResponseHashes?: boolean;

  /**
   * Whether to enforce size limits (MI11).
   * Default: true
   */
  enforceSizeLimits?: boolean;
}
