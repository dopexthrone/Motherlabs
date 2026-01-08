/**
 * RAG Retriever
 * =============
 *
 * Vector-based retrieval-augmented generation.
 * Indexes documents with embeddings and retrieves relevant context.
 */

import { randomBytes } from 'node:crypto';
import type {
  EmbeddingAdapter,
  VectorStore,
  Document,
  IndexedDocument,
  SearchQuery,
  SearchResponse,
  SearchResult,
  ChunkingOptions,
  Chunk,
  DocumentType,
} from './types.js';
import { createEmbeddingAdapter, type EmbeddingProvider } from './embeddings.js';
import { createVectorStore, type VectorStoreType } from './vector_store.js';

// =============================================================================
// Chunking
// =============================================================================

/**
 * Default chunking options.
 */
export const DEFAULT_CHUNKING: ChunkingOptions = {
  strategy: 'code',
  max_chunk_size: 1500,
  overlap: 200,
  min_chunk_size: 100,
};

/**
 * Chunk text using fixed size strategy.
 */
function chunkFixed(text: string, options: ChunkingOptions): Chunk[] {
  const chunks: Chunk[] = [];
  const { max_chunk_size, overlap, min_chunk_size = 50 } = options;

  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = Math.min(start + max_chunk_size, text.length);

    // Try to break at a natural boundary
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      const lastSpace = text.lastIndexOf(' ', end);

      if (lastNewline > start + min_chunk_size) {
        end = lastNewline + 1;
      } else if (lastSpace > start + min_chunk_size) {
        end = lastSpace + 1;
      }
    }

    const content = text.slice(start, end);
    if (content.trim().length >= min_chunk_size) {
      chunks.push({
        content,
        start_offset: start,
        end_offset: end,
        index,
      });
      index++;
    }

    start = end - overlap;
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk && start <= lastChunk.start_offset) {
      start = end;
    }
  }

  return chunks;
}

/**
 * Chunk code using language-aware splitting.
 */
function chunkCode(text: string, options: ChunkingOptions, language?: string): Chunk[] {
  const chunks: Chunk[] = [];
  const { max_chunk_size, overlap, min_chunk_size = 50 } = options;

  // Define code boundaries based on language
  const boundaryPatterns: Record<string, RegExp[]> = {
    python: [
      /^(?:async\s+)?def\s+\w+/gm,      // Function definitions
      /^class\s+\w+/gm,                   // Class definitions
      /^@\w+/gm,                          // Decorators
    ],
    typescript: [
      /^(?:export\s+)?(?:async\s+)?function\s+\w+/gm,
      /^(?:export\s+)?class\s+\w+/gm,
      /^(?:export\s+)?interface\s+\w+/gm,
      /^(?:export\s+)?type\s+\w+/gm,
      /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=/gm,
    ],
    javascript: [
      /^(?:export\s+)?(?:async\s+)?function\s+\w+/gm,
      /^(?:export\s+)?class\s+\w+/gm,
      /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=/gm,
    ],
  };

  const patterns = boundaryPatterns[language ?? ''] ?? boundaryPatterns['typescript'] ?? [];

  // Find all boundaries
  const boundaries: number[] = [0];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, 'gm');
    let match;
    while ((match = regex.exec(text)) !== null) {
      boundaries.push(match.index);
    }
  }
  boundaries.push(text.length);

  // Sort and dedupe
  const uniqueBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);

  // Create chunks from boundaries
  let currentStart = 0;
  let currentContent = '';
  let index = 0;

  for (let i = 1; i < uniqueBoundaries.length; i++) {
    const boundary = uniqueBoundaries[i] ?? text.length;
    const prevBoundary = uniqueBoundaries[i - 1] ?? 0;
    const segment = text.slice(prevBoundary, boundary);

    if (currentContent.length + segment.length <= max_chunk_size) {
      currentContent += segment;
    } else {
      // Save current chunk
      if (currentContent.trim().length >= min_chunk_size) {
        chunks.push({
          content: currentContent,
          start_offset: currentStart,
          end_offset: prevBoundary,
          index,
        });
        index++;
      }

      // Start new chunk with overlap
      const overlapStart = Math.max(0, currentContent.length - overlap);
      currentContent = currentContent.slice(overlapStart) + segment;
      currentStart = prevBoundary - (currentContent.length - segment.length);
    }
  }

  // Don't forget the last chunk
  if (currentContent.trim().length >= min_chunk_size) {
    chunks.push({
      content: currentContent,
      start_offset: currentStart,
      end_offset: text.length,
      index,
    });
  }

  return chunks.length > 0 ? chunks : chunkFixed(text, options);
}

/**
 * Chunk text into pieces.
 */
