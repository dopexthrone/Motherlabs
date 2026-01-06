/**
 * Pack Apply Pipeline
 * ===================
 *
 * Applies a PACK_SPEC-compliant patch to a target directory.
 * This module is non-authoritative; it validates inputs and produces
 * deterministic apply reports with before/after hashes for auditing.
 *
 * Key guarantees:
 * - Safe: validates target root, refuses symlinks and traversal
 * - Deterministic: same inputs → byte-identical report
 * - Auditable: before/after hashes for every operation
 * - Compliant: validates patch before application
 * - No absolute paths: reports use relative paths only
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

import { verifyPatch } from '../consumer/patch_verify.js';
import { canonicalize } from '../utils/canonical.js';

import type {
  ApplyResult,
  ApplyOutcome,
  ApplyOperationResult,
  ApplySummary,
  ApplyViolation,
  ApplyOptions,
} from '../consumer/apply_types.js';
import type { PatchSet, PatchOperation } from '../consumer/patch_types.js';

// =============================================================================
// Constants
// =============================================================================

const APPLY_SCHEMA_VERSION = '1.0.0';

// =============================================================================
// Types
// =============================================================================

/**
 * Arguments for pack apply operation.
 */
export interface ApplyPackArgs {
  /** Path to pack directory containing patch.json */
  pack_dir: string;

  /** Target root directory to apply patch to */
  target_root: string;

  /** Apply options */
  options?: ApplyOptions;
}

/**
 * Internal operation context.
 */
interface OperationContext {
  targetRoot: string;
  dryRun: boolean;
}

// =============================================================================
// Hash Utilities
// =============================================================================

/**
 * Compute SHA-256 hash of content in standard format.
 */
