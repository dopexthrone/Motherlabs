/**
 * Adapter Factory
 * ================
 *
 * Unified factory for creating model adapters.
 * Provides provider selection and future routing capabilities.
 */

import {
  ModelAdapter,
  ModelCapabilities,
  AdapterError,
  TransformContext,
  TransformResult,
} from './model.js';
import { MockModelAdapter, createEchoAdapter } from './mock.js';
import { ClaudeAdapter, ClaudeModel } from './claude.js';
import { OpenAIAdapter, OpenAIModel } from './openai.js';
import { OllamaAdapter, OllamaModel, isOllamaAvailable } from './ollama.js';
import { GeminiAdapter, GeminiModel, isGeminiConfigured } from './gemini.js';
import {
  ResilientExecutor,
  CircuitBreakerConfig,
  RetryConfig,
  CircuitOpenError,
  RetryExhaustedError,
  createAPIResilientExecutor,
} from './resilience.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported providers.
 */
export type AdapterProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'mock';

/**
 * Options for creating an adapter.
 */
export interface AdapterFactoryOptions {
  /**
   * Provider to use.
   */
  provider: AdapterProvider;

  /**
   * Model name (provider-specific).
   * If not specified, uses provider default.
   */
  model?: string;

  /**
   * Temperature for generation.
   * @default 0
   */
  temperature?: number;

  /**
   * Request timeout in milliseconds.
   */
  timeout_ms?: number;

  /**
   * Maximum retries for transient errors.
   */
  max_retries?: number;

  /**
   * Fallback provider if primary fails.
   */
  fallback_provider?: AdapterProvider;

  /**
   * Fallback model.
   */
  fallback_model?: string;

  /**
   * Enable circuit breaker + retry resilience wrapper.
   * @default false
   */
  enable_resilience?: boolean;

  /**
   * Circuit breaker configuration (when enable_resilience is true).
   */
  circuit_config?: Partial<CircuitBreakerConfig>;

  /**
   * Retry configuration (when enable_resilience is true).
   */
  retry_config?: Partial<RetryConfig>;
}

/**
 * Resolved adapter configuration.
 */
export interface ResolvedAdapterConfig {
  provider: AdapterProvider;
  model: string;
  capabilities: ModelCapabilities;
}

// =============================================================================
// Factory Implementation
// =============================================================================

/**
 * Create a model adapter based on options.
 *
 * @param options - Adapter configuration
 * @returns ModelAdapter instance
 * @throws AdapterError if configuration is invalid
 */
export function createAdapter(options: AdapterFactoryOptions): ModelAdapter {
  const { provider, model, temperature, timeout_ms, max_retries } = options;

  switch (provider) {
    case 'anthropic': {
      const claudeOpts: import('./claude.js').ClaudeAdapterOptions = {
        model: (model as ClaudeModel) ?? 'claude-3-5-sonnet-20241022',
      };
      if (temperature !== undefined) claudeOpts.temperature = temperature;
      if (timeout_ms !== undefined) claudeOpts.timeout_ms = timeout_ms;
      if (max_retries !== undefined) claudeOpts.max_retries = max_retries;
      return new ClaudeAdapter(claudeOpts);
    }

    case 'openai': {
      const openaiOpts: import('./openai.js').OpenAIAdapterOptions = {
        model: (model as OpenAIModel) ?? 'gpt-4o',
      };
      if (temperature !== undefined) openaiOpts.temperature = temperature;
      if (timeout_ms !== undefined) openaiOpts.timeout_ms = timeout_ms;
      if (max_retries !== undefined) openaiOpts.max_retries = max_retries;
      return new OpenAIAdapter(openaiOpts);
    }

    case 'google': {
      const geminiOpts: import('./gemini.js').GeminiAdapterOptions = {
        model: (model as GeminiModel) ?? 'gemini-2.0-flash',
      };
      if (temperature !== undefined) geminiOpts.temperature = temperature;
      if (timeout_ms !== undefined) geminiOpts.timeout_ms = timeout_ms;
      return new GeminiAdapter(geminiOpts);
    }

    case 'ollama': {
      const ollamaOpts: import('./ollama.js').OllamaAdapterOptions = {
        model: (model as OllamaModel) ?? 'llama3.3',
      };
      if (temperature !== undefined) ollamaOpts.temperature = temperature;
      if (timeout_ms !== undefined) ollamaOpts.timeout_ms = timeout_ms;
      return new OllamaAdapter(ollamaOpts);
    }

    case 'mock':
      return createEchoAdapter();

    default:
      throw new AdapterError(
        'INVALID_REQUEST',
        `Unknown provider: ${provider}`,
        false
      );
  }
}

/**
 * Create an adapter with automatic fallback.
 *
 * Returns a wrapper that tries the primary adapter first,
 * then falls back to the secondary on failure.
 *
 * @param options - Primary adapter configuration with fallback
 * @returns ModelAdapter with fallback behavior
 */