export function chunkText(
  text: string,
  options: ChunkingOptions = DEFAULT_CHUNKING,
  language?: string
): Chunk[] {
  switch (options.strategy) {
    case 'code':
      return chunkCode(text, options, language);
    case 'paragraph':
      return chunkByParagraph(text, options);
    case 'sentence':
      return chunkBySentence(text, options);
    case 'fixed':
    default:
      return chunkFixed(text, options);
  }
}

function chunkByParagraph(text: string, options: ChunkingOptions): Chunk[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let currentChunk = '';
  let currentStart = 0;
  let offset = 0;
  let index = 0;

  for (const para of paragraphs) {
    if (currentChunk.length + para.length + 2 <= options.max_chunk_size) {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    } else {
      if (currentChunk.trim().length >= (options.min_chunk_size ?? 50)) {
        chunks.push({
          content: currentChunk,
          start_offset: currentStart,
          end_offset: offset,
          index,
        });
        index++;
      }
      currentChunk = para;
      currentStart = offset;
    }
    offset += para.length + 2;
  }

  if (currentChunk.trim().length >= (options.min_chunk_size ?? 50)) {
    chunks.push({
      content: currentChunk,
      start_offset: currentStart,
      end_offset: text.length,
      index,
    });
  }

  return chunks;
}

function chunkBySentence(text: string, options: ChunkingOptions): Chunk[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: Chunk[] = [];
  let currentChunk = '';
  let currentStart = 0;
  let offset = 0;
  let index = 0;

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 <= options.max_chunk_size) {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    } else {
      if (currentChunk.trim().length >= (options.min_chunk_size ?? 50)) {
        chunks.push({
          content: currentChunk,
          start_offset: currentStart,
          end_offset: offset,
          index,
        });
        index++;
      }
      currentChunk = sentence;
      currentStart = offset;
    }
    offset += sentence.length + 1;
  }

  if (currentChunk.trim().length >= (options.min_chunk_size ?? 50)) {
    chunks.push({
      content: currentChunk,
      start_offset: currentStart,
      end_offset: text.length,
      index,
    });
  }

  return chunks;
}

// =============================================================================
// RAG Retriever
// =============================================================================

/**
 * RAG retriever options.
 */
export interface RAGRetrieverOptions {
  /**
   * Embedding provider.
   */
  embedding_provider?: EmbeddingProvider;

  /**
   * Vector store type.
   */
  store_type?: VectorStoreType;

  /**
   * Chunking options.
   */
  chunking?: Partial<ChunkingOptions>;

  /**
   * Embedding dimensions.
   */
  dimensions?: number;
}

/**
 * RAG retriever statistics.
 */
export interface RAGStats {
  /**
   * Total documents indexed.
   */
  total_documents: number;

  /**
   * Total chunks indexed.
   */
  total_chunks: number;

  /**
   * Total tokens used for embeddings.
   */
  total_embedding_tokens: number;

  /**
   * Total search queries.
   */
  total_searches: number;

  /**
   * Average search latency in ms.
   */
  average_search_latency_ms: number;
}

/**
 * RAG retriever for code and documentation.
 */
export class RAGRetriever {
  readonly id: string;
  private readonly embedder: EmbeddingAdapter;
  private readonly store: VectorStore;
  private readonly chunking: ChunkingOptions;

  private documentChunks: Map<string, string[]> = new Map(); // doc ID -> chunk IDs
  private stats = {
    total_documents: 0,
    total_chunks: 0,
    total_embedding_tokens: 0,
    total_searches: 0,
    total_search_latency_ms: 0,
  };

  constructor(options: RAGRetrieverOptions = {}) {
    this.id = `rag_${randomBytes(4).toString('hex')}`;

    const dimensions = options.dimensions ?? 768;

    this.embedder = createEmbeddingAdapter(
      options.embedding_provider ?? 'gemini'
    );

    this.store = createVectorStore(options.store_type ?? 'memory', {
      dimensions,
    });

    this.chunking = {
      ...DEFAULT_CHUNKING,
      ...options.chunking,
    };
  }

