/**
 * Model IO Verification
 * =====================
 *
 * Non-authoritative verification of model IO sessions against MODEL_IO_SPEC.md.
 * Returns violations deterministically without throwing.
 *
 * Rule IDs align with MODEL_IO_SPEC.md invariants:
 * - MI1: Schema version present
 * - MI2: Adapter and model ID non-empty
 * - MI3: Mode valid
 * - MI4: Interactions array present
 * - MI5: Indices monotonic and contiguous
 * - MI6: Prompt hash format
 * - MI7: Response hash integrity
 * - MI8: No duplicate prompt hashes (at same index)
 * - MI9: Deterministic sorting (by i)
 * - MI10: Stable violations (internal - violations are auto-sorted)
 * - MI11: Size limits
 * - MI12: No hidden nondeterminism (internal - handled by core extraction)
 */

import { createHash } from 'node:crypto';
import type {
  ModelIOSession,
  ModelIOInteraction,
  ModelIOCore,
  ModelIOInteractionCore,
  ModelIOViolation,
  ModelIOVerifyResult,
  ModelIOVerifyOptions,
  ContentHash,
} from './model_io_types.js';
import { MODEL_IO_LIMITS, VALID_MODES } from './model_io_types.js';
import { canonicalize } from '../utils/canonical.js';

/**
 * Rule IDs matching MODEL_IO_SPEC.md.
 */
const RULES = {
  MI1: 'MI1',
  MI2: 'MI2',
  MI3: 'MI3',
  MI4: 'MI4',
  MI5: 'MI5',
  MI6: 'MI6',
  MI7: 'MI7',
  MI8: 'MI8',
  MI9: 'MI9',
  MI11: 'MI11',
  SCHEMA: 'SCHEMA',
} as const;

/**
 * Hash pattern: sha256:<64 lowercase hex chars>
 */
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * Semver pattern for schema version.
 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Check if value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if string matches content hash format.
 */
function isValidContentHash(hash: unknown): hash is ContentHash {
  return typeof hash === 'string' && HASH_PATTERN.test(hash);
}

/**
 * Compute SHA256 hash of string content.
 */
function computeContentHash(content: string): ContentHash {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
  return `sha256:${hash}` as ContentHash;
}

/**
 * MI1: Schema version must be present and valid.
 */
function checkSchemaVersion(session: unknown, violations: ModelIOViolation[]): void {
  if (!isObject(session)) return;

  const schemaVersion = session['model_io_schema_version'];
  if (schemaVersion === undefined || schemaVersion === null) {
    violations.push({
      rule_id: RULES.MI1,
      path: '$.model_io_schema_version',
      message: 'model_io_schema_version is missing',
    });
  } else if (typeof schemaVersion !== 'string') {
    violations.push({
      rule_id: RULES.MI1,
      path: '$.model_io_schema_version',
      message: `model_io_schema_version must be string, got ${typeof schemaVersion}`,
    });
  } else if (schemaVersion.length === 0) {
    violations.push({
      rule_id: RULES.MI1,
      path: '$.model_io_schema_version',
      message: 'model_io_schema_version cannot be empty',
    });
  } else if (!SEMVER_PATTERN.test(schemaVersion)) {
    violations.push({
      rule_id: RULES.MI1,
      path: '$.model_io_schema_version',
      message: `model_io_schema_version must be semver format, got ${schemaVersion}`,
    });
  }
}

/**
 * MI2: Adapter and model ID must be non-empty strings.
 */
function checkAdapterAndModelId(session: ModelIOSession, violations: ModelIOViolation[]): void {
  if (typeof session.adapter_id !== 'string' || session.adapter_id.length === 0) {
    violations.push({
      rule_id: RULES.MI2,
      path: '$.adapter_id',
      message: 'adapter_id must be non-empty string',
    });
  }

  if (typeof session.model_id !== 'string' || session.model_id.length === 0) {
    violations.push({
      rule_id: RULES.MI2,
      path: '$.model_id',
      message: 'model_id must be non-empty string',
    });
  }
}

/**
 * MI3: Mode must be valid.
 */
function checkModeValid(session: ModelIOSession, violations: ModelIOViolation[]): void {
  if (!VALID_MODES.includes(session.mode as any)) {
    violations.push({
      rule_id: RULES.MI3,
      path: '$.mode',
      message: `mode must be one of [${VALID_MODES.join(', ')}], got ${session.mode}`,
    });
  }
}

/**
 * MI4: Interactions array must be present and within size limits.
 */
function checkInteractionsArray(session: ModelIOSession, options: ModelIOVerifyOptions, violations: ModelIOViolation[]): void {
  if (!Array.isArray(session.interactions)) {
    violations.push({
      rule_id: RULES.MI4,
      path: '$.interactions',
      message: 'interactions must be an array',
    });
    return;
  }

  if (options.enforceSizeLimits !== false && session.interactions.length > MODEL_IO_LIMITS.MAX_INTERACTIONS) {
    violations.push({
      rule_id: RULES.MI4,
      path: '$.interactions',
      message: `interactions length (${session.interactions.length}) exceeds limit (${MODEL_IO_LIMITS.MAX_INTERACTIONS})`,
    });
  }
}

