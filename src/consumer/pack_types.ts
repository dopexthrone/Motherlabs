/**
 * Pack Consumer Types
 * ===================
 *
 * Minimal public types for pack verification.
 * These types are for consumers verifying run export packs.
 *
 * See: docs/PACK_SPEC.md
 */

// Re-export Violation type from bundle_types for consistency
export type { Violation } from './bundle_types.js';

/**
 * Current pack spec version.
 */
export const PACK_SPEC_VERSION = '1.0.0';

/**
 * Files in the pack manifest.
 */
export const PACK_MANIFEST = {
  /** Required files */
  REQUIRED: ['run.json', 'bundle.json'] as const,
  /** Optional files */
  OPTIONAL: ['patch.json', 'evidence.json', 'ledger.jsonl', 'policy.json', 'model_io.json', 'runner.json', 'meta.json'] as const,
  /** All allowed files */
  ALL: ['run.json', 'bundle.json', 'patch.json', 'evidence.json', 'ledger.jsonl', 'policy.json', 'model_io.json', 'runner.json', 'meta.json'] as const,
} as const;

/**
 * Kernel result kind (from RUN_SPEC.md).
 */
export type KernelResultKind = 'BUNDLE' | 'CLARIFY' | 'REFUSE';

/**
 * Content hash format.
 */
export type ContentHash = `sha256:${string}`;

/**
 * Reference integrity check result.
 */
export interface ReferenceCheck {
  /** Source file containing the reference */
  source: string;
  /** Target file being referenced */
  target: string;
  /** Field path containing the reference (e.g., "bundle.sha256") */
  field: string;
  /** Expected hash from the reference */
  expected: ContentHash | null;
  /** Computed hash from target file */
  computed: ContentHash | null;
  /** Whether the hashes match */
  match: boolean;
}

/**
 * File entry in the pack.
 */
export interface PackFileEntry {
  /** Filename */
  name: string;
  /** Whether this is a required file */
  required: boolean;
  /** Whether the file exists */
  exists: boolean;
  /** Computed content hash (if file exists) */
  content_hash?: ContentHash;
}

/**
 * Pack violation.
 */
export interface PackViolation {
  /** Rule ID from PACK_SPEC.md (e.g., "PK1", "PK5") */
  rule_id: string;
  /** Relevant file path (optional) */
  path?: string;
  /** Human-readable description */
  message: string;
}

/**
 * Result of verifying a pack (success).
 */
export interface PackVerifySuccess {
  ok: true;
  /** Pack directory path */
  pack_path: string;
  /** Files that were verified */
  files_verified: string[];
  /** Reference integrity checks performed */
  reference_checks: ReferenceCheck[];
}

/**
 * Result of verifying a pack (failure).
 */
export interface PackVerifyFailure {
  ok: false;
  /** Pack directory path */
  pack_path: string;
  /** List of violations */
  violations: PackViolation[];
}

/**
 * Result of verifying a pack.
 */
export type PackVerifyResult = PackVerifySuccess | PackVerifyFailure;

/**
 * Options for pack verification.
 */
export interface PackVerifyOptions {
  /**
   * Whether to perform deep validation of embedded files.
   * If true, validates bundle.json against BUNDLE_SPEC, patch.json against PATCH_SPEC, etc.
   * Default: true
   */
  deepValidation?: boolean;

  /**
   * Whether to verify reference integrity (hash matching).
   * Default: true
   */
  verifyReferences?: boolean;
}
