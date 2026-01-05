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
