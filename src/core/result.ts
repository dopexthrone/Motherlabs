// Result<T,E> - Structured error handling (no exceptions in business logic)

/**
 * Result type for explicit error handling
 * Replaces throw/catch with type-safe error propagation
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

/**
 * Structured error with code and context
 */
export type StructuredError = {
  code: string
  message: string
  context?: Record<string, unknown>
  cause?: Error
}

/**
 * Create success result
 */
export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

/**
 * Create error result
 */
export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

/**
 * Create structured error
 */
export function createError(
  code: string,
  message: string,
  context?: Record<string, unknown>,
  cause?: Error
): StructuredError {
  return { code, message, context, cause }
}

/**
 * Map Result value if ok
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (result.ok) {
    return Ok(fn(result.value))
  }
  return result
}

/**
 * Chain Result operations (flatMap)
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (result.ok) {
    return fn(result.value)
  }
  return result
}

/**
 * Unwrap result or throw (use sparingly, only at boundaries)
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value
  }
  if (result.error instanceof Error) {
    throw result.error
  }
  throw new Error(String(result.error))
}

/**
 * Unwrap or provide default
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue
}

/**
 * Convert Result to error array (for validation)
 */
export function toErrors<T>(result: Result<T, StructuredError>): StructuredError[] {
  return result.ok ? [] : [result.error]
}

/**
 * Combine multiple Results (all must succeed)
 */
export function combineResults<T, E>(
  results: Array<Result<T, E>>
): Result<T[], E> {
  const values: T[] = []

  for (const result of results) {
    if (!result.ok) {
      return result
    }
    values.push(result.value)
  }

  return Ok(values)
}
