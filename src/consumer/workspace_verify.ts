/**
 * Workspace Snapshot Verification
 * ================================
 *
 * Non-authoritative verification of workspace snapshots against WORKSPACE_SPEC.md.
 * Returns violations deterministically without throwing.
 *
 * Rule IDs align with WORKSPACE_SPEC.md invariants:
 * - WS1: Schema version present and equals "1.0.0"
 * - WS2: Tool ID valid
 * - WS3: Args canonical (sorted keys, sorted arrays, no null/undefined)
 * - WS4: All refs relative (no traversal, no absolute)
 * - WS5: Hash format (sha256:<64hex>)
 * - WS6: Env allowlist valid (sorted, unique, no forbidden)
 * - WS7: Env hashed subset of allowlist
 * - WS8: No plaintext values
 * - WS9: Core hash excludes ephemeral
 * - WS10: Canonical round-trip stable
 * - WS11: Violations stable + sorted
 * - WS12: Required refs by tool
 * - WS13: Model IO ref conditional
 * - WS14: Leak prevention (no absolute paths anywhere)
 */

import type {
  WorkspaceSnapshot,
  WorkspaceSnapshotCore,
  WorkspaceViolation,
  WorkspaceVerificationResult,
  WorkspaceVerifyOptions,
  ToolId,
} from './workspace_types.js';
import {
  WORKSPACE_SCHEMA_VERSION,
  VALID_TOOL_IDS,
  FORBIDDEN_ENV_NAMES,
  FORBIDDEN_ENV_PREFIXES,
  REQUIRED_REFS_BY_TOOL,
} from './workspace_types.js';
import { canonicalize, canonicalHash, verifyRoundTrip } from '../utils/canonical.js';

/**
 * Rule IDs matching WORKSPACE_SPEC.md.
 */
const RULES = {
  WS1: 'WS1',
  WS2: 'WS2',
  WS3: 'WS3',
  WS4: 'WS4',
  WS5: 'WS5',
  WS6: 'WS6',
  WS7: 'WS7',
  WS8: 'WS8',
  WS12: 'WS12',
  WS13: 'WS13',
  WS14: 'WS14',
  WS10: 'WS10',
  SCHEMA: 'SCHEMA',
} as const;

/**
 * Check if value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if path is absolute (Unix or Windows).
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
 * Check if path has backslashes.
 */
