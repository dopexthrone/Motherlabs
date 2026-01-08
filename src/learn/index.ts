/**
 * Prompt Learning / Refinement
 * ============================
 *
 * Learn from generation outcomes to refine prompts over time.
 * Tracks what works and applies lessons learned to future prompts.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A recorded generation outcome for learning.
 */
export interface GenerationOutcome {
  /**
   * The original prompt.
   */
  prompt: string;

  /**
   * Language used.
   */
  language: string;

  /**
   * Whether generation succeeded (passed verification/eval).
   */
  succeeded: boolean;

  /**
   * Confidence score.
   */
  confidence: number;

  /**
   * Error type if failed.
   */
  error_type?: string;

  /**
   * Error message if failed.
   */
  error_message?: string;

  /**
   * Was repair needed?
   */
  needed_repair?: boolean;

  /**
   * Did repair succeed?
   */
  repair_succeeded?: boolean;

  /**
   * Timestamp.
   */
  timestamp: number;
}

/**
 * A learned prompt pattern.
 */
export interface PromptPattern {
  /**
   * Pattern identifier.
   */
  id: string;

  /**
   * Description of when to apply.
   */
  description: string;

  /**
   * Keywords that trigger this pattern.
   */
  triggers: string[];

  /**
   * Additions to make to the prompt.
   */
  additions: string[];

  /**
   * Success rate when this pattern is used.
   */
  success_rate: number;

  /**
   * Number of times applied.
   */
  applications: number;
}

/**
 * Prompt refinement suggestion.
 */
export interface RefinementSuggestion {
  /**
   * Type of refinement.
   */
  type: 'add_constraint' | 'add_example' | 'clarify_requirement' | 'add_edge_case' | 'specify_type';

  /**
   * What to add/change.
   */
  content: string;

  /**
   * Confidence in this suggestion (0-1).
   */
  confidence: number;

  /**
   * Why this is suggested.
   */
  reason: string;
}

/**
 * Learned insights from generation history.
 */
export interface LearningInsights {
  /**
   * Overall success rate.
   */
  success_rate: number;

  /**
   * Most common error types.
   */
  common_errors: Array<{ type: string; count: number; rate: number }>;

  /**
   * Patterns that improve success.
   */
  helpful_patterns: PromptPattern[];

  /**
   * Suggested improvements.
   */
  suggestions: RefinementSuggestion[];
}

// =============================================================================
// Prompt Learner
// =============================================================================

/**
 * Learns from generation outcomes to improve prompts.
 */
export class PromptLearner {
  private outcomes: GenerationOutcome[] = [];
  private patterns: Map<string, PromptPattern> = new Map();
  private maxHistory: number;

  constructor(maxHistory: number = 1000) {
    this.maxHistory = maxHistory;
    this.initializeBuiltinPatterns();
  }

  /**
   * Initialize built-in patterns based on common issues.
   */
  private initializeBuiltinPatterns(): void {
    const builtins: PromptPattern[] = [
      {
        id: 'edge_cases',
        description: 'Handle edge cases explicitly',
        triggers: ['edge', 'empty', 'null', 'zero', 'negative'],
        additions: ['Handle edge cases: empty inputs, null values, and boundary conditions'],
        success_rate: 0.85,
        applications: 0,
      },
      {
        id: 'type_hints',
        description: 'Add type annotations',
        triggers: ['type', 'typed', 'annotation', 'hint'],
        additions: ['Include complete type annotations for all parameters and return values'],
        success_rate: 0.9,
        applications: 0,
      },
      {
        id: 'error_handling',
        description: 'Explicit error handling',
        triggers: ['error', 'exception', 'fail', 'invalid'],
        additions: ['Handle errors gracefully with try-catch blocks and meaningful error messages'],
        success_rate: 0.8,
        applications: 0,
      },
      {
        id: 'input_validation',
        description: 'Validate inputs',
        triggers: ['validate', 'check', 'verify', 'sanitize'],
        additions: ['Validate all inputs before processing and raise appropriate exceptions for invalid data'],
        success_rate: 0.85,
        applications: 0,
      },
      {
        id: 'async_handling',
        description: 'Proper async patterns',
        triggers: ['async', 'await', 'promise', 'concurrent'],
        additions: ['Use async/await consistently and handle promise rejections'],
        success_rate: 0.75,
        applications: 0,
      },
      {
        id: 'immutability',
        description: 'Prefer immutable operations',
        triggers: ['immutable', 'pure', 'functional'],
        additions: ['Prefer immutable operations and avoid mutating input parameters'],
        success_rate: 0.7,
        applications: 0,
      },
    ];

    for (const pattern of builtins) {
      this.patterns.set(pattern.id, pattern);
    }
  }

