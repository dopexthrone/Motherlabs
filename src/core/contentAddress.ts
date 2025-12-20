// Content Addressing - sha256-based IDs (tamper-proof by design)

import * as crypto from 'crypto'

/**
 * Compute content-addressed ID for any object
 * Format: sha256:{64-char-hex}
 */
export function contentAddress(content: unknown): string {
  const canonical = canonicalJSON(content)
  const hash = crypto.createHash('sha256').update(canonical).digest('hex')
  return `sha256:${hash}`
}

/**
 * Canonical JSON serialization (deterministic)
 * - Keys sorted alphabetically
 * - No whitespace
 * - Consistent formatting
 * - Depth-limited to prevent stack overflow on circular/deep objects
 */
export function canonicalJSON(obj: unknown, maxDepth: number = 50, seen: WeakSet<object> = new WeakSet()): string {
  if (obj === null) return 'null'
  if (obj === undefined) return 'null'  // undefined becomes null in JSON
  if (typeof obj === 'string') return JSON.stringify(obj)
  if (typeof obj === 'number') return String(obj)
  if (typeof obj === 'boolean') return String(obj)

  if (maxDepth <= 0) {
    return '"[MAX_DEPTH_EXCEEDED]"'
  }

  if (Array.isArray(obj)) {
    if (seen.has(obj)) return '"[CIRCULAR]"'
    seen.add(obj)
    const items = obj.map(item => canonicalJSON(item, maxDepth - 1, seen))
    return `[${items.join(',')}]`
  }

  if (typeof obj === 'object') {
    if (seen.has(obj)) return '"[CIRCULAR]"'
    seen.add(obj)
    const keys = Object.keys(obj).sort()
    const pairs = keys.map(key => {
      const value = (obj as Record<string, unknown>)[key]
      return `${JSON.stringify(key)}:${canonicalJSON(value, maxDepth - 1, seen)}`
    })
    return `{${pairs.join(',')}}`
  }

  throw new Error(`Cannot canonicalize type: ${typeof obj}`)
}

/**
 * Verify content matches its address
 */
export function verifyContentAddress(content: unknown, address: string): boolean {
  if (!address.startsWith('sha256:')) {
    throw new Error('Address must start with sha256:')
  }

  const computed = contentAddress(content)
  return computed === address
}

/**
 * Extract hash from content address
 */
export function extractHash(address: string): string {
  if (!address.startsWith('sha256:')) {
    throw new Error('Address must start with sha256:')
  }
  return address.substring(7)  // Remove 'sha256:' prefix
}

/**
 * Validate content address format
 */
export function isValidContentAddress(address: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(address)
}