function computeHash(content: string): string {
  const hash = createHash('sha256');
  hash.update(content, 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Compute hash of file content, or null if file doesn't exist.
 */
function hashFile(path: string): string | null {
  try {
    const content = readFileSync(path, 'utf8');
    return computeHash(content);
  } catch {
    return null;
  }
}

// =============================================================================
// Path Safety
// =============================================================================

/**
 * Check if path contains traversal patterns.
 * Check BEFORE normalization to catch all .. segments.
 */
function hasPathTraversal(pathStr: string): boolean {
  const segments = pathStr.split(/[/\\]/);
  return segments.some((seg) => seg === '..');
}

/**
 * Check if path is a symlink.
 */
function isSymlink(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if path is a directory (not a symlink).
 */
function isDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if path is a regular file (not a symlink).
 */
function isRegularFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if path exists and is a symlink (for blocking).
 */
function existsAsSymlink(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if target root has any symlinks in target tree.
 */
function hasSymlinksInTree(root: string): { found: boolean; path?: string } {
  try {
    const checkDir = (dir: string): { found: boolean; path?: string } => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          return { found: true, path: relative(root, fullPath) };
        }
        if (entry.isDirectory()) {
          const sub = checkDir(fullPath);
          if (sub.found) return sub;
        }
      }
      return { found: false };
    };
    return checkDir(root);
  } catch {
    return { found: false };
  }
}

/**
 * Validate target root is safe for applying patches.
 *
 * Rules (AS5):
 * - Must exist and be a directory
 * - Must not be a symlink
 * - Must not contain path traversal
 * - Must not be filesystem root
 */
function validateTargetRoot(targetRoot: string): { ok: true } | { ok: false; error: string; violations: ApplyViolation[] } {
  const violations: ApplyViolation[] = [];

  // Check for path traversal
  if (hasPathTraversal(targetRoot)) {
    violations.push({
      rule_id: 'AS5',
      message: 'target root contains path traversal',
    });
    return { ok: false, error: 'target root contains path traversal', violations };
  }

  const resolvedPath = resolve(targetRoot);

  // Check not filesystem root
  if (resolvedPath === '/') {
    violations.push({
      rule_id: 'AS5',
      message: 'target root cannot be filesystem root',
    });
    return { ok: false, error: 'target root cannot be filesystem root', violations };
  }

  // Check exists
  if (!existsSync(resolvedPath)) {
    violations.push({
      rule_id: 'AS5',
      message: 'target root is not a directory',
    });
    return { ok: false, error: 'target root is not a directory', violations };
  }

  // Check is directory
  if (!isDirectory(resolvedPath)) {
    if (isSymlink(resolvedPath)) {
      violations.push({
        rule_id: 'AS5',
        message: 'target root is a symbolic link',
      });
      return { ok: false, error: 'target root is a symbolic link', violations };
    }
    violations.push({
      rule_id: 'AS5',
      message: 'target root is not a directory',
    });
    return { ok: false, error: 'target root is not a directory', violations };
  }

  // Check for symlinks in tree
  const symlinkCheck = hasSymlinksInTree(resolvedPath);
  if (symlinkCheck.found) {
    const symlinkViolation: ApplyViolation = {
      rule_id: 'AS5',
      message: `symlink found in target tree: ${symlinkCheck.path}`,
    };
    if (symlinkCheck.path !== undefined) {
      symlinkViolation.path = symlinkCheck.path;
    }
    violations.push(symlinkViolation);
    return { ok: false, error: `symlink found in target tree: ${symlinkCheck.path}`, violations };
  }

  return { ok: true };
}

// =============================================================================
// Pack Loading
// =============================================================================

/**
 * Load and validate patch from pack directory.
 */
function loadPatch(packDir: string): { ok: true; patch: PatchSet } | { ok: false; error: string; violations: ApplyViolation[] } {
  const patchPath = join(packDir, 'patch.json');

  // AS3: patch.json required
  if (!existsSync(patchPath)) {
    return {
      ok: false,
      error: 'pack has no patch.json',
      violations: [{ rule_id: 'AS3', message: 'pack has no patch.json' }],
    };
  }

  let patchContent: string;
  try {
    patchContent = readFileSync(patchPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      error: `failed to read patch.json: ${err instanceof Error ? err.message : String(err)}`,
      violations: [{ rule_id: 'AS3', message: 'failed to read patch.json' }],
    };
  }

  let patch: unknown;
  try {
    patch = JSON.parse(patchContent);
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON in patch.json: ${err instanceof Error ? err.message : String(err)}`,
      violations: [{ rule_id: 'AS3', message: 'invalid JSON in patch.json' }],
    };
  }

  // AS4: patch must pass verification
  const verifyResult = verifyPatch(patch);
  if (!verifyResult.ok) {
    const count = verifyResult.violations.length;
    return {
      ok: false,
      error: `patch verification failed: ${count} violations`,
      violations: [
        { rule_id: 'AS4', message: `patch verification failed: ${count} violations` },
        ...verifyResult.violations.map((v) => ({
          rule_id: 'AS4',
          path: v.path,
          message: `[${v.rule_id}] ${v.message}`,
        })),
      ],
    };
  }

  return { ok: true, patch: patch as PatchSet };
}

// =============================================================================
// Operation Execution
// =============================================================================

/**
 * Execute a single create operation.
 */
function executeCreate(
  op: PatchOperation,
  ctx: OperationContext
): ApplyOperationResult {
  const targetPath = join(ctx.targetRoot, op.path);
  const beforeHash = hashFile(targetPath);

  // File already exists?
  if (existsSync(targetPath)) {
    return {
      op: 'create',
      path: op.path,
      status: 'error',
      before_hash: beforeHash,
      after_hash: null,
      bytes_written: 0,
      error: `file already exists: ${op.path}`,
    };
  }

  const content = op.content ?? '';
  const bytesWritten = Buffer.byteLength(content, 'utf8');
  const afterHash = computeHash(content);

  if (!ctx.dryRun) {
    // Create parent directories if needed
    const parentDir = dirname(targetPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    writeFileSync(targetPath, content, 'utf8');
  }

  return {
    op: 'create',
    path: op.path,
    status: 'success',
    before_hash: beforeHash,
    after_hash: afterHash,
    bytes_written: bytesWritten,
  };
}

/**
 * Execute a single modify operation.
 */
function executeModify(
  op: PatchOperation,
  ctx: OperationContext
): ApplyOperationResult {
  const targetPath = join(ctx.targetRoot, op.path);
  const beforeHash = hashFile(targetPath);

  // File doesn't exist?
  if (!existsSync(targetPath)) {
    return {
      op: 'modify',
      path: op.path,
      status: 'error',
      before_hash: beforeHash,
      after_hash: null,
      bytes_written: 0,
      error: `file does not exist: ${op.path}`,
    };
  }

  // Is it a directory?
  if (isDirectory(targetPath)) {
    return {
      op: 'modify',
      path: op.path,
      status: 'error',
      before_hash: beforeHash,
      after_hash: null,
      bytes_written: 0,
      error: `path is a directory: ${op.path}`,
    };
  }

  // Is it a symlink? (should have been caught earlier, but double-check)
  if (existsAsSymlink(targetPath)) {
    return {
      op: 'modify',
      path: op.path,
      status: 'error',
      before_hash: beforeHash,
      after_hash: null,
      bytes_written: 0,
      error: `path is a symbolic link: ${op.path}`,
    };
  }

  const content = op.content ?? '';
  const bytesWritten = Buffer.byteLength(content, 'utf8');
  const afterHash = computeHash(content);

  if (!ctx.dryRun) {
    writeFileSync(targetPath, content, 'utf8');
  }

  return {
    op: 'modify',
    path: op.path,
    status: 'success',
    before_hash: beforeHash,
    after_hash: afterHash,
    bytes_written: bytesWritten,
  };
}

/**
 * Execute a single delete operation.
 */
function executeDelete(
  op: PatchOperation,
  ctx: OperationContext
): ApplyOperationResult {
  const targetPath = join(ctx.targetRoot, op.path);
  const beforeHash = hashFile(targetPath);

  // File doesn't exist?
  if (!existsSync(targetPath)) {
    return {
      op: 'delete',
      path: op.path,
      status: 'error',
      before_hash: beforeHash,
      after_hash: null,
      bytes_written: 0,
      error: `file does not exist: ${op.path}`,
    };
  }

  // Is it a directory?
  if (isDirectory(targetPath)) {
    return {
      op: 'delete',
      path: op.path,
      status: 'error',
      before_hash: beforeHash,
      after_hash: null,
      bytes_written: 0,
      error: `path is a directory: ${op.path}`,
    };
  }

  // Is it a symlink?
  if (existsAsSymlink(targetPath)) {
    return {
      op: 'delete',
      path: op.path,
      status: 'error',
      before_hash: beforeHash,
      after_hash: null,
      bytes_written: 0,
      error: `path is a symbolic link: ${op.path}`,
    };
  }

  if (!ctx.dryRun) {
    unlinkSync(targetPath);
  }

  return {
    op: 'delete',
    path: op.path,
    status: 'success',
    before_hash: beforeHash,
    after_hash: null,
    bytes_written: 0,
  };
}

/**
 * Execute a single operation.
 */
function executeOperation(
  op: PatchOperation,
  ctx: OperationContext
): ApplyOperationResult {
  switch (op.op) {
    case 'create':
      return executeCreate(op, ctx);
    case 'modify':
      return executeModify(op, ctx);
    case 'delete':
      return executeDelete(op, ctx);
    default:
      // Type should prevent this, but handle unknown op
      return {
        op: op.op as 'create',
        path: op.path,
        status: 'error',
        before_hash: null,
        after_hash: null,
        bytes_written: 0,
        error: `unknown operation type: ${op.op}`,
      };
  }
}

// =============================================================================
// Result Building
// =============================================================================

/**
 * Compute summary from operation results.
 */
function computeSummary(opResults: ApplyOperationResult[]): ApplySummary {
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytesWritten = 0;

  for (const r of opResults) {
    if (r.status === 'success') {
      succeeded++;
      totalBytesWritten += r.bytes_written;
    } else if (r.status === 'skipped') {
      skipped++;
    } else {
      failed++;
    }
  }

  return {
    total_operations: opResults.length,
    succeeded,
    skipped,
    failed,
    total_bytes_written: totalBytesWritten,
  };
}

/**
 * Determine outcome from summary.
 */
function determineOutcome(summary: ApplySummary): ApplyOutcome {
  if (summary.failed === 0 && summary.total_operations > 0) {
    return 'SUCCESS';
  }
  if (summary.succeeded > 0 && summary.failed > 0) {
    return 'PARTIAL';
  }
  if (summary.succeeded === 0 && summary.total_operations > 0) {
    return 'FAILED';
  }
  // Empty patch: consider success
  return 'SUCCESS';
}

/**
 * Sanitize target root for output (no absolute paths per AS12).
 */
function sanitizeTargetRoot(targetRoot: string): string {
  // If it's absolute, convert to relative representation
  if (isAbsolute(targetRoot)) {
    // Use just the basename or '.'
    const base = dirname(targetRoot);
    const name = targetRoot.split('/').pop() || '.';
    return name;
  }
  return targetRoot;
}

/**
 * Sort violations by rule_id, then path.
 */
function sortViolations(violations: ApplyViolation[]): ApplyViolation[] {
  return [...violations].sort((a, b) => {
    if (a.rule_id !== b.rule_id) {
      return a.rule_id < b.rule_id ? -1 : 1;
    }
    const aPath = a.path ?? '';
    const bPath = b.path ?? '';
    return aPath < bPath ? -1 : aPath > bPath ? 1 : 0;
  });
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Apply a patch from a pack directory to a target directory.
 *
 * @param args - Apply arguments
 * @returns ApplyResult with deterministic report
 */
export async function applyPatch(args: ApplyPackArgs): Promise<ApplyResult> {
  const dryRun = args.options?.dryRun ?? false;
  const sanitizedTarget = sanitizeTargetRoot(args.target_root);

  // A) Validate target root
  const targetValidation = validateTargetRoot(args.target_root);
  if (!targetValidation.ok) {
    return {
      apply_schema_version: APPLY_SCHEMA_VERSION,
      outcome: 'REFUSED',
      dry_run: dryRun,
      target_root: sanitizedTarget,
      patch_source: { proposal_id: '', proposal_hash: '' },
      operation_results: [],
      summary: {
        total_operations: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        total_bytes_written: 0,
      },
      violations: sortViolations(targetValidation.violations),
      error: targetValidation.error,
    };
  }

  // B) Load and validate patch
  const patchResult = loadPatch(args.pack_dir);
  if (!patchResult.ok) {
    return {
      apply_schema_version: APPLY_SCHEMA_VERSION,
      outcome: 'REFUSED',
      dry_run: dryRun,
      target_root: sanitizedTarget,
      patch_source: { proposal_id: '', proposal_hash: '' },
      operation_results: [],
      summary: {
        total_operations: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        total_bytes_written: 0,
      },
      violations: sortViolations(patchResult.violations),
      error: patchResult.error,
    };
  }

  const patch = patchResult.patch;
  const resolvedTarget = resolve(args.target_root);

  // C) Sort operations by path for deterministic ordering (AS2)
  const sortedOps = [...patch.operations].sort((a, b) => a.path.localeCompare(b.path));

  // D) Execute operations
  const ctx: OperationContext = {
    targetRoot: resolvedTarget,
    dryRun,
  };

  const opResults: ApplyOperationResult[] = [];
  for (const op of sortedOps) {
    const result = executeOperation(op, ctx);
    opResults.push(result);
  }

  // E) Results are already sorted by path since we sorted ops

  // F) Compute summary and outcome
  const summary = computeSummary(opResults);
  const outcome = determineOutcome(summary);

  // G) Build result
  const result: ApplyResult = {
    apply_schema_version: APPLY_SCHEMA_VERSION,
    outcome,
    dry_run: dryRun,
    target_root: sanitizedTarget,
    patch_source: {
      proposal_id: patch.source_proposal_id,
      proposal_hash: patch.source_proposal_hash,
    },
    operation_results: opResults,
    summary,
  };

  // Add error message if not success
  if (outcome === 'FAILED' || outcome === 'PARTIAL') {
    const failedOps = opResults.filter((r) => r.status === 'error');
    result.error = `${failedOps.length} operations failed`;
  }

  return result;
}

/**
 * Export the function for direct use.
 */
export { applyPatch as applyPatchToDir };
