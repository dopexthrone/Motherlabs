/**
 * Adapter Resilience Patterns
 * ===========================
 *
 * Circuit breaker and retry/backoff for model adapters.
 * Prevents cascade failures and handles transient errors.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Circuit breaker state.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /**
   * Number of failures before opening circuit.
   */
  failureThreshold: number;

  /**
   * Time in ms before attempting recovery.
   */
  resetTimeout: number;

  /**
   * Number of successes in half-open to close circuit.
   */
  successThreshold: number;

  /**
   * Time window for counting failures (ms).
   */
  failureWindow: number;
}

/**
 * Circuit breaker statistics.
 */
export interface CircuitBreakerStats {
  /**
   * Current state.
   */
  state: CircuitState;

  /**
   * Total failures.
   */
  failures: number;

  /**
   * Total successes.
   */
  successes: number;

  /**
   * Recent failures in window.
   */
  recentFailures: number;

  /**
   * When circuit was last opened.
   */
  lastOpenedAt?: number;

  /**
   * When circuit will attempt recovery.
   */
  recoveryAt?: number;
}

/**
 * Retry configuration.
 */
export interface RetryConfig {
  /**
   * Maximum retry attempts.
   */
  maxAttempts: number;

  /**
   * Initial delay in ms.
   */
  initialDelay: number;

  /**
   * Maximum delay in ms.
   */
  maxDelay: number;

  /**
   * Backoff multiplier.
   */
  backoffMultiplier: number;

  /**
   * Jitter factor (0-1).
   */
  jitter: number;

  /**
   * Which errors to retry.
   */
  retryOn?: (error: Error) => boolean;
}

/**
 * Retry statistics.
 */
export interface RetryStats {
  /**
   * Total attempts made.
   */
  totalAttempts: number;

  /**
   * Successful on first try.
   */
  firstTrySuccesses: number;

  /**
   * Successful after retry.
   */
  retrySuccesses: number;

  /**
   * Total failures (exhausted retries).
   */
  exhaustedFailures: number;

  /**
   * Average attempts per request.
   */
  avgAttempts: number;
}

// =============================================================================
// Circuit Breaker
// =============================================================================

/**
 * Circuit breaker implementation.
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failures: number[] = [];
  private successes = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastOpenedAt: number | null = null;
  private recoveryAt: number | null = null;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeout: config.resetTimeout ?? 30000, // 30 seconds
      successThreshold: config.successThreshold ?? 2,
      failureWindow: config.failureWindow ?? 60000, // 1 minute
    };
  }

  /**
   * Check if circuit allows requests.
   */
  canExecute(): boolean {
    this.cleanupOldFailures();

    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      // Check if we can transition to half-open
      if (this.recoveryAt && Date.now() >= this.recoveryAt) {
        this.state = 'half-open';
        this.successes = 0;
        return true;
      }
      return false;
    }

    // Half-open: allow limited requests
    return true;
  }

  /**
   * Record a successful operation.
   */
  recordSuccess(): void {
    this.totalSuccesses++;

    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = 'closed';
        this.failures = [];
        this.recoveryAt = null;
      }
    }
  }

  /**
   * Record a failed operation.
   */
  recordFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.totalFailures++;

    this.cleanupOldFailures();

    if (this.state === 'closed') {
      if (this.failures.length >= this.config.failureThreshold) {
        this.openCircuit();
      }
    } else if (this.state === 'half-open') {
      // Any failure in half-open reopens the circuit
      this.openCircuit();
    }
  }

  /**
   * Get current state.
   */
  getState(): CircuitState {
    this.cleanupOldFailures();

    // Check for auto-recovery
    if (this.state === 'open' && this.recoveryAt && Date.now() >= this.recoveryAt) {
      this.state = 'half-open';
      this.successes = 0;
    }

    return this.state;
  }

  /**
   * Get statistics.
   */
  getStats(): CircuitBreakerStats {
    this.cleanupOldFailures();

    const stats: CircuitBreakerStats = {
      state: this.getState(),
      failures: this.totalFailures,
      successes: this.totalSuccesses,
      recentFailures: this.failures.length,
    };

    if (this.lastOpenedAt) stats.lastOpenedAt = this.lastOpenedAt;
    if (this.recoveryAt) stats.recoveryAt = this.recoveryAt;

    return stats;
  }

  /**
   * Reset the circuit breaker.
   */
  reset(): void {
    this.state = 'closed';
    this.failures = [];
    this.successes = 0;
    this.lastOpenedAt = null;
    this.recoveryAt = null;
  }

  /**
   * Force open the circuit (for testing/manual override).
   */
  forceOpen(): void {
    this.openCircuit();
  }

  /**
   * Force close the circuit (for testing/manual override).
   */
  forceClose(): void {
    this.state = 'closed';
    this.failures = [];
    this.recoveryAt = null;
  }

  /**
   * Open the circuit.
   */
  private openCircuit(): void {
    this.state = 'open';
    this.lastOpenedAt = Date.now();
    this.recoveryAt = Date.now() + this.config.resetTimeout;
  }

  /**
   * Cleanup failures outside the window.
   */
  private cleanupOldFailures(): void {
    const cutoff = Date.now() - this.config.failureWindow;
    this.failures = this.failures.filter((t) => t > cutoff);
  }
}

/**
 * Circuit breaker error.
 */
export class CircuitOpenError extends Error {
  readonly recoveryAt?: number;

