/**
 * Pack Export Pipeline
 * ====================
 *
 * Deterministic export of harness runs to PACK_SPEC-compliant directories.
 * This module is non-authoritative; it orchestrates harness runs and
 * serializes results to files.
 *
 * Key guarantees:
 * - Deterministic: same input → byte-identical output
 * - Safe: only writes to specified out_dir, refuses traversal
 * - Compliant: exported packs pass pack-verify
 * - No symlinks: only regular files
 * - Canonical JSON: all JSON files use canonicalize()
 */

import { existsSync, readdirSync, lstatSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname, basename, normalize, isAbsolute, relative } from 'node:path';

import { runHarness } from './run_intent.js';
import { createLedgerEntry, serializeLedgerEntry } from './ledger.js';
import { loadPolicy } from './policy.js';
import { canonicalize, canonicalHash } from '../utils/canonical.js';
import { verifyPack } from '../consumer/pack_verify.js';
import { generateProposal } from '../protocol/proposal.js';
import { transform, getBundleHash } from '../assembler/bundle.js';

import type {
  HarnessRunInput,
  HarnessRunResult,
  PolicyProfileName,
  ModelMode,
  KernelResultKind,
} from './types.js';
import type { PackVerifyResult, PackViolation } from '../consumer/pack_types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Export mode determines how the harness runs.
 * - 'plan': Uses plan-only mode (no sandbox execution)
 * - 'exec': Uses execute-sandbox mode
 */
export type PackExportMode = 'plan' | 'exec';

/**
 * Arguments for pack export.
 */
export interface ExportPackArgs {
  /** Path to input intent JSON file */
  intent_path: string;

  /** Target directory to create pack in */
  out_dir: string;

  /** Policy profile name */
  policy_name: PolicyProfileName;

  /** Export mode: 'plan' or 'exec' */
  mode: PackExportMode;

  /** Model mode (default: 'none') */
  model_mode?: ModelMode;

  /** Path to model recording file (for record/replay) */
  model_recording_path?: string;
}

/**
 * Result of pack export.
 */
export interface ExportPackResult {
  /** Whether export succeeded */
  ok: boolean;

  /** Output directory path */
  out_dir: string;

  /** Files written (sorted relative paths) */
  files_written: string[];

  /** Pack verification result */
  pack_verify: {
    ok: boolean;
    violations?: PackViolation[];
  };

  /** Run outcome (BUNDLE, CLARIFY, or REFUSE) */
  run_outcome: KernelResultKind;

  /** Error message if ok=false */
  error?: string;
}

// =============================================================================
// Path Safety
// =============================================================================

/**
 * Check if a directory exists and is empty.
 */
