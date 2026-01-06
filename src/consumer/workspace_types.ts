/**
 * Workspace Snapshot Types
 * ========================
 *
 * Consumer types for WORKSPACE_SPEC.md compliance.
 * These types define the workspace snapshot format for capturing
 * deterministic execution inputs without exposing secrets.
 */

/**
 * Schema version for workspace snapshots.
 */
export const WORKSPACE_SCHEMA_VERSION = '1.0.0';

/**
 * Valid tool IDs for workspace snapshots.
 */
export const VALID_TOOL_IDS = [
  'pack-export',
  'pack-apply',
  'git-apply',
  'repo-state',
  'workspace-snapshot',
] as const;

export type ToolId = (typeof VALID_TOOL_IDS)[number];

/**
 * Default environment variable allowlist.
 * Values are hashed, never stored raw.
 */
export const DEFAULT_ENV_ALLOWLIST = ['LANG', 'LC_ALL', 'NODE_ENV', 'TZ'] as const;

/**
 * Forbidden environment variable names (exact match).
 */
export const FORBIDDEN_ENV_NAMES = ['PATH', 'HOME', 'USER'] as const;

/**
 * Forbidden environment variable prefixes.
 * Any variable starting with these is rejected.
 */
export const FORBIDDEN_ENV_PREFIXES = [
  'SSH_',
  'NPM_',
  'GIT_',
  'AWS_',
  'OPENAI_',
  'ANTHROPIC_',
] as const;

/**
 * Reference to an intent file.
 */
export interface IntentRef {
  rel_path: string;
  sha256: string;
}

/**
 * Reference to a pack directory.
 */
export interface PackRef {
  rel_path: string;
  pack_hash: string;
}

/**
 * Reference to a model IO recording.
 */
export interface ModelIORef {
  rel_path: string;
  sha256: string;
}

/**
 * Reference to a policy profile.
 */
export interface PolicyRef {
  profile: string;
  policy_hash: string;
}

/**
 * Reference to a repo state file.
 */
export interface RepoStateRef {
  rel_path: string;
  sha256: string;
}

/**
 * All references in a workspace snapshot.
 */
export interface WorkspaceRefs {
  intent?: IntentRef;
  pack?: PackRef;
  model_io?: ModelIORef;
  policy: PolicyRef;
  repo_state?: RepoStateRef;
}

/**
 * Hashed environment variable entry.
 */
export interface EnvHashedEntry {
  name: string;
  sha256: string;
}

/**
 * Environment configuration in workspace snapshot.
 */
export interface WorkspaceEnv {
  allowlist: string[];
  hashed: EnvHashedEntry[];
}

/**
 * Safety boundaries configuration.
 */
export interface WorkspaceSafety {
  work_root_rel: '.';
  denies_absolute: true;
  denies_traversal: true;
}

/**
 * Ephemeral fields excluded from core hash.
 */
export interface WorkspaceSnapshotEphemeral {
  generated_at?: string;
  tool_version?: string;
  human_notes?: string;
}

/**
 * Core fields used for content-addressing.
 */
export interface WorkspaceSnapshotCore {
  workspace_schema_version: string;
  tool_id: string;
  args: Record<string, string | boolean | string[]>;
  refs: WorkspaceRefs;
  env: WorkspaceEnv;
  safety: WorkspaceSafety;
  warnings?: string[];
}

/**
 * Complete workspace snapshot.
 */
export interface WorkspaceSnapshot extends WorkspaceSnapshotCore {
  ephemeral?: WorkspaceSnapshotEphemeral;
}

/**
 * Verification violation.
 */
export interface WorkspaceViolation {
  rule_id: string;
  message: string;
  path?: string;
}

/**
 * Verification result.
 */
export interface WorkspaceVerificationResult {
  valid: boolean;
  violations: WorkspaceViolation[];
  workspace_hash?: string;
}

/**
 * Verification options.
 */
export interface WorkspaceVerifyOptions {
  /**
   * Skip hash verification for referenced files.
   */
  skipHashVerification?: boolean;
}

/**
 * Required refs for each tool ID.
 */
export const REQUIRED_REFS_BY_TOOL: Record<ToolId, ('intent' | 'pack')[]> = {
  'pack-export': ['intent'],
  'pack-apply': ['pack'],
  'git-apply': ['pack'],
  'repo-state': [],
  'workspace-snapshot': [],
};
