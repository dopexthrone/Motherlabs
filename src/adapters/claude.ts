/**
 * Claude Adapter
 * ==============
 *
 * Live adapter for Anthropic's Claude API.
 * Implements ModelAdapter interface for production use.
 *
 * Security:
 * - API key from environment only (never hardcoded)
 * - Keys never logged or included in errors
 * - Request/response hashing for audit trails
 */

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import {
  ModelCapabilities,
  TransformContext,
  TransformResult,
  AdapterError,
  StreamChunk,
  StreamResult,
  StreamingModelAdapter,
} from './model.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported Claude models.
 */
export type ClaudeModel =
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-20250514'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-haiku-20241022'
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307';

/**
 * Model capabilities lookup.
 */
const MODEL_CAPABILITIES: Record<ClaudeModel, ModelCapabilities> = {
  'claude-opus-4-5-20251101': {
    max_context_tokens: 200000,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'claude-sonnet-4-20250514': {
    max_context_tokens: 200000,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'claude-3-5-sonnet-20241022': {
    max_context_tokens: 200000,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'claude-3-5-haiku-20241022': {
    max_context_tokens: 200000,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'claude-3-opus-20240229': {
    max_context_tokens: 200000,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'claude-3-sonnet-20240229': {
    max_context_tokens: 200000,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'claude-3-haiku-20240307': {
    max_context_tokens: 200000,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
};

/**
 * Options for ClaudeAdapter.
 */
export interface ClaudeAdapterOptions {
  /**
   * API key. If not provided, reads from ANTHROPIC_API_KEY env var.
   */
  api_key?: string;

  /**
   * Model to use.
   * @default 'claude-3-5-sonnet-20241022'
   */
  model?: ClaudeModel;

  /**
   * Maximum number of retries for transient errors.
   * @default 3
   */
  max_retries?: number;

  /**
   * Request timeout in milliseconds.
   * @default 120000
   */
  timeout_ms?: number;

  /**
   * Base URL override (for testing/proxies).
   */
  base_url?: string;

  /**
   * Temperature for generation.
   * @default 0 (deterministic)
   */
  temperature?: number;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Claude API adapter implementing StreamingModelAdapter interface.
 */
export class ClaudeAdapter implements StreamingModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly client: Anthropic;
  private readonly model: ClaudeModel;
  private readonly max_retries: number;
  private readonly timeout_ms: number;
  private readonly temperature: number;
  private ready: boolean = false;

  constructor(options: ClaudeAdapterOptions = {}) {
    const api_key = options.api_key ?? process.env.ANTHROPIC_API_KEY;

    if (!api_key) {
      throw new AdapterError(
        'ADAPTER_ERROR',
        'ANTHROPIC_API_KEY not provided and not found in environment',
        false
      );
    }

    this.model = options.model ?? 'claude-3-5-sonnet-20241022';
    this.max_retries = options.max_retries ?? 3;
    this.timeout_ms = options.timeout_ms ?? 120000;
    this.temperature = options.temperature ?? 0;

    // Generate adapter ID from model + hash
    const hash = createHash('sha256')
      .update(`claude:${this.model}:${Date.now()}`)
      .digest('hex')
      .slice(0, 8);
    this.adapter_id = `claude_${hash}`;
    this.model_id = this.model;
    this.capabilities = MODEL_CAPABILITIES[this.model];

    // Initialize client
    this.client = new Anthropic({
      apiKey: api_key,
      baseURL: options.base_url,
      timeout: this.timeout_ms,
      maxRetries: this.max_retries,
    });

    this.ready = true;
  }

  async transform(
    prompt: string,
    context: TransformContext
  ): Promise<TransformResult> {
    if (!this.ready) {
      throw new AdapterError(
        'ADAPTER_ERROR',
        'Adapter not ready - was it shut down?',
        false
      );
    }

    const start_time = performance.now();

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.capabilities.max_output_tokens,
        temperature: this.temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        metadata: {
          user_id: context.intent_id,
        },
      });

      const latency_ms = Math.round(performance.now() - start_time);

      // Extract text content
      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      return {
        content,
        tokens_input: response.usage.input_tokens,
        tokens_output: response.usage.output_tokens,
        latency_ms,
        model_version: response.model,
        from_cache: false,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async *transformStream(
    prompt: string,
    context: TransformContext
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    if (!this.ready) {
      throw new AdapterError(
        'ADAPTER_ERROR',
        'Adapter not ready - was it shut down?',
        false
      );
    }

    const start_time = performance.now();
    let first_chunk_time: number | undefined;
    let total_content = '';
    let index = 0;
    let tokens_input = 0;
    let tokens_output = 0;

    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: this.capabilities.max_output_tokens,
        temperature: this.temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        metadata: {
          user_id: context.intent_id,
        },
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if ('text' in delta && delta.text) {
            if (first_chunk_time === undefined) {
              first_chunk_time = performance.now() - start_time;
            }

            total_content += delta.text;

            yield {
              content: delta.text,
              done: false,
              index: index++,
            };
          }
        } else if (event.type === 'message_delta') {
          // Usage info comes in message_delta
          if ('usage' in event && event.usage) {
            tokens_output = event.usage.output_tokens ?? 0;
          }
        } else if (event.type === 'message_start') {
          // Input tokens come from message_start
          if ('message' in event && event.message?.usage) {
            tokens_input = event.message.usage.input_tokens ?? 0;
          }
        }
      }

      // Get final message for accurate token counts
      const finalMessage = await stream.finalMessage();
      tokens_input = finalMessage.usage.input_tokens;
      tokens_output = finalMessage.usage.output_tokens;

      // Yield final chunk
      yield {
        content: '',
        done: true,
        tokens_so_far: tokens_output,
        index: index++,
      };

      const latency_ms = Math.round(performance.now() - start_time);

      return {
        content: total_content,
        tokens_input,
        tokens_output,
        latency_ms,
        model_version: finalMessage.model,
        from_cache: false,
        total_chunks: index,
        time_to_first_chunk_ms: Math.round(first_chunk_time ?? latency_ms),
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async isReady(): Promise<boolean> {
    return this.ready;
  }

  async shutdown(): Promise<void> {
    this.ready = false;
  }

  /**
   * Map Anthropic errors to AdapterError.
   */
  private mapError(error: unknown): AdapterError {
    if (error instanceof Anthropic.APIError) {
      const status = error.status;
      const message = error.message;

      if (status === 429) {
        return new AdapterError('RATE_LIMITED', message, true, {
          status,
        });
      }

      if (status === 408 || message.includes('timeout')) {
        return new AdapterError('TIMEOUT', message, true, { status });
      }

      if (status === 400) {
        if (message.includes('context') || message.includes('token')) {
          return new AdapterError('CONTEXT_TOO_LONG', message, false, {
            status,
          });
        }
        return new AdapterError('INVALID_REQUEST', message, false, {
          status,
        });
      }

      if (status >= 500) {
        return new AdapterError('MODEL_ERROR', message, true, { status });
      }

      return new AdapterError('ADAPTER_ERROR', message, false, { status });
    }

    if (error instanceof Error) {
      if (
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND')
      ) {
        return new AdapterError('NETWORK_ERROR', error.message, true);
      }
      return new AdapterError('ADAPTER_ERROR', error.message, false);
    }

    return new AdapterError('ADAPTER_ERROR', String(error), false);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a Claude adapter with default settings.
 */
export function createClaudeAdapter(
  model: ClaudeModel = 'claude-3-5-sonnet-20241022'
): ClaudeAdapter {
  return new ClaudeAdapter({ model });
}

/**
 * Create a Claude adapter for development (higher temperature).
 */
export function createClaudeDevAdapter(
  model: ClaudeModel = 'claude-3-5-sonnet-20241022'
): ClaudeAdapter {
  return new ClaudeAdapter({ model, temperature: 0.7 });
}

/**
 * Get capabilities for a Claude model without creating an adapter.
 */
export function getClaudeCapabilities(model: ClaudeModel): ModelCapabilities {
  return MODEL_CAPABILITIES[model];
}
