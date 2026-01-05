/**
 * Patch Verification
 * ==================
 *
 * Non-authoritative verification of patch set against PATCH_SPEC.md.
 * Returns violations deterministically without throwing.
 *
 * Rule IDs align with PATCH_SPEC.md invariants:
 * - PS1: Schema version present
 * - PS2: Op enum valid
 * - PS3: Path relative only
 * - PS4: No path traversal
 * - PS5: No duplicate targets
 * - PS6: Text only UTF-8
 * - PS7: Max bytes enforced
 * - PS8: Sorting canonical
 * - PS9: No symlink intent
 * - PS10: Stable violations (internal - violations are auto-sorted)
 */

import type { PatchSet, PatchOperation, PatchVerifyOptions, PatchVerifyResult } from './patch_types.js';
import type { Violation } from './bundle_types.js';

/**
 * Rule IDs matching PATCH_SPEC.md.
 */
const RULES = {
  PS1: 'PS1',
  PS2: 'PS2',
  PS3: 'PS3',
  PS4: 'PS4',
  PS5: 'PS5',
  PS6: 'PS6',
  PS7: 'PS7',
  PS8: 'PS8',
  PS9: 'PS9',
  SCHEMA: 'SCHEMA',
} as const;

/**
 * Default max bytes (default policy: 50MB).
 */
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Valid operation types.
 */
const VALID_OPS = new Set(['create', 'modify', 'delete']);

/**
 * Check if value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if string is valid UTF-8 without null bytes.
 * In JavaScript, strings are already UTF-16, so we check for:
 * - Null bytes
 * - Unpaired surrogates (invalid UTF-16 that can't be UTF-8)
 */
function isValidUtf8Content(content: string): boolean {
  // Check for null bytes
  if (content.includes('\0')) {
    return false;
  }

  // Check for unpaired surrogates (invalid UTF-16)
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    // High surrogate (0xD800-0xDBFF) must be followed by low surrogate (0xDC00-0xDFFF)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = content.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false; // Unpaired high surrogate
      }
      i++; // Skip the low surrogate
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false; // Unpaired low surrogate
    }
  }

  return true;
}

/**
 * Check if path is absolute (starts with / or has Windows drive).
 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path);
}

/**
 * Check if path has traversal or forbidden characters.
 */
function hasPathTraversal(path: string): boolean {
  return path.includes('..') || path.includes('\\');
}

/**
 * Check if path has forbidden patterns.
 */
function hasForbiddenPathChars(path: string): boolean {
  // Control characters (except tab, newline)
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) {
      return true;
    }
  }
  // Leading/trailing whitespace
  if (path !== path.trim()) {
    return true;
  }
  // Null byte
  if (path.includes('\0')) {
    return true;
  }
  return false;
}

/**
 * Check if path has normalization issues.
 */
function hasNormalizationIssues(path: string): boolean {
  return (
    path.startsWith('./') ||
    path.includes('//') ||
    path.endsWith('/') ||
    path === '.' ||
    path === ''
  );
}

/**
 * PS1: Schema version must be present and valid string.
 */
function checkSchemaVersion(patch: unknown, violations: Violation[]): void {
  if (!isObject(patch)) return;

  const schemaVersion = patch['patch_schema_version'];
  if (schemaVersion === undefined || schemaVersion === null) {
    violations.push({
      rule_id: RULES.PS1,
      path: '$.patch_schema_version',
      message: 'patch_schema_version is missing',
    });
  } else if (typeof schemaVersion !== 'string') {
    violations.push({
      rule_id: RULES.PS1,
      path: '$.patch_schema_version',
      message: `patch_schema_version must be string, got ${typeof schemaVersion}`,
    });
  } else if (schemaVersion.length === 0) {
    violations.push({
      rule_id: RULES.PS1,
      path: '$.patch_schema_version',
      message: 'patch_schema_version cannot be empty',
    });
  }
}

/**
 * PS2: All operations must have valid op type.
 */
