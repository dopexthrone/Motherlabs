/**
 * Rate Limiting
 * =============
 *
 * Token bucket rate limiter for API calls.
 * Prevents hitting rate limits and provides backpressure.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Rate limit configuration.
 */
export interface RateLimitConfig {
  /**
   * Maximum requests per window.
   */
  maxRequests: number;

  /**
   * Window duration in milliseconds.
   */
  windowMs: number;

  /**
   * Maximum tokens per minute (for token-based limiting).
   */
  maxTokensPerMinute?: number;

  /**
   * Whether to queue requests when rate limited.
   */
  enableQueue?: boolean;

  /**
   * Maximum queue size.
   */
  maxQueueSize?: number;
}

/**
 * Rate limit status.
 */
export interface RateLimitStatus {
  /**
   * Whether the rate limit is currently exceeded.
   */
  limited: boolean;

  /**
   * Remaining requests in current window.
   */
  remaining: number;

  /**
   * When the current window resets.
   */
  reset_at: number;

  /**
   * Milliseconds until reset.
   */
  retry_after_ms: number;

  /**
   * Current queue size (if queuing enabled).
   */
  queue_size: number;
}

/**
 * Rate limiter statistics.
 */
export interface RateLimitStats {
  /**
   * Total requests.
   */
  total_requests: number;

  /**
   * Requests that were rate limited.
   */
  limited_requests: number;

  /**
   * Requests that were queued.
   */
  queued_requests: number;

  /**
   * Total tokens consumed.
   */
  total_tokens: number;

  /**
   * Current requests in window.
   */
  current_window_requests: number;
}

// =============================================================================
// Token Bucket Rate Limiter
// =============================================================================

/**
 * Token bucket rate limiter.
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private requests: number[] = [];
  private tokens: number[] = [];
  private queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];

  private stats = {
    total_requests: 0,
    limited_requests: 0,
    queued_requests: 0,
    total_tokens: 0,
  };

  constructor(config: RateLimitConfig) {
    this.config = {
      ...config,
      enableQueue: config.enableQueue ?? false,
      maxQueueSize: config.maxQueueSize ?? 100,
    };
  }

  /**
   * Check if a request can proceed.
   */
  canProceed(tokenCount?: number): boolean {
    this.cleanup();

    // Check request limit
    if (this.requests.length >= this.config.maxRequests) {
      return false;
    }

    // Check token limit
    if (this.config.maxTokensPerMinute && tokenCount) {
      const currentTokens = this.tokens.reduce((sum, t) => sum + t, 0);
      if (currentTokens + tokenCount > this.config.maxTokensPerMinute) {
        return false;
      }
    }

    return true;
  }

  /**
   * Record a request.
   */
  recordRequest(tokenCount?: number): void {
    const now = Date.now();
    this.requests.push(now);
    this.stats.total_requests++;

    if (tokenCount) {
      this.tokens.push(tokenCount);
      this.stats.total_tokens += tokenCount;
    }
  }

  /**
   * Acquire permission to make a request.
   * If rate limited and queuing is enabled, waits in queue.
   * Otherwise throws immediately.
   */
  async acquire(tokenCount?: number): Promise<void> {
    this.stats.total_requests++;

    if (this.canProceed(tokenCount)) {
      this.recordRequest(tokenCount);
      return;
    }

    this.stats.limited_requests++;

    // If queuing disabled, throw immediately
    if (!this.config.enableQueue) {
      const status = this.getStatus();
      throw new RateLimitError(
        `Rate limit exceeded. Retry after ${status.retry_after_ms}ms`,
        status.retry_after_ms
      );
    }

    // Check queue size
    if (this.queue.length >= (this.config.maxQueueSize ?? 100)) {
      throw new RateLimitError('Rate limit queue is full', 0);
    }

    // Queue the request
    this.stats.queued_requests++;

    return new Promise((resolve, reject) => {
      this.queue.push({
        resolve: () => {
          this.recordRequest(tokenCount);
          resolve();
        },
        reject,
        timestamp: Date.now(),
      });

      // Process queue when window resets
      this.scheduleQueueProcessing();
    });
  }

  /**
   * Get current rate limit status.
   */
  getStatus(): RateLimitStatus {
    this.cleanup();

    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const remaining = Math.max(0, this.config.maxRequests - this.requests.length);

    // Find when the oldest request in window expires
    const oldestInWindow = this.requests.find((r) => r > windowStart);
    const resetAt = oldestInWindow
      ? oldestInWindow + this.config.windowMs
      : now + this.config.windowMs;

    return {
      limited: this.requests.length >= this.config.maxRequests,
      remaining,
      reset_at: resetAt,
      retry_after_ms: Math.max(0, resetAt - now),
      queue_size: this.queue.length,
    };
  }

  /**
   * Get statistics.
   */
  getStats(): RateLimitStats {
    this.cleanup();

    return {
      ...this.stats,
      current_window_requests: this.requests.length,
    };
  }

  /**
   * Reset the rate limiter.
   */
  reset(): void {
    this.requests = [];
    this.tokens = [];

    // Reject all queued requests
    for (const item of this.queue) {
      item.reject(new RateLimitError('Rate limiter reset', 0));
    }
    this.queue = [];
  }

  /**
   * Cleanup old requests outside the window.
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const tokenWindowStart = now - 60000; // 1 minute for tokens

    this.requests = this.requests.filter((r) => r > windowStart);
    this.tokens = this.tokens.filter((_, i) => this.requests[i] && this.requests[i]! > tokenWindowStart);
  }

  /**
   * Schedule queue processing when window resets.
   */
  private scheduleQueueProcessing(): void {
    const status = this.getStatus();
    if (status.retry_after_ms > 0 && this.queue.length > 0) {
      setTimeout(() => {
        this.processQueue();
      }, status.retry_after_ms + 10);
    }
  }

  /**
   * Process queued requests.
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.canProceed()) {
      const item = this.queue.shift();
      if (item) {
        item.resolve();
      }
    }

    // Schedule next processing if there are more items
    if (this.queue.length > 0) {
      this.scheduleQueueProcessing();
    }
  }
}

/**
 * Rate limit error.
 */
export class RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a rate limiter with default configuration.
 */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}): RateLimiter {
  const fullConfig: RateLimitConfig = {
    maxRequests: config.maxRequests ?? 60,
    windowMs: config.windowMs ?? 60000, // 1 minute
    enableQueue: config.enableQueue ?? true,
    maxQueueSize: config.maxQueueSize ?? 100,
  };
  if (config.maxTokensPerMinute !== undefined) {
    fullConfig.maxTokensPerMinute = config.maxTokensPerMinute;
  }
  return new RateLimiter(fullConfig);
}

/**
 * Pre-configured rate limiters for common providers.
 */
export const PROVIDER_LIMITS: Record<string, RateLimitConfig> = {
  anthropic: {
    maxRequests: 60,
    windowMs: 60000,
    maxTokensPerMinute: 100000,
    enableQueue: true,
    maxQueueSize: 50,
  },
  openai: {
    maxRequests: 60,
    windowMs: 60000,
    maxTokensPerMinute: 90000,
    enableQueue: true,
    maxQueueSize: 50,
  },
  gemini: {
    maxRequests: 60,
    windowMs: 60000,
    maxTokensPerMinute: 120000,
    enableQueue: true,
    maxQueueSize: 50,
  },
};

/**
 * Create a rate limiter for a specific provider.
 */
export function createProviderRateLimiter(provider: string): RateLimiter {
  const config = PROVIDER_LIMITS[provider.toLowerCase()];
  if (config) {
    return new RateLimiter(config);
  }
  return createRateLimiter();
}