/**
 * MI5: Indices must be monotonic and contiguous (0, 1, 2, ...).
 */
function checkIndicesContiguous(session: ModelIOSession, violations: ModelIOViolation[]): void {
  if (!Array.isArray(session.interactions)) return;

  for (let i = 0; i < session.interactions.length; i++) {
    const interaction = session.interactions[i]!;
    if (typeof interaction.i !== 'number') {
      violations.push({
        rule_id: RULES.MI5,
        path: `$.interactions[${i}].i`,
        message: `index must be a number, got ${typeof interaction.i}`,
      });
    } else if (interaction.i !== i) {
      violations.push({
        rule_id: RULES.MI5,
        path: `$.interactions[${i}].i`,
        message: `index must be ${i}, got ${interaction.i}`,
      });
    }
  }
}

/**
 * MI6: Prompt hash must be valid format.
 */
function checkPromptHashFormat(session: ModelIOSession, violations: ModelIOViolation[]): void {
  if (!Array.isArray(session.interactions)) return;

  for (let i = 0; i < session.interactions.length; i++) {
    const interaction = session.interactions[i]!;
    if (!isValidContentHash(interaction.prompt_hash)) {
      violations.push({
        rule_id: RULES.MI6,
        path: `$.interactions[${i}].prompt_hash`,
        message: `prompt_hash must be sha256:<64 hex chars>, got ${interaction.prompt_hash}`,
      });
    }
  }
}

/**
 * MI7: Response hash must be valid format and match content.
 */
function checkResponseHashIntegrity(session: ModelIOSession, options: ModelIOVerifyOptions, violations: ModelIOViolation[]): void {
  if (!Array.isArray(session.interactions)) return;
  if (options.verifyResponseHashes === false) return;

  for (let i = 0; i < session.interactions.length; i++) {
    const interaction = session.interactions[i]!;

    // Check format
    if (!isValidContentHash(interaction.response_hash)) {
      violations.push({
        rule_id: RULES.MI7,
        path: `$.interactions[${i}].response_hash`,
        message: `response_hash must be sha256:<64 hex chars>, got ${interaction.response_hash}`,
      });
      continue;
    }

    // Check response_content exists
    if (typeof interaction.response_content !== 'string') {
      violations.push({
        rule_id: RULES.MI7,
        path: `$.interactions[${i}].response_content`,
        message: `response_content must be a string, got ${typeof interaction.response_content}`,
      });
      continue;
    }

    // Check hash matches content
    const computedHash = computeContentHash(interaction.response_content);
    if (interaction.response_hash !== computedHash) {
      violations.push({
        rule_id: RULES.MI7,
        path: `$.interactions[${i}].response_hash`,
        message: `response_hash mismatch: expected ${computedHash}, got ${interaction.response_hash}`,
      });
    }
  }
}

/**
 * MI8: No duplicate (prompt_hash, i) pairs.
 * Note: Same prompt_hash at different indices is allowed.
 */
function checkNoDuplicates(session: ModelIOSession, violations: ModelIOViolation[]): void {
  if (!Array.isArray(session.interactions)) return;

  const seen = new Set<string>();
  for (let i = 0; i < session.interactions.length; i++) {
    const interaction = session.interactions[i]!;
    const key = `${interaction.prompt_hash}|${interaction.i}`;
    if (seen.has(key)) {
      violations.push({
        rule_id: RULES.MI8,
        path: `$.interactions[${i}]`,
        message: `duplicate (prompt_hash, i) pair at index ${i}`,
      });
    }
    seen.add(key);
  }
}

/**
 * MI9: Interactions must be sorted by i ascending.
 */
function checkSorting(session: ModelIOSession, violations: ModelIOViolation[]): void {
  if (!Array.isArray(session.interactions) || session.interactions.length <= 1) return;

  for (let i = 1; i < session.interactions.length; i++) {
    const prev = session.interactions[i - 1]!;
    const curr = session.interactions[i]!;

    if (typeof prev.i === 'number' && typeof curr.i === 'number' && prev.i >= curr.i) {
      violations.push({
        rule_id: RULES.MI9,
        path: `$.interactions[${i}]`,
        message: `interactions not sorted by i: ${prev.i} >= ${curr.i}`,
      });
    }
  }
}

/**
 * MI11: Size limits on response content.
 */
