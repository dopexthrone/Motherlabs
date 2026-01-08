/**
 * Embedding Adapters
 * ==================
 *
 * Embedding generation using various providers.
 */

import { randomBytes } from 'node:crypto';
import type { EmbeddingAdapter, EmbeddingResult, Embedding } from './types.js';

// =============================================================================
// Gemini Embedding Adapter
// =============================================================================

/**
 * Gemini embedding model options.
 */
export type GeminiEmbeddingModel = 'text-embedding-004' | 'embedding-001';

/**
 * Gemini embedding adapter options.
 */
export interface GeminiEmbeddingOptions {
  /**
   * Model to use.
   */
  model?: GeminiEmbeddingModel;

  /**
   * API key (defaults to GEMINI_API_KEY env var).
   */
  api_key?: string;

  /**
   * Task type for embedding.
   */
  task_type?: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | 'SEMANTIC_SIMILARITY' | 'CLASSIFICATION' | 'CLUSTERING';
}

/**
 * Gemini embedding adapter.
 */
export class GeminiEmbeddingAdapter implements EmbeddingAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly dimensions: number;

  private readonly apiKey: string;
  private readonly taskType: string;

  constructor(options: GeminiEmbeddingOptions = {}) {
    const model = options.model ?? 'text-embedding-004';
    this.adapter_id = `gemini_embed_${randomBytes(4).toString('hex')}`;
    this.model_id = model;
    this.dimensions = model === 'text-embedding-004' ? 768 : 768;
    this.taskType = options.task_type ?? 'RETRIEVAL_DOCUMENT';

    const apiKey = options.api_key ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable not set');
    }
    this.apiKey = apiKey;
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const startTime = performance.now();
    const embeddings: Embedding[] = [];
    let totalTokens = 0;

    // Batch texts (Gemini supports batch embedding)
    const batchSize = 100;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResult = await this.embedBatch(batch);
      embeddings.push(...batchResult.embeddings);
      totalTokens += batchResult.tokens;
    }

    return {
      embeddings,
      tokens_used: totalTokens,
      latency_ms: Math.round(performance.now() - startTime),
    };
  }

  private async embedBatch(texts: string[]): Promise<{ embeddings: Embedding[]; tokens: number }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model_id}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map((text) => ({
      model: `models/${this.model_id}`,
      content: { parts: [{ text }] },
      taskType: this.taskType,
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini embedding API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      embeddings: Array<{ values: number[] }>;
    };

    const embeddings: Embedding[] = data.embeddings.map((e) => ({
      vector: e.values,
      dimensions: e.values.length,
      model: this.model_id,
    }));

    // Estimate tokens (rough: ~4 chars per token)
    const tokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);

    return { embeddings, tokens };
  }

  async isReady(): Promise<boolean> {
    try {
      await this.embed(['test']);
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// OpenAI Embedding Adapter
// =============================================================================

/**
 * OpenAI embedding model options.
 */
export type OpenAIEmbeddingModel =
  | 'text-embedding-3-small'
  | 'text-embedding-3-large'
  | 'text-embedding-ada-002';

/**
 * OpenAI embedding adapter options.
 */
export interface OpenAIEmbeddingOptions {
  /**
   * Model to use.
   */
  model?: OpenAIEmbeddingModel;

  /**
   * API key (defaults to OPENAI_API_KEY env var).
   */
  api_key?: string;

  /**
   * Reduce dimensions (only for text-embedding-3-*).
   */
  dimensions?: number;
}

const OPENAI_DIMENSIONS: Record<OpenAIEmbeddingModel, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * OpenAI embedding adapter.
 */
export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly dimensions: number;

  private readonly apiKey: string;

  constructor(options: OpenAIEmbeddingOptions = {}) {
    const model = options.model ?? 'text-embedding-3-small';
    this.adapter_id = `openai_embed_${randomBytes(4).toString('hex')}`;
    this.model_id = model;
    this.dimensions = options.dimensions ?? OPENAI_DIMENSIONS[model];

    const apiKey = options.api_key ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }
    this.apiKey = apiKey;
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const startTime = performance.now();

    const url = 'https://api.openai.com/v1/embeddings';
    const body: Record<string, unknown> = {
      model: this.model_id,
      input: texts,
    };

    // Add dimensions if using text-embedding-3-*
    if (this.model_id.startsWith('text-embedding-3-') && this.dimensions !== OPENAI_DIMENSIONS[this.model_id as OpenAIEmbeddingModel]) {
      body.dimensions = this.dimensions;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { total_tokens: number };
    };

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);

    const embeddings: Embedding[] = sorted.map((e) => ({
      vector: e.embedding,
      dimensions: e.embedding.length,
      model: this.model_id,
    }));

    return {
      embeddings,
      tokens_used: data.usage.total_tokens,
      latency_ms: Math.round(performance.now() - startTime),
    };
  }

  async isReady(): Promise<boolean> {
    try {
      await this.embed(['test']);
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Mock Embedding Adapter (for testing)
// =============================================================================

/**
 * Mock embedding adapter that generates deterministic random embeddings.
 */
export class MockEmbeddingAdapter implements EmbeddingAdapter {
  readonly adapter_id: string;
  readonly model_id = 'mock-embedding';
  readonly dimensions: number;

  constructor(dimensions: number = 768) {
    this.adapter_id = `mock_embed_${randomBytes(4).toString('hex')}`;
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const startTime = performance.now();

    const embeddings: Embedding[] = texts.map((text) => ({
      vector: this.generateDeterministicVector(text),
      dimensions: this.dimensions,
      model: this.model_id,
    }));

    return {
      embeddings,
      tokens_used: texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
      latency_ms: Math.round(performance.now() - startTime),
    };
  }

  private generateDeterministicVector(text: string): number[] {
    // Generate deterministic "random" vector from text hash
    const vector: number[] = [];
    let hash = 0;

    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }

    for (let i = 0; i < this.dimensions; i++) {
      // Use hash to seed pseudo-random values
      hash = ((hash * 1103515245) + 12345) | 0;
      vector.push((hash & 0x7fffffff) / 0x7fffffff - 0.5);
    }

    // Normalize
    const mag = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / mag);
  }

  async isReady(): Promise<boolean> {
    return true;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Embedding provider type.
 */
export type EmbeddingProvider = 'gemini' | 'openai' | 'mock';

/**
 * Create an embedding adapter.
 */
export function createEmbeddingAdapter(
  provider: EmbeddingProvider = 'gemini',
  options: GeminiEmbeddingOptions | OpenAIEmbeddingOptions = {}
): EmbeddingAdapter {
  switch (provider) {
    case 'gemini':
      return new GeminiEmbeddingAdapter(options as GeminiEmbeddingOptions);
    case 'openai':
      return new OpenAIEmbeddingAdapter(options as OpenAIEmbeddingOptions);
    case 'mock':
      return new MockEmbeddingAdapter();
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}
