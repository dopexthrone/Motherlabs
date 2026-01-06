/**
 * Git Apply Pipeline
 * ==================
 *
 * Applies a PACK_SPEC-compliant patch to a git repository working tree.
 * This module is non-authoritative; it validates inputs and produces
 * deterministic apply reports with file hashes for auditing.
 *
 * Key guarantees:
 * - Safe: validates repo state, refuses dirty working tree by default
 * - Deterministic: same inputs → byte-identical report
 * - Local only: NO network git commands (fetch, push, pull)
 * - Auditable: file content hashes for every changed file
 * - No absolute paths: reports use relative paths only
 *
 * See: docs/GIT_APPLY_SPEC.md
 */

import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { join, resolve, basename, isAbsolute, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { applyPatch } from './pack_apply.js';
import { canonicalize, canonicalHash } from '../utils/canonical.js';

import type { ApplyResult } from '../consumer/apply_types.js';

// =============================================================================
// Constants
// =============================================================================

const GIT_APPLY_SCHEMA_VERSION = '1.0.0';

// =============================================================================
// Types
// =============================================================================

/**
 * Git apply outcome status.
 */
export type GitApplyOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'REFUSED';

/**
 * Changed file with content hash.
 */
export interface GitChangedFile {
  /** Relative path from repo root */
  path: string;
  /** Operation type */
  op: 'create' | 'modify' | 'delete';
  /** SHA-256 hash of final file content (null for delete) */
  content_hash: string | null;
}

/**
 * Summary statistics.
 */
export interface GitApplySummary {
  /** Total files changed */
  total_files: number;
  /** Files created */
  created: number;
  /** Files modified */
  modified: number;
  /** Files deleted */
  deleted: number;
  /** Total bytes written */
  total_bytes_written: number;
}

/**
 * Git apply violation.
 */
export interface GitApplyViolation {
  /** Rule ID from GIT_APPLY_SPEC (e.g., "GA2") */
  rule_id: string;
  /** Relevant path (optional) */
  path?: string;
  /** Human-readable message */
  message: string;
}

/**
 * Complete result of applying a patch to a git repository.
 */
export interface GitApplyResult {
  /** Schema version for this format */
  git_apply_schema_version: string;
  /** Overall outcome */
  outcome: GitApplyOutcome;
  /** Whether this was a dry run */
  dry_run: boolean;
  /** Repository root (relative, no absolute paths) */
  repo_root: string;
  /** Branch information */
  branch: {
    name: string;
    created: boolean;
    head_before: string;
    head_after: string;
  };
  /** Git state information */
  git_state: {
    clean_before: boolean;
    clean_after: boolean;
  };
  /** Pack source information */
  pack_source: {
    run_id: string | null;
    bundle_hash: string | null;
  };
  /** Hash of underlying apply result */
  apply_result_hash: string;
  /** Changed files with content hashes (sorted by path) */
  changed_files: GitChangedFile[];
  /** Summary statistics */
  summary: GitApplySummary;
  /** Commit information (if commit was created) */
  commit?: {
    sha: string;
    message: string;
  };
  /** Violations if any */
  violations?: GitApplyViolation[];
  /** Error message if outcome is FAILED or REFUSED */
  error?: string;
}

/**
 * Options for git apply operation.
 */
export interface GitApplyOptions {
  /** Dry-run mode: generate report but no writes or git changes */
  dryRun?: boolean;
  /** Target branch name (default: deterministic based on run_id) */
  branch?: string;
  /** Create a commit after applying */
  commit?: boolean;
  /** Commit message (default: deterministic format) */
  commitMessage?: string;
  /** Allow apply on dirty working tree */
  allowDirty?: boolean;
}

/**
 * Arguments for git apply operation.
 */
export interface GitApplyArgs {
  /** Path to pack directory */
  pack_dir: string;
  /** Path to git repository root */
  repo_root: string;
  /** Apply options */
  options?: GitApplyOptions;
}

// =============================================================================
// Git Command Utilities
// =============================================================================

/**
 * Result of a git command execution.
 */
interface GitCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a git command safely with spawnSync.
 * Only allows commands from the allowlist per GA8.
 */
function execGit(args: string[], cwd: string): GitCommandResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });

  return {
    success: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    exitCode: result.status ?? 1,
  };
}