export function createAdapterWithFallback(
  options: AdapterFactoryOptions
): ModelAdapter {
  const primary = createAdapter(options);

  if (!options.fallback_provider) {
    return primary;
  }

  const fallbackOpts: AdapterFactoryOptions = {
    provider: options.fallback_provider,
  };
  if (options.fallback_model !== undefined) fallbackOpts.model = options.fallback_model;
  if (options.temperature !== undefined) fallbackOpts.temperature = options.temperature;
  if (options.timeout_ms !== undefined) fallbackOpts.timeout_ms = options.timeout_ms;
  if (options.max_retries !== undefined) fallbackOpts.max_retries = options.max_retries;

  const fallback = createAdapter(fallbackOpts);

  return new FallbackAdapter(primary, fallback);
}

/**
 * Auto-detect and create the best available adapter.
 *
 * Priority:
 * 1. Ollama (if running locally - for testing)
 * 2. Gemini (if GOOGLE_API_KEY is set)
 * 3. OpenAI (if OPENAI_API_KEY is set)
 * 4. Claude (if ANTHROPIC_API_KEY is set)
 * 5. Mock (fallback)
 */
export async function createAutoAdapter(): Promise<ModelAdapter> {
  // Try Ollama first (local, free, good for testing)
  if (await isOllamaAvailable()) {
    return new OllamaAdapter();
  }

  // Try Gemini
  if (isGeminiConfigured()) {
    try {
      return new GeminiAdapter();
    } catch {
      // Continue to next provider
    }
  }

  // Try OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      return new OpenAIAdapter();
    } catch {
      // Continue to next provider
    }
  }

  // Try Claude
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return new ClaudeAdapter();
    } catch {
      // Continue to next provider
    }
  }

  // Fall back to mock
  return createEchoAdapter();
}

/**
 * Get provider from environment.
 * Returns null if no provider is configured.
 */
export function getConfiguredProvider(): AdapterProvider | null {
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) return 'google';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

/**
 * Check if a provider is available.
 */
export async function isProviderAvailable(
  provider: AdapterProvider
): Promise<boolean> {
  switch (provider) {
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY;

    case 'openai':
      return !!process.env.OPENAI_API_KEY;

    case 'google':
      return isGeminiConfigured();

    case 'ollama':
      return await isOllamaAvailable();

    case 'mock':
      return true;

    default:
      return false;
  }
}

/**
 * Get default model for a provider.
 */
export function getDefaultModel(provider: AdapterProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-3-5-sonnet-20241022';
    case 'openai':
      return 'gpt-4o';
    case 'google':
      return 'gemini-2.0-flash';
    case 'ollama':
      return 'llama3.3';
    case 'mock':
      return 'mock';
    default:
      return 'unknown';
  }
}

// =============================================================================
// Fallback Adapter
// =============================================================================

/**
 * Adapter that tries primary first, then falls back on error.
 */
class FallbackAdapter implements ModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  constructor(
    private readonly primary: ModelAdapter,
    private readonly fallback: ModelAdapter
  ) {
    this.adapter_id = `fallback_${primary.adapter_id}_${fallback.adapter_id}`;
    this.model_id = `${primary.model_id}|${fallback.model_id}`;
    // Use primary capabilities (more optimistic)
    this.capabilities = primary.capabilities;
  }

  async transform(
    prompt: string,
    context: import('./model.js').TransformContext
  ): Promise<import('./model.js').TransformResult> {
    try {
      return await this.primary.transform(prompt, context);
    } catch (error) {
      // Only fallback on retryable errors
      if (error instanceof AdapterError && error.retryable) {
        return await this.fallback.transform(prompt, context);
      }
      throw error;
    }
  }

  async isReady(): Promise<boolean> {
    const [primaryReady, fallbackReady] = await Promise.all([
      this.primary.isReady(),
      this.fallback.isReady(),
    ]);
    return primaryReady || fallbackReady;
  }

  async shutdown(): Promise<void> {
    await Promise.all([this.primary.shutdown(), this.fallback.shutdown()]);
  }
}

// =============================================================================
// Routing Configuration (Future v0.5.0)
// =============================================================================

/**
 * Routing rule condition.
 */
export type RoutingCondition =
  | 'cost'
  | 'latency'
  | 'quality'
  | 'context_length'
  | 'always';

/**
 * Routing action.
 */
export type RoutingAction = 'use_primary' | 'use_fallback' | 'use_local';

/**
 * A routing rule.
 */
export interface RoutingRule {
  condition: RoutingCondition;
  threshold?: number;
  action: RoutingAction;
}

/**
 * Full routing configuration.
 */
export interface RoutingConfig {
  primary: AdapterFactoryOptions;
  fallback?: AdapterFactoryOptions;
  local?: AdapterFactoryOptions;
  rules: RoutingRule[];
}

/**
 * Create a routing adapter (placeholder for v0.5.0).
 * Currently just creates the primary adapter.
 */
