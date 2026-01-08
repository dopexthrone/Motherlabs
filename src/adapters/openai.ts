/**
 * OpenAI Adapter
 * ==============
 *
 * Live adapter for OpenAI's API.
 * Implements ModelAdapter interface for production use.
 *
 * Security:
 * - API key from environment only (never hardcoded)
 * - Keys never logged or included in errors
 * - Request/response hashing for audit trails
 */

import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import {
  ModelAdapter,
  ModelCapabilities,
  TransformContext,
  TransformResult,
  AdapterError,
} from './model.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported OpenAI models.
 */
export type OpenAIModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-4-turbo-preview'
  | 'gpt-4'
  | 'gpt-3.5-turbo'
  | 'o1'
  | 'o1-mini'
  | 'o1-preview';

/**
 * Model capabilities lookup.
 */
const MODEL_CAPABILITIES: Record<OpenAIModel, ModelCapabilities> = {
  'gpt-4o': {
    max_context_tokens: 128000,
    max_output_tokens: 16384,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gpt-4o-mini': {
    max_context_tokens: 128000,
    max_output_tokens: 16384,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gpt-4-turbo': {
    max_context_tokens: 128000,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gpt-4-turbo-preview': {
    max_context_tokens: 128000,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gpt-4': {
    max_context_tokens: 8192,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gpt-3.5-turbo': {
    max_context_tokens: 16385,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  o1: {
    max_context_tokens: 200000,
    max_output_tokens: 100000,
    supports_structured_output: false,
    supports_tool_use: false,
    supports_streaming: false,
  },
  'o1-mini': {
    max_context_tokens: 128000,
    max_output_tokens: 65536,
    supports_structured_output: false,
    supports_tool_use: false,
    supports_streaming: false,
  },
  'o1-preview': {
    max_context_tokens: 128000,
    max_output_tokens: 32768,
    supports_structured_output: false,
    supports_tool_use: false,
    supports_streaming: false,
  },
};

/**
 * Options for OpenAIAdapter.
 */
export interface OpenAIAdapterOptions {
  /**
   * API key. If not provided, reads from OPENAI_API_KEY env var.
   */
  api_key?: string;

  /**
   * Organization ID. If not provided, reads from OPENAI_ORG_ID env var.
   */
  organization_id?: string;

  /**
   * Model to use.
   * @default 'gpt-4o'
   */
  model?: OpenAIModel;

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
 * OpenAI API adapter implementing ModelAdapter interface.
 */
export class OpenAIAdapter implements ModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly client: OpenAI;
  private readonly model: OpenAIModel;
  private readonly max_retries: number;
  private readonly timeout_ms: number;
  private readonly temperature: number;
  private ready: boolean = false;

  constructor(options: OpenAIAdapterOptions = {}) {
    const api_key = options.api_key ?? process.env.OPENAI_API_KEY;

    if (!api_key) {
      throw new AdapterError(
        'ADAPTER_ERROR',
        'OPENAI_API_KEY not provided and not found in environment',
        false
      );
    }

    this.model = options.model ?? 'gpt-4o';
    this.max_retries = options.max_retries ?? 3;
    this.timeout_ms = options.timeout_ms ?? 120000;
    this.temperature = options.temperature ?? 0;

    // Generate adapter ID from model + hash
    const hash = createHash('sha256')
      .update(`openai:${this.model}:${Date.now()}`)
      .digest('hex')
      .slice(0, 8);
    this.adapter_id = `openai_${hash}`;
    this.model_id = this.model;
    this.capabilities = MODEL_CAPABILITIES[this.model];

    // Initialize client
    this.client = new OpenAI({
      apiKey: api_key,
      organization: options.organization_id ?? process.env.OPENAI_ORG_ID,
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
      // o1 models don't support temperature/system messages
      const isO1Model = this.model.startsWith('o1');

      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: this.capabilities.max_output_tokens,
        ...(isO1Model ? {} : { temperature: this.temperature }),
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        user: context.intent_id,
      });

      const latency_ms = Math.round(performance.now() - start_time);

      // Extract content
      const content = response.choices[0]?.message?.content ?? '';

      return {
        content,
        tokens_input: response.usage?.prompt_tokens ?? 0,
        tokens_output: response.usage?.completion_tokens ?? 0,
        latency_ms,
        model_version: response.model,
        from_cache: false,
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
   * Map OpenAI errors to AdapterError.
   */
  private mapError(error: unknown): AdapterError {
    if (error instanceof OpenAI.APIError) {
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
        if (
          message.includes('context') ||
          message.includes('token') ||
          message.includes('maximum')
        ) {
          return new AdapterError('CONTEXT_TOO_LONG', message, false, {
            status,
          });
        }
        return new AdapterError('INVALID_REQUEST', message, false, {
          status,
        });
      }

      if (status && status >= 500) {
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
 * Create an OpenAI adapter with default settings.
 */
export function createOpenAIAdapter(
  model: OpenAIModel = 'gpt-4o'
): OpenAIAdapter {
  return new OpenAIAdapter({ model });
}

/**
 * Create an OpenAI adapter for development (higher temperature).
 */
export function createOpenAIDevAdapter(
  model: OpenAIModel = 'gpt-4o'
): OpenAIAdapter {
  return new OpenAIAdapter({ model, temperature: 0.7 });
}

/**
 * Get capabilities for an OpenAI model without creating an adapter.
 */
export function getOpenAICapabilities(model: OpenAIModel): ModelCapabilities {
  return MODEL_CAPABILITIES[model];
}