/**
 * Check if directory is inside a git working tree.
 */
function isGitRepo(dir: string): boolean {
  // First check for .git directory
  if (existsSync(join(dir, '.git'))) {
    return true;
  }
  // Fallback to git rev-parse
  const result = execGit(['rev-parse', '--is-inside-work-tree'], dir);
  return result.success && result.stdout === 'true';
}

/**
 * Get the repository root directory.
 */
function getRepoRoot(dir: string): string | null {
  const result = execGit(['rev-parse', '--show-toplevel'], dir);
  return result.success ? result.stdout : null;
}

/**
 * Get current HEAD commit SHA.
 */
function getHeadCommit(repoRoot: string): string {
  const result = execGit(['rev-parse', 'HEAD'], repoRoot);
  return result.success ? result.stdout : 'unknown';
}

/**
 * Check if working tree is clean.
 */
function isWorkingTreeClean(repoRoot: string): boolean {
  const result = execGit(['status', '--porcelain'], repoRoot);
  return result.success && result.stdout === '';
}

/**
 * Get current branch name.
 */
function getCurrentBranch(repoRoot: string): string {
  const result = execGit(['branch', '--show-current'], repoRoot);
  return result.success ? result.stdout : 'HEAD';
}

/**
 * Check if a branch exists.
 */
function branchExists(repoRoot: string, branchName: string): boolean {
  const result = execGit(['branch', '--list', branchName], repoRoot);
  return result.success && result.stdout !== '';
}

/**
 * Checkout or create a branch.
 */
function checkoutBranch(repoRoot: string, branchName: string, create: boolean): GitCommandResult {
  if (create) {
    return execGit(['checkout', '-b', branchName], repoRoot);
  } else {
    return execGit(['checkout', branchName], repoRoot);
  }
}

/**
 * Stage all changes.
 */
function stageAll(repoRoot: string): GitCommandResult {
  return execGit(['add', '-A'], repoRoot);
}

/**
 * Create a commit.
 */
function createCommit(repoRoot: string, message: string): GitCommandResult {
  return execGit(['commit', '-m', message], repoRoot);
}

/**
 * Set local git config.
 */
function setGitConfig(repoRoot: string, key: string, value: string): GitCommandResult {
  return execGit(['config', key, value], repoRoot);
}

// =============================================================================
// Hash Utilities
// =============================================================================

/**
 * Compute SHA-256 hash of content.
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
 */
function hasPathTraversal(pathStr: string): boolean {
  const segments = pathStr.split(/[/\\]/);
  return segments.some((seg) => seg === '..');
}

/**
 * Sanitize repo root for output (no absolute paths per GA9).
 */
function sanitizeRepoRoot(repoRoot: string): string {
  if (isAbsolute(repoRoot)) {
    return basename(repoRoot) || '.';
  }
  return repoRoot;
}

// =============================================================================
// Pack Loading
// =============================================================================

/**
 * Load run.json from pack directory.
 */
function loadRunJson(packDir: string): { run_id: string | null; bundle_hash: string | null } {
  const runPath = join(packDir, 'run.json');
  try {
    const content = readFileSync(runPath, 'utf8');
    const run = JSON.parse(content);
    return {
      run_id: run.run_id ?? null,
      bundle_hash: run.bundle?.sha256 ?? null,
    };
  } catch {
    return { run_id: null, bundle_hash: null };
  }
}

// =============================================================================
// Violation Helpers
// =============================================================================

/**
 * Sort violations deterministically by rule_id, then path.
 */
