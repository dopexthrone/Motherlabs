/**
 * Pack Verification
 * =================
 *
 * Non-authoritative verification of run export packs against PACK_SPEC.md.
 * Returns violations deterministically without throwing.
 *
 * Rule IDs align with PACK_SPEC.md invariants:
 * - PK1: Required files exist
 * - PK2: No unknown files
 * - PK3: Run spec valid
 * - PK4: Bundle spec valid
 * - PK5: Hash match (run -> bundle)
 * - PK6: No symlinks
 * - PK7: No path traversal
 * - PK8: Optional files valid
 * - PK9: Ledger format valid
 * - PK10: Stable violations (internal - violations are auto-sorted)
 * - PK11: Meta ignored (meta.json not validated)
 * - PK12: Regular files only
 */

import { readFileSync, readdirSync, lstatSync, existsSync, statSync } from 'node:fs';
import { join, basename, resolve, normalize } from 'node:path';
import { canonicalize, canonicalHash } from '../utils/canonical.js';
import { verifyBundle } from './bundle_verify.js';
import { verifyPatch } from './patch_verify.js';
import { verifyModelIO } from './model_io_verify.js';
import type {
  PackVerifyResult,
  PackVerifySuccess,
  PackVerifyFailure,
  PackViolation,
  PackVerifyOptions,
  ReferenceCheck,
  ContentHash,
  KernelResultKind,
} from './pack_types.js';
import { PACK_MANIFEST } from './pack_types.js';

/**
 * Rule IDs matching PACK_SPEC.md.
 */
const RULES = {
  PK1: 'PK1',
  PK2: 'PK2',
  PK3: 'PK3',
  PK4: 'PK4',
  PK5: 'PK5',
  PK6: 'PK6',
  PK7: 'PK7',
  PK8: 'PK8',
  PK9: 'PK9',
  PK12: 'PK12',
  IO: 'IO',
} as const;

/**
 * Check if a path is a symlink using lstat.
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
 * Check if a path is a regular file.
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
 * Check if a path is a directory.
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
 */
function hasPathTraversal(path: string): boolean {
  const normalized = normalize(path);
  return normalized.includes('..') || normalized !== path;
}

/**
 * Check if filename is valid (no separators, not . or ..).
 */
function isValidFilename(name: string): boolean {
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('\0')) return false;
  return true;
}

/**
 * Read and parse a JSON file safely.
 */
function readJsonFile(path: string): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    const content = readFileSync(path, 'utf-8');
    const data = JSON.parse(content);
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Compute content hash for a file.
 */
function computeFileHash(path: string): ContentHash | null {
  try {
    const content = readFileSync(path, 'utf-8');
    const data = JSON.parse(content);
    const hash = canonicalHash(data);
    return `sha256:${hash}` as ContentHash;
  } catch {
    return null;
  }
}

/**
 * Extract kernel result kind from run.json.
 */
function getResultKind(run: unknown): KernelResultKind | null {
  if (run === null || typeof run !== 'object') return null;
  const obj = run as Record<string, unknown>;
  const kind = obj['kernel_result_kind'];
  if (kind === 'BUNDLE' || kind === 'CLARIFY' || kind === 'REFUSE') {
    return kind;
  }
  return null;
}

/**
 * Extract bundle reference from run.json.
 */
function getBundleRef(run: unknown): { bundle_id: string; sha256: string } | null {
  if (run === null || typeof run !== 'object') return null;
  const obj = run as Record<string, unknown>;
  const bundle = obj['bundle'];
  if (bundle === null || typeof bundle !== 'object') return null;
  const bundleObj = bundle as Record<string, unknown>;
  const bundleId = bundleObj['bundle_id'];
  const sha256 = bundleObj['sha256'];
  if (typeof bundleId === 'string' && typeof sha256 === 'string') {
    return { bundle_id: bundleId, sha256 };
  }
  return null;
}

/**
 * Validate run.json has required fields per RUN_SPEC.md.
 */
