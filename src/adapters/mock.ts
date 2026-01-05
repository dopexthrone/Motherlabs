/**
 * Mock Model Adapter
 * ==================
 *
 * Returns pre-configured responses for deterministic testing.
 * Does not make any network calls.
 *
 * Usage:
 * ```typescript
 * const responses = new Map([
 *   ['prompt_hash_1', { content: 'response 1', ... }],
 *   ['prompt_hash_2', { content: 'response 2', ... }],
 * ]);
 * const adapter = new MockModelAdapter(responses);
 * ```
 */

import { createHash } from 'node:crypto';
import type {
  ModelAdapter,
  ModelCapabilities,
  TransformContext,
  TransformResult,
  RecordedInteraction,
  RecordingSession,
} from './model.js';
import { AdapterError } from './model.js';

// =============================================================================
// Mock Response Configuration
// =============================================================================

/**
 * Configuration for a mock response.
 */
export interface MockResponse {
  /**
   * The content to return.
   */
  content: string;

  /**
   * Simulated input tokens (default: estimate from prompt).
   */
  tokens_input?: number;

  /**
   * Simulated output tokens (default: estimate from content).
   */
  tokens_output?: number;

  /**
   * Simulated latency in ms (default: 0).
   */
  latency_ms?: number;
}

/**
 * Default response when no match is found.
 */
export interface MockDefaultBehavior {
  /**
   * How to handle unmatched prompts.
   */
  type: 'error' | 'echo' | 'fixed';

  /**
   * Fixed response content (for type: 'fixed').
   */
  content?: string;
}

/**
 * Options for MockModelAdapter.
 */
export interface MockModelAdapterOptions {
  /**
   * Model ID to report (default: 'mock').
   */
  model_id?: string;

  /**
   * Capabilities to report.
   */
  capabilities?: Partial<ModelCapabilities>;

  /**
   * How to handle unmatched prompts (default: 'error').
   */
  default_behavior?: MockDefaultBehavior;

  /**
   * Whether to record interactions (default: false).
   */
  record?: boolean;
}

// =============================================================================
// Mock Model Adapter Implementation
// =============================================================================

/**
 * Mock model adapter for testing.
 *
 * Responses can be configured by:
 * 1. Exact prompt hash match
 * 2. Prompt substring match
 * 3. Default behavior (error, echo, or fixed response)
 */