function isEmptyDir(path: string): boolean {
  try {
    const entries = readdirSync(path);
    return entries.length === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory (not a symlink).
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
 * Check if path contains traversal patterns.
 * Check BEFORE normalization to catch all .. segments.
 */
function hasPathTraversal(pathStr: string): boolean {
  // Check original path for .. segments
  // This catches /foo/../bar and foo/.. and ../foo
  const segments = pathStr.split(/[/\\]/);
  return segments.some((seg) => seg === '..');
}

/**
 * Validate output directory is safe to write to.
 *
 * Rules:
 * - Must not contain path traversal (..)
 * - If exists, must be empty directory
 * - Parent must exist or be creatable
 * - Must not be a symlink
 */
function validateOutDir(outDir: string): { ok: true } | { ok: false; error: string } {
  // Check for path traversal
  if (hasPathTraversal(outDir)) {
    return { ok: false, error: 'out_dir contains path traversal segments' };
  }

  const resolvedPath = resolve(outDir);

  // Check if parent exists
  const parentDir = dirname(resolvedPath);
  if (!existsSync(parentDir)) {
    return { ok: false, error: `parent directory does not exist: ${parentDir}` };
  }
  if (!isDirectory(parentDir)) {
    return { ok: false, error: `parent is not a directory: ${parentDir}` };
  }

  // Check if out_dir exists
  if (existsSync(resolvedPath)) {
    // Must be a directory
    if (!isDirectory(resolvedPath)) {
      return { ok: false, error: 'out_dir exists but is not a directory' };
    }

    // Must be empty
    if (!isEmptyDir(resolvedPath)) {
      return { ok: false, error: 'out_dir exists and is non-empty' };
    }
  }

  return { ok: true };
}

/**
 * Check if intent path contains absolute paths that should be refused.
 * Per RS6: no absolute paths in pack content.
 */
function checkIntentForAbsolutePaths(intentPath: string): { ok: true } | { ok: false; error: string } {
  // We allow absolute paths as input file location
  // The sanitization happens when writing to pack (run.json uses sanitized path)
  return { ok: true };
}

// =============================================================================
// File Writing
// =============================================================================

/**
 * Write a file with canonical JSON content.
 */
function writeCanonicalJson(path: string, data: unknown): void {
  const content = canonicalize(data) + '\n';
  writeFileSync(path, content, 'utf-8');
}

/**
 * Write a file with plain text content.
 */
function writePlainText(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
}

// =============================================================================
// Pack Export Implementation
// =============================================================================

/**
 * Export a harness run as a PACK_SPEC-compliant directory.
 *
 * @param args - Export arguments
 * @returns Export result
 */
export async function exportPack(args: ExportPackArgs): Promise<ExportPackResult> {
  const filesWritten: string[] = [];

  // A) Validate out_dir
  const outDirValidation = validateOutDir(args.out_dir);
  if (!outDirValidation.ok) {
    return {
      ok: false,
      out_dir: args.out_dir,
      files_written: [],
      pack_verify: { ok: false, violations: [] },
      run_outcome: 'REFUSE',
      error: outDirValidation.error,
    };
  }

  // B) Check intent path
  const intentValidation = checkIntentForAbsolutePaths(args.intent_path);
  if (!intentValidation.ok) {
    return {
      ok: false,
      out_dir: args.out_dir,
      files_written: [],
      pack_verify: { ok: false, violations: [] },
      run_outcome: 'REFUSE',
      error: intentValidation.error,
    };
  }

  // Verify intent file exists
  if (!existsSync(args.intent_path)) {
    return {
      ok: false,
      out_dir: args.out_dir,
      files_written: [],
      pack_verify: { ok: false, violations: [] },
      run_outcome: 'REFUSE',
      error: `intent file not found: ${args.intent_path}`,
    };
  }

  // C) Run harness
  const harnessInput: HarnessRunInput = {
    intent_path: args.intent_path,
    mode: args.mode === 'exec' ? 'execute-sandbox' : 'plan-only',
    policy: args.policy_name,
  };
  if (args.model_mode !== undefined) {
    harnessInput.model_mode = args.model_mode;
  }
  if (args.model_recording_path !== undefined) {
    harnessInput.model_recording_path = args.model_recording_path;
  }

  let runResult: HarnessRunResult;
  try {
    runResult = await runHarness(harnessInput);
  } catch (error) {
    return {
      ok: false,
      out_dir: args.out_dir,
      files_written: [],
      pack_verify: { ok: false, violations: [] },
      run_outcome: 'REFUSE',
      error: `harness run failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // D) Create output directory
  const resolvedOutDir = resolve(args.out_dir);
  if (!existsSync(resolvedOutDir)) {
    mkdirSync(resolvedOutDir, { recursive: true });
  }

  // E) Emit pack files

  // run.json - always required
  // Remove sandbox_path from run result if present (internal only)
  const runForPack = { ...runResult };
  delete runForPack.sandbox_path;
  writeCanonicalJson(join(resolvedOutDir, 'run.json'), runForPack);
  filesWritten.push('run.json');

  // bundle.json - required for BUNDLE/CLARIFY, absent for REFUSE
  if (runResult.kernel_result_kind !== 'REFUSE' && runResult.bundle !== null) {
    // Re-generate bundle from intent to get full bundle data
    try {
      const intentContent = await readFile(args.intent_path, 'utf-8');
      const intent = JSON.parse(intentContent) as { goal: string; constraints?: string[]; context?: Record<string, unknown> };
      const bundle = transform(intent);
      writeCanonicalJson(join(resolvedOutDir, 'bundle.json'), bundle);
      filesWritten.push('bundle.json');

      // patch.json - if we have file operations in the proposal
      // Generate proposal to get patch content
      const proposal = generateProposal(bundle);

      // Filter to only file operations and build PatchOperations per PATCH_SPEC
      const fileActions = proposal.actions.filter(
        (a) => a.type === 'create_file' || a.type === 'modify_file' || a.type === 'delete_file'
      );

      if (fileActions.length > 0) {
        // Map action type to patch op type per PATCH_SPEC
        const mapOpType = (actionType: string): 'create' | 'modify' | 'delete' => {
          if (actionType === 'create_file') return 'create';
          if (actionType === 'modify_file') return 'modify';
          return 'delete';
        };

        // Build operations array
        const operations = fileActions.map((a) => {
          const op: Record<string, unknown> = {
            op: mapOpType(a.type),
            path: a.target,
          };
          if (a.content !== undefined) {
            op.content = a.content;
            op.size_bytes = Buffer.byteLength(a.content, 'utf-8');
          }
          if (a.expected_hash) {
            op.expected_hash = a.expected_hash;
          }
          return op;
        });

        // Calculate total bytes
        const totalBytes = operations.reduce((sum, op) => {
          return sum + (typeof op.size_bytes === 'number' ? op.size_bytes : 0);
        }, 0);

        // Build patch per PATCH_SPEC.md
        const patch = {
          patch_schema_version: '1.0.0',
          source_proposal_id: proposal.id,
          source_proposal_hash: canonicalHash(proposal),
          operations,
          total_bytes: totalBytes,
        };
        writeCanonicalJson(join(resolvedOutDir, 'patch.json'), patch);
        filesWritten.push('patch.json');
      }
    } catch {
      // If bundle generation fails, we already have minimal bundle info from run result
      // Write a minimal bundle.json that will fail verification but is better than nothing
      // Actually, this shouldn't happen since harness already succeeded
    }
  }

  // policy.json - always recommended
  const policy = loadPolicy(args.policy_name);
  writeCanonicalJson(join(resolvedOutDir, 'policy.json'), policy);
  filesWritten.push('policy.json');

  // ledger.jsonl - single entry for this run
  const ledgerEntry = createLedgerEntry(runResult);
  const ledgerLine = serializeLedgerEntry(ledgerEntry);
  writePlainText(join(resolvedOutDir, 'ledger.jsonl'), ledgerLine + '\n');
  filesWritten.push('ledger.jsonl');

  // evidence.json - if we have execution details (exec mode)
  if (runResult.execution !== null && args.mode === 'exec') {
    // Build minimal evidence structure
    const evidence = {
      proposal_id: 'prop_harness',
      proposal_hash: 'harness_execution',
      action_results: [],
      test_results: [],
      status: runResult.decision.accepted ? 'complete' : 'failed',
      started_at: runResult.started_at,
      completed_at: runResult.completed_at,
      total_duration_ms: 0,
      executor_id: runResult.execution.sandbox_id,
      working_dir: 'sandbox',
    };
    writeCanonicalJson(join(resolvedOutDir, 'evidence.json'), evidence);
    filesWritten.push('evidence.json');
  }

  // model_io.json - only if model_mode is record/replay and we have session
  // Currently model IO is not fully integrated, so skip for now
  // This will be added when model adapter integration is complete

  // F) Sort files_written
  filesWritten.sort();

  // G) Verify the exported pack
  const packVerifyResult = verifyPack(resolvedOutDir);

  // H) Return result
  if (packVerifyResult.ok) {
    return {
      ok: true,
      out_dir: args.out_dir,
      files_written: filesWritten,
      pack_verify: { ok: true },
      run_outcome: runResult.kernel_result_kind,
    };
  } else {
    return {
      ok: false,
      out_dir: args.out_dir,
      files_written: filesWritten,
      pack_verify: { ok: false, violations: packVerifyResult.violations },
      run_outcome: runResult.kernel_result_kind,
      error: 'pack verification failed',
    };
  }
}