function validateRunBasicSchema(run: unknown, violations: PackViolation[]): boolean {
  if (run === null || typeof run !== 'object') {
    violations.push({
      rule_id: RULES.PK3,
      path: 'run.json',
      message: 'run.json must be a JSON object',
    });
    return false;
  }

  const obj = run as Record<string, unknown>;
  const requiredFields = [
    'run_schema_version',
    'run_id',
    'started_at',
    'completed_at',
    'kernel_version',
    'policy',
    'intent',
    'kernel_result_kind',
    'decision',
    'model_mode',
  ];

  let valid = true;
  for (const field of requiredFields) {
    if (!(field in obj)) {
      violations.push({
        rule_id: RULES.PK3,
        path: 'run.json',
        message: `missing required field: ${field}`,
      });
      valid = false;
    }
  }

  // Validate kernel_result_kind
  const kind = getResultKind(run);
  if (kind === null && 'kernel_result_kind' in obj) {
    violations.push({
      rule_id: RULES.PK3,
      path: 'run.json',
      message: `invalid kernel_result_kind: ${obj['kernel_result_kind']}`,
    });
    valid = false;
  }

  return valid;
}

/**
 * Validate ledger.jsonl format (PK9).
 */
function validateLedger(packPath: string, violations: PackViolation[]): void {
  const ledgerPath = join(packPath, 'ledger.jsonl');
  if (!existsSync(ledgerPath)) return;

  try {
    const content = readFileSync(ledgerPath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim() !== '');

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]!);
        // Basic schema validation
        if (typeof entry !== 'object' || entry === null) {
          violations.push({
            rule_id: RULES.PK9,
            path: 'ledger.jsonl',
            message: `line ${i + 1}: entry must be an object`,
          });
          continue;
        }
        // Check required ledger entry fields
        const required = ['run_id', 'timestamp', 'intent_sha256', 'result_kind', 'accepted', 'mode', 'policy'];
        for (const field of required) {
          if (!(field in entry)) {
            violations.push({
              rule_id: RULES.PK9,
              path: 'ledger.jsonl',
              message: `line ${i + 1}: missing field ${field}`,
            });
          }
        }
      } catch {
        violations.push({
          rule_id: RULES.PK9,
          path: 'ledger.jsonl',
          message: `line ${i + 1}: invalid JSON`,
        });
      }
    }
  } catch (err) {
    violations.push({
      rule_id: RULES.PK9,
      path: 'ledger.jsonl',
      message: `failed to read ledger: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Validate policy.json matches run.json policy (if both exist).
 */
function validatePolicyConsistency(packPath: string, runData: unknown, violations: PackViolation[]): void {
  const policyPath = join(packPath, 'policy.json');
  if (!existsSync(policyPath)) return;

  const policyResult = readJsonFile(policyPath);
  if (!policyResult.ok) {
    violations.push({
      rule_id: RULES.PK8,
      path: 'policy.json',
      message: `failed to parse: ${policyResult.error}`,
    });
    return;
  }

  // Check if run.json has embedded policy
  if (runData !== null && typeof runData === 'object') {
    const runObj = runData as Record<string, unknown>;
    const runPolicy = runObj['policy'];
    if (runPolicy !== undefined) {
      try {
        const runPolicyCanonical = canonicalize(runPolicy);
        const filePolicyCanonical = canonicalize(policyResult.data);
        if (runPolicyCanonical !== filePolicyCanonical) {
          violations.push({
            rule_id: RULES.PK8,
            path: 'policy.json',
            message: 'policy.json does not match run.json embedded policy',
          });
        }
      } catch {
        // Skip comparison if canonicalization fails
      }
    }
  }
}

/**
 * Sort violations deterministically (PK10).
 */
function sortViolations(violations: PackViolation[]): PackViolation[] {
  return [...violations].sort((a, b) => {
    // Sort by rule_id first
    if (a.rule_id !== b.rule_id) {
      return a.rule_id < b.rule_id ? -1 : 1;
    }
    // Then by path
    const pathA = a.path ?? '';
    const pathB = b.path ?? '';
    if (pathA !== pathB) {
      return pathA < pathB ? -1 : 1;
    }
    // Then by message (for stability)
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

/**
 * Verify a pack directory against PACK_SPEC.md invariants.
 *
 * @param packPath - Path to the pack directory
 * @param options - Verification options
 * @returns PackVerifyResult with ok=true if valid, ok=false with violations if invalid
 */
export function verifyPack(packPath: string, options: PackVerifyOptions = {}): PackVerifyResult {
  const { deepValidation = true, verifyReferences = true } = options;
  const violations: PackViolation[] = [];
  const filesVerified: string[] = [];
  const referenceChecks: ReferenceCheck[] = [];

  // Resolve and normalize the path
  const resolvedPath = resolve(packPath);

  // PK7: No path traversal
  if (hasPathTraversal(packPath)) {
    violations.push({
      rule_id: RULES.PK7,
      path: packPath,
      message: 'pack path contains traversal patterns',
    });
  }

  // Check pack is a directory
  if (!existsSync(resolvedPath)) {
    return {
      ok: false,
      pack_path: packPath,
      violations: [
        {
          rule_id: RULES.IO,
          path: packPath,
          message: 'pack directory does not exist',
        },
      ],
    };
  }

  if (!isDirectory(resolvedPath)) {
    return {
      ok: false,
      pack_path: packPath,
      violations: [
        {
          rule_id: RULES.IO,
          path: packPath,
          message: 'pack path is not a directory',
        },
      ],
    };
  }

  // PK6: Pack itself must not be a symlink
  if (isSymlink(packPath)) {
    violations.push({
      rule_id: RULES.PK6,
      path: packPath,
      message: 'pack path is a symbolic link',
    });
  }

  // Read directory contents (sorted for determinism)
  let entries: string[];
  try {
    entries = readdirSync(resolvedPath).sort();
  } catch (err) {
    return {
      ok: false,
      pack_path: packPath,
      violations: [
        {
          rule_id: RULES.IO,
          path: packPath,
          message: `failed to read directory: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  // PK2: Check for unknown files
  const allowedFiles = new Set(PACK_MANIFEST.ALL);
  for (const entry of entries) {
    if (!allowedFiles.has(entry as typeof PACK_MANIFEST.ALL[number])) {
      violations.push({
        rule_id: RULES.PK2,
        path: entry,
        message: `unknown file in pack: ${entry}`,
      });
    }

    // PK7: Check filename validity
    if (!isValidFilename(entry)) {
      violations.push({
        rule_id: RULES.PK7,
        path: entry,
        message: `invalid filename: ${entry}`,
      });
    }
  }

  // Check each file
  for (const entry of entries) {
    const filePath = join(resolvedPath, entry);

    // PK6: No symlinks
    if (isSymlink(filePath)) {
      violations.push({
        rule_id: RULES.PK6,
        path: entry,
        message: `file is a symbolic link: ${entry}`,
      });
      continue;
    }

    // PK12: Must be regular file
    if (!isRegularFile(filePath)) {
      violations.push({
        rule_id: RULES.PK12,
        path: entry,
        message: `not a regular file: ${entry}`,
      });
      continue;
    }

    filesVerified.push(entry);
  }

  // Read run.json first to determine outcome
  const runPath = join(resolvedPath, 'run.json');
  let runData: unknown = null;
  let resultKind: KernelResultKind | null = null;

  if (existsSync(runPath) && isRegularFile(runPath)) {
    const runResult = readJsonFile(runPath);
    if (!runResult.ok) {
      violations.push({
        rule_id: RULES.PK3,
        path: 'run.json',
        message: `failed to parse: ${runResult.error}`,
      });
    } else {
      runData = runResult.data;
      resultKind = getResultKind(runData);

      // PK3: Validate run.json basic schema
      validateRunBasicSchema(runData, violations);
    }
  } else {
    // PK1: run.json is always required
    violations.push({
      rule_id: RULES.PK1,
      path: 'run.json',
      message: 'required file missing: run.json',
    });
  }

  // PK1: Check required files based on outcome
  const bundlePath = join(resolvedPath, 'bundle.json');
  const bundleExists = existsSync(bundlePath) && isRegularFile(bundlePath);

  if (resultKind !== 'REFUSE' && !bundleExists) {
    violations.push({
      rule_id: RULES.PK1,
      path: 'bundle.json',
      message: 'required file missing: bundle.json (required for BUNDLE/CLARIFY outcomes)',
    });
  }

  // PK4: Validate bundle.json if it exists and deep validation is enabled
  let bundleData: unknown = null;
  if (bundleExists && deepValidation) {
    const bundleResult = readJsonFile(bundlePath);
    if (!bundleResult.ok) {
      violations.push({
        rule_id: RULES.PK4,
        path: 'bundle.json',
        message: `failed to parse: ${bundleResult.error}`,
      });
    } else {
      bundleData = bundleResult.data;
      const bundleVerify = verifyBundle(bundleData);
      if (!bundleVerify.ok) {
        for (const v of bundleVerify.violations) {
          violations.push({
            rule_id: RULES.PK4,
            path: 'bundle.json',
            message: `${v.rule_id}: ${v.message}`,
          });
        }
      }
    }
  }

  // PK5: Verify reference integrity (run -> bundle hash)
  if (verifyReferences && runData !== null && bundleExists) {
    const bundleRef = getBundleRef(runData);
    if (bundleRef !== null) {
      const computedHash = computeFileHash(bundlePath);
      const expectedHash = bundleRef.sha256 as ContentHash;

      const check: ReferenceCheck = {
        source: 'run.json',
        target: 'bundle.json',
        field: 'bundle.sha256',
        expected: expectedHash,
        computed: computedHash,
        match: expectedHash === computedHash,
      };
      referenceChecks.push(check);

      if (!check.match) {
        violations.push({
          rule_id: RULES.PK5,
          path: 'bundle.json',
          message: `hash mismatch: run.json references ${expectedHash}, but bundle.json computes to ${computedHash}`,
        });
      }
    }
  }

  // PK8: Validate optional files
  if (deepValidation) {
    // Validate patch.json
    const patchPath = join(resolvedPath, 'patch.json');
    if (existsSync(patchPath) && isRegularFile(patchPath)) {
      const patchResult = readJsonFile(patchPath);
      if (!patchResult.ok) {
        violations.push({
          rule_id: RULES.PK8,
          path: 'patch.json',
          message: `failed to parse: ${patchResult.error}`,
        });
      } else {
        const patchVerify = verifyPatch(patchResult.data);
        if (!patchVerify.ok) {
          for (const v of patchVerify.violations) {
            violations.push({
              rule_id: RULES.PK8,
              path: 'patch.json',
              message: `${v.rule_id}: ${v.message}`,
            });
          }
        }
      }
    }

    // Validate evidence.json basic structure
    const evidencePath = join(resolvedPath, 'evidence.json');
    if (existsSync(evidencePath) && isRegularFile(evidencePath)) {
      const evidenceResult = readJsonFile(evidencePath);
      if (!evidenceResult.ok) {
        violations.push({
          rule_id: RULES.PK8,
          path: 'evidence.json',
          message: `failed to parse: ${evidenceResult.error}`,
        });
      } else {
        // Basic schema check for evidence
        const evidence = evidenceResult.data;
        if (evidence === null || typeof evidence !== 'object') {
          violations.push({
            rule_id: RULES.PK8,
            path: 'evidence.json',
            message: 'evidence.json must be an object',
          });
        } else {
          const evObj = evidence as Record<string, unknown>;
          const evRequired = ['proposal_id', 'proposal_hash', 'action_results', 'test_results', 'status'];
          for (const field of evRequired) {
            if (!(field in evObj)) {
              violations.push({
                rule_id: RULES.PK8,
                path: 'evidence.json',
                message: `missing required field: ${field}`,
              });
            }
          }
        }
      }
    }

    // Validate policy.json consistency
    validatePolicyConsistency(resolvedPath, runData, violations);

    // Validate model_io.json
    const modelIoPath = join(resolvedPath, 'model_io.json');
    if (existsSync(modelIoPath) && isRegularFile(modelIoPath)) {
      const modelIoResult = readJsonFile(modelIoPath);
      if (!modelIoResult.ok) {
        violations.push({
          rule_id: RULES.PK8,
          path: 'model_io.json',
          message: `failed to parse: ${modelIoResult.error}`,
        });
      } else {
        const modelIoVerify = verifyModelIO(modelIoResult.data);
        if (!modelIoVerify.ok) {
          for (const v of modelIoVerify.violations) {
            violations.push({
              rule_id: RULES.PK8,
              path: 'model_io.json',
              message: `${v.rule_id}: ${v.message}`,
            });
          }
        }
      }
    }

    // PK9: Validate ledger.jsonl
    validateLedger(resolvedPath, violations);
  }

  // PK11: meta.json is parsed but not validated (only check JSON syntax)
  const metaPath = join(resolvedPath, 'meta.json');
  if (existsSync(metaPath) && isRegularFile(metaPath)) {
    const metaResult = readJsonFile(metaPath);
    if (!metaResult.ok) {
      violations.push({
        rule_id: RULES.PK8,
        path: 'meta.json',
        message: `invalid JSON: ${metaResult.error}`,
      });
    }
    // Note: meta.json contents are NOT validated beyond JSON syntax (PK11)
  }

  // Sort violations (PK10)
  const sortedViolations = sortViolations(violations);

  if (sortedViolations.length > 0) {
    return {
      ok: false,
      pack_path: packPath,
      violations: sortedViolations,
    };
  }

  return {
    ok: true,
    pack_path: packPath,
    files_verified: filesVerified.sort(),
    reference_checks: referenceChecks,
  };
}
