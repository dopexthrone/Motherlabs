/**
 * Repository State Verification
 * ==============================
 *
 * Non-authoritative verification of repo state against REPO_STATE_SPEC.md.
 * Returns violations deterministically without throwing.
 *
 * Rule IDs align with REPO_STATE_SPEC.md invariants:
 * - RS1: Schema version present and equals "1.0.0"
 * - RS2: Node version baseline (v24.11.1)
 * - RS3: Repository commit format (40-hex)
 * - RS4: Dirty paths validity
 * - RS5: Package lock hash format
 * - RS6: No absolute paths
 * - RS7: Sorted arrays
 * - RS8: Violation ordering (internal)
 * - RS9: Contracts map validity
 * - RS10: Core hash excludes ephemeral
 * - RS11: Canonical round-trip
 * - RS12: CLI output determinism (external test)
 */

import type {
  RepoState,
  RepoStateCore,
  RepoStateViolation,
  RepoStateVerificationResult,
  RepoStateVerifyOptions,
  RepoStateContracts,
} from './repo_state_types.js';
import {
  REPO_STATE_SCHEMA_VERSION,
  NODE_VERSION_BASELINE,
} from './repo_state_types.js';
import { canonicalize, canonicalHash, verifyRoundTrip } from '../utils/canonical.js';

/**
 * Rule IDs matching REPO_STATE_SPEC.md.
 */
const RULES = {
  RS1: 'RS1',
  RS2: 'RS2',
  RS3: 'RS3',
  RS4: 'RS4',
  RS5: 'RS5',
  RS6: 'RS6',
  RS7: 'RS7',
  RS9: 'RS9',
  RS11: 'RS11',
  SCHEMA: 'SCHEMA',
} as const;

/**
 * Required contract keys in sorted order.
 */
const REQUIRED_CONTRACT_KEYS: (keyof RepoStateContracts)[] = [
  'apply_schema_version',
  'bundle_schema_version',
  'git_apply_schema_version',
  'model_io_schema_version',
  'pack_schema_version',
  'patch_schema_version',
  'run_schema_version',
];

/**
 * Check if value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if path is absolute (starts with / or has Windows drive).
 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path);
}

/**
 * Check if path has traversal.
 */
function hasPathTraversal(path: string): boolean {
  return path.includes('..');
}

/**
 * Check if array is sorted lexicographically.
 */
function isSorted(arr: string[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1]! > arr[i]!) {
      return false;
    }
  }
  return true;
}

/**
 * Check if array has duplicates.
 */
function hasDuplicates(arr: string[]): boolean {
  return new Set(arr).size !== arr.length;
}

/**
 * Validate commit hash format (40-char lowercase hex).
 */
function isValidCommitHash(hash: string): boolean {
  return /^[0-9a-f]{40}$/.test(hash);
}

/**
 * Validate sha256 hash format (sha256:{64 hex chars}).
 */
function isValidSha256Hash(hash: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(hash);
}

/**
 * Sort violations deterministically (RS8).
 */
function sortViolations(violations: RepoStateViolation[]): RepoStateViolation[] {
  return [...violations].sort((a, b) => {
    // Primary: rule_id ascending
    const ruleCompare = a.rule_id.localeCompare(b.rule_id);
    if (ruleCompare !== 0) return ruleCompare;

    // Secondary: path ascending (empty string if undefined)
    const pathA = a.path ?? '';
    const pathB = b.path ?? '';
    return pathA.localeCompare(pathB);
  });
}

/**
 * Compute RepoStateCore from RepoState (excludes ephemeral).
 */
export function computeRepoStateCore(state: RepoState): RepoStateCore {
  return {
    repo_state_schema_version: state.repo_state_schema_version,
    repo_commit: state.repo_commit,
    repo_dirty: state.repo_dirty,
    dirty_paths: state.dirty_paths,
    node_version: state.node_version,
    npm_version: state.npm_version,
    os_platform: state.os_platform,
    os_arch: state.os_arch,
    package_lock_sha256: state.package_lock_sha256,
    contracts: state.contracts,
  };
}

/**
 * Compute hash of RepoStateCore.
 */
export function computeRepoStateHash(state: RepoState): string {
  const core = computeRepoStateCore(state);
  return `sha256:${canonicalHash(core)}`;
}

/**
 * Verify repo state against REPO_STATE_SPEC.md invariants.
 */
