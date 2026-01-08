/**
 * Base Generator
 * ==============
 *
 * Abstract base class for all generators.
 * Provides common functionality for prompt building, response parsing, and error handling.
 */

import type { ModelAdapter, TransformContext } from '../adapters/model.js';
import type {
  Generator,
  GeneratorId,
  GeneratorContext,
  GeneratorOutput,
} from './types.js';

// =============================================================================
// Base Generator
// =============================================================================

/**
 * Abstract base class for generators.
 */
export abstract class BaseGenerator<TInput, TOutput>
  implements Generator<TInput, TOutput>
{
  abstract readonly id: GeneratorId;
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Build the prompt for this generator.
   */
  protected abstract buildPrompt(input: TInput, context: GeneratorContext): string;

  /**
   * Parse the LLM response into structured output.
   */
  protected abstract parseResponse(response: string): TOutput;

  /**
   * Get the system prompt for this generator.
   */
  protected abstract getSystemPrompt(): string;

  /**
   * Generate output using the model adapter.
   */
  async generate(
    input: TInput,
    adapter: ModelAdapter,
    context: GeneratorContext
  ): Promise<GeneratorOutput<TOutput>> {
    // Build the full prompt
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.buildPrompt(input, context);
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    // Create transform context
    const transformContext: TransformContext = {
      intent_id: context.intent_id,
      run_id: context.run_id,
      mode: context.mode,
      constraints: context.constraints,
      metadata: {
        generator_id: this.id,
        generator_name: this.name,
        ...context.metadata,
      },
    };

    // Call the model
    const result = await adapter.transform(fullPrompt, transformContext);

    // Parse the response
    let parsedResult: TOutput;
    let parsed = true;
    const parseErrors: string[] = [];

    try {
      parsedResult = this.parseResponse(result.content);
    } catch (error) {
      parsed = false;
      parseErrors.push(
        error instanceof Error ? error.message : String(error)
      );
      // Return a default/empty result
      parsedResult = this.getDefaultOutput();
    }

    const output: GeneratorOutput<TOutput> = {
      result: parsedResult,
      raw_response: result.content,
      model_info: {
        model_id: adapter.model_id,
        tokens_input: result.tokens_input,
        tokens_output: result.tokens_output,
        latency_ms: result.latency_ms,
      },
      parsed,
    };
    if (parseErrors.length > 0) {
      output.parse_errors = parseErrors;
    }
    return output;
  }

  /**
   * Get a default output when parsing fails.
   */
  protected abstract getDefaultOutput(): TOutput;
}

// =============================================================================
// Prompt Utilities
// =============================================================================

/**
 * Extract JSON from a response that may contain markdown code blocks.
 */
export function extractJSON(response: string): string {
  // Try to find JSON in code blocks first
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON (object or array)
  const jsonMatch = response.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }

  // Return as-is
  return response.trim();
}

/**
 * Parse JSON safely with error handling.
 */
export function parseJSON<T>(json: string): T {
  const extracted = extractJSON(json);
  return JSON.parse(extracted) as T;
}

/**
 * Build a structured prompt with sections.
 */
export function buildStructuredPrompt(sections: PromptSection[]): string {
  return sections
    .filter((s) => s.content.trim().length > 0)
    .map((s) => `## ${s.title}\n\n${s.content}`)
    .join('\n\n');
}

/**
 * A section in a structured prompt.
 */
export interface PromptSection {
  title: string;
  content: string;
}
