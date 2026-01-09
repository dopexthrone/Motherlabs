/**
 * Gemini Adapter
 * ==============
 *
 * Live adapter for Google's Gemini API.
 * Implements ModelAdapter interface for production use.
 *
 * Uses REST API directly (no SDK dependency).
 * API Docs: https://ai.google.dev/api/rest
 *
 * Security:
 * - API key from environment only (never hardcoded)
 * - Keys never logged or included in errors
 */

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
 * Supported Gemini models.
 */
export type GeminiModel =
  | 'gemini-2.0-flash-exp'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-pro-latest'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-flash-latest'
  | 'gemini-1.5-flash-8b'
  | 'gemini-1.0-pro'
  | string; // Allow custom model names

/**
 * Model capabilities lookup.
 */
const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'gemini-2.0-flash-exp': {
    max_context_tokens: 1048576,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gemini-1.5-pro': {
    max_context_tokens: 2097152,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gemini-1.5-pro-latest': {
    max_context_tokens: 2097152,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gemini-1.5-flash': {
    max_context_tokens: 1048576,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gemini-1.5-flash-latest': {
    max_context_tokens: 1048576,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gemini-1.5-flash-8b': {
    max_context_tokens: 1048576,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
  'gemini-1.0-pro': {
    max_context_tokens: 32768,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: true,
    supports_streaming: true,
  },
};

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  max_context_tokens: 32768,
  max_output_tokens: 8192,
  supports_structured_output: true,
  supports_tool_use: true,
  supports_streaming: true,
};

/**
 * Options for GeminiAdapter.
 */
export interface GeminiAdapterOptions {
  /**
   * API key. If not provided, reads from GOOGLE_API_KEY or GEMINI_API_KEY env var.
   */
  api_key?: string;

  /**
   * Model to use.
   * @default 'gemini-2.0-flash'
   */
  model?: GeminiModel;

  /**
   * Request timeout in milliseconds.
   * @default 120000
   */
  timeout_ms?: number;

  /**
   * Temperature for generation.
   * @default 0 (deterministic)
   */
  temperature?: number;

  /**
   * Maximum output tokens.
   * @default 8192
   */
  max_output_tokens?: number;

  /**
   * Base URL override.
   * @default 'https://generativelanguage.googleapis.com/v1beta'
   */
  base_url?: string;
}

/**
 * Gemini API response types.
 */
interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  modelVersion?: string;
}

interface GeminiError {
  error: {
    code: number;
    message: string;
    status: string;
  };
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Gemini API adapter implementing StreamingModelAdapter interface.
 */
export class GeminiAdapter implements StreamingModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly api_key: string;
  private readonly model: GeminiModel;
  private readonly timeout_ms: number;
  private readonly temperature: number;
  private readonly max_output_tokens: number;
  private readonly base_url: string;
  private ready: boolean = false;

  constructor(options: GeminiAdapterOptions = {}) {
    const api_key =
      options.api_key ??
      process.env.GOOGLE_API_KEY ??
      process.env.GEMINI_API_KEY;

    if (!api_key) {
      throw new AdapterError(
        'ADAPTER_ERROR',
        'GOOGLE_API_KEY or GEMINI_API_KEY not provided and not found in environment',
        false
      );
    }

    this.api_key = api_key;
    this.model = options.model ?? 'gemini-2.0-flash';
    this.timeout_ms = options.timeout_ms ?? 120000;
    this.temperature = options.temperature ?? 0;
    this.max_output_tokens = options.max_output_tokens ?? 8192;
    this.base_url =
      options.base_url ?? 'https://generativelanguage.googleapis.com/v1beta';

    // Generate adapter ID from model + hash
    const hash = createHash('sha256')
      .update(`gemini:${this.model}:${Date.now()}`)
      .digest('hex')
      .slice(0, 8);
    this.adapter_id = `gemini_${hash}`;
    this.model_id = this.model;
    this.capabilities =
      MODEL_CAPABILITIES[this.model] ?? { ...DEFAULT_CAPABILITIES };

    this.ready = true;
  }