  /**
   * Index a document.
   */
  async index(document: Document): Promise<number> {
    // Chunk the document
    const chunks = chunkText(
      document.content,
      this.chunking,
      document.language
    );

    if (chunks.length === 0) return 0;

    // Generate embeddings for all chunks
    const texts = chunks.map((c) => c.content);
    const embeddingResult = await this.embedder.embed(texts);

    // Create indexed documents
    const indexedDocs: IndexedDocument[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddingResult.embeddings[i];
      if (!chunk || !embedding) continue;

      const doc: IndexedDocument = {
        id: `${document.id}_chunk_${chunk.index}`,
        type: document.type,
        content: chunk.content,
        embedding,
        indexed_at: Date.now(),
        metadata: {
          ...document.metadata,
          parent_id: document.id,
          chunk_index: chunk.index,
          start_offset: chunk.start_offset,
          end_offset: chunk.end_offset,
        },
      };
      if (document.source) {
        doc.source = document.source;
      }
      if (document.language) {
        doc.language = document.language;
      }
      indexedDocs.push(doc);
    }

    // Store in vector store
    await this.store.add(indexedDocs);

    // Track chunk IDs for this document
    this.documentChunks.set(
      document.id,
      indexedDocs.map((d) => d.id)
    );

    // Update stats
    this.stats.total_documents++;
    this.stats.total_chunks += chunks.length;
    this.stats.total_embedding_tokens += embeddingResult.tokens_used;

    return chunks.length;
  }

  /**
   * Index multiple documents.
   */
  async indexBatch(documents: Document[]): Promise<number> {
    let totalChunks = 0;
    for (const doc of documents) {
      totalChunks += await this.index(doc);
    }
    return totalChunks;
  }

  /**
   * Remove a document and its chunks.
   */
  async remove(documentId: string): Promise<void> {
    const chunkIds = this.documentChunks.get(documentId);
    if (chunkIds) {
      await this.store.remove(chunkIds);
      this.documentChunks.delete(documentId);
      this.stats.total_documents--;
      this.stats.total_chunks -= chunkIds.length;
    }
  }

  /**
   * Search for relevant context.
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const startTime = performance.now();

    // Generate query embedding
    const embeddingResult = await this.embedder.embed([query.text]);
    const queryEmbedding = embeddingResult.embeddings[0];
    if (!queryEmbedding) {
      throw new Error('Failed to generate query embedding');
    }

    // Search vector store
    const searchOptions: Omit<SearchQuery, 'text'> = {
      limit: query.limit ?? 10,
      min_similarity: query.min_similarity ?? 0.5,
    };
    if (query.type_filter) {
      searchOptions.type_filter = query.type_filter;
    }
    if (query.language_filter) {
      searchOptions.language_filter = query.language_filter;
    }
    const results = await this.store.search(queryEmbedding, searchOptions);

    const latencyMs = Math.round(performance.now() - startTime);

    // Update stats
    this.stats.total_searches++;
    this.stats.total_search_latency_ms += latencyMs;
    this.stats.total_embedding_tokens += embeddingResult.tokens_used;

    const storeStats = await this.store.stats();

    return {
      results,
      query_embedding: queryEmbedding,
      total_searched: storeStats.total_documents,
      latency_ms: latencyMs,
    };
  }

  /**
   * Get context items for code generation.
   * Returns formatted context ready for LLM prompt.
   */
  async getContext(
    query: string,
    options: {
      limit?: number;
      min_similarity?: number;
      type_filter?: DocumentType[];
      language_filter?: string[];
    } = {}
  ): Promise<Array<{ type: DocumentType; content: string; source?: string; relevance: number }>> {
    const searchQuery: SearchQuery = {
      text: query,
      limit: options.limit ?? 5,
      min_similarity: options.min_similarity ?? 0.5,
    };
    if (options.type_filter) {
      searchQuery.type_filter = options.type_filter;
    }
    if (options.language_filter) {
      searchQuery.language_filter = options.language_filter;
    }
    const response = await this.search(searchQuery);

    return response.results.map((r) => {
      const item: { type: DocumentType; content: string; source?: string; relevance: number } = {
        type: r.document.type,
        content: r.document.content,
        relevance: r.similarity,
      };
      if (r.document.source) {
        item.source = r.document.source;
      }
      return item;
    });
  }

  /**
   * Get retriever statistics.
   */
  getStats(): RAGStats {
    return {
      total_documents: this.stats.total_documents,
      total_chunks: this.stats.total_chunks,
      total_embedding_tokens: this.stats.total_embedding_tokens,
      total_searches: this.stats.total_searches,
      average_search_latency_ms:
        this.stats.total_searches > 0
          ? Math.round(this.stats.total_search_latency_ms / this.stats.total_searches)
          : 0,
    };
  }

  /**
   * Clear all indexed documents.
   */
  async clear(): Promise<void> {
    await this.store.clear();
    this.documentChunks.clear();
    this.stats = {
      total_documents: 0,
      total_chunks: 0,
      total_embedding_tokens: 0,
      total_searches: 0,
      total_search_latency_ms: 0,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a RAG retriever.
 */
export function createRAGRetriever(options: RAGRetrieverOptions = {}): RAGRetriever {
  return new RAGRetriever(options);
}
