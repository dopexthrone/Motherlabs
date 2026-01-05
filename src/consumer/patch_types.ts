/**
 * Patch Consumer Types
 * ====================
 *
 * Minimal public types for patch verification.
 * These types are for consumers; the full kernel types remain internal.
 *
 * See: docs/PATCH_SPEC.md
 */

// Re-export Violation type from bundle_types for consistency
export type { Violation } from './bundle_types.js';

/**
 * Current patch schema version.
 */
export const PATCH_SCHEMA_VERSION = '1.0.0';

/**
 * Patch operation type.
 */
export type PatchOpType = 'create' | 'modify' | 'delete';

/**
 * Single file operation within a PatchSet.
 */
export interface PatchOperation {
  /**
   * Operation type.
   */
  op: PatchOpType;

  /**
   * Target file path (relative, POSIX-style).
   */
  path: string;

  /**
   * File content (for create/modify operations).
   */
  content?: string;

  /**
   * Expected content hash after operation.
   */
  expected_hash?: string;

  /**
   * Content size in bytes.
   */
  size_bytes?: number;

  /**
   * Ordering priority (lower = earlier).
   * Used for deterministic sorting.
   */
  order?: number;
}

/**
 * Collection of file operations to apply.
 */
export interface PatchSet {
  /**
   * Schema version for this format.
   */
  patch_schema_version: string;

  /**
   * Source proposal ID that generated this patch set.
   */
  source_proposal_id: string;

  /**
   * Hash of the source proposal.
   */
  source_proposal_hash: string;

  /**
   * Ordered list of file operations.
   * ORDERING: Sorted by order ascending, then path ascending.
   */
  operations: PatchOperation[];

  /**
   * Total byte count of all content.
   */
  total_bytes: number;
}

/**
 * Result of verifying a patch set against PATCH_SPEC.md.
 */
export type PatchVerifyResult =
  | { ok: true }
  | { ok: false; violations: import('./bundle_types.js').Violation[] };

/**
 * Options for patch verification.
 */
export interface PatchVerifyOptions {
  /**
   * Maximum total bytes allowed (from policy).
   * Default: 50MB (default policy).
   */
  maxTotalBytes?: number;
}