  constructor(message: string, recoveryAt?: number) {
    super(message);
    this.name = 'CircuitOpenError';
    if (recoveryAt) this.recoveryAt = recoveryAt;
  }
}

// =============================================================================
// Retry with Backoff
// =============================================================================

/**
 * Retry executor with exponential backoff.
 */
export class RetryExecutor {
  private readonly config: RetryConfig;
  private stats = {
    totalAttempts: 0,
    firstTrySuccesses: 0,
    retrySuccesses: 0,
    exhaustedFailures: 0,
  };

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      initialDelay: config.initialDelay ?? 1000,
      maxDelay: config.maxDelay ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      jitter: config.jitter ?? 0.1,
      retryOn: config.retryOn ?? this.defaultRetryOn,
    };
  }

  /**
   * Execute with retry.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt < this.config.maxAttempts) {
      attempt++;
      this.stats.totalAttempts++;

      try {
        const result = await fn();

        if (attempt === 1) {
          this.stats.firstTrySuccesses++;
        } else {
          this.stats.retrySuccesses++;
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (!this.config.retryOn!(lastError)) {
          throw lastError;
        }

        // Check if we have more attempts
        if (attempt >= this.config.maxAttempts) {
          break;
        }

        // Wait before retry
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    this.stats.exhaustedFailures++;
    throw new RetryExhaustedError(
      `Exhausted ${this.config.maxAttempts} retry attempts`,
      lastError
    );
  }

  /**
   * Get statistics.
   */
  getStats(): RetryStats {
    const total = this.stats.firstTrySuccesses + this.stats.retrySuccesses + this.stats.exhaustedFailures;
    return {
      ...this.stats,
      avgAttempts: total > 0 ? this.stats.totalAttempts / total : 0,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      totalAttempts: 0,
      firstTrySuccesses: 0,
      retrySuccesses: 0,
      exhaustedFailures: 0,
    };
  }

  /**
   * Calculate delay for attempt.
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff
    let delay = this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);

    // Cap at max delay
    delay = Math.min(delay, this.config.maxDelay);

    // Add jitter
    const jitterRange = delay * this.config.jitter;
    delay += Math.random() * jitterRange * 2 - jitterRange;

    return Math.round(delay);
  }

  /**
   * Default retry condition.
   */
  private defaultRetryOn(error: Error): boolean {
    // Retry on network errors, rate limits, and server errors
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('econnreset') ||
      message.includes('econnrefused')
    );
  }

  /**
   * Sleep for ms.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Retry exhausted error.
 */
export class RetryExhaustedError extends Error {
  readonly lastError?: Error;

  constructor(message: string, lastError?: Error) {
    super(message);
    this.name = 'RetryExhaustedError';
    if (lastError) this.lastError = lastError;
  }
}

// =============================================================================
// Combined Resilient Executor
// =============================================================================

/**
 * Resilient executor combining circuit breaker and retry.
 */
export class ResilientExecutor {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryExecutor: RetryExecutor;

  constructor(
    circuitConfig: Partial<CircuitBreakerConfig> = {},
    retryConfig: Partial<RetryConfig> = {}
  ) {
    this.circuitBreaker = new CircuitBreaker(circuitConfig);
    this.retryExecutor = new RetryExecutor(retryConfig);
  }

  /**
   * Execute with circuit breaker and retry.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check circuit breaker first
    if (!this.circuitBreaker.canExecute()) {
      const stats = this.circuitBreaker.getStats();
      throw new CircuitOpenError(
        'Circuit breaker is open',
        stats.recoveryAt
      );
    }

    try {
      // Execute with retry
      const result = await this.retryExecutor.execute(fn);
      this.circuitBreaker.recordSuccess();
      return result;
    } catch (error) {
      // If retry was exhausted, record as circuit breaker failure
      if (error instanceof RetryExhaustedError) {
        this.circuitBreaker.recordFailure();
      }
      throw error;
    }
  }

  /**
   * Get combined statistics.
   */
  getStats(): {
    circuit: CircuitBreakerStats;
    retry: RetryStats;
  } {
    return {
      circuit: this.circuitBreaker.getStats(),
      retry: this.retryExecutor.getStats(),
    };
  }

  /**
   * Reset both circuit breaker and retry stats.
   */
  reset(): void {
    this.circuitBreaker.reset();
    this.retryExecutor.resetStats();
  }

  /**
   * Get circuit breaker.
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Get retry executor.
   */
  getRetryExecutor(): RetryExecutor {
    return this.retryExecutor;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a circuit breaker.
 */
export function createCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  return new CircuitBreaker(config);
}

/**
 * Create a retry executor.
 */
export function createRetryExecutor(config?: Partial<RetryConfig>): RetryExecutor {
  return new RetryExecutor(config);
}

/**
 * Create a resilient executor.
 */
export function createResilientExecutor(
  circuitConfig?: Partial<CircuitBreakerConfig>,
  retryConfig?: Partial<RetryConfig>
): ResilientExecutor {
  return new ResilientExecutor(circuitConfig, retryConfig);
}

/**
 * Pre-configured resilient executor for API calls.
 */
export function createAPIResilientExecutor(): ResilientExecutor {
  return createResilientExecutor(
    {
      failureThreshold: 5,
      resetTimeout: 30000,
      successThreshold: 2,
      failureWindow: 60000,
    },
    {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitter: 0.1,
    }
  );
}
