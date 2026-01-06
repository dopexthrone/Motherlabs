/**
 * Repository State Consumer Types
 * ================================
 *
 * Public types for repository state capture and verification.
 * These types define the environment fingerprint for reproducibility auditing.
 *
 * See: docs/REPO_STATE_SPEC.md
 */

/**
 * Current repo state schema version.
 */
export const REPO_STATE_SCHEMA_VERSION = '1.0.0';

/**
 * Expected Node.js version for freeze baseline.
 */
export const NODE_VERSION_BASELINE = 'v24.11.1';

/**
 * Contract versions map - spec version for each artifact type.
 */
export interface RepoStateContracts {
  /**
   * APPLY_SPEC.md schema version.
   */
  apply_schema_version: string;

  /**
   * BUNDLE_SPEC.md schema version.
   */
  bundle_schema_version: string;

  /**
   * GIT_APPLY_SPEC.md schema version.
   */
  git_apply_schema_version: string;

  /**
   * MODEL_IO_SPEC.md schema version.
   */
  model_io_schema_version: string;

  /**
   * PACK_SPEC.md schema version.
   */
  pack_schema_version: string;

  /**
   * PATCH_SPEC.md schema version.
   */
  patch_schema_version: string;

  /**
   * RUN_SPEC.md schema version.
   */
  run_schema_version: string;
}

/**
 * Ephemeral fields excluded from core hash (display-only).
 */
export interface RepoStateEphemeral {
  /**
   * Timestamp when state was generated (ISO 8601 UTC).
   */
  generated_at?: string;

  /**
   * Current branch name (varies, display only).
   */
  display_branch?: string;
}

/**
 * Core fields included in content hash.
 */
export interface RepoStateCore {
  /**
   * Schema version for this format.
   */
  repo_state_schema_version: string;

  /**
   * Git HEAD commit hash (40-char lowercase hex).
   */
  repo_commit: string;

  /**
   * Whether working tree has uncommitted changes.
   */
  repo_dirty: boolean;

  /**
   * List of dirty paths (sorted, relative only).
   */
  dirty_paths: string[];

  /**
   * Node.js version (e.g., "v24.11.1").
   */
  node_version: string;

  /**
   * npm version (e.g., "11.6.2").
   */
  npm_version: string;

  /**
   * Operating system platform.
   */
  os_platform: string;

  /**
   * Operating system architecture.
   */
  os_arch: string;

  /**
   * SHA256 hash of package-lock.json.
   * Format: sha256:{64 hex characters}
   */
  package_lock_sha256: string;

  /**
   * Contract/spec versions map.
   */
  contracts: RepoStateContracts;
}

/**
 * Complete repository state including ephemeral fields.
 */
export interface RepoState extends RepoStateCore {
  /**
   * Ephemeral fields (excluded from core hash).
   */
  ephemeral?: RepoStateEphemeral;
}

/**
 * Violation of a repo state invariant.
 */
export interface RepoStateViolation {
  /**
   * Rule ID from REPO_STATE_SPEC (e.g., "RS1").
   */
  rule_id: string;

  /**
   * Human-readable message.
   */
  message: string;

  /**
   * Relevant path (optional).
   */
  path?: string;
}

/**
 * Result of verifying a repo state against REPO_STATE_SPEC.md.
 */
export interface RepoStateVerificationResult {
  /**
   * Whether verification passed.
   */
  valid: boolean;

  /**
   * List of violations (sorted by rule_id, path).
   */
  violations: RepoStateViolation[];

  /**
   * SHA256 hash of RepoStateCore (present on success).
   */
  repo_state_hash?: string;

  /**
   * Whether node_version matches baseline.
   */
  node_version_match?: boolean;
}

/**
 * Options for repo state verification.
 */
export interface RepoStateVerifyOptions {
  /**
   * Skip RS2 node version baseline check.
   */
  skipNodeVersionCheck?: boolean;

  /**
   * Allow dirty repository (skip dirty warning).
   */
  allowDirty?: boolean;
}

/**
 * Options for repo state generation.
 */
export interface RepoStateGenerateOptions {
  /**
   * Skip dependency analysis (faster).
   */
  noDeps?: boolean;

  /**
   * Output file path (if not provided, outputs to stdout).
   */
  outFile?: string;
}
