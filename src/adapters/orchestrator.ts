/**
 * Multi-Model Orchestrator
 * ========================
 *
 * Routes requests to different models based on:
 * - Task type (draft vs final, simple vs complex)
 * - Cost optimization (cheap for exploration, expensive for production)
 * - Load balancing across providers
 * - Provider health and availability
 */

import type {
  ModelAdapter,
  ModelCapabilities,
  TransformContext,
  TransformResult,
  StreamChunk,
  StreamResult,
  StreamingModelAdapter,
} from './model.js';
import { AdapterError, isStreamingAdapter } from './model.js';
import { createAdapter, type AdapterFactoryOptions, type AdapterProvider } from './factory.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Task classification for routing.
 */
export type TaskType =
  | 'draft'           // Initial exploration, can use cheaper model
  | 'refinement'      // Iterating on draft, medium quality
  | 'final'           // Production output, highest quality
  | 'validation'      // Checking/reviewing, can be fast
  | 'embedding';      // Embedding generation (if supported)

/**
 * Model tier for cost/quality tradeoff.
 */
export type ModelTier = 'economy' | 'standard' | 'premium';

/**
 * Provider health status.
 */
export interface ProviderHealth {
  provider: AdapterProvider;
  available: boolean;
  latency_ms: number;
  error_rate: number;
  last_check: number;
}

/**
 * Orchestrator configuration.
 */
export interface OrchestratorConfig {
  /**
   * Default provider.
   */
  default_provider: AdapterProvider;

  /**
   * Model mappings by tier.
   */
  tiers: {
    economy?: AdapterFactoryOptions;
    standard?: AdapterFactoryOptions;
    premium?: AdapterFactoryOptions;
  };

  /**
   * Task type to tier mapping.
   */
  task_routing?: Partial<Record<TaskType, ModelTier>>;

  /**
   * Enable load balancing across providers.
   * @default false
   */
  load_balance?: boolean;

  /**
   * Providers for load balancing.
   */
  balance_providers?: AdapterProvider[];

  /**
   * Health check interval in ms.
   * @default 60000
   */
  health_check_interval?: number;

  /**
   * Fallback on error.
   * @default true
   */
  fallback_on_error?: boolean;
}

/**
 * Orchestrator statistics.
 */
export interface OrchestratorStats {
  requests_by_tier: Record<ModelTier, number>;
  requests_by_provider: Record<string, number>;
  fallbacks: number;
  errors: number;
  avg_latency_ms: number;
  cost_estimate: number;
}

// =============================================================================
// Multi-Model Orchestrator
// =============================================================================

/**
 * Multi-model orchestrator for intelligent request routing.
 * Supports streaming if any of the underlying adapters support streaming.
 */