function hasBackslashes(path: string): boolean {
  return path.includes('\\');
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
 * Validate sha256 hash format.
 */
function isValidSha256Hash(hash: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(hash);
}

/**
 * Check if env var name is forbidden.
 */
function isForbiddenEnvName(name: string): boolean {
  // Exact match forbidden names
  if ((FORBIDDEN_ENV_NAMES as readonly string[]).includes(name)) {
    return true;
  }

  // Prefix match
  for (const prefix of FORBIDDEN_ENV_PREFIXES) {
    if (name.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if env var name is valid format (uppercase alphanumeric + underscore).
 */
function isValidEnvName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

/**
 * Check if object keys are sorted.
 */
function areKeysSorted(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  for (let i = 1; i < keys.length; i++) {
    if (keys[i - 1]! > keys[i]!) {
      return false;
    }
  }
  return true;
}

/**
 * Sort violations deterministically (WS11).
 */
function sortViolations(violations: WorkspaceViolation[]): WorkspaceViolation[] {
  return [...violations].sort((a, b) => {
    const ruleCompare = a.rule_id.localeCompare(b.rule_id);
    if (ruleCompare !== 0) return ruleCompare;

    const pathA = a.path ?? '';
    const pathB = b.path ?? '';
    return pathA.localeCompare(pathB);
  });
}

/**
 * Check all string fields for absolute paths (WS14).
 */
function checkForLeaks(
  obj: unknown,
  path: string,
  violations: WorkspaceViolation[]
): void {
  if (typeof obj === 'string') {
    if (isAbsolutePath(obj)) {
      violations.push({
        rule_id: RULES.WS14,
        message: `Absolute path detected in field`,
        path,
      });
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      checkForLeaks(obj[i], `${path}[${i}]`, violations);
    }
  } else if (isObject(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      // Skip ephemeral for leak checks
      if (path === '' && key === 'ephemeral') continue;
      checkForLeaks(value, path ? `${path}.${key}` : key, violations);
    }
  }
}

/**
 * Compute WorkspaceSnapshotCore from WorkspaceSnapshot (excludes ephemeral).
 */
export function computeWorkspaceCore(snapshot: WorkspaceSnapshot): WorkspaceSnapshotCore {
  return {
    workspace_schema_version: snapshot.workspace_schema_version,
    tool_id: snapshot.tool_id,
    args: snapshot.args,
    refs: snapshot.refs,
    env: snapshot.env,
    safety: snapshot.safety,
    ...(snapshot.warnings ? { warnings: snapshot.warnings } : {}),
  };
}

/**
 * Compute hash of WorkspaceSnapshotCore.
 */
export function computeWorkspaceHash(snapshot: WorkspaceSnapshot): string {
  const core = computeWorkspaceCore(snapshot);
  return `sha256:${canonicalHash(core)}`;
}

/**
 * Verify workspace snapshot against WORKSPACE_SPEC.md invariants.
 */
export function verifyWorkspaceSnapshot(
  input: unknown,
  _options: WorkspaceVerifyOptions = {}
): WorkspaceVerificationResult {
  const violations: WorkspaceViolation[] = [];

  // Schema check: must be object
  if (!isObject(input)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: `Expected object, got ${input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input}`,
    });
    return { valid: false, violations: sortViolations(violations) };
  }

  const snapshot = input as Record<string, unknown>;

  // WS1: Schema version present and equals "1.0.0"
  if (typeof snapshot.workspace_schema_version !== 'string') {
    violations.push({
      rule_id: RULES.WS1,
      message: 'Missing or invalid workspace_schema_version',
    });
  } else if (snapshot.workspace_schema_version !== WORKSPACE_SCHEMA_VERSION) {
    violations.push({
      rule_id: RULES.WS1,
      message: `Invalid schema version: expected "${WORKSPACE_SCHEMA_VERSION}", got "${snapshot.workspace_schema_version}"`,
    });
  }

  // WS2: Tool ID valid
  if (typeof snapshot.tool_id !== 'string') {
    violations.push({
      rule_id: RULES.WS2,
      message: 'Missing or invalid tool_id',
    });
  } else if (!(VALID_TOOL_IDS as readonly string[]).includes(snapshot.tool_id)) {
    violations.push({
      rule_id: RULES.WS2,
      message: `Invalid tool_id: expected one of ${VALID_TOOL_IDS.join(', ')}, got "${snapshot.tool_id}"`,
    });
  }

  // WS3: Args canonical
  if (!isObject(snapshot.args)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid args: expected object',
    });
  } else {
    const args = snapshot.args as Record<string, unknown>;

    // Check keys are sorted
    if (!areKeysSorted(args)) {
      violations.push({
        rule_id: RULES.WS3,
        message: 'args keys are not sorted lexicographically',
      });
    }

    // Check for null/undefined values and array sorting
    for (const [key, value] of Object.entries(args)) {
      if (value === null || value === undefined) {
        violations.push({
          rule_id: RULES.WS3,
          message: `args.${key} contains null or undefined`,
          path: `args.${key}`,
        });
      } else if (Array.isArray(value)) {
        const strValues = value.filter((v): v is string => typeof v === 'string');
        if (strValues.length === value.length && !isSorted(strValues)) {
          violations.push({
            rule_id: RULES.WS3,
            message: `args.${key} array is not sorted`,
            path: `args.${key}`,
          });
        }
      }
    }
  }

  // WS4, WS5, WS12: Refs validation
  if (!isObject(snapshot.refs)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid refs: expected object',
    });
  } else {
    const refs = snapshot.refs as Record<string, unknown>;

    // Validate each ref
    const refChecks: Array<{ key: string; obj: unknown; hashField: string }> = [
      { key: 'intent', obj: refs.intent, hashField: 'sha256' },
      { key: 'pack', obj: refs.pack, hashField: 'pack_hash' },
      { key: 'model_io', obj: refs.model_io, hashField: 'sha256' },
      { key: 'repo_state', obj: refs.repo_state, hashField: 'sha256' },
    ];

    for (const { key, obj, hashField } of refChecks) {
      if (obj !== undefined) {
        if (!isObject(obj)) {
          violations.push({
            rule_id: RULES.SCHEMA,
            message: `refs.${key} is not an object`,
            path: `refs.${key}`,
          });
        } else {
          const ref = obj as Record<string, unknown>;

          // WS4: Path validation
          if (typeof ref.rel_path === 'string') {
            if (isAbsolutePath(ref.rel_path)) {
              violations.push({
                rule_id: RULES.WS4,
                message: `Absolute path in refs.${key}.rel_path`,
                path: `refs.${key}.rel_path`,
              });
            }
            if (hasPathTraversal(ref.rel_path)) {
              violations.push({
                rule_id: RULES.WS4,
                message: `Path traversal in refs.${key}.rel_path`,
                path: `refs.${key}.rel_path`,
              });
            }
            if (hasBackslashes(ref.rel_path)) {
              violations.push({
                rule_id: RULES.WS4,
                message: `Backslash in refs.${key}.rel_path`,
                path: `refs.${key}.rel_path`,
              });
            }
          } else {
            violations.push({
              rule_id: RULES.SCHEMA,
              message: `refs.${key}.rel_path is not a string`,
              path: `refs.${key}.rel_path`,
            });
          }

          // WS5: Hash format
          const hashValue = ref[hashField];
          if (typeof hashValue === 'string') {
            if (!isValidSha256Hash(hashValue)) {
              violations.push({
                rule_id: RULES.WS5,
                message: `Invalid hash format in refs.${key}.${hashField}`,
                path: `refs.${key}.${hashField}`,
              });
            }
          } else {
            violations.push({
              rule_id: RULES.SCHEMA,
              message: `refs.${key}.${hashField} is not a string`,
              path: `refs.${key}.${hashField}`,
            });
          }
        }
      }
    }

    // Policy ref is required
    if (!isObject(refs.policy)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'Missing refs.policy',
        path: 'refs.policy',
      });
    } else {
      const policy = refs.policy as Record<string, unknown>;
      if (typeof policy.profile !== 'string') {
        violations.push({
          rule_id: RULES.SCHEMA,
          message: 'refs.policy.profile is not a string',
          path: 'refs.policy.profile',
        });
      }
      if (typeof policy.policy_hash === 'string') {
        if (!isValidSha256Hash(policy.policy_hash)) {
          violations.push({
            rule_id: RULES.WS5,
            message: 'Invalid hash format in refs.policy.policy_hash',
            path: 'refs.policy.policy_hash',
          });
        }
      } else {
        violations.push({
          rule_id: RULES.SCHEMA,
          message: 'refs.policy.policy_hash is not a string',
          path: 'refs.policy.policy_hash',
        });
      }
    }

    // WS12: Required refs by tool
    const toolId = snapshot.tool_id as ToolId;
    if ((VALID_TOOL_IDS as readonly string[]).includes(toolId)) {
      const requiredRefs = REQUIRED_REFS_BY_TOOL[toolId];
      for (const reqRef of requiredRefs) {
        if (refs[reqRef] === undefined) {
          violations.push({
            rule_id: RULES.WS12,
            message: `Missing required ref "${reqRef}" for tool_id "${toolId}"`,
            path: `refs.${reqRef}`,
          });
        }
      }
    }

    // WS13: Model IO ref conditional
    const args = snapshot.args as Record<string, unknown> | undefined;
    const modelMode = args?.model_mode;
    if (modelMode === 'record' || modelMode === 'replay') {
      if (refs.model_io === undefined) {
        violations.push({
          rule_id: RULES.WS13,
          message: `refs.model_io required when model_mode is "${modelMode}"`,
          path: 'refs.model_io',
        });
      }
    }
  }

  // WS6, WS7, WS8: Env validation
  if (!isObject(snapshot.env)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid env: expected object',
    });
  } else {
    const env = snapshot.env as Record<string, unknown>;

    // WS6: Allowlist validation
    if (!Array.isArray(env.allowlist)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'env.allowlist is not an array',
        path: 'env.allowlist',
      });
    } else {
      const allowlist = env.allowlist as unknown[];
      const stringAllowlist: string[] = [];

      for (let i = 0; i < allowlist.length; i++) {
        const name = allowlist[i];
        if (typeof name !== 'string') {
          violations.push({
            rule_id: RULES.WS6,
            message: `env.allowlist[${i}] is not a string`,
            path: `env.allowlist[${i}]`,
          });
        } else {
          stringAllowlist.push(name);

          if (!isValidEnvName(name)) {
            violations.push({
              rule_id: RULES.WS6,
              message: `Invalid env var name format: "${name}"`,
              path: `env.allowlist[${i}]`,
            });
          }

          if (isForbiddenEnvName(name)) {
            violations.push({
              rule_id: RULES.WS6,
              message: `Forbidden env var name: "${name}"`,
              path: `env.allowlist[${i}]`,
            });
          }
        }
      }

      if (!isSorted(stringAllowlist)) {
        violations.push({
          rule_id: RULES.WS6,
          message: 'env.allowlist is not sorted lexicographically',
        });
      }

      if (hasDuplicates(stringAllowlist)) {
        violations.push({
          rule_id: RULES.WS6,
          message: 'env.allowlist contains duplicates',
        });
      }

      // WS7: Hashed entries subset of allowlist
      if (Array.isArray(env.hashed)) {
        const allowlistSet = new Set(stringAllowlist);
        const hashed = env.hashed as unknown[];
        const hashedNames: string[] = [];

        for (let i = 0; i < hashed.length; i++) {
          const entry = hashed[i];
          if (!isObject(entry)) {
            violations.push({
              rule_id: RULES.SCHEMA,
              message: `env.hashed[${i}] is not an object`,
              path: `env.hashed[${i}]`,
            });
          } else {
            const e = entry as Record<string, unknown>;

            if (typeof e.name !== 'string') {
              violations.push({
                rule_id: RULES.SCHEMA,
                message: `env.hashed[${i}].name is not a string`,
                path: `env.hashed[${i}].name`,
              });
            } else {
              hashedNames.push(e.name);

              if (!allowlistSet.has(e.name)) {
                violations.push({
                  rule_id: RULES.WS7,
                  message: `env.hashed entry "${e.name}" not in allowlist`,
                  path: `env.hashed[${i}]`,
                });
              }
            }

            if (typeof e.sha256 === 'string') {
              if (!isValidSha256Hash(e.sha256)) {
                violations.push({
                  rule_id: RULES.WS5,
                  message: `Invalid hash format in env.hashed[${i}].sha256`,
                  path: `env.hashed[${i}].sha256`,
                });
              }
            } else {
              violations.push({
                rule_id: RULES.SCHEMA,
                message: `env.hashed[${i}].sha256 is not a string`,
                path: `env.hashed[${i}].sha256`,
              });
            }

            // WS8: No plaintext value field
            if ('value' in e) {
              violations.push({
                rule_id: RULES.WS8,
                message: 'Plaintext value detected in env.hashed entry',
                path: `env.hashed[${i}].value`,
              });
            }
          }
        }

        // Check hashed entries are sorted by name
        if (!isSorted(hashedNames)) {
          violations.push({
            rule_id: RULES.WS7,
            message: 'env.hashed is not sorted by name',
          });
        }
      } else {
        violations.push({
          rule_id: RULES.SCHEMA,
          message: 'env.hashed is not an array',
          path: 'env.hashed',
        });
      }
    }
  }

  // Safety block validation
  if (!isObject(snapshot.safety)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid safety: expected object',
    });
  } else {
    const safety = snapshot.safety as Record<string, unknown>;
    if (safety.work_root_rel !== '.') {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'safety.work_root_rel must be "."',
        path: 'safety.work_root_rel',
      });
    }
    if (safety.denies_absolute !== true) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'safety.denies_absolute must be true',
        path: 'safety.denies_absolute',
      });
    }
    if (safety.denies_traversal !== true) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'safety.denies_traversal must be true',
        path: 'safety.denies_traversal',
      });
    }
  }

  // Warnings validation
  if (snapshot.warnings !== undefined) {
    if (!Array.isArray(snapshot.warnings)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'warnings is not an array',
        path: 'warnings',
      });
    } else {
      const warnings = snapshot.warnings as unknown[];
      const stringWarnings: string[] = [];
      for (let i = 0; i < warnings.length; i++) {
        if (typeof warnings[i] === 'string') {
          stringWarnings.push(warnings[i] as string);
        }
      }
      if (!isSorted(stringWarnings)) {
        violations.push({
          rule_id: RULES.SCHEMA,
          message: 'warnings is not sorted',
          path: 'warnings',
        });
      }
    }
  }

  // WS14: Leak prevention - check all string fields for absolute paths
  checkForLeaks(snapshot, '', violations);

  // WS10: Canonical round-trip
  const hasSchemaViolations = violations.some(
    (v) => v.rule_id === RULES.SCHEMA || v.rule_id === RULES.WS1
  );
  if (!hasSchemaViolations) {
    try {
      if (!verifyRoundTrip(input)) {
        violations.push({
          rule_id: RULES.WS10,
          message: 'Workspace snapshot does not round-trip through canonicalization',
        });
      }
    } catch {
      violations.push({
        rule_id: RULES.WS10,
        message: 'Failed to canonicalize workspace snapshot',
      });
    }
  }

  // Sort violations (WS11)
  const sortedViolations = sortViolations(violations);

  // Compute hash if valid
  const valid = sortedViolations.length === 0;
  const result: WorkspaceVerificationResult = {
    valid,
    violations: sortedViolations,
  };

  if (valid) {
    try {
      result.workspace_hash = computeWorkspaceHash(input as unknown as WorkspaceSnapshot);
    } catch {
      // Should not happen if validation passed
    }
  }

  return result;
}

/**
 * Serialize WorkspaceSnapshot to canonical JSON.
 */
export function serializeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string {
  return canonicalize(snapshot);
}