  /**
   * Record a generation outcome.
   */
  record(outcome: GenerationOutcome): void {
    this.outcomes.push(outcome);

    // Trim history if needed
    if (this.outcomes.length > this.maxHistory) {
      this.outcomes = this.outcomes.slice(-this.maxHistory);
    }

    // Update pattern statistics
    this.updatePatternStats(outcome);
  }

  /**
   * Update pattern statistics based on outcome.
   */
  private updatePatternStats(outcome: GenerationOutcome): void {
    const promptLower = outcome.prompt.toLowerCase();

    for (const pattern of this.patterns.values()) {
      // Check if any trigger matches
      const triggered = pattern.triggers.some((t) => promptLower.includes(t.toLowerCase()));

      if (triggered) {
        // Update success rate using exponential moving average
        const alpha = 0.1; // Learning rate
        pattern.success_rate =
          alpha * (outcome.succeeded ? 1 : 0) + (1 - alpha) * pattern.success_rate;
        pattern.applications++;
      }
    }
  }

  /**
   * Analyze history and get insights.
   */
  getInsights(): LearningInsights {
    const total = this.outcomes.length;
    if (total === 0) {
      return {
        success_rate: 0,
        common_errors: [],
        helpful_patterns: [],
        suggestions: [],
      };
    }

    // Calculate success rate
    const successes = this.outcomes.filter((o) => o.succeeded).length;
    const success_rate = successes / total;

    // Find common errors
    const errorCounts = new Map<string, number>();
    for (const outcome of this.outcomes) {
      if (!outcome.succeeded && outcome.error_type) {
        errorCounts.set(outcome.error_type, (errorCounts.get(outcome.error_type) ?? 0) + 1);
      }
    }

    const common_errors = Array.from(errorCounts.entries())
      .map(([type, count]) => ({
        type,
        count,
        rate: count / (total - successes || 1),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Find helpful patterns (high success rate + used enough)
    const helpful_patterns = Array.from(this.patterns.values())
      .filter((p) => p.applications >= 5 && p.success_rate > 0.7)
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, 5);

    // Generate suggestions based on patterns
    const suggestions = this.generateSuggestions(common_errors, helpful_patterns);

    return {
      success_rate,
      common_errors,
      helpful_patterns,
      suggestions,
    };
  }

  /**
   * Generate refinement suggestions.
   */
  private generateSuggestions(
    commonErrors: Array<{ type: string; count: number; rate: number }>,
    _helpfulPatterns: PromptPattern[]
  ): RefinementSuggestion[] {
    const suggestions: RefinementSuggestion[] = [];

    // Suggest based on common error types
    for (const error of commonErrors) {
      if (error.type === 'syntax_error') {
        suggestions.push({
          type: 'clarify_requirement',
          content: 'Be explicit about syntax requirements and expected code structure',
          confidence: 0.8,
          reason: `${error.count} syntax errors detected`,
        });
      } else if (error.type === 'type_error') {
        suggestions.push({
          type: 'specify_type',
          content: 'Include specific type signatures in the prompt',
          confidence: 0.85,
          reason: `${error.count} type errors detected`,
        });
      } else if (error.type === 'test_failure') {
        suggestions.push({
          type: 'add_edge_case',
          content: 'Add explicit handling for edge cases like empty inputs, null values, and boundaries',
          confidence: 0.75,
          reason: `${error.count} test failures detected`,
        });
      } else if (error.type === 'runtime_error') {
        suggestions.push({
          type: 'add_constraint',
          content: 'Add error handling requirements to the prompt',
          confidence: 0.7,
          reason: `${error.count} runtime errors detected`,
        });
      }
    }

    return suggestions;
  }

  /**
   * Refine a prompt based on learned patterns.
   */
  refine(originalPrompt: string, language: string): string {
    const sections: string[] = [originalPrompt];
    const appliedPatterns: string[] = [];
    const promptLower = originalPrompt.toLowerCase();

    // Apply relevant patterns
    for (const pattern of this.patterns.values()) {
      // Check if pattern should apply
      const shouldApply =
        pattern.success_rate > 0.6 &&
        pattern.triggers.some((t) => promptLower.includes(t.toLowerCase()));

      if (shouldApply && pattern.additions.length > 0) {
        for (const addition of pattern.additions) {
          if (!promptLower.includes(addition.toLowerCase())) {
            appliedPatterns.push(addition);
          }
        }
      }
    }

    // Add learned requirements if any
    if (appliedPatterns.length > 0) {
      sections.push('\n\n## Additional Requirements (learned from previous generations)');
      for (const addition of appliedPatterns) {
        sections.push(`- ${addition}`);
      }
    }

    // Add language-specific hints
    const languageHints = this.getLanguageHints(language);
    if (languageHints.length > 0) {
      sections.push(`\n\n## ${language} Best Practices`);
      for (const hint of languageHints) {
        sections.push(`- ${hint}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Get language-specific hints.
   */
  private getLanguageHints(language: string): string[] {
    const hints: string[] = [];

    if (language === 'python') {
      // Check if type errors are common
      const typeErrorRate = this.getErrorRate('type_error');
      if (typeErrorRate > 0.1) {
        hints.push('Use type hints for all function parameters and return values');
      }

      const runtimeErrorRate = this.getErrorRate('runtime_error');
      if (runtimeErrorRate > 0.1) {
        hints.push('Handle None values explicitly');
      }
    } else if (language === 'typescript' || language === 'javascript') {
      const typeErrorRate = this.getErrorRate('type_error');
      if (typeErrorRate > 0.1) {
        hints.push('Provide complete TypeScript type annotations');
      }

      const undefinedRate = this.getErrorRate('undefined_reference');
      if (undefinedRate > 0.1) {
        hints.push('Handle undefined and null values with optional chaining or guards');
      }
    }

    return hints;
  }

  /**
   * Get error rate for a specific error type.
   */
  private getErrorRate(errorType: string): number {
    const recent = this.outcomes.slice(-100); // Last 100 outcomes
    if (recent.length === 0) return 0;

    const failures = recent.filter((o) => !o.succeeded);
    if (failures.length === 0) return 0;

    const typeFailures = failures.filter((o) => o.error_type === errorType).length;
    return typeFailures / recent.length;
  }

  /**
   * Export learned patterns for persistence.
   */
  exportPatterns(): PromptPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Import patterns from persistence.
   */
  importPatterns(patterns: PromptPattern[]): void {
    for (const pattern of patterns) {
      this.patterns.set(pattern.id, pattern);
    }
  }

  /**
   * Add a custom pattern.
   */
  addPattern(pattern: PromptPattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  /**
   * Get statistics.
   */
  getStats(): {
    total_outcomes: number;
    success_rate: number;
    patterns_count: number;
    most_applied_pattern?: string;
  } {
    const total = this.outcomes.length;
    const successes = this.outcomes.filter((o) => o.succeeded).length;

    // Find most applied pattern
    let mostApplied: PromptPattern | undefined;
    for (const pattern of this.patterns.values()) {
      if (!mostApplied || pattern.applications > mostApplied.applications) {
        mostApplied = pattern;
      }
    }

    const result: ReturnType<typeof this.getStats> = {
      total_outcomes: total,
      success_rate: total > 0 ? successes / total : 0,
      patterns_count: this.patterns.size,
    };

    if (mostApplied && mostApplied.applications > 0) {
      result.most_applied_pattern = mostApplied.id;
    }

    return result;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a prompt learner.
 */
export function createPromptLearner(maxHistory: number = 1000): PromptLearner {
  return new PromptLearner(maxHistory);
}

// =============================================================================
// Quick API
// =============================================================================

/**
 * Quick refine - apply learned patterns to a prompt.
 */
export function quickRefine(
  prompt: string,
  language: string,
  learner: PromptLearner
): string {
  return learner.refine(prompt, language);
}

/**
 * Analyze outcomes and get suggestions.
 */
export function analyzOutcomes(outcomes: GenerationOutcome[]): LearningInsights {
  const learner = createPromptLearner();
  for (const outcome of outcomes) {
    learner.record(outcome);
  }
  return learner.getInsights();
}