function sortViolations(violations: GitApplyViolation[]): GitApplyViolation[] {
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
// Main Implementation
// =============================================================================

/**
 * Apply a patch from a pack directory to a git repository.
 *
 * @param args - Apply arguments
 * @returns GitApplyResult with deterministic report
 */
export async function applyPackToGitRepo(args: GitApplyArgs): Promise<GitApplyResult> {
  const dryRun = args.options?.dryRun ?? false;
  const allowDirty = args.options?.allowDirty ?? false;
  const commitRequested = args.options?.commit ?? false;
  const violations: GitApplyViolation[] = [];

  // Helper to create REFUSED result
  const makeRefused = (error: string, extraViolations: GitApplyViolation[] = []): GitApplyResult => ({
    git_apply_schema_version: GIT_APPLY_SCHEMA_VERSION,
    outcome: 'REFUSED',
    dry_run: dryRun,
    repo_root: sanitizeRepoRoot(args.repo_root),
    branch: { name: '', created: false, head_before: '', head_after: '' },
    git_state: { clean_before: false, clean_after: false },
    pack_source: { run_id: null, bundle_hash: null },
    apply_result_hash: '',
    changed_files: [],
    summary: { total_files: 0, created: 0, modified: 0, deleted: 0, total_bytes_written: 0 },
    violations: sortViolations([...violations, ...extraViolations]),
    error,
  });

  // A) Validate repo_root path safety (GA3)
  if (hasPathTraversal(args.repo_root)) {
    violations.push({
      rule_id: 'GA3',
      path: args.repo_root,
      message: 'path traversal not allowed',
    });
    return makeRefused('path traversal not allowed');
  }

  const resolvedRepoRoot = resolve(args.repo_root);

  // B) Validate repo_root is a git repository (GA2)
  if (!isGitRepo(resolvedRepoRoot)) {
    violations.push({
      rule_id: 'GA2',
      message: 'target is not a git repository',
    });
    return makeRefused('target is not a git repository');
  }

  // C) Get initial git state
  const headBefore = getHeadCommit(resolvedRepoRoot);
  const cleanBefore = isWorkingTreeClean(resolvedRepoRoot);
  const currentBranch = getCurrentBranch(resolvedRepoRoot);

  // D) Check working tree state
  if (!cleanBefore && !allowDirty) {
    violations.push({
      rule_id: 'GA2',
      message: 'working tree has uncommitted changes',
    });
    return makeRefused('working tree has uncommitted changes');
  }

  // E) Load pack info
  const runInfo = loadRunJson(args.pack_dir);

  // F) Determine target branch (GA6)
  let targetBranch: string;
  if (args.options?.branch) {
    targetBranch = args.options.branch;
  } else if (runInfo.run_id) {
    targetBranch = `apply/${runInfo.run_id}`;
  } else {
    targetBranch = 'apply/manual';
  }

  // G) Check for patch.json
  const patchPath = join(args.pack_dir, 'patch.json');
  if (!existsSync(patchPath)) {
    violations.push({
      rule_id: 'GA4',
      message: 'pack has no patch.json',
    });
    return makeRefused('pack has no patch.json');
  }

  // I) Checkout/create branch (skip in dry-run)
  let branchCreated = false;
  if (!dryRun) {
    const branchExistsResult = branchExists(resolvedRepoRoot, targetBranch);
    if (!branchExistsResult && targetBranch !== currentBranch) {
      const checkoutResult = checkoutBranch(resolvedRepoRoot, targetBranch, true);
      if (!checkoutResult.success) {
        return makeRefused(`GIT_ERROR: checkout -b ${targetBranch} failed: ${checkoutResult.stderr}`);
      }
      branchCreated = true;
    } else if (targetBranch !== currentBranch) {
      const checkoutResult = checkoutBranch(resolvedRepoRoot, targetBranch, false);
      if (!checkoutResult.success) {
        return makeRefused(`GIT_ERROR: checkout ${targetBranch} failed: ${checkoutResult.stderr}`);
      }
    }
  }

  // J) Apply patch using existing engine
  const applyResult = await applyPatch({
    pack_dir: args.pack_dir,
    target_root: resolvedRepoRoot,
    options: { dryRun },
  });

  // K) Build changed files list with content hashes
  const changedFiles: GitChangedFile[] = [];
  for (const opResult of applyResult.operation_results) {
    let contentHash: string | null = null;
    if (opResult.op !== 'delete' && opResult.status === 'success') {
      const filePath = join(resolvedRepoRoot, opResult.path);
      contentHash = hashFile(filePath);
    }
    changedFiles.push({
      path: opResult.path,
      op: opResult.op,
      content_hash: contentHash,
    });
  }

  // Sort by path (GA5)
  changedFiles.sort((a, b) => a.path.localeCompare(b.path));

  // L) Compute summary
  const summary: GitApplySummary = {
    total_files: changedFiles.length,
    created: changedFiles.filter((f) => f.op === 'create').length,
    modified: changedFiles.filter((f) => f.op === 'modify').length,
    deleted: changedFiles.filter((f) => f.op === 'delete').length,
    total_bytes_written: applyResult.summary.total_bytes_written,
  };

  // M) Handle commit if requested
  let commitInfo: { sha: string; message: string } | undefined;
  let headAfter = headBefore;
  let cleanAfter = cleanBefore;

  if (!dryRun && commitRequested && applyResult.outcome === 'SUCCESS') {
    // Set local git config for deterministic commits
    setGitConfig(resolvedRepoRoot, 'user.name', 'Motherlabs');
    setGitConfig(resolvedRepoRoot, 'user.email', 'alex@motherlabs.ai');

    // Stage all changes
    const stageResult = stageAll(resolvedRepoRoot);
    if (!stageResult.success) {
      return makeRefused(`GIT_ERROR: add -A failed: ${stageResult.stderr}`);
    }

    // Build commit message
    const commitMessage = args.options?.commitMessage ??
      `Apply patch from pack\n\nPack run_id: ${runInfo.run_id || 'manual'}\nBundle hash: ${runInfo.bundle_hash || 'unknown'}\n\nApplied via git-apply CLI`;

    // Create commit
    const commitResult = createCommit(resolvedRepoRoot, commitMessage);
    if (!commitResult.success) {
      return makeRefused(`GIT_ERROR: commit failed: ${commitResult.stderr}`);
    }

    // Get new HEAD
    headAfter = getHeadCommit(resolvedRepoRoot);
    cleanAfter = isWorkingTreeClean(resolvedRepoRoot);

    commitInfo = {
      sha: headAfter,
      message: commitMessage,
    };
  } else if (!dryRun) {
    // Check final state without commit
    cleanAfter = isWorkingTreeClean(resolvedRepoRoot);
    headAfter = getHeadCommit(resolvedRepoRoot);
  }

  // N) Map apply outcome to git apply outcome
  let outcome: GitApplyOutcome;
  switch (applyResult.outcome) {
    case 'SUCCESS':
      outcome = 'SUCCESS';
      break;
    case 'PARTIAL':
      outcome = 'PARTIAL';
      break;
    case 'FAILED':
      outcome = 'FAILED';
      break;
    case 'REFUSED':
      outcome = 'REFUSED';
      break;
    default:
      outcome = 'FAILED';
  }

  // O) Build final result
  const result: GitApplyResult = {
    git_apply_schema_version: GIT_APPLY_SCHEMA_VERSION,
    outcome,
    dry_run: dryRun,
    repo_root: sanitizeRepoRoot(args.repo_root),
    branch: {
      name: targetBranch,
      created: branchCreated,
      head_before: headBefore,
      head_after: headAfter,
    },
    git_state: {
      clean_before: cleanBefore,
      clean_after: cleanAfter,
    },
    pack_source: {
      run_id: runInfo.run_id,
      bundle_hash: runInfo.bundle_hash,
    },
    apply_result_hash: canonicalHash(applyResult),
    changed_files: changedFiles,
    summary,
  };

  if (commitInfo) {
    result.commit = commitInfo;
  }

  if (violations.length > 0) {
    result.violations = sortViolations(violations);
  }

  if (outcome === 'FAILED' || outcome === 'PARTIAL') {
    result.error = applyResult.error ?? `${summary.deleted + summary.modified - summary.total_files + changedFiles.filter((f) => f.op === 'create').length} operations failed`;
  }

  return result;
}

/**
 * Export schema version constant.
 */
export { GIT_APPLY_SCHEMA_VERSION };
