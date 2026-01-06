/**
 * Bundle Consumer Module
 * ======================
 *
 * Public API for third-party bundle consumers.
 *
 * Usage:
 *   import { verifyBundle, summarizeBundle } from 'context-engine-kernel/consumer';
 *   import { verifyPatch } from 'context-engine-kernel/consumer';
 *
 * Or via CLI:
 *   npm run bundle-verify -- bundle.json
 *   npm run bundle-summarize -- bundle.json
 *   npm run patch-verify -- patch.json
 *
 * See: docs/CONSUMING_BUNDLES.md, docs/PATCH_SPEC.md
 */

// Bundle Types
export type {
  Bundle,
  BundleStatus,
  BundleStats,
  ContextNode,
  Output,
  Question,
  ResultKind,
  Violation,
  VerifyResult,
  BundleSummary,
} from './bundle_types.js';

// Bundle Verification
export { verifyBundle } from './bundle_verify.js';

// Bundle Summary
export { summarizeBundle } from './bundle_summary.js';

// Patch Types
export type {
  PatchSet,
  PatchOperation,
  PatchOpType,
  PatchVerifyResult,
  PatchVerifyOptions,
} from './patch_types.js';
export { PATCH_SCHEMA_VERSION } from './patch_types.js';

// Patch Verification
export { verifyPatch } from './patch_verify.js';

// Model IO Types
export type {
  ModelIOSession,
  ModelIOInteraction,
  ModelIOCore,
  ModelIOInteractionCore,
  ModelIOViolation,
  ModelIOVerifyResult,
  ModelIOVerifySuccess,
  ModelIOVerifyFailure,
  ModelIOVerifyOptions,
  ModelIOMode,
  ModelIOStats,
} from './model_io_types.js';
export { MODEL_IO_SCHEMA_VERSION, MODEL_IO_LIMITS, VALID_MODES } from './model_io_types.js';

// Model IO Verification
export { verifyModelIO, computeModelIOCore, computeModelIOHash } from './model_io_verify.js';

// Apply Types
export type {
  ApplyResult,
  ApplyOutcome,
  ApplyOperationResult,
  ApplyOperationStatus,
  ApplyOpType,
  ApplySummary,
  ApplyViolation,
  ApplyPatchSource,
  ApplyVerifyResult,
  ApplyVerifyOptions,
  ApplyOptions,
} from './apply_types.js';
export { APPLY_SCHEMA_VERSION } from './apply_types.js';

// Apply Verification
export { verifyApplyResult } from './apply_verify.js';

// Repository State Types
export type {
  RepoState,
  RepoStateCore,
  RepoStateContracts,
  RepoStateEphemeral,
  RepoStateViolation,
  RepoStateVerificationResult,
  RepoStateVerifyOptions,
  RepoStateGenerateOptions,
} from './repo_state_types.js';
export { REPO_STATE_SCHEMA_VERSION, NODE_VERSION_BASELINE } from './repo_state_types.js';

// Repository State Verification
export {
  verifyRepoState,
  computeRepoStateCore,
  computeRepoStateHash,
  serializeRepoState,
} from './repo_state_verify.js';