export function createRoutingAdapter(config: RoutingConfig): ModelAdapter {
  // v0.4.0: Simple implementation - just use primary with optional fallback
  if (config.fallback) {
    const opts: AdapterFactoryOptions = {
      ...config.primary,
      fallback_provider: config.fallback.provider,
    };
    if (config.fallback.model !== undefined) {
      opts.fallback_model = config.fallback.model;
    }
    return createAdapterWithFallback(opts);
  }

  return createAdapter(config.primary);
}

// =============================================================================
// Resilient Adapter
// =============================================================================

/**
 * Adapter wrapper with circuit breaker and retry/backoff.
 * Prevents cascade failures and handles transient errors.
 */
export class ResilientAdapter implements ModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly executor: ResilientExecutor;

  constructor(
    private readonly inner: ModelAdapter,
    circuitConfig?: Partial<CircuitBreakerConfig>,
    retryConfig?: Partial<RetryConfig>
  ) {
    this.adapter_id = `resilient_${inner.adapter_id}`;
    this.model_id = inner.model_id;
    this.capabilities = inner.capabilities;
    this.executor = new ResilientExecutor(circuitConfig, retryConfig);
  }

  async transform(
    prompt: string,
    context: TransformContext
  ): Promise<TransformResult> {
    try {
      return await this.executor.execute(() =>
        this.inner.transform(prompt, context)
      );
    } catch (error) {
      // Convert resilience errors to adapter errors
      if (error instanceof CircuitOpenError) {
        const details: Record<string, unknown> = {};
        if (error.recoveryAt !== undefined) details.recovery_at = error.recoveryAt;
        throw new AdapterError(
          'RATE_LIMITED',
          `Circuit breaker open: ${error.message}`,
          true, // Retryable after recovery
          Object.keys(details).length > 0 ? details : undefined
        );
      }
      if (error instanceof RetryExhaustedError) {
        const details: Record<string, unknown> = {};
        if (error.lastError) details.last_error = error.lastError.message;
        throw new AdapterError(
          'NETWORK_ERROR',
          `Retry exhausted: ${error.message}`,
          false,
          Object.keys(details).length > 0 ? details : undefined
        );
      }
      throw error;
    }
  }

  async isReady(): Promise<boolean> {
    // Check circuit breaker state
    const circuitStats = this.executor.getStats().circuit;
    if (circuitStats.state === 'open') {
      return false;
    }
    return this.inner.isReady();
  }

  async shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  /**
   * Get resilience statistics.
   */
  getResilienceStats(): {
    circuit: import('./resilience.js').CircuitBreakerStats;
    retry: import('./resilience.js').RetryStats;
  } {
    return this.executor.getStats();
  }

  /**
   * Reset circuit breaker and retry stats.
   */
  resetResilience(): void {
    this.executor.reset();
  }
}

/**
 * Create an adapter with resilience patterns (circuit breaker + retry).
 *
 * @param options - Adapter configuration
 * @returns ModelAdapter wrapped with resilience
 */
export function createResilientAdapter(
  options: AdapterFactoryOptions
): ResilientAdapter {
  const inner = createAdapter(options);
  return new ResilientAdapter(inner, options.circuit_config, options.retry_config);
}

/**
 * Create an adapter with both resilience and fallback.
 *
 * @param options - Primary adapter configuration
 * @returns ModelAdapter with resilience + fallback
 */
export function createResilientAdapterWithFallback(
  options: AdapterFactoryOptions
): ModelAdapter {
  const primary = createResilientAdapter(options);

  if (!options.fallback_provider) {
    return primary;
  }

  const fallbackOpts: AdapterFactoryOptions = {
    provider: options.fallback_provider,
  };
  if (options.fallback_model !== undefined) fallbackOpts.model = options.fallback_model;
  if (options.temperature !== undefined) fallbackOpts.temperature = options.temperature;
  if (options.timeout_ms !== undefined) fallbackOpts.timeout_ms = options.timeout_ms;
  if (options.circuit_config !== undefined) fallbackOpts.circuit_config = options.circuit_config;
  if (options.retry_config !== undefined) fallbackOpts.retry_config = options.retry_config;

  const fallback = createResilientAdapter(fallbackOpts);

  return new FallbackAdapter(primary, fallback);
}

/**
 * Create a production-ready adapter with sensible defaults.
 *
 * Includes:
 * - Circuit breaker (opens after 5 failures, recovers after 30s)
 * - Retry with exponential backoff (3 attempts, 1s-30s delay)
 * - Optional fallback provider
 *
 * @param options - Adapter configuration
 * @returns Production-ready adapter
 */
export function createProductionAdapter(
  options: AdapterFactoryOptions
): ModelAdapter {
  const opts: AdapterFactoryOptions = {
    ...options,
    circuit_config: {
      failureThreshold: 5,
      resetTimeout: 30000,
      successThreshold: 2,
      failureWindow: 60000,
      ...options.circuit_config,
    },
    retry_config: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      jitter: 0.1,
      ...options.retry_config,
    },
  };

  if (opts.fallback_provider) {
    return createResilientAdapterWithFallback(opts);
  }

  return createResilientAdapter(opts);
}