  async transform(
    prompt: string,
    _context: TransformContext
  ): Promise<TransformResult> {
    if (!this.ready) {
      throw new AdapterError(
        'ADAPTER_ERROR',
        'Adapter not ready - was it shut down?',
        false
      );
    }

    const start_time = performance.now();
    const url = `${this.base_url}/models/${this.model}:generateContent?key=${this.api_key}`;

    try {
      const controller = new AbortController();
      const timeout_id = setTimeout(
        () => controller.abort(),
        this.timeout_ms
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: this.temperature,
            maxOutputTokens: this.max_output_tokens,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout_id);

      if (!response.ok) {
        const error_data = (await response.json()) as GeminiError;
        throw new Error(
          `Gemini API error ${response.status}: ${error_data.error?.message ?? response.statusText}`
        );
      }

      const data = (await response.json()) as GeminiResponse;
      const latency_ms = Math.round(performance.now() - start_time);

      // Extract text content
      const content =
        data.candidates?.[0]?.content?.parts
          ?.map((p) => p.text)
          .join('\n') ?? '';

      return {
        content,
        tokens_input: data.usageMetadata?.promptTokenCount ?? 0,
        tokens_output: data.usageMetadata?.candidatesTokenCount ?? 0,
        latency_ms,
        model_version: data.modelVersion ?? this.model,
        from_cache: false,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async *transformStream(
    prompt: string,
    _context: TransformContext
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

    // Use streamGenerateContent endpoint with SSE
    const url = `${this.base_url}/models/${this.model}:streamGenerateContent?alt=sse&key=${this.api_key}`;

    try {
      const controller = new AbortController();
      const timeout_id = setTimeout(
        () => controller.abort(),
        this.timeout_ms
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: this.temperature,
            maxOutputTokens: this.max_output_tokens,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout_id);

      if (!response.ok) {
        const error_text = await response.text();
        throw new Error(
          `Gemini API error ${response.status}: ${error_text}`
        );
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data.trim() === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data) as GeminiResponse;

              // Extract text from response
              const text = parsed.candidates?.[0]?.content?.parts
                ?.map((p) => p.text)
                .filter(Boolean)
                .join('') ?? '';

              if (text) {
                if (first_chunk_time === undefined) {
                  first_chunk_time = performance.now() - start_time;
                }

                total_content += text;

                yield {
                  content: text,
                  done: false,
                  index: index++,
                };
              }

              // Track usage if available
              if (parsed.usageMetadata) {
                tokens_input = parsed.usageMetadata.promptTokenCount ?? 0;
                tokens_output = parsed.usageMetadata.candidatesTokenCount ?? 0;
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }

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
        model_version: this.model,
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
   * Map errors to AdapterError.
   */
  private mapError(error: unknown): AdapterError {
    if (error instanceof Error) {
      const message = error.message;

      if (error.name === 'AbortError' || message.includes('aborted')) {
        return new AdapterError('TIMEOUT', 'Request timed out', true);
      }

      if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
        return new AdapterError('RATE_LIMITED', message, true);
      }

      if (message.includes('400') || message.includes('INVALID_ARGUMENT')) {
        if (message.includes('token') || message.includes('length')) {
          return new AdapterError('CONTEXT_TOO_LONG', message, false);
        }
        return new AdapterError('INVALID_REQUEST', message, false);
      }

      if (message.includes('401') || message.includes('403')) {
        return new AdapterError('ADAPTER_ERROR', `Auth error: ${message}`, false);
      }

      if (message.includes('500') || message.includes('503')) {
        return new AdapterError('MODEL_ERROR', message, true);
      }

      if (
        message.includes('ECONNREFUSED') ||
        message.includes('ENOTFOUND') ||
        message.includes('fetch failed')
      ) {
        return new AdapterError('NETWORK_ERROR', message, true);
      }

      return new AdapterError('ADAPTER_ERROR', message, false);
    }

    return new AdapterError('ADAPTER_ERROR', String(error), false);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a Gemini adapter with default settings.
 */
export function createGeminiAdapter(
  model: GeminiModel = 'gemini-2.0-flash'
): GeminiAdapter {
  return new GeminiAdapter({ model });
}

/**
 * Create a Gemini adapter for development (higher temperature).
 */
export function createGeminiDevAdapter(
  model: GeminiModel = 'gemini-2.0-flash'
): GeminiAdapter {
  return new GeminiAdapter({ model, temperature: 0.7 });
}

/**
 * Get capabilities for a Gemini model without creating an adapter.
 */
export function getGeminiCapabilities(model: GeminiModel): ModelCapabilities {
  return MODEL_CAPABILITIES[model] ?? { ...DEFAULT_CAPABILITIES };
}

/**
 * Check if Gemini API key is configured.
 */
export function isGeminiConfigured(): boolean {
  return !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
}
