/**
 * Request Caching
 * ===============
 *
 * Memoization layer for model API calls.
 * Prevents duplicate requests and reduces costs.
 */

import { createHash } from 'node:crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Cache entry with metadata.
 */
export interface CacheEntry<T> {
  /**
   * Cached value.
   */
  value: T;

  /**
   * When the entry was created.
   */
  created_at: number;

  /**
   * When the entry expires.
   */
  expires_at: number;

  /**
   * Number of times this entry was accessed.
   */
  hits: number;

  /**
   * Size in bytes (approximate).
   */
  size_bytes: number;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  /**
   * Total number of entries.
   */
  entries: number;

  /**
   * Total cache hits.
   */
  hits: number;

  /**
   * Total cache misses.
   */
  misses: number;

  /**
   * Hit rate (0-1).
   */
  hit_rate: number;

  /**
   * Total size in bytes.
   */
  total_size_bytes: number;

  /**
   * Number of evictions.
   */
  evictions: number;
}

/**
 * Cache options.
 */
export interface CacheOptions {
  /**
   * Maximum number of entries.
   */
  maxEntries?: number;

  /**
   * Default TTL in milliseconds.
   */
  defaultTTL?: number;

  /**
   * Maximum size in bytes.
   */
  maxSizeBytes?: number;
}

// =============================================================================
// LRU Cache Implementation
// =============================================================================

/**
 * LRU cache with TTL support.
 */
export class LRUCache<T> {
  private readonly cache: Map<string, CacheEntry<T>> = new Map();
  private readonly maxEntries: number;
  private readonly defaultTTL: number;
  private readonly maxSizeBytes: number;

  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.defaultTTL = options.defaultTTL ?? 3600000; // 1 hour
    this.maxSizeBytes = options.maxSizeBytes ?? 100 * 1024 * 1024; // 100MB
  }

  /**
   * Get a value from cache.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check expiration
    if (Date.now() > entry.expires_at) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Update access order (LRU)
    this.cache.delete(key);
    entry.hits++;
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache.
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const size = this.estimateSize(value);

    // Evict if needed
    this.evictIfNeeded(size);

    const entry: CacheEntry<T> = {
      value,
      created_at: now,
      expires_at: now + (ttl ?? this.defaultTTL),
      hits: 0,
      size_bytes: size,
    };

    this.cache.set(key, entry);
  }

  /**
   * Check if key exists and is valid.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expires_at) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a key.
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    let totalSize = 0;

    for (const entry of this.cache.values()) {
      totalSize += entry.size_bytes;
    }

    return {
      entries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hit_rate: total > 0 ? this.stats.hits / total : 0,
      total_size_bytes: totalSize,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Evict entries if needed to make room.
   */
  private evictIfNeeded(neededSize: number): void {
    // Evict if over max entries
    while (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        this.stats.evictions++;
      } else {
        break;
      }
    }

    // Evict if over max size
    let currentSize = 0;
    for (const entry of this.cache.values()) {
      currentSize += entry.size_bytes;
    }

    while (currentSize + neededSize > this.maxSizeBytes && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        const entry = this.cache.get(firstKey);
        if (entry) {
          currentSize -= entry.size_bytes;
        }
        this.cache.delete(firstKey);
        this.stats.evictions++;
      } else {
        break;
      }
    }

    // Evict expired entries
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires_at) {
        this.cache.delete(key);
        this.stats.evictions++;
      }
    }
  }

  /**
   * Estimate size of a value in bytes.
   */
  private estimateSize(value: T): number {
    try {
      return JSON.stringify(value).length * 2; // UTF-16
    } catch {
      return 1000; // Default estimate
    }
  }
}

// =============================================================================
// Request Cache
// =============================================================================

/**
 * Generate a cache key from request parameters.
 */
export function generateCacheKey(
  prompt: string,
  model: string,
  params?: Record<string, unknown>
): string {
  const data = {
    prompt,
    model,
    params: params ?? {},
  };

  const hash = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');

  return `req_${hash.slice(0, 16)}`;
}

/**
 * Create a request cache.
 */
export function createRequestCache<T>(options?: CacheOptions): LRUCache<T> {
  return new LRUCache<T>(options);
}
