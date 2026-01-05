/**
 * Bundle Consumer Types
 * =====================
 *
 * Minimal public types for bundle verification and summary.
 * These types are for consumers; the full kernel types remain internal.
 *
 * NOTE: This module re-exports stable types from the kernel.
 * Consumers should use these types for API stability.
 */

// Re-export core types that consumers need for bundle handling
export type {
  Bundle,
  BundleStatus,
  BundleStats,
  ContextNode,
  Output,
  Question,
} from '../types/artifacts.js';

/**
 * Result kind determined from bundle structure.
 */
export type ResultKind = 'BUNDLE' | 'CLARIFY' | 'REFUSE';

/**
 * Violation from bundle verification.
 * Returned when a bundle fails spec validation.
 */
export interface Violation {
  /** Rule ID from BUNDLE_SPEC.md (e.g., "BS1", "BS3") */
  rule_id: string;
  /** JSON path to the violation (e.g., "$.outputs[0].path") */
  path: string;
  /** Human-readable description */
  message: string;
}

/**
 * Result of verifying a bundle against BUNDLE_SPEC.md.
 */
export type VerifyResult =
  | { ok: true }
  | { ok: false; violations: Violation[] };

/**
 * Deterministic summary of a bundle.
 * All fields are JSON-serializable and stable.
 */
export interface BundleSummary {
  /** Schema version from the bundle */
  schema_version: string;
  /** Outcome type: BUNDLE, CLARIFY, or REFUSE */
  outcome: ResultKind;
  /** Bundle hash if bundle is valid (hex string) */
  bundle_hash: string | null;
  /** Number of artifacts/outputs */
  artifact_count: number;
  /** List of artifact paths, sorted lexicographically */
  artifact_paths: string[];
  /** Number of unresolved questions */
  unresolved_questions_count: number;
  /** List of question IDs, sorted by spec (priority desc, id asc) */
  question_ids: string[];
  /** Number of terminal nodes */
  terminal_nodes_count: number;
  /** List of terminal node IDs, sorted lexicographically */
  terminal_node_ids: string[];
}
