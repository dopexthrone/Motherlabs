// Effect Types - Motherlabs Governance System
// Tracks what effects are allowed, granted, and exercised
// Ported from manual kernel verifier governance patterns

/**
 * Effect types that can be granted or exercised
 * Effects are capabilities that require prior authorization
 */
export type EffectType =
  | 'NONE'                    // No effects (pure computation)
  | 'FS_READ_SANDBOX'         // Read files within sandbox
  | 'FS_WRITE_SANDBOX'        // Write files within sandbox
  | 'CODE_MODIFY'             // Modify source code files
  | 'GIT_COMMIT'              // Create git commits
  | 'GIT_PUSH'                // Push to remote (not allowed in bootstrap)
  | 'TEST_EXECUTE'            // Execute test suite
  | 'LLM_GENERATE'            // Generate code via LLM
  | 'LEDGER_APPEND'           // Append to ledger
  | 'SCHEMA_REGISTER'         // Register new schema
  | 'EXECUTION_RUN'           // Run execution artifact

/**
 * Effect manifest - tracks granted vs exercised effects
 */
export type EffectManifest = {
  /** Effects that were granted by prior authorization */
  granted_effects: EffectType[]
  /** Effects that were actually exercised */
  exercised_effects: EffectType[]
  /** File manifest for FS effects */
  file_manifest?: FileManifestEntry[]
  /** Whether exercised effects are within granted bounds */
  within_bounds: boolean
}

/**
 * File manifest entry - tracks file operations
 */
export type FileManifestEntry = {
  /** Relative path (no "..", no leading "/") */
  path: string
  /** Operation performed */
  operation: 'create' | 'overwrite' | 'delete' | 'read'
  /** Size in bytes (0 for deletes) */
  byte_count: number
  /** Content hash for verification */
  sha256: string
}

/**
 * Standard effect sets for common operations
 */
export const EFFECT_SETS = {
  /** Pure code validation (no side effects) */
  PURE_VALIDATION: ['NONE'] as EffectType[],

  /** Code generation via LLM */
  LLM_CODE_GENERATION: ['LLM_GENERATE', 'LEDGER_APPEND'] as EffectType[],

  /** Code application with rollback */
  CODE_APPLICATION: [
    'FS_READ_SANDBOX',
    'FS_WRITE_SANDBOX',
    'CODE_MODIFY',
    'GIT_COMMIT',
    'TEST_EXECUTE',
    'LEDGER_APPEND'
  ] as EffectType[],

  /** Test execution only */
  TEST_ONLY: ['TEST_EXECUTE', 'LEDGER_APPEND'] as EffectType[],

  /** Ledger operations only */
  LEDGER_ONLY: ['LEDGER_APPEND'] as EffectType[]
} as const

/**
 * Check if exercised effects are within granted bounds
 */
export function checkEffectBounds(
  granted: EffectType[],
  exercised: EffectType[]
): { valid: boolean; violations: EffectType[] } {
  const grantedSet = new Set(granted)
  const violations: EffectType[] = []

  for (const effect of exercised) {
    if (effect === 'NONE') continue // NONE is always allowed
    if (!grantedSet.has(effect)) {
      violations.push(effect)
    }
  }

  return {
    valid: violations.length === 0,
    violations
  }
}

/**
 * Create effect manifest from granted and exercised effects
 */
export function createEffectManifest(
  granted: EffectType[],
  exercised: EffectType[],
  fileManifest?: FileManifestEntry[]
): EffectManifest {
  const bounds = checkEffectBounds(granted, exercised)

  return {
    granted_effects: granted,
    exercised_effects: exercised,
    file_manifest: fileManifest,
    within_bounds: bounds.valid
  }
}

/**
 * Validate file manifest entry path safety
 * Returns error string if invalid, null if valid
 */
export function validateFilePath(path: string): string | null {
  if (path.startsWith('/')) {
    return 'Path must not start with /'
  }
  if (path.includes('..')) {
    return 'Path must not contain ..'
  }
  if (path.includes('//')) {
    return 'Path must not contain //'
  }
  if (!path.match(/^[a-zA-Z0-9_\-./]+$/)) {
    return 'Path contains invalid characters'
  }
  return null
}

/**
 * Create file manifest entry
 */
export function createFileManifestEntry(
  path: string,
  operation: FileManifestEntry['operation'],
  content: Buffer | string
): FileManifestEntry {
  const pathError = validateFilePath(path)
  if (pathError) {
    throw new Error(`Invalid file path: ${pathError}`)
  }

  const buffer = typeof content === 'string' ? Buffer.from(content) : content
  const crypto = require('crypto')
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

  return {
    path,
    operation,
    byte_count: buffer.length,
    sha256
  }
}