export class MockModelAdapter implements ModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly responses: Map<string, MockResponse>;
  private readonly substringMatches: Map<string, MockResponse>;
  private readonly defaultBehavior: MockDefaultBehavior;
  private readonly shouldRecord: boolean;
  private readonly recordedInteractions: RecordedInteraction[] = [];
  private sequence = 0;
  private ready = true;

  constructor(
    responses: Map<string, MockResponse> = new Map(),
    options: MockModelAdapterOptions = {}
  ) {
    this.responses = responses;
    this.substringMatches = new Map();
    this.model_id = options.model_id ?? 'mock';
    this.adapter_id = `mock_${this.hashString(this.model_id).slice(0, 8)}`;
    this.defaultBehavior = options.default_behavior ?? { type: 'error' };
    this.shouldRecord = options.record ?? false;

    this.capabilities = {
      max_context_tokens: options.capabilities?.max_context_tokens ?? 100000,
      max_output_tokens: options.capabilities?.max_output_tokens ?? 4096,
      supports_structured_output: options.capabilities?.supports_structured_output ?? true,
      supports_tool_use: options.capabilities?.supports_tool_use ?? false,
      supports_streaming: options.capabilities?.supports_streaming ?? false,
    };
  }

  /**
   * Add a response for a specific prompt hash.
   */
  addResponse(promptOrHash: string, response: MockResponse): void {
    // If it looks like a hash, use directly; otherwise hash the prompt
    const key = promptOrHash.length === 64 && /^[a-f0-9]+$/.test(promptOrHash)
      ? promptOrHash
      : this.hashString(promptOrHash);
    this.responses.set(key, response);
  }

  /**
   * Add a response that matches any prompt containing the substring.
   */
  addSubstringMatch(substring: string, response: MockResponse): void {
    this.substringMatches.set(substring, response);
  }

  /**
   * Clear all configured responses.
   */
  clearResponses(): void {
    this.responses.clear();
    this.substringMatches.clear();
  }

  /**
   * Get recorded interactions (if recording enabled).
   */
  getRecordedInteractions(): readonly RecordedInteraction[] {
    return this.recordedInteractions;
  }

  /**
   * Export recording as a session.
   */
  exportRecording(): RecordingSession {
    const now = new Date().toISOString();
    const stats = this.recordedInteractions.reduce(
      (acc, i) => ({
        total_interactions: acc.total_interactions + 1,
        total_tokens_input: acc.total_tokens_input + i.result.tokens_input,
        total_tokens_output: acc.total_tokens_output + i.result.tokens_output,
        total_latency_ms: acc.total_latency_ms + i.result.latency_ms,
      }),
      { total_interactions: 0, total_tokens_input: 0, total_tokens_output: 0, total_latency_ms: 0 }
    );

    return {
      format_version: '1.0',
      started_at: this.recordedInteractions[0]?.recorded_at ?? now,
      ended_at: now,
      model_id: this.model_id,
      interactions: [...this.recordedInteractions],
      stats,
    };
  }

  async transform(prompt: string, context: TransformContext): Promise<TransformResult> {
    if (!this.ready) {
      throw new AdapterError('ADAPTER_ERROR', 'Adapter is not ready', false);
    }

    const promptHash = this.hashString(prompt);
    let response: MockResponse | undefined;

    // Try exact hash match first
    response = this.responses.get(promptHash);

    // Try substring matches
    if (!response) {
      for (const [substring, resp] of this.substringMatches) {
        if (prompt.includes(substring)) {
          response = resp;
          break;
        }
      }
    }

    // Apply default behavior if no match
    if (!response) {
      switch (this.defaultBehavior.type) {
        case 'error':
          throw new AdapterError(
            'REPLAY_MISS',
            `No mock response for prompt hash: ${promptHash}`,
            false,
            { prompt_preview: prompt.slice(0, 100) }
          );
        case 'echo':
          response = { content: prompt };
          break;
        case 'fixed':
          response = { content: this.defaultBehavior.content ?? '' };
          break;
      }
    }

    // Estimate tokens if not provided
    const tokens_input = response.tokens_input ?? Math.ceil(prompt.length / 4);
    const tokens_output = response.tokens_output ?? Math.ceil(response.content.length / 4);
    const latency_ms = response.latency_ms ?? 0;

    const result: TransformResult = {
      content: response.content,
      tokens_input,
      tokens_output,
      latency_ms,
      model_version: `${this.model_id}-mock`,
      from_cache: true,
    };

    // Record if enabled
    if (this.shouldRecord) {
      this.recordedInteractions.push({
        sequence: this.sequence++,
        prompt_hash: promptHash,
        prompt,
        context,
        result,
        recorded_at: new Date().toISOString(),
      });
    }

    return result;
  }

  async isReady(): Promise<boolean> {
    return this.ready;
  }

  async shutdown(): Promise<void> {
    this.ready = false;
  }

  /**
   * Reset the adapter to ready state (for testing).
   */
  reset(): void {
    this.ready = true;
    this.sequence = 0;
    this.recordedInteractions.length = 0;
  }

  private hashString(s: string): string {
    return createHash('sha256').update(s, 'utf-8').digest('hex');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a mock adapter that echoes prompts back.
 */
export function createEchoAdapter(options?: Omit<MockModelAdapterOptions, 'default_behavior'>): MockModelAdapter {
  return new MockModelAdapter(new Map(), {
    ...options,
    default_behavior: { type: 'echo' },
  });
}

/**
 * Create a mock adapter that returns a fixed response.
 */
export function createFixedAdapter(
  content: string,
  options?: Omit<MockModelAdapterOptions, 'default_behavior'>
): MockModelAdapter {
  return new MockModelAdapter(new Map(), {
    ...options,
    default_behavior: { type: 'fixed', content },
  });
}

/**
 * Create a mock adapter from a recording session.
 */
export function createAdapterFromRecording(
  session: RecordingSession,
  options?: MockModelAdapterOptions
): MockModelAdapter {
  const responses = new Map<string, MockResponse>();

  for (const interaction of session.interactions) {
    responses.set(interaction.prompt_hash, {
      content: interaction.result.content,
      tokens_input: interaction.result.tokens_input,
      tokens_output: interaction.result.tokens_output,
      latency_ms: 0, // Don't replay latency
    });
  }

  return new MockModelAdapter(responses, {
    model_id: session.model_id,
    ...options,
  });
}