function checkSizeLimits(session: ModelIOSession, options: ModelIOVerifyOptions, violations: ModelIOViolation[]): void {
  if (!Array.isArray(session.interactions)) return;
  if (options.enforceSizeLimits === false) return;

  let totalBytes = 0;

  for (let i = 0; i < session.interactions.length; i++) {
    const interaction = session.interactions[i]!;
    if (typeof interaction.response_content === 'string') {
      const contentBytes = Buffer.byteLength(interaction.response_content, 'utf-8');

      if (contentBytes > MODEL_IO_LIMITS.MAX_RESPONSE_BYTES) {
        violations.push({
          rule_id: RULES.MI11,
          path: `$.interactions[${i}].response_content`,
          message: `response_content size (${contentBytes} bytes) exceeds limit (${MODEL_IO_LIMITS.MAX_RESPONSE_BYTES})`,
        });
      }

      totalBytes += contentBytes;
    }
  }

  if (totalBytes > MODEL_IO_LIMITS.MAX_TOTAL_BYTES) {
    violations.push({
      rule_id: RULES.MI11,
      path: '$.interactions',
      message: `total response bytes (${totalBytes}) exceeds limit (${MODEL_IO_LIMITS.MAX_TOTAL_BYTES})`,
    });
  }
}

/**
 * Check basic session schema structure.
 */
function checkBasicSchema(session: unknown, violations: ModelIOViolation[]): session is ModelIOSession {
  if (!isObject(session)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$',
      message: `session must be object, got ${session === null ? 'null' : typeof session}`,
    });
    return false;
  }

  const required = ['model_io_schema_version', 'adapter_id', 'model_id', 'mode', 'interactions'];
  let hasRequiredFields = true;

  for (const field of required) {
    if (!(field in session)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        path: `$.${field}`,
        message: `required field ${field} is missing`,
      });
      hasRequiredFields = false;
    }
  }

  if ('interactions' in session && !Array.isArray(session['interactions'])) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$.interactions',
      message: 'interactions must be an array',
    });
    hasRequiredFields = false;
  }

  return hasRequiredFields;
}

/**
 * Sort violations deterministically by rule_id, then path, then message.
 * Returns a new array (does not mutate input).
 * MI10: Stable violations.
 */
function sortViolations(violations: ModelIOViolation[]): ModelIOViolation[] {
  return [...violations].sort((a, b) => {
    if (a.rule_id !== b.rule_id) {
      return a.rule_id < b.rule_id ? -1 : 1;
    }
    const pathA = a.path ?? '';
    const pathB = b.path ?? '';
    if (pathA !== pathB) {
      return pathA < pathB ? -1 : 1;
    }
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

/**
 * Compute the ModelIOCore from a session (excludes ephemeral fields).
 */
export function computeModelIOCore(session: ModelIOSession): ModelIOCore {
  return {
    model_io_schema_version: session.model_io_schema_version,
    adapter_id: session.adapter_id,
    model_id: session.model_id,
    mode: session.mode,
    interactions: session.interactions
      .map((interaction): ModelIOInteractionCore => ({
        i: interaction.i,
        prompt_hash: interaction.prompt_hash,
        response_hash: interaction.response_hash,
        response_content: interaction.response_content,
      }))
      .sort((a, b) => a.i - b.i),
  };
}

/**
 * Compute the ModelIOHash from a session.
 */
export function computeModelIOHash(session: ModelIOSession): ContentHash {
  const core = computeModelIOCore(session);
  const canonical = canonicalize(core);
  const hash = createHash('sha256').update(canonical, 'utf-8').digest('hex');
  return `sha256:${hash}` as ContentHash;
}

/**
 * Verify a model IO session against MODEL_IO_SPEC.md invariants.
 *
 * @param session - Unknown value to verify as ModelIOSession
 * @param options - Verification options
 * @returns { ok: true, interactions_count, model_io_hash } if valid,
 *          { ok: false, violations: [...] } if invalid
 */
export function verifyModelIO(session: unknown, options: ModelIOVerifyOptions = {}): ModelIOVerifyResult {
  const violations: ModelIOViolation[] = [];

  // Check basic structure first
  checkSchemaVersion(session, violations);

  if (!checkBasicSchema(session, violations)) {
    // Can't continue if basic schema is invalid
    return { ok: false, violations: sortViolations(violations) };
  }

  // Now we know session has the right shape
  const s = session as ModelIOSession;

  // Run all invariant checks
  checkAdapterAndModelId(s, violations);
  checkModeValid(s, violations);
  checkInteractionsArray(s, options, violations);
  checkIndicesContiguous(s, violations);
  checkPromptHashFormat(s, violations);
  checkResponseHashIntegrity(s, options, violations);
  checkNoDuplicates(s, violations);
  checkSorting(s, violations);
  checkSizeLimits(s, options, violations);

  if (violations.length === 0) {
    return {
      ok: true,
      interactions_count: s.interactions.length,
      model_io_hash: computeModelIOHash(s),
    };
  }

  return { ok: false, violations: sortViolations(violations) };
}
