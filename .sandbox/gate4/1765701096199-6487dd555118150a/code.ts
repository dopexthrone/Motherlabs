
// DETERMINISTIC: Error handling needed
import { Result, Ok, Err } from '../core/result'

export function withErrorHandling<T>(fn: () => T): Result<T, Error> {
  try {
    return Ok(fn())
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}
