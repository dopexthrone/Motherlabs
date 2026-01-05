/**
 * Bundle Consumer Module
 * ======================
 *
 * Public API for third-party bundle consumers.
 *
 * Usage:
 *   import { verifyBundle, summarizeBundle } from 'context-engine-kernel/consumer';
 *
 * Or via CLI:
 *   npm run bundle-verify -- bundle.json
 *   npm run bundle-summarize -- bundle.json
 *
 * See: docs/CONSUMING_BUNDLES.md
 */

// Types
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

// Verification
export { verifyBundle } from './bundle_verify.js';

// Summary
export { summarizeBundle } from './bundle_summary.js';
