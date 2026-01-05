/**
 * Canonical JSON Serialization
 * =============================
 *
 * Deterministic JSON serialization with sorted keys and stable output.
 * This is the foundation of kernel determinism.
 *
 * Rules:
 * - Objects: keys sorted lexicographically (UTF-16 code units)
 * - Arrays: elements in exact index order
 * - Primitives: standard JSON form
 * - Encoding: UTF-8, no BOM
 * - Whitespace: no extra spaces, single trailing LF
 * - Rejected: NaN, Infinity, BigInt, undefined, functions, symbols
 */

import { createHash } from 'node:crypto';

/**
 * Values that cannot be canonicalized - will throw
 */
function isUnsupportedValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return !Number.isFinite(value); // NaN, Infinity, -Infinity
  }
  if (typeof value === 'bigint') return true;
  if (typeof value === 'function') return true;
  if (typeof value === 'symbol') return true;
  if (typeof value === 'undefined') return true;
  return false;
}

/**
 * Recursively canonicalize a value to a deterministic string.
 * Throws on unsupported values (NaN, Infinity, BigInt, undefined, functions, symbols).
 */
function canonicalizeValue(value: unknown, path: string): string {
  // Check for unsupported values first
  if (isUnsupportedValue(value)) {
    throw new Error(`Unsupported value at ${path}: ${typeof value} cannot be canonicalized`);
  }

  // Null
  if (value === null) {
    return 'null';
  }

  // Primitives
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    // Already checked for non-finite above
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  // Array
  if (Array.isArray(value)) {
    const elements = value.map((el, i) => canonicalizeValue(el, `${path}[${i}]`));
    return '[' + elements.join(',') + ']';
  }

  // Object (plain object only)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Get keys and sort lexicographically
    const keys = Object.keys(obj).sort((a, b) => {
      // Lexicographic comparison by UTF-16 code units
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    const pairs: string[] = [];
    for (const key of keys) {
      const val = obj[key];
      // Skip undefined values (JSON.stringify behavior)
      if (val === undefined) continue;
      const canonicalKey = JSON.stringify(key);
      const canonicalVal = canonicalizeValue(val, `${path}.${key}`);
      pairs.push(`${canonicalKey}:${canonicalVal}`);
    }

    return '{' + pairs.join(',') + '}';
  }

  throw new Error(`Unknown value type at ${path}: ${typeof value}`);
}

/**
 * Canonicalize a value to a deterministic JSON string.
 *
 * @param value - The value to canonicalize
 * @returns Canonical JSON string (no trailing newline)
 * @throws Error if value contains unsupported types
 */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value, '$');
}

/**
 * Canonicalize a value to bytes (UTF-8 encoded, with trailing LF).
 * This is what gets hashed.
 *
 * @param value - The value to canonicalize
 * @returns Buffer containing UTF-8 bytes with trailing LF
 */
export function canonicalizeToBytes(value: unknown): Buffer {
  const json = canonicalize(value);
  return Buffer.from(json + '\n', 'utf-8');
}

/**
 * Compute SHA-256 hash of canonical representation.
 *
 * @param value - The value to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function canonicalHash(value: unknown): string {
  const bytes = canonicalizeToBytes(value);
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Derive a short ID from content hash.
 *
 * @param prefix - ID prefix (e.g., 'bundle', 'node', 'q')
 * @param value - The value to hash
 * @returns ID in format `prefix_<first 16 hex chars>`
 */
export function deriveId(prefix: string, value: unknown): string {
  const hash = canonicalHash(value);
  return `${prefix}_${hash.slice(0, 16)}`;
}

/**
 * Parse canonical JSON bytes back to value.
 *
 * @param bytes - UTF-8 encoded JSON bytes
 * @returns Parsed value
 */
export function parseCanonical(bytes: Buffer): unknown {
  const str = bytes.toString('utf-8').replace(/\n$/, '');
  return JSON.parse(str);
}

/**
 * Verify that a value round-trips through canonicalization.
 * Used for testing.
 *
 * @param value - The value to verify
 * @returns true if round-trip produces identical canonical output
 */
export function verifyRoundTrip(value: unknown): boolean {
  try {
    const canonical1 = canonicalize(value);
    const parsed = JSON.parse(canonical1);
    const canonical2 = canonicalize(parsed);
    return canonical1 === canonical2;
  } catch {
    return false;
  }
}