function checkOpEnumValid(patch: PatchSet, violations: Violation[]): void {
  if (!Array.isArray(patch.operations)) return;

  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i]!;
    if (!VALID_OPS.has(op.op)) {
      violations.push({
        rule_id: RULES.PS2,
        path: `$.operations[${i}].op`,
        message: `invalid operation type: ${op.op}`,
      });
    }
  }
}

/**
 * PS3: All paths must be relative.
 */
function checkPathRelativeOnly(patch: PatchSet, violations: Violation[]): void {
  if (!Array.isArray(patch.operations)) return;

  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i]!;
    if (isAbsolutePath(op.path)) {
      violations.push({
        rule_id: RULES.PS3,
        path: `$.operations[${i}].path`,
        message: `absolute path not allowed: ${op.path}`,
      });
    }
  }
}

/**
 * PS4: No path traversal or backslashes.
 */
function checkNoPathTraversal(patch: PatchSet, violations: Violation[]): void {
  if (!Array.isArray(patch.operations)) return;

  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i]!;
    if (hasPathTraversal(op.path)) {
      violations.push({
        rule_id: RULES.PS4,
        path: `$.operations[${i}].path`,
        message: `path traversal or backslash not allowed: ${op.path}`,
      });
    }
    if (hasForbiddenPathChars(op.path)) {
      violations.push({
        rule_id: RULES.PS4,
        path: `$.operations[${i}].path`,
        message: `forbidden characters in path: ${op.path}`,
      });
    }
    if (hasNormalizationIssues(op.path)) {
      violations.push({
        rule_id: RULES.PS4,
        path: `$.operations[${i}].path`,
        message: `path not normalized: ${op.path}`,
      });
    }
  }
}

/**
 * PS5: No duplicate target paths.
 */
function checkNoDuplicateTargets(patch: PatchSet, violations: Violation[]): void {
  if (!Array.isArray(patch.operations)) return;

  const seen = new Map<string, number>();
  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i]!;
    const prevIndex = seen.get(op.path);
    if (prevIndex !== undefined) {
      violations.push({
        rule_id: RULES.PS5,
        path: `$.operations[${i}].path`,
        message: `duplicate target path: ${op.path} (also at index ${prevIndex})`,
      });
    } else {
      seen.set(op.path, i);
    }
  }
}

/**
 * PS6: All content must be valid UTF-8 without null bytes.
 */
function checkTextOnlyUtf8(patch: PatchSet, violations: Violation[]): void {
  if (!Array.isArray(patch.operations)) return;

  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i]!;
    if (op.content !== undefined && !isValidUtf8Content(op.content)) {
      violations.push({
        rule_id: RULES.PS6,
        path: `$.operations[${i}].content`,
        message: `content is not valid UTF-8 or contains null bytes`,
      });
    }
    // delete operations should not have content
    if (op.op === 'delete' && op.content !== undefined) {
      violations.push({
        rule_id: RULES.PS6,
        path: `$.operations[${i}].content`,
        message: `delete operation must not have content`,
      });
    }
    // create/modify operations should have content (at least empty string)
    if ((op.op === 'create' || op.op === 'modify') && op.content === undefined) {
      violations.push({
        rule_id: RULES.PS6,
        path: `$.operations[${i}].content`,
        message: `${op.op} operation must have content`,
      });
    }
  }
}

/**
 * PS7: Total bytes must not exceed policy limit.
 */
function checkMaxBytesEnforced(patch: PatchSet, maxBytes: number, violations: Violation[]): void {
  if (typeof patch.total_bytes !== 'number') {
    violations.push({
      rule_id: RULES.PS7,
      path: '$.total_bytes',
      message: 'total_bytes is missing or not a number',
    });
    return;
  }

  if (patch.total_bytes > maxBytes) {
    violations.push({
      rule_id: RULES.PS7,
      path: '$.total_bytes',
      message: `total_bytes (${patch.total_bytes}) exceeds limit (${maxBytes})`,
    });
  }

  // Also verify total_bytes matches actual content
  let actualBytes = 0;
  if (Array.isArray(patch.operations)) {
    for (const op of patch.operations) {
      if (op.content !== undefined) {
        actualBytes += Buffer.byteLength(op.content, 'utf8');
      }
    }
  }

  if (actualBytes !== patch.total_bytes) {
    violations.push({
      rule_id: RULES.PS7,
      path: '$.total_bytes',
      message: `total_bytes (${patch.total_bytes}) does not match actual content size (${actualBytes})`,
    });
  }
}

