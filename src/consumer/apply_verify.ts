/**
 * Apply Result Verification
 * =========================
 *
 * Non-authoritative verification of apply results against APPLY_SPEC.md.
 * Returns violations deterministically without throwing.
 *
 * Rule IDs align with APPLY_SPEC.md invariants:
 * - AS1: Schema version present
 * - AS2: Deterministic ordering
 * - AS3: Patch required (checked at apply time, not result verification)
 * - AS4: Patch must pass verification (checked at apply time)
 * - AS5: Target root safety (checked at apply time)
 * - AS6: Write set equals patch set (optional, requires patch)
 * - AS7: Hashes present (sha256: format)
 * - AS8: Dry-run no writes (enforced at apply time)
 * - AS9: Stable error codes (deterministic errors)
 * - AS10: Canonical JSON output (serialization contract)
 * - AS11: Idempotence documentation (informational)
 * - AS12: No absolute path leakage
 */

import type {
  ApplyResult,
  ApplyViolation,
  ApplyVerifyResult,
  ApplyVerifyOptions,
  ApplyOperationResult,
  ApplyOutcome,
} from './apply_types.js';
import type { PatchSet } from './patch_types.js';

/**
 * Rule IDs matching APPLY_SPEC.md.
 */
const RULES = {
  AS1: 'AS1',
  AS2: 'AS2',
  AS6: 'AS6',
  AS7: 'AS7',
  AS9: 'AS9',
  AS12: 'AS12',
  SCHEMA: 'SCHEMA',
} as const;

/**
 * Valid outcome values.
 */
const VALID_OUTCOMES: Set<ApplyOutcome> = new Set(['SUCCESS', 'PARTIAL', 'FAILED', 'REFUSED']);

/**
 * Valid operation types.
 */
const VALID_OPS = new Set(['create', 'modify', 'delete']);

/**
 * Valid operation statuses.
 */
const VALID_STATUSES = new Set(['success', 'skipped', 'error']);

/**
 * Check if value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if path is absolute.
 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path);
}

/**
 * Check if hash has valid sha256: format or is null.
 */
function isValidHash(hash: unknown): boolean {
  if (hash === null) return true;
  if (typeof hash !== 'string') return false;
  if (!hash.startsWith('sha256:')) return false;
  // sha256: followed by 64 hex chars
  const hexPart = hash.substring(7);
  return hexPart.length === 64 && /^[0-9a-f]+$/.test(hexPart);
}

/**
 * AS1: Schema version must be present and valid string.
 */
function checkSchemaVersion(result: unknown, violations: ApplyViolation[]): void {
  if (!isObject(result)) return;

  const schemaVersion = result['apply_schema_version'];
  if (schemaVersion === undefined || schemaVersion === null) {
    violations.push({
      rule_id: RULES.AS1,
      path: '$.apply_schema_version',
      message: 'apply_schema_version is missing',
    });
  } else if (typeof schemaVersion !== 'string') {
    violations.push({
      rule_id: RULES.AS1,
      path: '$.apply_schema_version',
      message: `apply_schema_version must be string, got ${typeof schemaVersion}`,
    });
  } else if (schemaVersion.length === 0) {
    violations.push({
      rule_id: RULES.AS1,
      path: '$.apply_schema_version',
      message: 'apply_schema_version cannot be empty',
    });
  }
}

/**
 * AS2: Operation results must be sorted by path.
 */
function checkOperationOrdering(result: ApplyResult, violations: ApplyViolation[]): void {
  if (!Array.isArray(result.operation_results) || result.operation_results.length <= 1) return;

  for (let i = 1; i < result.operation_results.length; i++) {
    const prev = result.operation_results[i - 1]!;
    const curr = result.operation_results[i]!;

    if (prev.path > curr.path) {
      violations.push({
        rule_id: RULES.AS2,
        path: `$.operation_results[${i}]`,
        message: `operation_results not sorted by path: ${prev.path} > ${curr.path}`,
      });
    }
  }
}

/**
 * AS2: Violations must be sorted by rule_id, then path.
 */
function checkViolationOrdering(result: ApplyResult, violations: ApplyViolation[]): void {
  if (!result.violations || result.violations.length <= 1) return;

  for (let i = 1; i < result.violations.length; i++) {
    const prev = result.violations[i - 1]!;
    const curr = result.violations[i]!;

    if (prev.rule_id > curr.rule_id) {
      violations.push({
        rule_id: RULES.AS2,
        path: `$.violations[${i}]`,
        message: `violations not sorted by rule_id: ${prev.rule_id} > ${curr.rule_id}`,
      });
    } else if (prev.rule_id === curr.rule_id) {
      const prevPath = prev.path ?? '';
      const currPath = curr.path ?? '';
      if (prevPath > currPath) {
        violations.push({
          rule_id: RULES.AS2,
          path: `$.violations[${i}]`,
          message: `violations not sorted by path: ${prevPath} > ${currPath}`,
        });
      }
    }
  }
}

/**
 * AS6: Write set equals patch set (optional check).
 */
