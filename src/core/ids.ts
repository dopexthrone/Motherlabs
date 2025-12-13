// Deterministic ID Generation - No Date.now(), monotonic, reproducible

/**
 * ID generator with monotonic counter (deterministic)
 * Replaces Date.now() which breaks determinism/replay
 */
export class IdGenerator {
  private counters: Map<string, number> = new Map()

  /**
   * Generate deterministic ID for evidence
   * Format: {taskId}-{type}-{sequence}
   */
  evidenceId(taskId: string, type: string): string {
    const key = `${taskId}:${type}`
    const current = this.counters.get(key) || 0
    const next = current + 1
    this.counters.set(key, next)

    return `${taskId}-${type}-${next}`
  }

  /**
   * Generate deterministic ID for any entity
   * Format: {prefix}-{sequence}
   */
  generate(prefix: string): string {
    const current = this.counters.get(prefix) || 0
    const next = current + 1
    this.counters.set(prefix, next)

    return `${prefix}-${next}`
  }

  /**
   * Reset counter (for testing)
   */
  reset(): void {
    this.counters.clear()
  }

  /**
   * Get current state (for replay/serialization)
   */
  getState(): Record<string, number> {
    return Object.fromEntries(this.counters.entries())
  }

  /**
   * Restore state (for replay/deserialization)
   */
  setState(state: Record<string, number>): void {
    this.counters = new Map(Object.entries(state))
  }
}

/**
 * Global ID generator instance
 * Note: For true determinism in tests, inject IdGenerator as dependency
 */
export const globalIdGenerator = new IdGenerator()

/**
 * Timestamp provider interface (for dependency injection)
 */
export interface TimeProvider {
  now(): number
}

/**
 * Real time provider (uses Date.now)
 */
export class RealTimeProvider implements TimeProvider {
  now(): number {
    return Date.now()
  }
}

/**
 * Deterministic time provider (for testing/replay)
 */
export class DeterministicTimeProvider implements TimeProvider {
  private currentTime: number

  constructor(startTime: number = 0) {
    this.currentTime = startTime
  }

  now(): number {
    return this.currentTime
  }

  advance(ms: number): void {
    this.currentTime += ms
  }

  set(time: number): void {
    this.currentTime = time
  }
}

/**
 * Global time provider (injectable for tests)
 */
export let globalTimeProvider: TimeProvider = new RealTimeProvider()

export function setTimeProvider(provider: TimeProvider): void {
  globalTimeProvider = provider
}
