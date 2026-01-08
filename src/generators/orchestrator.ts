/**
 * Generator Orchestrator
 * ======================
 *
 * Coordinates multiple generators to process intents through the LLM pipeline.
 * This is the main entry point for LLM-powered intent processing.
 *
 * Pipeline:
 * 1. Clarify (G0) - Check if clarification is needed
 * 2. Blueprint (G3) - Generate X artifact
 * 3. BuildPlan (G4) - Generate Y artifact (future)
 * 4. Verification (G5) - Generate Z artifact (future)
 */

import type { ModelAdapter } from '../adapters/model.js';
import type {
  GeneratorContext,
  GeneratorOutput,
  ClarifierInput,
  ClarifierOutput,
  BlueprintInput,
  BlueprintOutput,
} from './types.js';
import { ClarifierGenerator } from './clarifier.js';
import { BlueprintGenerator } from './blueprint.js';

// =============================================================================
// Orchestrator Types
// =============================================================================

/**
 * Options for the orchestrator.
 */
export interface OrchestratorOptions {
  /**
   * Skip clarification step.
   * @default false
   */
  skip_clarification?: boolean;

  /**
   * Maximum clarification rounds.
   * @default 3
   */
  max_clarification_rounds?: number;

  /**
   * Auto-answer clarification questions with defaults.
   * @default false
   */
  auto_clarify?: boolean;
}

/**
 * Result of orchestrating a full intent processing.
 */
export interface OrchestratorResult {
  /**
   * Whether processing completed successfully.
   */
  success: boolean;

  /**
   * Current stage in the pipeline.
   */
  stage: 'clarify' | 'blueprint' | 'buildplan' | 'complete' | 'error';

  /**
   * Clarification result (if clarification was needed).
   */
  clarification?: GeneratorOutput<ClarifierOutput>;

  /**
   * Blueprint result (if generated).
   */
  blueprint?: GeneratorOutput<BlueprintOutput>;

  /**
   * Error message (if failed).
   */
  error?: string;

  /**
   * Total tokens used.
   */
  total_tokens: {
    input: number;
    output: number;
  };

  /**
   * Total latency in ms.
   */
  total_latency_ms: number;
}

// =============================================================================
// Generator Orchestrator
// =============================================================================

/**
 * Orchestrates multiple generators to process intents.
 */
export class GeneratorOrchestrator {
  private readonly clarifier: ClarifierGenerator;
  private readonly blueprintGen: BlueprintGenerator;
  private readonly options: Required<OrchestratorOptions>;

  constructor(options: OrchestratorOptions = {}) {
    this.clarifier = new ClarifierGenerator();
    this.blueprintGen = new BlueprintGenerator();
    this.options = {
      skip_clarification: options.skip_clarification ?? false,
      max_clarification_rounds: options.max_clarification_rounds ?? 3,
      auto_clarify: options.auto_clarify ?? false,
    };
  }

  /**
   * Check if an intent needs clarification.
   */
  async clarify(
    input: ClarifierInput,
    adapter: ModelAdapter,
    context: GeneratorContext
  ): Promise<GeneratorOutput<ClarifierOutput>> {
    return this.clarifier.generate(input, adapter, context);
  }

  /**
   * Generate a blueprint from a clarified intent.
   */
  async generateBlueprint(
    input: BlueprintInput,
    adapter: ModelAdapter,
    context: GeneratorContext
  ): Promise<GeneratorOutput<BlueprintOutput>> {
    return this.blueprintGen.generate(input, adapter, context);
  }

  /**
   * Process an intent through the full pipeline.
   *
   * @param goal - The intent goal
   * @param adapter - Model adapter to use
   * @param context - Generator context
   * @param clarifications - Pre-provided answers to clarification questions
   */
  async process(
    goal: string,
    adapter: ModelAdapter,
    context: GeneratorContext,
    clarifications?: Record<string, string>
  ): Promise<OrchestratorResult> {
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let totalLatency = 0;

    try {
      // Stage 1: Clarification (optional)
      let clarificationResult: GeneratorOutput<ClarifierOutput> | undefined;

      if (!this.options.skip_clarification) {
        const clarifyInput: ClarifierInput = {
          goal,
          constraints: context.constraints,
          context: context.metadata,
        };

        clarificationResult = await this.clarifier.generate(
          clarifyInput,
          adapter,
          context
        );

        totalTokensInput += clarificationResult.model_info.tokens_input;
        totalTokensOutput += clarificationResult.model_info.tokens_output;
        totalLatency += clarificationResult.model_info.latency_ms;

        // If clarification is needed and we don't have answers, return early
        if (
          clarificationResult.result.needs_clarification &&
          !clarifications &&
          !this.options.auto_clarify
        ) {
          return {
            success: true,
            stage: 'clarify',
            clarification: clarificationResult,
            total_tokens: {
              input: totalTokensInput,
              output: totalTokensOutput,
            },
            total_latency_ms: totalLatency,
          };
        }
      }

      // Stage 2: Blueprint Generation
      const blueprintInput: BlueprintInput = {
        goal,
        constraints: context.constraints,
        context: context.metadata,
      };
      if (clarifications) {
        blueprintInput.clarifications = clarifications;
      }

      const blueprintResult = await this.blueprintGen.generate(
        blueprintInput,
        adapter,
        context
      );

      totalTokensInput += blueprintResult.model_info.tokens_input;
      totalTokensOutput += blueprintResult.model_info.tokens_output;
      totalLatency += blueprintResult.model_info.latency_ms;

      const result: OrchestratorResult = {
        success: true,
        stage: 'blueprint',
        blueprint: blueprintResult,
        total_tokens: {
          input: totalTokensInput,
          output: totalTokensOutput,
        },
        total_latency_ms: totalLatency,
      };
      if (clarificationResult) {
        result.clarification = clarificationResult;
      }
      return result;
    } catch (error) {
      return {
        success: false,
        stage: 'error',
        error: error instanceof Error ? error.message : String(error),
        total_tokens: {
          input: totalTokensInput,
          output: totalTokensOutput,
        },
        total_latency_ms: totalLatency,
      };
    }
  }

  /**
   * Quick clarification check without full processing.
   */
  async needsClarification(
    goal: string,
    adapter: ModelAdapter,
    context: GeneratorContext
  ): Promise<boolean> {
    const result = await this.clarify(
      { goal, constraints: context.constraints },
      adapter,
      context
    );
    return result.result.needs_clarification;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new generator orchestrator.
 */
export function createOrchestrator(
  options?: OrchestratorOptions
): GeneratorOrchestrator {
  return new GeneratorOrchestrator(options);
}
