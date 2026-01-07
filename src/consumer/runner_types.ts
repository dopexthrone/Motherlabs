/**
 * Runner Types
 * ============
 *
 * Consumer types for RUNNER_SPEC.md compliance.
 * These types define the runner format for capturing deterministic
 * execution environment details without exposing secrets.
 */

/**
 * Schema version for runner records.
 */
export const RUNNER_SCHEMA_VERSION = '1.0.0';

/**
 * Valid operating systems.
 */
export const VALID_OS = ['linux', 'darwin', 'win32'] as const;
export type ValidOS = (typeof VALID_OS)[number];

/**
 * Valid architectures.
 */
export const VALID_ARCH = ['x64', 'arm64', 'ia32'] as const;
export type ValidArch = (typeof VALID_ARCH)[number];

/**
 * Valid sandbox backends.
 */
export const VALID_SANDBOX_BACKENDS = ['process', 'container', 'vm', 'none'] as const;
export type SandboxBackend = (typeof VALID_SANDBOX_BACKENDS)[number];

/**
 * Valid isolation levels.
 */
export const VALID_ISOLATION_LEVELS = ['strict', 'standard', 'none'] as const;
export type IsolationLevel = (typeof VALID_ISOLATION_LEVELS)[number];

/**
 * Forbidden environment variable prefixes in env_allowlist.
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
 * Limit bounds for validation.
 */
export const LIMIT_BOUNDS = {
  timeout_ms: { min: 1000, max: 600000 },
  max_output_files: { min: 1, max: 10000 },
  max_total_output_bytes: { min: 1024, max: 1073741824 },
} as const;

/**
 * Platform information.
 */
export interface RunnerPlatform {
  os: string;
  arch: string;
  node_version: string;
  npm_version: string;
}

/**
 * Sandbox configuration.
 */
export interface RunnerSandbox {
  backend: string;
  isolation_level: string;
  network_blocked: boolean;
  filesystem_readonly: boolean;
}

/**
 * Execution limits.
 */
export interface RunnerLimits {
  timeout_ms: number;
  max_output_files: number;
  max_total_output_bytes: number;
  max_memory_bytes?: number;
  max_cpu_seconds?: number;
}

/**
 * Command policy.
 */
export interface RunnerCommands {
  allowlist: string[];
  blocklist: string[];
  shell: string;
}

/**
 * Execution context.
 */
export interface RunnerContext {
  working_dir: '.';
  env_allowlist: string[];
  locale: string;
  timezone: string;
}

/**
 * Execution phase timing.
 */
export interface ExecutionPhase {
  name: string;
  started_at: string;
  duration_ms: number;
}

/**
 * Timing information.
 */
export interface RunnerTiming {
  started_at: string;
  completed_at: string;
  duration_ms: number;
  phases?: ExecutionPhase[];
}

/**
 * Exit status.
 */
export interface RunnerExit {
  code: number;
  signal?: string;
  oom_killed: boolean;
  timeout_killed: boolean;
}

/**
 * Ephemeral fields excluded from core hash.
 */
export interface RunnerEphemeral {
  host_id?: string;
  session_id?: string;
  human_notes?: string;
}

/**
 * Core fields used for content-addressing.
 * Excludes ephemeral and timing.
 */
export interface RunnerCore {
  runner_schema_version: string;
  runner_id: string;
  runner_version: string;
  platform: RunnerPlatform;
  sandbox: RunnerSandbox;
  limits: RunnerLimits;
  commands: RunnerCommands;
  write_roots: string[];
  context: RunnerContext;
  exit: RunnerExit;
  warnings?: string[];
}

/**
 * Complete runner record.
 */
export interface Runner extends RunnerCore {
  timing: RunnerTiming;
  ephemeral?: RunnerEphemeral;
}

/**
 * Verification violation.
 */
export interface RunnerViolation {
  rule_id: string;
  message: string;
  path?: string;
}

/**
 * Verification result.
 */
export interface RunnerVerificationResult {
  valid: boolean;
  violations: RunnerViolation[];
  runner_hash?: string;
}

/**
 * Verification options.
 */
export interface RunnerVerifyOptions {
  /**
   * Skip timing consistency checks.
   */
  skipTimingValidation?: boolean;
}
