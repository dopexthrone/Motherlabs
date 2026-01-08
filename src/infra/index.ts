/**
 * Infrastructure Module
 * =====================
 *
 * Production infrastructure: caching, rate limiting, cost tracking, observability.
 */

// Cache
export {
  LRUCache,
  generateCacheKey,
  createRequestCache,
  type CacheEntry,
  type CacheStats,
  type CacheOptions,
} from './cache.js';

// Rate Limiting
export {
  RateLimiter,
  RateLimitError,
  createRateLimiter,
  createProviderRateLimiter,
  PROVIDER_LIMITS,
  type RateLimitConfig,
  type RateLimitStatus,
  type RateLimitStats,
} from './rate-limit.js';

// Cost Tracking
export {
  CostTracker,
  BudgetExceededError,
  createCostTracker,
  createDailyBudgetTracker,
  MODEL_PRICING,
  type ModelPricing,
  type CostEntry,
  type CostReport,
  type BudgetConfig,
} from './cost.js';

// Metrics / Observability
export {
  MetricsCollector,
  ConsoleExporter,
  createMetricsCollector,
  type MetricType,
  type MetricValue,
  type LogLevel,
  type LogEntry,
  type Span,
  type MetricsExporter,
} from './metrics.js';