function checkWriteSetEqualsPatchSet(
  result: ApplyResult,
  patch: PatchSet,
  violations: ApplyViolation[]
): void {
  const resultPaths = new Set(result.operation_results.map((r) => r.path));
  const patchPaths = new Set(patch.operations.map((o) => o.path));

  // Check for extra paths in result
  for (const path of resultPaths) {
    if (!patchPaths.has(path)) {
      violations.push({
        rule_id: RULES.AS6,
        path: path,
        message: `path in result but not in patch: ${path}`,
      });
    }
  }

  // Check for missing paths in result
  for (const path of patchPaths) {
    if (!resultPaths.has(path)) {
      violations.push({
        rule_id: RULES.AS6,
        path: path,
        message: `path in patch but not in result: ${path}`,
      });
    }
  }
}

/**
 * AS7: All hashes must use sha256: format.
 */
function checkHashFormat(result: ApplyResult, violations: ApplyViolation[]): void {
  if (!Array.isArray(result.operation_results)) return;

  for (let i = 0; i < result.operation_results.length; i++) {
    const op = result.operation_results[i]!;

    if (!isValidHash(op.before_hash)) {
      violations.push({
        rule_id: RULES.AS7,
        path: `$.operation_results[${i}].before_hash`,
        message: `invalid hash format: ${op.before_hash}`,
      });
    }

    if (!isValidHash(op.after_hash)) {
      violations.push({
        rule_id: RULES.AS7,
        path: `$.operation_results[${i}].after_hash`,
        message: `invalid hash format: ${op.after_hash}`,
      });
    }
  }
}

/**
 * AS9: Error messages must be present when appropriate.
 */
function checkErrorConsistency(result: ApplyResult, violations: ApplyViolation[]): void {
  // If outcome is FAILED or REFUSED, should have error message
  if ((result.outcome === 'FAILED' || result.outcome === 'REFUSED') && !result.error) {
    violations.push({
      rule_id: RULES.AS9,
      message: `outcome is ${result.outcome} but no error message provided`,
    });
  }

  // Operation-level: if status is error, should have error message
  if (Array.isArray(result.operation_results)) {
    for (let i = 0; i < result.operation_results.length; i++) {
      const op = result.operation_results[i]!;
      if (op.status === 'error' && !op.error) {
        violations.push({
          rule_id: RULES.AS9,
          path: `$.operation_results[${i}]`,
          message: `operation status is error but no error message provided`,
        });
      }
    }
  }
}

/**
 * AS12: No absolute paths in output.
 */
function checkNoAbsolutePaths(result: ApplyResult, violations: ApplyViolation[]): void {
  if (typeof result.target_root === 'string' && isAbsolutePath(result.target_root)) {
    violations.push({
      rule_id: RULES.AS12,
      path: '$.target_root',
      message: `absolute path in target_root: ${result.target_root}`,
    });
  }

  if (Array.isArray(result.operation_results)) {
    for (let i = 0; i < result.operation_results.length; i++) {
      const op = result.operation_results[i]!;
      if (isAbsolutePath(op.path)) {
        violations.push({
          rule_id: RULES.AS12,
          path: `$.operation_results[${i}].path`,
          message: `absolute path in operation: ${op.path}`,
        });
      }
    }
  }
}

/**
 * Check basic apply result schema structure.
 */
