/**
 * Ollama Adapter
 * ==============
 *
 * Local model adapter for Ollama.
 * Implements ModelAdapter interface for offline/development use.
 *
 * Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
 *
 * No SDK required - uses native fetch.
 */

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
 * Common Ollama models.
 */
export type OllamaModel =
  | 'llama3.3'
  | 'llama3.3:70b'
  | 'llama3.2'
  | 'llama3.1'
  | 'llama3.1:70b'
  | 'qwen2.5'
  | 'qwen2.5:72b'
  | 'qwen2.5-coder'
  | 'mistral'
  | 'mixtral'
  | 'codellama'
  | 'deepseek-coder'
  | 'phi3'
  | string; // Allow any model name

/**
 * Default capabilities (conservative estimates).
 */
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  max_context_tokens: 8192,
  max_output_tokens: 4096,
  supports_structured_output: false,
  supports_tool_use: false,
  supports_streaming: true,
};

/**
 * Known model capabilities.
 */
const MODEL_CAPABILITIES: Partial<Record<string, ModelCapabilities>> = {
  'llama3.3': {
    max_context_tokens: 131072,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: false,
    supports_streaming: true,
  },
  'llama3.3:70b': {
    max_context_tokens: 131072,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: false,
    supports_streaming: true,
  },
  'qwen2.5': {
    max_context_tokens: 32768,
    max_output_tokens: 4096,
    supports_structured_output: true,
    supports_tool_use: false,
    supports_streaming: true,
  },
  'qwen2.5:72b': {
    max_context_tokens: 131072,
    max_output_tokens: 8192,
    supports_structured_output: true,
    supports_tool_use: false,
    supports_streaming: true,
  },
  mistral: {
    max_context_tokens: 32768,
    max_output_tokens: 4096,
    supports_structured_output: false,
    supports_tool_use: false,
    supports_streaming: true,
  },
  mixtral: {
    max_context_tokens: 32768,
    max_output_tokens: 4096,
    supports_structured_output: false,
    supports_tool_use: false,
    supports_streaming: true,
  },
};

/**
 * Options for OllamaAdapter.
 */
export interface OllamaAdapterOptions {
  /**
   * Base URL for Ollama API.
   * @default 'http://localhost:11434'
   */
  base_url?: string;

  /**
   * Model to use.
   * @default 'llama3.3'
   */
  model?: OllamaModel;

  /**
   * Request timeout in milliseconds.
   * @default 300000 (5 minutes - local models can be slow)
   */
  timeout_ms?: number;

  /**
   * Temperature for generation.
   * @default 0 (deterministic)
   */
  temperature?: number;

  /**
   * Number of tokens to predict.
   * @default 4096
   */
  num_predict?: number;
}

/**
 * Ollama API response types.
 */
interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Ollama adapter implementing ModelAdapter interface.
 */
export class OllamaAdapter implements ModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly base_url: string;
  private readonly model: OllamaModel;
  private readonly timeout_ms: number;
  private readonly temperature: number;
  private readonly num_predict: number;
  private ready: boolean = false;

  constructor(options: OllamaAdapterOptions = {}) {
    this.base_url =
      options.base_url ??
      process.env.OLLAMA_BASE_URL ??
      'http://localhost:11434';
    this.model = options.model ?? 'llama3.3';
    this.timeout_ms = options.timeout_ms ?? 300000;
    this.temperature = options.temperature ?? 0;
    this.num_predict = options.num_predict ?? 4096;

    // Generate adapter ID from model + hash
    const hash = createHash('sha256')
      .update(`ollama:${this.model}:${Date.now()}`)
      .digest('hex')
      .slice(0, 8);
    this.adapter_id = `ollama_${hash}`;
    this.model_id = `ollama/${this.model}`;

    // Get capabilities (use base model name for lookup)
    const base_model = this.model.split(':')[0] ?? this.model;
    this.capabilities =
      MODEL_CAPABILITIES[base_model] ?? { ...DEFAULT_CAPABILITIES };

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

    try {
      const controller = new AbortController();
      const timeout_id = setTimeout(
        () => controller.abort(),
        this.timeout_ms
      );

      const response = await fetch(`${this.base_url}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: this.temperature,
            num_predict: this.num_predict,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout_id);

      if (!response.ok) {
        const error_text = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${error_text}`);
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      const latency_ms = Math.round(performance.now() - start_time);

      return {
        content: data.response,
        tokens_input: data.prompt_eval_count ?? 0,
        tokens_output: data.eval_count ?? 0,
        latency_ms,
        model_version: data.model,
        from_cache: false,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async isReady(): Promise<boolean> {
    if (!this.ready) return false;

    // Verify Ollama is actually running
    try {
      const response = await fetch(`${this.base_url}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.ready = false;
  }

  /**
   * List available models on the Ollama server.
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.base_url}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        models: Array<{ name: string }>;
      };
      return data.models.map((m) => m.name);
    } catch {
      return [];
    }
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

      if (
        message.includes('ECONNREFUSED') ||
        message.includes('ENOTFOUND') ||
        message.includes('fetch failed')
      ) {
        return new AdapterError(
          'NETWORK_ERROR',
          `Cannot connect to Ollama at ${this.base_url}. Is Ollama running?`,
          true
        );
      }

      if (message.includes('404') || message.includes('not found')) {
        return new AdapterError(
          'INVALID_REQUEST',
          `Model '${this.model}' not found. Run: ollama pull ${this.model}`,
          false
        );
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
 * Create an Ollama adapter with default settings.
 */
export function createOllamaAdapter(
  model: OllamaModel = 'llama3.3'
): OllamaAdapter {
  return new OllamaAdapter({ model });
}

/**
 * Create an Ollama adapter for development (higher temperature).
 */
export function createOllamaDevAdapter(
  model: OllamaModel = 'llama3.3'
): OllamaAdapter {
  return new OllamaAdapter({ model, temperature: 0.7 });
}

/**
 * Check if Ollama is available.
 */
export async function isOllamaAvailable(
  base_url: string = 'http://localhost:11434'
): Promise<boolean> {
  try {
    const response = await fetch(`${base_url}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * List models available on Ollama.
 */
export async function listOllamaModels(
  base_url: string = 'http://localhost:11434'
): Promise<string[]> {
  try {
    const response = await fetch(`${base_url}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as {
      models: Array<{ name: string }>;
    };
    return data.models.map((m) => m.name);
  } catch {
    return [];
  }
}
