/**
 * Cost Tracking
 * =============
 *
 * Track API costs and enforce budgets.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Model pricing (per 1M tokens).
 */
export interface ModelPricing {
  /**
   * Input token price per 1M tokens.
   */
  input_per_million: number;

  /**
   * Output token price per 1M tokens.
   */
  output_per_million: number;

  /**
   * Currency (default USD).
   */
  currency?: string;
}

/**
 * Cost entry for tracking.
 */
export interface CostEntry {
  /**
   * Request ID.
   */
  request_id: string;

  /**
   * Model used.
   */
  model: string;

  /**
   * Input tokens.
   */
  input_tokens: number;

  /**
   * Output tokens.
   */
  output_tokens: number;

  /**
   * Total cost.
   */
  cost: number;

  /**
   * Timestamp.
   */
  timestamp: number;

  /**
   * Optional tags for categorization.
   */
  tags?: string[];
}

/**
 * Cost report.
 */
export interface CostReport {
  /**
   * Total cost.
   */
  total_cost: number;

  /**
   * Total input tokens.
   */
  total_input_tokens: number;

  /**
   * Total output tokens.
   */
  total_output_tokens: number;

  /**
   * Number of requests.
   */
  total_requests: number;

  /**
   * Cost by model.
   */
  by_model: Record<string, { cost: number; requests: number; tokens: number }>;

  /**
   * Cost by tag.
   */
  by_tag: Record<string, { cost: number; requests: number }>;

  /**
   * Average cost per request.
   */
  avg_cost_per_request: number;

  /**
   * Budget remaining (if set).
   */
  budget_remaining?: number;

  /**
   * Period start.
   */
  period_start: number;

  /**
   * Period end.
   */
  period_end: number;
}

/**
 * Budget configuration.
 */
export interface BudgetConfig {
  /**
   * Maximum spend for the period.
   */
  max_spend: number;

  /**
   * Period in milliseconds.
   */
  period_ms: number;

  /**
   * Action when budget exceeded.
   */
  on_exceed: 'warn' | 'block' | 'throttle';

  /**
   * Warning threshold (0-1).
   */
  warning_threshold?: number;
}

// =============================================================================
// Model Pricing Database
// =============================================================================

/**
 * Known model pricing (as of Jan 2025).
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-3-opus': { input_per_million: 15, output_per_million: 75 },
  'claude-3-sonnet': { input_per_million: 3, output_per_million: 15 },
  'claude-3-haiku': { input_per_million: 0.25, output_per_million: 1.25 },
  'claude-3.5-sonnet': { input_per_million: 3, output_per_million: 15 },
  'claude-sonnet-4': { input_per_million: 3, output_per_million: 15 },
  'claude-opus-4': { input_per_million: 15, output_per_million: 75 },

  // OpenAI
  'gpt-4-turbo': { input_per_million: 10, output_per_million: 30 },
  'gpt-4o': { input_per_million: 5, output_per_million: 15 },
  'gpt-4o-mini': { input_per_million: 0.15, output_per_million: 0.6 },
  'o1': { input_per_million: 15, output_per_million: 60 },
  'o1-mini': { input_per_million: 3, output_per_million: 12 },

  // Google
  'gemini-1.5-pro': { input_per_million: 1.25, output_per_million: 5 },
  'gemini-1.5-flash': { input_per_million: 0.075, output_per_million: 0.3 },
  'gemini-2.0-flash': { input_per_million: 0.1, output_per_million: 0.4 },
};

// =============================================================================
// Cost Tracker
// =============================================================================

/**
 * Cost tracker.
 */
export class CostTracker {
  private entries: CostEntry[] = [];
  private budget?: BudgetConfig;
  private periodStart: number;

  constructor(budget?: BudgetConfig) {
    if (budget) {
      this.budget = budget;
    }
    this.periodStart = Date.now();
  }

  /**
   * Calculate cost for tokens.
   */
  calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const pricing = this.getPricing(model);

    const inputCost = (inputTokens / 1_000_000) * pricing.input_per_million;
    const outputCost = (outputTokens / 1_000_000) * pricing.output_per_million;