export class ModelOrchestrator implements StreamingModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly config: Required<OrchestratorConfig>;
  private readonly adapters: Map<ModelTier, ModelAdapter> = new Map();
  private readonly providerHealth: Map<AdapterProvider, ProviderHealth> = new Map();
  private readonly stats: OrchestratorStats = {
    requests_by_tier: { economy: 0, standard: 0, premium: 0 },
    requests_by_provider: {},
    fallbacks: 0,
    errors: 0,
    avg_latency_ms: 0,
    cost_estimate: 0,
  };
  private totalLatency = 0;
  private requestCount = 0;
  private balanceIndex = 0;

  constructor(config: OrchestratorConfig) {
    this.config = {
      default_provider: config.default_provider,
      tiers: config.tiers,
      task_routing: config.task_routing ?? {
        draft: 'economy',
        refinement: 'standard',
        final: 'premium',
        validation: 'economy',
        embedding: 'economy',
      },
      load_balance: config.load_balance ?? false,
      balance_providers: config.balance_providers ?? [],
      health_check_interval: config.health_check_interval ?? 60000,
      fallback_on_error: config.fallback_on_error ?? true,
    };

    this.adapter_id = `orchestrator_${Date.now().toString(36)}`;
    this.model_id = 'orchestrator';

    // Initialize adapters for each tier
    this.initializeAdapters();

    // Set capabilities from primary adapter, with streaming support if any adapter supports it
    const primaryAdapter = this.adapters.get('standard') ?? this.adapters.values().next().value;
    const hasStreamingAdapter = Array.from(this.adapters.values()).some(a => a.capabilities.supports_streaming);
    this.capabilities = primaryAdapter?.capabilities
      ? { ...primaryAdapter.capabilities, supports_streaming: hasStreamingAdapter }
      : {
          max_context_tokens: 128000,
          max_output_tokens: 4096,
          supports_structured_output: true,
          supports_tool_use: false,
          supports_streaming: hasStreamingAdapter,
        };

    // Initialize health for balance providers
    for (const provider of this.config.balance_providers) {
      this.providerHealth.set(provider, {
        provider,
        available: true,
        latency_ms: 0,
        error_rate: 0,
        last_check: Date.now(),
      });
    }
  }

  /**
   * Initialize adapters for each configured tier.
   */
  private initializeAdapters(): void {
    const tiers: ModelTier[] = ['economy', 'standard', 'premium'];

    for (const tier of tiers) {
      const tierConfig = this.config.tiers[tier];
      if (tierConfig) {
        try {
          const adapter = createAdapter(tierConfig);
          this.adapters.set(tier, adapter);
        } catch {
          // Tier unavailable, will fall back to others
        }
      }
    }

    // Ensure at least one adapter exists
    if (this.adapters.size === 0) {
      const defaultAdapter = createAdapter({ provider: this.config.default_provider });
      this.adapters.set('standard', defaultAdapter);
    }
  }

  /**
   * Transform with intelligent routing.
   */
  async transform(
    prompt: string,
    context: TransformContext
  ): Promise<TransformResult> {
    const startTime = performance.now();

    // Determine task type from context
    const taskType = this.classifyTask(context);
    const tier = this.config.task_routing[taskType] ?? 'standard';

    // Get adapter for tier (with fallback)
    const adapter = this.getAdapterForTier(tier);
    const provider = this.extractProvider(adapter);

    // Track stats
    this.stats.requests_by_tier[tier]++;
    this.stats.requests_by_provider[provider] =
      (this.stats.requests_by_provider[provider] ?? 0) + 1;

    try {
      const result = await adapter.transform(prompt, context);

      // Update latency stats
      const latency = performance.now() - startTime;
      this.totalLatency += latency;
      this.requestCount++;
      this.stats.avg_latency_ms = this.totalLatency / this.requestCount;

      // Update provider health
      this.updateProviderHealth(provider, true, latency);

      // Estimate cost (rough approximation)
      this.stats.cost_estimate += this.estimateCost(
        tier,
        result.tokens_input,
        result.tokens_output
      );

      return result;
    } catch (error) {
      this.stats.errors++;
      this.updateProviderHealth(provider, false, 0);

      // Try fallback if enabled
      if (this.config.fallback_on_error) {
        const fallbackAdapter = this.getFallbackAdapter(tier);
        if (fallbackAdapter && fallbackAdapter !== adapter) {
          this.stats.fallbacks++;
          return fallbackAdapter.transform(prompt, context);
        }
      }

      throw error;
    }
  }

  /**
   * Transform with intelligent routing and streaming.
   */
  async *transformStream(
    prompt: string,
    context: TransformContext
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const startTime = performance.now();

    // Determine task type from context
    const taskType = this.classifyTask(context);
    const tier = this.config.task_routing[taskType] ?? 'standard';

    // Get adapter for tier (with fallback)
    const adapter = this.getAdapterForTier(tier);
    const provider = this.extractProvider(adapter);

    // Track stats
    this.stats.requests_by_tier[tier]++;
    this.stats.requests_by_provider[provider] =
      (this.stats.requests_by_provider[provider] ?? 0) + 1;

    // Check if adapter supports streaming
    if (!isStreamingAdapter(adapter)) {
      throw new AdapterError(
        'INVALID_REQUEST',
        `Selected adapter (${adapter.adapter_id}) does not support streaming`,
        false
      );
    }

    try {
      let streamResult: StreamResult | undefined;

      const stream = adapter.transformStream(prompt, context);

      for await (const chunk of stream) {
        yield chunk;
      }

      // Get final result from generator return
      const final = await stream.next();
      if (final.done && final.value) {
        streamResult = final.value;
      }

      if (!streamResult) {
        throw new AdapterError(
          'ADAPTER_ERROR',
          'Stream did not return a final result',
          false
        );
      }

      // Update latency stats
      const latency = performance.now() - startTime;
      this.totalLatency += latency;
      this.requestCount++;
      this.stats.avg_latency_ms = this.totalLatency / this.requestCount;

      // Update provider health
      this.updateProviderHealth(provider, true, latency);

      // Estimate cost (rough approximation)
      this.stats.cost_estimate += this.estimateCost(
        tier,
        streamResult.tokens_input,
        streamResult.tokens_output
      );

      return streamResult;
    } catch (error) {
      this.stats.errors++;
      this.updateProviderHealth(provider, false, 0);

      // Try fallback if enabled
      if (this.config.fallback_on_error) {
        const fallbackAdapter = this.getFallbackAdapter(tier);
        if (fallbackAdapter && fallbackAdapter !== adapter && isStreamingAdapter(fallbackAdapter)) {
          this.stats.fallbacks++;
          // For fallback, we need to collect and re-yield
          let fallbackResult: StreamResult | undefined;
          const fallbackStream = fallbackAdapter.transformStream(prompt, context);

          for await (const chunk of fallbackStream) {
            yield chunk;
          }

          const fallbackFinal = await fallbackStream.next();
          if (fallbackFinal.done && fallbackFinal.value) {
            fallbackResult = fallbackFinal.value;
          }

          if (fallbackResult) {
            return fallbackResult;
          }
        }
      }

      throw error;
    }
  }

  /**
   * Classify task type from context.
   */
  private classifyTask(context: TransformContext): TaskType {
    const mode = context.mode;
    const metadata = context.metadata as Record<string, unknown>;

    // Check explicit task type in metadata
    if (metadata.task_type && typeof metadata.task_type === 'string') {
      const explicit = metadata.task_type as string;
      if (['draft', 'refinement', 'final', 'validation', 'embedding'].includes(explicit)) {
        return explicit as TaskType;
      }
    }

    // Infer from mode
    switch (mode) {
      case 'plan-only':
        return 'draft';
      case 'clarify':
        return 'validation';
      case 'execute':
        // Check for refinement indicators
        if (metadata.attempt && (metadata.attempt as number) > 1) {
          return 'refinement';
        }
        if (metadata.repair || metadata.iteration) {
          return 'refinement';
        }
        return 'final';
      default:
        return 'standard' as unknown as TaskType;
    }
  }

  /**
   * Get adapter for tier with load balancing.
   */
  private getAdapterForTier(tier: ModelTier): ModelAdapter {
    // Direct tier lookup
    let adapter = this.adapters.get(tier);

    // If load balancing enabled and we have healthy providers
    if (this.config.load_balance && this.config.balance_providers.length > 0) {
      const healthyProviders = this.config.balance_providers.filter(
        (p) => this.providerHealth.get(p)?.available !== false
      );

      if (healthyProviders.length > 0) {
        // Round-robin selection
        const provider = healthyProviders[this.balanceIndex % healthyProviders.length];
        this.balanceIndex++;

        // Create adapter for this provider with same tier config
        const tierConfig = this.config.tiers[tier];
        if (tierConfig && provider) {
          try {
            return createAdapter({ ...tierConfig, provider });
          } catch {
            // Fall back to default
          }
        }
      }
    }

    // Fallback chain: requested tier -> standard -> any available
    if (!adapter) {
      adapter = this.adapters.get('standard');
    }
    if (!adapter) {
      adapter = this.adapters.values().next().value;
    }
    if (!adapter) {
      throw new AdapterError('INVALID_REQUEST', 'No adapters available', false);
    }

    return adapter;
  }

  /**
   * Get fallback adapter for tier.
   */
  private getFallbackAdapter(failedTier: ModelTier): ModelAdapter | null {
    const fallbackOrder: ModelTier[] = ['standard', 'economy', 'premium'];

    for (const tier of fallbackOrder) {
      if (tier !== failedTier && this.adapters.has(tier)) {
        return this.adapters.get(tier)!;
      }
    }

    return null;
  }

  /**
   * Extract provider from adapter ID.
   */
  private extractProvider(adapter: ModelAdapter): string {
    const id = adapter.adapter_id;
    // Format: provider_hash or resilient_provider_hash
    const parts = id.split('_');
    return parts[0] === 'resilient' ? parts[1] ?? 'unknown' : parts[0] ?? 'unknown';
  }

  /**
   * Update provider health status.
   */
  private updateProviderHealth(provider: string, success: boolean, latency: number): void {
    const health = this.providerHealth.get(provider as AdapterProvider);
    if (!health) return;

    // Update with exponential moving average
    const alpha = 0.1;
    health.latency_ms = alpha * latency + (1 - alpha) * health.latency_ms;
    health.error_rate = alpha * (success ? 0 : 1) + (1 - alpha) * health.error_rate;
    health.available = health.error_rate < 0.5;
    health.last_check = Date.now();
  }

  /**
   * Estimate cost for request.
   */
  private estimateCost(tier: ModelTier, inputTokens: number, outputTokens: number): number {
    // Rough cost estimates per 1M tokens
    const costs: Record<ModelTier, { input: number; output: number }> = {
      economy: { input: 0.15, output: 0.6 },
      standard: { input: 3, output: 15 },
      premium: { input: 15, output: 75 },
    };

    const tierCost = costs[tier];
    return (inputTokens / 1_000_000) * tierCost.input + (outputTokens / 1_000_000) * tierCost.output;
  }

  /**
   * Check if orchestrator is ready.
   */
  async isReady(): Promise<boolean> {
    for (const adapter of this.adapters.values()) {
      if (await adapter.isReady()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Shutdown all adapters.
   */
  async shutdown(): Promise<void> {
    const shutdowns = Array.from(this.adapters.values()).map((a) => a.shutdown());
    await Promise.all(shutdowns);
  }

  /**
   * Get orchestrator statistics.
   */
  getStats(): OrchestratorStats {
    return { ...this.stats };
  }

  /**
   * Get provider health status.
   */
  getProviderHealth(): Map<AdapterProvider, ProviderHealth> {
    return new Map(this.providerHealth);
  }

  /**
   * Manually set provider availability.
   */
  setProviderAvailable(provider: AdapterProvider, available: boolean): void {
    const health = this.providerHealth.get(provider);
    if (health) {
      health.available = available;
      health.last_check = Date.now();
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a multi-model orchestrator.
 */
export function createOrchestrator(config: OrchestratorConfig): ModelOrchestrator {
  return new ModelOrchestrator(config);
}

/**
 * Create a cost-optimized orchestrator.
 * Uses cheap models for exploration, expensive for final output.
 */
export function createCostOptimizedOrchestrator(
  economyProvider: AdapterProvider = 'google',
  premiumProvider: AdapterProvider = 'anthropic'
): ModelOrchestrator {
  return new ModelOrchestrator({
    default_provider: economyProvider,
    tiers: {
      economy: { provider: economyProvider, model: 'gemini-2.0-flash' },
      standard: { provider: economyProvider, model: 'gemini-1.5-pro' },
      premium: { provider: premiumProvider, model: 'claude-3-5-sonnet-20241022' },
    },
    task_routing: {
      draft: 'economy',
      refinement: 'economy',
      final: 'premium',
      validation: 'economy',
      embedding: 'economy',
    },
  });
}

/**
 * Create a load-balanced orchestrator across multiple providers.
 */
export function createLoadBalancedOrchestrator(
  providers: AdapterProvider[]
): ModelOrchestrator {
  if (providers.length === 0) {
    providers = ['google', 'anthropic', 'openai'];
  }

  return new ModelOrchestrator({
    default_provider: providers[0]!,
    tiers: {
      standard: { provider: providers[0]! },
    },
    load_balance: true,
    balance_providers: providers,
  });
}
