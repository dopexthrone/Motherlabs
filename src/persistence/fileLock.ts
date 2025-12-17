// File Lock - Cross-process file locking using proper-lockfile
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 8 (Immutable Evidence) - Concurrent write protection
// TCB Component: Part of the persistence system

import { Result, Ok, Err } from '../core/result'
import * as lockfileModule from 'proper-lockfile'
import type { ReleaseFunction } from 'proper-lockfile'

export class FileLock {
  private release: ReleaseFunction | null = null
  private filepath: string | null = null
  private acquired: boolean = false

  /**
   * Acquire lock on a file
   *
   * Uses proper-lockfile with retry logic and stale detection.
   * The lock is on a .lock file adjacent to the target file.
   */
  async acquire(filepath: string): Promise<Result<void, Error>> {
    if (this.acquired) {
      return Err(new Error('Lock already acquired'))
    }

    try {
      this.release = await lockfileModule.lock(filepath, {
        retries: {
          retries: 5,
          factor: 2,
          minTimeout: 100,
          maxTimeout: 1000
        },
        stale: 10000,  // Consider lock stale after 10 seconds
        realpath: false,  // Don't resolve symlinks
        onCompromised: (err: Error) => {
          // Lock was compromised (e.g., stale lock removed by another process)
          console.error(`[FileLock] Lock compromised: ${err.message}`)
          this.acquired = false
          this.release = null
          this.filepath = null
        }
      })

      this.filepath = filepath
      this.acquired = true
      return Ok(undefined)

    } catch (error) {
      return Err(
        error instanceof Error
          ? new Error(`Failed to acquire lock on ${filepath}: ${error.message}`)
          : new Error(`Failed to acquire lock on ${filepath}`)
      )
    }
  }

  /**
   * Release the lock
   */
  async unlock(): Promise<Result<void, Error>> {
    if (!this.acquired || !this.release) {
      return Ok(undefined)  // Already unlocked
    }

    try {
      await this.release()
      this.release = null
      this.filepath = null
      this.acquired = false
      return Ok(undefined)

    } catch (error) {
      return Err(
        error instanceof Error
          ? new Error(`Failed to release lock: ${error.message}`)
          : new Error('Failed to release lock')
      )
    }
  }

  /**
   * Check if lock is currently held
   */
  isLocked(): boolean {
    return this.acquired
  }

  /**
   * Get the filepath being locked
   */
  getLockedFile(): string | null {
    return this.filepath
  }

  /**
   * Static helper to check if a file is locked
   */
  static async isFileLocked(filepath: string): Promise<Result<boolean, Error>> {
    try {
      const locked = await lockfileModule.check(filepath, { stale: 10000 })
      return Ok(locked)
    } catch (error) {
      return Err(
        error instanceof Error
          ? error
          : new Error('Failed to check lock status')
      )
    }
  }
}

/**
 * Execute a function while holding a file lock
 *
 * Ensures the lock is always released, even if the function throws.
 *
 * @param filepath - File to lock
 * @param fn - Function to execute while holding the lock
 * @returns Result of the function
 */
export async function withFileLock<T>(
  filepath: string,
  fn: () => Promise<T>
): Promise<Result<T, Error>> {
  const lock = new FileLock()

  const acquireResult = await lock.acquire(filepath)
  if (!acquireResult.ok) {
    return Err(acquireResult.error)
  }

  try {
    const result = await fn()
    return Ok(result)
  } catch (error) {
    return Err(
      error instanceof Error
        ? error
        : new Error(String(error))
    )
  } finally {
    await lock.unlock()
  }
}