    return inputCost + outputCost;
  }

  /**
   * Record a request's cost.
   */
  record(
    requestId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    tags?: string[]
  ): CostEntry {
    const cost = this.calculateCost(model, inputTokens, outputTokens);

    const entry: CostEntry = {
      request_id: requestId,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost,
      timestamp: Date.now(),
    };
    if (tags && tags.length > 0) {
      entry.tags = tags;
    }

    this.entries.push(entry);

    // Check budget
    if (this.budget) {
      this.checkBudget();
    }

    return entry;
  }

  /**
   * Check if a request can proceed under budget.
   * Returns estimated cost or throws if blocked.
   */
  checkBudgetForRequest(
    model: string,
    estimatedInputTokens: number,
    estimatedOutputTokens: number
  ): { canProceed: boolean; estimatedCost: number; budgetRemaining?: number } {
    const estimatedCost = this.calculateCost(
      model,
      estimatedInputTokens,
      estimatedOutputTokens
    );

    if (!this.budget) {
      return { canProceed: true, estimatedCost };
    }

    const currentSpend = this.getCurrentPeriodSpend();
    const remaining = this.budget.max_spend - currentSpend;

    if (currentSpend + estimatedCost > this.budget.max_spend) {
      if (this.budget.on_exceed === 'block') {
        return {
          canProceed: false,
          estimatedCost,
          budgetRemaining: remaining,
        };
      }
    }

    return {
      canProceed: true,
      estimatedCost,
      budgetRemaining: remaining,
    };
  }

  /**
   * Get cost report for current period.
   */
  getReport(): CostReport {
    this.cleanupOldEntries();

    const periodEntries = this.getEntriesInPeriod();

    const report: CostReport = {
      total_cost: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_requests: periodEntries.length,
      by_model: {},
      by_tag: {},
      avg_cost_per_request: 0,
      period_start: this.periodStart,
      period_end: Date.now(),
    };

    for (const entry of periodEntries) {
      report.total_cost += entry.cost;
      report.total_input_tokens += entry.input_tokens;
      report.total_output_tokens += entry.output_tokens;

      // By model
      if (!report.by_model[entry.model]) {
        report.by_model[entry.model] = { cost: 0, requests: 0, tokens: 0 };
      }
      report.by_model[entry.model]!.cost += entry.cost;
      report.by_model[entry.model]!.requests++;
      report.by_model[entry.model]!.tokens += entry.input_tokens + entry.output_tokens;

      // By tag
      if (entry.tags) {
        for (const tag of entry.tags) {
          if (!report.by_tag[tag]) {
            report.by_tag[tag] = { cost: 0, requests: 0 };
          }
          report.by_tag[tag]!.cost += entry.cost;
          report.by_tag[tag]!.requests++;
        }
      }
    }

    if (periodEntries.length > 0) {
      report.avg_cost_per_request = report.total_cost / periodEntries.length;
    }

    if (this.budget) {
      report.budget_remaining = Math.max(0, this.budget.max_spend - report.total_cost);
    }

    return report;
  }

  /**
   * Get current period spend.
   */
  getCurrentPeriodSpend(): number {
    const periodEntries = this.getEntriesInPeriod();
    return periodEntries.reduce((sum, e) => sum + e.cost, 0);
  }

  /**
   * Set budget configuration.
   */
  setBudget(budget: BudgetConfig): void {
    this.budget = budget;
    this.resetPeriod();
  }

  /**
   * Reset the period.
   */
  resetPeriod(): void {
    this.periodStart = Date.now();
    this.entries = [];
  }

  /**
   * Get pricing for a model.
   */
  private getPricing(model: string): ModelPricing {
    // Try exact match first
    if (MODEL_PRICING[model]) {
      return MODEL_PRICING[model]!;
    }

    // Try partial match
    const modelLower = model.toLowerCase();
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (modelLower.includes(key) || key.includes(modelLower)) {
        return pricing;
      }
    }

    // Default pricing (conservative estimate)
    return { input_per_million: 10, output_per_million: 30 };
  }

  /**
   * Get entries in current period.
   */
  private getEntriesInPeriod(): CostEntry[] {
    if (!this.budget) {
      return this.entries;
    }

    const periodStart = this.periodStart;
    return this.entries.filter((e) => e.timestamp >= periodStart);
  }

  /**
   * Check budget and emit warnings/errors.
   */
  private checkBudget(): void {
    if (!this.budget) return;

    const currentSpend = this.getCurrentPeriodSpend();
    const threshold = this.budget.warning_threshold ?? 0.8;

    if (currentSpend >= this.budget.max_spend) {
      if (this.budget.on_exceed === 'block') {
        throw new BudgetExceededError(
          `Budget exceeded: $${currentSpend.toFixed(2)} / $${this.budget.max_spend.toFixed(2)}`
        );
      } else {
        console.warn(
          `[CostTracker] Budget exceeded: $${currentSpend.toFixed(2)} / $${this.budget.max_spend.toFixed(2)}`
        );
      }
    } else if (currentSpend >= this.budget.max_spend * threshold) {
      console.warn(
        `[CostTracker] Budget warning: $${currentSpend.toFixed(2)} / $${this.budget.max_spend.toFixed(2)} (${Math.round((currentSpend / this.budget.max_spend) * 100)}%)`
      );
    }
  }

  /**
   * Cleanup old entries outside the budget period.
   */
  private cleanupOldEntries(): void {
    if (!this.budget) return;

    const cutoff = Date.now() - this.budget.period_ms * 2;
    this.entries = this.entries.filter((e) => e.timestamp > cutoff);
  }
}

/**
 * Budget exceeded error.
 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a cost tracker.
 */
export function createCostTracker(budget?: BudgetConfig): CostTracker {
  return new CostTracker(budget);
}

/**
 * Create a cost tracker with a daily budget.
 */
export function createDailyBudgetTracker(
  maxSpendPerDay: number,
  onExceed: 'warn' | 'block' | 'throttle' = 'warn'
): CostTracker {
  return createCostTracker({
    max_spend: maxSpendPerDay,
    period_ms: 24 * 60 * 60 * 1000, // 24 hours
    on_exceed: onExceed,
    warning_threshold: 0.8,
  });
}
