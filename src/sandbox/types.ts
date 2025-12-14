// Gate 4 Types - Kernel-grade test execution
// Based on Motherlabs Kernel specification

/**
 * Capabilities that can be granted to an execution
 */
export type ExecutionCapability =
  | 'FS_READ'           // Always implicit for repo content
  | 'FS_WRITE_SANDBOX'  // Write only inside run sandbox
  | 'NET'               // Network access (default: denied)

/**
 * Test execution request - inputs to Gate 4
 */
export type TestExecRequest = {
  attempt_id: string
  cwd: string                        // Absolute or repo-relative (validated)
  command: string[]                  // argv array, NOT shell string
  env_allowlist: string[]            // Environment variables to pass through
  time_limit_ms: number
  capabilities: ExecutionCapability[]
  sandbox_root: string               // Deterministic run directory path
}

/**
 * Evidence artifact reference
 */
export type EvidenceArtifact = {
  artifact_id: string
  artifact_type: 'stdout_log' | 'stderr_log' | 'exit_code' | 'file_manifest' | 'network_manifest'
  path: string
  sha256: string
  size_bytes: number
}

/**
 * File manifest entry (diff-based)
 */
export type FileManifestEntry = {
  relative_path: string
  operation: 'create' | 'overwrite' | 'delete'
  byte_count: number
  sha256: string
}

/**
 * Diff-based file manifest
 */
export type DiffBasedManifest = {
  manifest_version: '1.0'
  entries: FileManifestEntry[]
  files_created: number
  files_overwritten: number
  files_deleted: number
  total_bytes_written: number
}

/**
 * Network manifest entry
 */
export type NetworkManifestEntry = {
  timestamp: number
  host: string
  port: number
  protocol: 'tcp' | 'udp'
  direction: 'outbound' | 'inbound'
}

/**
 * Network manifest
 */
export type NetworkManifest = {
  manifest_version: '1.0'
  denied: boolean
  entries: NetworkManifestEntry[]
}

/**
 * Policy checks performed during execution
 */
export type PolicyChecks = {
  cwd_validated: boolean
  env_sanitized: boolean
  network_denied_or_manifested: boolean
  fs_write_within_limits: boolean
  symlink_escape_absent: boolean
  path_escape_absent: boolean
}

/**
 * Deterministic fingerprint for audit
 */
export type DeterministicFingerprint = {
  runner_version: string
  command_hash: string
  env_hash: string
  sandbox_config_hash: string
}

/**
 * Evidence bundle produced by execution
 */
export type EvidenceBundle = {
  stdout_log: EvidenceArtifact
  stderr_log: EvidenceArtifact
  exit_code_artifact: EvidenceArtifact
  file_manifest?: EvidenceArtifact
  network_manifest: EvidenceArtifact
}

/**
 * Denial reason codes
 */
export type DenialReason =
  | 'TIMEOUT'
  | 'EXIT_NONZERO'
  | 'POLICY_VIOLATION'
  | 'EVIDENCE_MISSING'
  | 'HASH_MISMATCH'
  | 'PATH_ESCAPE'
  | 'SYMLINK_ESCAPE'
  | 'FILE_SIZE_EXCEEDED'
  | 'FILE_COUNT_EXCEEDED'
  | 'BYTES_EXCEEDED'
  | 'CWD_INVALID'
  | 'COMMAND_NOT_ALLOWED'
  | 'EXECUTION_ERROR'

/**
 * Test execution result - output from Gate 4
 */
export type TestExecResult = {
  ok: boolean
  exit_code: number
  timed_out: boolean
  evidence: EvidenceBundle
  policy_checks: PolicyChecks
  deterministic_fingerprint: DeterministicFingerprint
  denial?: {
    reason: DenialReason
    message: string
    details?: Record<string, unknown>
  }
}

/**
 * Sandbox limits configuration
 */
export type SandboxLimits = {
  max_file_size_bytes: number      // Per-file limit
  max_total_bytes: number          // Total write limit
  max_file_count: number           // Max files created
  max_stdout_bytes: number
  max_stderr_bytes: number
}

/**
 * Sandbox configuration
 */
export type SandboxConfig = {
  run_dir: string
  repo_root: string
  limits: SandboxLimits
  capabilities: ExecutionCapability[]
  env_allowlist: string[]
  time_limit_ms: number
}

/**
 * Sandbox state snapshot (for diff)
 */
export type SandboxSnapshot = {
  timestamp: number
  files: Map<string, { sha256: string; size_bytes: number }>
}

/**
 * Diff result between two snapshots
 */
export type SandboxDiffResult = {
  created: FileManifestEntry[]
  overwritten: FileManifestEntry[]
  deleted: FileManifestEntry[]
  violations: Array<{
    type: 'SYMLINK_ESCAPE' | 'PATH_ESCAPE' | 'SIZE_EXCEEDED' | 'COUNT_EXCEEDED'
    path: string
    message: string
  }>
}

/**
 * Default sandbox limits
 */
export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  max_file_size_bytes: 10 * 1024 * 1024,   // 10 MB per file
  max_total_bytes: 100 * 1024 * 1024,      // 100 MB total
  max_file_count: 1000,                     // Max 1000 files
  max_stdout_bytes: 5 * 1024 * 1024,       // 5 MB stdout
  max_stderr_bytes: 5 * 1024 * 1024        // 5 MB stderr
}

/**
 * Runner version for fingerprinting
 */
export const RUNNER_VERSION = '1.0.0'