/**
 * PS8: Operations must be sorted by order, then path.
 */
function checkSortingCanonical(patch: PatchSet, violations: Violation[]): void {
  if (!Array.isArray(patch.operations) || patch.operations.length <= 1) return;

  for (let i = 1; i < patch.operations.length; i++) {
    const prev = patch.operations[i - 1]!;
    const curr = patch.operations[i]!;

    const prevOrder = prev.order ?? 0;
    const currOrder = curr.order ?? 0;

    if (prevOrder > currOrder) {
      violations.push({
        rule_id: RULES.PS8,
        path: `$.operations[${i}]`,
        message: `operations not sorted by order: ${prevOrder} > ${currOrder}`,
      });
    } else if (prevOrder === currOrder && prev.path > curr.path) {
      violations.push({
        rule_id: RULES.PS8,
        path: `$.operations[${i}]`,
        message: `operations not sorted by path: ${prev.path} > ${curr.path}`,
      });
    }
  }
}

/**
 * PS9: No symlink operations.
 */
function checkNoSymlinkIntent(patch: PatchSet, violations: Violation[]): void {
  if (!Array.isArray(patch.operations)) return;

  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i]!;
    if ((op.op as string) === 'symlink') {
      violations.push({
        rule_id: RULES.PS9,
        path: `$.operations[${i}].op`,
        message: 'symlink operations are not allowed',
      });
    }
  }
}

/**
 * Check basic patch schema structure.
 */
function checkBasicSchema(patch: unknown, violations: Violation[]): patch is PatchSet {
  if (!isObject(patch)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$',
      message: `patch must be object, got ${patch === null ? 'null' : typeof patch}`,
    });
    return false;
  }

  const required = ['patch_schema_version', 'source_proposal_id', 'source_proposal_hash', 'operations', 'total_bytes'];
  let hasRequiredFields = true;

  for (const field of required) {
    if (!(field in patch)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        path: `$.${field}`,
        message: `required field ${field} is missing`,
      });
      hasRequiredFields = false;
    }
  }

  if ('operations' in patch && !Array.isArray(patch['operations'])) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.operations',
      message: 'operations must be an array',
    });
    hasRequiredFields = false;
  }

  return hasRequiredFields;
}

/**
 * Sort violations deterministically by rule_id, then path.
 * Returns a new array (does not mutate input).
 * PS10: Stable violations.
 */
function sortViolations(violations: Violation[]): Violation[] {
  return [...violations].sort((a, b) => {
    if (a.rule_id !== b.rule_id) {
      return a.rule_id < b.rule_id ? -1 : 1;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/**
 * Verify a patch set against PATCH_SPEC.md invariants.
 *
 * @param patch - Unknown value to verify as PatchSet
 * @param options - Verification options
 * @returns { ok: true } if valid, { ok: false, violations: [...] } if invalid
 */
export function verifyPatch(patch: unknown, options?: PatchVerifyOptions): PatchVerifyResult {
  const violations: Violation[] = [];
  const maxBytes = options?.maxTotalBytes ?? DEFAULT_MAX_BYTES;

  // Check basic structure first
  checkSchemaVersion(patch, violations);

  if (!checkBasicSchema(patch, violations)) {
    // Can't continue if basic schema is invalid
    return { ok: false, violations: sortViolations(violations) };
  }

  // Now we know patch has the right shape
  const p = patch as PatchSet;

  // Run all invariant checks
  checkOpEnumValid(p, violations);
  checkPathRelativeOnly(p, violations);
  checkNoPathTraversal(p, violations);
  checkNoDuplicateTargets(p, violations);
  checkTextOnlyUtf8(p, violations);
  checkMaxBytesEnforced(p, maxBytes, violations);
  checkSortingCanonical(p, violations);
  checkNoSymlinkIntent(p, violations);

  if (violations.length === 0) {
    return { ok: true };
  }

  return { ok: false, violations: sortViolations(violations) };
}