export function verifyRepoState(
  input: unknown,
  options: RepoStateVerifyOptions = {}
): RepoStateVerificationResult {
  const violations: RepoStateViolation[] = [];

  // Schema check: must be object
  if (!isObject(input)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: `Expected object, got ${input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input}`,
    });
    return { valid: false, violations: sortViolations(violations) };
  }

  const state = input as Record<string, unknown>;

  // RS1: Schema version present and equals "1.0.0"
  if (typeof state.repo_state_schema_version !== 'string') {
    violations.push({
      rule_id: RULES.RS1,
      message: 'Missing or invalid repo_state_schema_version',
    });
  } else if (state.repo_state_schema_version !== REPO_STATE_SCHEMA_VERSION) {
    violations.push({
      rule_id: RULES.RS1,
      message: `Invalid schema version: expected "${REPO_STATE_SCHEMA_VERSION}", got "${state.repo_state_schema_version}"`,
    });
  }

  // RS3: Repository commit format
  if (typeof state.repo_commit !== 'string') {
    violations.push({
      rule_id: RULES.RS3,
      message: 'Missing or invalid repo_commit',
    });
  } else if (!isValidCommitHash(state.repo_commit)) {
    violations.push({
      rule_id: RULES.RS3,
      message: `Invalid repo_commit format: expected 40-char lowercase hex, got "${state.repo_commit}"`,
    });
  }

  // repo_dirty must be boolean
  if (typeof state.repo_dirty !== 'boolean') {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid repo_dirty: expected boolean',
    });
  }

  // RS4, RS6, RS7: dirty_paths validation
  if (!Array.isArray(state.dirty_paths)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid dirty_paths: expected array',
    });
  } else {
    const paths = state.dirty_paths as unknown[];

    // Check each path
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      if (typeof p !== 'string') {
        violations.push({
          rule_id: RULES.RS4,
          message: `dirty_paths[${i}] is not a string`,
          path: String(p),
        });
        continue;
      }

      // RS6: No absolute paths
      if (isAbsolutePath(p)) {
        violations.push({
          rule_id: RULES.RS6,
          message: `Absolute path in dirty_paths`,
          path: p,
        });
      }

      // RS4: No traversal
      if (hasPathTraversal(p)) {
        violations.push({
          rule_id: RULES.RS4,
          message: `Path traversal in dirty_paths`,
          path: p,
        });
      }
    }

    // RS7: Must be sorted
    const stringPaths = paths.filter((p): p is string => typeof p === 'string');
    if (!isSorted(stringPaths)) {
      violations.push({
        rule_id: RULES.RS7,
        message: 'dirty_paths is not sorted lexicographically',
      });
    }

    // RS4: No duplicates
    if (hasDuplicates(stringPaths)) {
      violations.push({
        rule_id: RULES.RS4,
        message: 'dirty_paths contains duplicates',
      });
    }
  }

  // RS2: Node version baseline (warning if mismatch)
  let nodeVersionMatch = true;
  if (typeof state.node_version !== 'string') {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid node_version',
    });
    nodeVersionMatch = false;
  } else if (!options.skipNodeVersionCheck && state.node_version !== NODE_VERSION_BASELINE) {
    violations.push({
      rule_id: RULES.RS2,
      message: `Node version mismatch: expected "${NODE_VERSION_BASELINE}", got "${state.node_version}"`,
    });
    nodeVersionMatch = false;
  }

  // npm_version required
  if (typeof state.npm_version !== 'string') {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid npm_version',
    });
  }

  // os_platform required
  if (typeof state.os_platform !== 'string') {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid os_platform',
    });
  }

  // os_arch required
  if (typeof state.os_arch !== 'string') {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid os_arch',
    });
  }

  // RS5: Package lock hash format
  if (typeof state.package_lock_sha256 !== 'string') {
    violations.push({
      rule_id: RULES.RS5,
      message: 'Missing or invalid package_lock_sha256',
    });
  } else if (!isValidSha256Hash(state.package_lock_sha256)) {
    violations.push({
      rule_id: RULES.RS5,
      message: `Invalid package_lock_sha256 format: expected "sha256:<64hex>", got "${state.package_lock_sha256}"`,
    });
  }

  // RS9: Contracts map validity
  if (!isObject(state.contracts)) {
    violations.push({
      rule_id: RULES.RS9,
      message: 'Missing or invalid contracts: expected object',
    });
  } else {
    const contracts = state.contracts as Record<string, unknown>;

    // Check all required keys are present and non-empty
    for (const key of REQUIRED_CONTRACT_KEYS) {
      if (typeof contracts[key] !== 'string') {
        violations.push({
          rule_id: RULES.RS9,
          message: `Missing contracts.${key}`,
          path: `contracts.${key}`,
        });
      } else if (contracts[key] === '') {
        violations.push({
          rule_id: RULES.RS9,
          message: `Empty value for contracts.${key}`,
          path: `contracts.${key}`,
        });
      }
    }

    // Check keys are sorted (RS9)
    const actualKeys = Object.keys(contracts).sort();
    const expectedSorted = REQUIRED_CONTRACT_KEYS.slice().sort();
    const actualSortedStr = actualKeys.join(',');
    const givenKeysOrder = Object.keys(contracts).join(',');
    if (actualSortedStr !== givenKeysOrder) {
      violations.push({
        rule_id: RULES.RS9,
        message: 'contracts keys are not sorted lexicographically',
      });
    }
  }

  // RS11: Canonical round-trip (only if no schema violations so far)
  const hasSchemaViolations = violations.some(
    (v) => v.rule_id === RULES.SCHEMA || v.rule_id === RULES.RS1
  );
  if (!hasSchemaViolations) {
    try {
      if (!verifyRoundTrip(input)) {
        violations.push({
          rule_id: RULES.RS11,
          message: 'Repo state does not round-trip through canonicalization',
        });
      }
    } catch {
      violations.push({
        rule_id: RULES.RS11,
        message: 'Failed to canonicalize repo state',
      });
    }
  }

  // Sort violations (RS8)
  const sortedViolations = sortViolations(violations);

  // Compute hash if valid
  const valid = sortedViolations.length === 0;
  const result: RepoStateVerificationResult = {
    valid,
    violations: sortedViolations,
    node_version_match: nodeVersionMatch,
  };

  if (valid) {
    try {
      result.repo_state_hash = computeRepoStateHash(input as unknown as RepoState);
    } catch {
      // Should not happen if validation passed
    }
  }

  return result;
}

/**
 * Serialize RepoState to canonical JSON.
 */
export function serializeRepoState(state: RepoState): string {
  return canonicalize(state);
}
