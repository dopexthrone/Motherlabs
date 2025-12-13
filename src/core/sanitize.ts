// Input Sanitization - Prevent injection and DoS attacks

const MAX_INPUT_LENGTH = 100_000  // 100KB limit
const MAX_LINE_LENGTH = 10_000

export type SanitizeResult = {
  sanitized: string
  truncated: boolean
  warnings: string[]
}

/**
 * Sanitize user input before LLM processing
 * Prevents: injection, DoS, prompt manipulation
 */
export function sanitizeInput(input: string): SanitizeResult {
  const warnings: string[] = []
  let sanitized = input
  let truncated = false

  // 1. Type validation
  if (typeof input !== 'string') {
    throw new Error('Input must be a string')
  }

  // 2. Length limits (DoS prevention)
  if (sanitized.length > MAX_INPUT_LENGTH) {
    sanitized = sanitized.substring(0, MAX_INPUT_LENGTH)
    truncated = true
    warnings.push(`Input truncated to ${MAX_INPUT_LENGTH} characters`)
  }

  // 3. Line length limits (prevent regex DoS)
  const lines = sanitized.split('\n')
  const sanitizedLines = lines.map(line => {
    if (line.length > MAX_LINE_LENGTH) {
      warnings.push('Long line truncated')
      return line.substring(0, MAX_LINE_LENGTH)
    }
    return line
  })
  sanitized = sanitizedLines.join('\n')

  // 4. Remove null bytes (can break parsers)
  if (sanitized.includes('\0')) {
    sanitized = sanitized.replace(/\0/g, '')
    warnings.push('Null bytes removed')
  }

  // 5. Escape prompt manipulation attempts
  // Common patterns: "; ignore previous instructions", "SYSTEM:", etc.
  const suspiciousPatterns = [
    /;?\s*ignore\s+(previous|above|prior)\s+(instruction|prompt|command)/gi,
    /;?\s*disregard\s+(previous|above|prior)/gi,
    /^\s*SYSTEM\s*:/gmi,
    /^\s*ASSISTANT\s*:/gmi,
    /;\s*console\./gi,  // JavaScript injection attempt
    /<script/gi,        // HTML injection
    /\$\{.*\}/g,        // Template injection
    /DROP\s+TABLE/gi,   // SQL injection
    /DELETE\s+FROM/gi,  // SQL injection
    /INSERT\s+INTO/gi,  // SQL injection
    /exec\s*\(/gi,      // Command injection
    /eval\s*\(/gi       // Code injection
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      // Don't remove, but escape to make inert
      sanitized = sanitized.replace(pattern, match => {
        warnings.push(`Suspicious pattern escaped: ${match.substring(0, 30)}`)
        return match.replace(/[;:]/g, ',')  // Neutralize separators
      })
    }
  }

  // 6. Normalize whitespace (prevent obfuscation)
  sanitized = sanitized
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\t/g, '  ')     // Tabs to spaces
    .trim()

  return {
    sanitized,
    truncated,
    warnings
  }
}

/**
 * Validate that sanitized input is safe
 */
export function validateSanitized(result: SanitizeResult): void {
  if (result.sanitized.length === 0) {
    throw new Error('Input is empty after sanitization')
  }

  if (result.sanitized.length > MAX_INPUT_LENGTH) {
    throw new Error('Sanitization failed: still too long')
  }
}