function checkBasicSchema(result: unknown, violations: ApplyViolation[]): result is ApplyResult {
  if (!isObject(result)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$',
      message: `result must be object, got ${result === null ? 'null' : typeof result}`,
    });
    return false;
  }

  const required = [
    'apply_schema_version',
    'outcome',
    'dry_run',
    'target_root',
    'patch_source',
    'operation_results',
    'summary',
  ];
  let hasRequiredFields = true;

  for (const field of required) {
    if (!(field in result)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        path: `$.${field}`,
        message: `required field ${field} is missing`,
      });
      hasRequiredFields = false;
    }
  }

  // Check outcome is valid
  if ('outcome' in result && !VALID_OUTCOMES.has(result['outcome'] as ApplyOutcome)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.outcome',
      message: `invalid outcome: ${result['outcome']}`,
    });
  }

  // Check dry_run is boolean
  if ('dry_run' in result && typeof result['dry_run'] !== 'boolean') {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.dry_run',
      message: `dry_run must be boolean, got ${typeof result['dry_run']}`,
    });
  }

  // Check operation_results is array
  if ('operation_results' in result && !Array.isArray(result['operation_results'])) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.operation_results',
      message: 'operation_results must be an array',
    });
    hasRequiredFields = false;
  }

  // Check patch_source structure
  if ('patch_source' in result) {
    const ps = result['patch_source'];
    if (!isObject(ps)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        path: '$.patch_source',
        message: 'patch_source must be an object',
      });
    } else {
      if (!('proposal_id' in ps) || typeof ps['proposal_id'] !== 'string') {
        violations.push({
          rule_id: RULES.SCHEMA,
          path: '$.patch_source.proposal_id',
          message: 'patch_source.proposal_id must be a string',
        });
      }
      if (!('proposal_hash' in ps) || typeof ps['proposal_hash'] !== 'string') {
        violations.push({
          rule_id: RULES.SCHEMA,
          path: '$.patch_source.proposal_hash',
          message: 'patch_source.proposal_hash must be a string',
        });
      }
    }
  }

  // Check summary structure
  if ('summary' in result) {
    const sum = result['summary'];
    if (!isObject(sum)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        path: '$.summary',
        message: 'summary must be an object',
      });
    } else {
      const summaryFields = ['total_operations', 'succeeded', 'skipped', 'failed', 'total_bytes_written'];
      for (const field of summaryFields) {
        if (!(field in sum) || typeof sum[field] !== 'number') {
          violations.push({
            rule_id: RULES.SCHEMA,
            path: `$.summary.${field}`,
            message: `summary.${field} must be a number`,
          });
        }
      }
    }
  }

  // Check operation_results items structure
  if ('operation_results' in result && Array.isArray(result['operation_results'])) {
    const ops = result['operation_results'] as unknown[];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!isObject(op)) {
        violations.push({
          rule_id: RULES.SCHEMA,
          path: `$.operation_results[${i}]`,
          message: 'operation result must be an object',
        });
        continue;
      }

      if (!('op' in op) || !VALID_OPS.has(op['op'] as string)) {
        violations.push({
          rule_id: RULES.SCHEMA,
          path: `$.operation_results[${i}].op`,
          message: `invalid op: ${op['op']}`,
        });
      }

      if (!('path' in op) || typeof op['path'] !== 'string') {
        violations.push({
          rule_id: RULES.SCHEMA,
          path: `$.operation_results[${i}].path`,
          message: 'path must be a string',
        });
      }

      if (!('status' in op) || !VALID_STATUSES.has(op['status'] as string)) {
        violations.push({
          rule_id: RULES.SCHEMA,
          path: `$.operation_results[${i}].status`,
          message: `invalid status: ${op['status']}`,
        });
      }

      if (!('bytes_written' in op) || typeof op['bytes_written'] !== 'number') {
        violations.push({
          rule_id: RULES.SCHEMA,
          path: `$.operation_results[${i}].bytes_written`,
          message: 'bytes_written must be a number',
        });
      }
    }
  }

  return hasRequiredFields;
}

/**
 * Check summary consistency with operation_results.
 */
function checkSummaryConsistency(result: ApplyResult, violations: ApplyViolation[]): void {
  const ops = result.operation_results;

  // Count actual statuses
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytes = 0;

  for (const op of ops) {
    if (op.status === 'success') succeeded++;
    else if (op.status === 'skipped') skipped++;
    else if (op.status === 'error') failed++;
    totalBytes += op.bytes_written;
  }

  const summary = result.summary;

  if (summary.total_operations !== ops.length) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.summary.total_operations',
      message: `total_operations (${summary.total_operations}) does not match operation_results length (${ops.length})`,
    });
  }

  if (summary.succeeded !== succeeded) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.summary.succeeded',
      message: `succeeded count (${summary.succeeded}) does not match actual (${succeeded})`,
    });
  }

  if (summary.skipped !== skipped) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.summary.skipped',
      message: `skipped count (${summary.skipped}) does not match actual (${skipped})`,
    });
  }

  if (summary.failed !== failed) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.summary.failed',
      message: `failed count (${summary.failed}) does not match actual (${failed})`,
    });
  }

  if (summary.total_bytes_written !== totalBytes) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.summary.total_bytes_written',
      message: `total_bytes_written (${summary.total_bytes_written}) does not match actual (${totalBytes})`,
    });
  }
}

/**
 * Sort violations deterministically by rule_id, then path.
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

/**
 * Verify an apply result against APPLY_SPEC.md invariants.
 *
 * @param result - Unknown value to verify as ApplyResult
 * @param options - Verification options
 * @param patch - Optional patch set to verify AS6 (write set equals patch set)
 * @returns { ok: true } if valid, { ok: false, violations: [...] } if invalid
 */
export function verifyApplyResult(
  result: unknown,
  options?: ApplyVerifyOptions,
  patch?: PatchSet
): ApplyVerifyResult {
  const violations: ApplyViolation[] = [];

  // Check basic structure first
  checkSchemaVersion(result, violations);

  if (!checkBasicSchema(result, violations)) {
    // Can't continue if basic schema is invalid
    return { ok: false, violations: sortViolations(violations) };
  }

  // Now we know result has the right shape
  const r = result as ApplyResult;

  // Run all invariant checks
  checkOperationOrdering(r, violations);
  checkViolationOrdering(r, violations);
  checkHashFormat(r, violations);
  checkErrorConsistency(r, violations);
  checkNoAbsolutePaths(r, violations);
  checkSummaryConsistency(r, violations);

  // Optional AS6 check if patch provided
  if (patch && !options?.skipPatchMatch) {
    checkWriteSetEqualsPatchSet(r, patch, violations);
  }

  if (violations.length === 0) {
    return { ok: true };
  }

  return { ok: false, violations: sortViolations(violations) };
}
