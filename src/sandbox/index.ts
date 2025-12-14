// Sandbox Module - Secure code execution
// Based on Motherlabs Kernel patterns

// Legacy executor (for backward compatibility)
export {
  executeCode,
  verifyCodeExecution,
  cleanupRunDirectory,
  ensureSandboxRoot,
  type ExecutionConfig,
  type ExecutionResult
} from './executor'

// Kernel-grade runner (new)
export {
  runTestExec,
  verifyEvidence,
  cleanupRunDir
} from './runner'

// Kernel-grade types
export type {
  TestExecRequest,
  TestExecResult,
  SandboxConfig,
  SandboxSnapshot,
  SandboxDiffResult,
  DiffBasedManifest,
  NetworkManifest,
  EvidenceBundle,
  EvidenceArtifact,
  PolicyChecks,
  DeterministicFingerprint,
  DenialReason,
  ExecutionCapability,
  FileManifestEntry,
  NetworkManifestEntry,
  SandboxLimits
} from './types'

export { DEFAULT_SANDBOX_LIMITS, RUNNER_VERSION } from './types'
