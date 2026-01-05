/**
 * Input Normalization
 * ===================
 *
 * Deterministic input normalization ensuring byte-identical canonical form.
 * All inputs pass through this before processing.
 *
 * Normalization steps:
 * 1. Parse as UTF-8
 * 2. Strip BOM if present
 * 3. Convert CRLF → LF
 * 4. Normalize Unicode to NFC
 * 5. Trim trailing whitespace per line
 * 6. Ensure single trailing LF
 */

/**
 * UTF-8 BOM bytes (EF BB BF)
 */
const UTF8_BOM = '\uFEFF';

/**
 * Normalize a string to canonical form.
 *
 * @param input - Raw string input
 * @returns Normalized string
 */
export function normalizeString(input: string): string {
  let result = input;

  // Step 1: Strip BOM if present
  if (result.startsWith(UTF8_BOM)) {
    result = result.slice(1);
  }

  // Step 2: Convert CRLF to LF (Windows line endings)
  result = result.replace(/\r\n/g, '\n');

  // Step 3: Convert lone CR to LF (old Mac line endings)
  result = result.replace(/\r/g, '\n');

  // Step 4: Normalize Unicode to NFC (Canonical Decomposition, followed by Canonical Composition)
  result = result.normalize('NFC');

  return result;
}

/**
 * Normalize bytes to canonical UTF-8 string.
 *
 * @param bytes - Raw bytes (Buffer or Uint8Array)
 * @returns Normalized string
 * @throws Error if bytes are not valid UTF-8
 */
export function normalizeBytes(bytes: Buffer | Uint8Array): string {
  // Decode as UTF-8
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const raw = decoder.decode(bytes);

  return normalizeString(raw);
}

/**
 * Normalize a file path to canonical form.
 * - Always use forward slashes
 * - No leading slash (relative paths only)
 * - No double slashes
 * - No . or .. segments
 *
 * @param path - Raw path
 * @returns Normalized path
 * @throws Error if path is absolute or contains parent references
 */
export function normalizePath(path: string): string {
  // Convert backslashes to forward slashes
  let result = path.replace(/\\/g, '/');

  // Remove double slashes
  result = result.replace(/\/+/g, '/');

  // Remove leading slash if present
  if (result.startsWith('/')) {
    throw new Error(`Absolute paths not allowed in bundle: ${path}`);
  }

  // Check for parent directory references
  if (result.includes('..')) {
    throw new Error(`Parent directory references not allowed: ${path}`);
  }

  // Remove current directory references
  result = result.replace(/^\.\//, '');
  result = result.replace(/\/\.\//g, '/');

  // Remove trailing slash
  result = result.replace(/\/$/, '');

  return result;
}

/**
 * Normalize constraint text.
 * - Trim whitespace
 * - Normalize Unicode
 * - Normalize line endings
 *
 * @param constraint - Raw constraint text
 * @returns Normalized constraint
 */
export function normalizeConstraint(constraint: string): string {
  let result = normalizeString(constraint);

  // Trim leading/trailing whitespace
  result = result.trim();

  // Collapse multiple spaces to single space (but preserve line breaks)
  result = result.replace(/[ \t]+/g, ' ');

  // Collapse multiple newlines to double newline (paragraph break)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

/**
 * Normalize an array of constraints.
 * - Normalize each constraint
 * - Remove empty constraints
 * - Remove duplicates
 * - Sort lexicographically
 *
 * @param constraints - Array of raw constraints
 * @returns Normalized, sorted, deduplicated array
 */
export function normalizeConstraints(constraints: string[]): string[] {
  const normalized = constraints
    .map(normalizeConstraint)
    .filter((c) => c.length > 0);

  // Remove duplicates while preserving first occurrence order, then sort
  const unique = [...new Set(normalized)];

  // Sort lexicographically for deterministic ordering
  unique.sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  return unique;
}

/**
 * Intent input structure (before normalization)
 */
export interface RawIntent {
  goal: string;
  constraints?: string[];
  context?: Record<string, unknown>;
}

/**
 * Normalized intent structure
 */
export interface NormalizedIntent {
  goal: string;
  constraints: string[];
  context: Record<string, unknown>;
}

/**
 * Normalize an intent object to canonical form.
 *
 * @param raw - Raw intent input
 * @returns Normalized intent
 * @throws Error if intent is invalid
 */
export function normalizeIntent(raw: RawIntent): NormalizedIntent {
  // Validate required fields
  if (typeof raw.goal !== 'string') {
    throw new Error('Intent must have a string goal');
  }

  const goal = normalizeString(raw.goal).trim();
  if (goal.length === 0) {
    throw new Error('Intent goal cannot be empty');
  }

  // Normalize constraints
  const constraints = normalizeConstraints(raw.constraints ?? []);

  // Context is passed through as-is (will be canonicalized during serialization)
  const context = raw.context ?? {};

  return {
    goal,
    constraints,
    context,
  };
}

/**
 * Parse and normalize JSON input.
 *
 * @param json - JSON string or bytes
 * @returns Parsed and normalized value
 * @throws Error if JSON is invalid
 */
export function parseAndNormalize(json: string | Buffer): unknown {
  const str = typeof json === 'string' ? normalizeString(json) : normalizeBytes(json);
  return JSON.parse(str);
}
