/**
 * RAG Types
 * =========
 *
 * Core types for Retrieval-Augmented Generation with vector embeddings.
 */

// =============================================================================
// Embedding Types
// =============================================================================

/**
 * A vector embedding.
 */
export interface Embedding {
  /**
   * The embedding vector.
   */
  vector: number[];

  /**
   * Dimensionality of the vector.
   */
  dimensions: number;

  /**
   * Model used to generate embedding.
   */
  model: string;
}

/**
 * Result of embedding generation.
 */
export interface EmbeddingResult {
  /**
   * Generated embeddings (one per input).
   */
  embeddings: Embedding[];

  /**
   * Total tokens used.
   */
  tokens_used: number;

  /**
   * Latency in milliseconds.
   */
  latency_ms: number;
}

/**
 * Embedding adapter interface.
 */
export interface EmbeddingAdapter {
  /**
   * Adapter identifier.
   */
  readonly adapter_id: string;

  /**
   * Model identifier.
   */
  readonly model_id: string;

  /**
   * Embedding dimensions.
   */
  readonly dimensions: number;

  /**
   * Generate embeddings for text inputs.
   */
  embed(texts: string[]): Promise<EmbeddingResult>;

  /**
   * Check if adapter is ready.
   */
  isReady(): Promise<boolean>;
}

// =============================================================================
// Document Types
// =============================================================================

/**
 * Document type for indexing.
 */
export type DocumentType = 'code' | 'doc' | 'example' | 'snippet' | 'test';

/**
 * A document to be indexed.
 */
export interface Document {
  /**
   * Unique document ID.
   */
  id: string;

  /**
   * Document type.
   */
  type: DocumentType;

  /**
   * Document content.
   */
  content: string;

  /**
   * Source path or URL.
   */
  source?: string;

  /**
   * Programming language (if code).
   */
  language?: string;

  /**
   * Additional metadata.
   */
  metadata?: Record<string, unknown>;
}

/**
 * An indexed document with embedding.
 */
export interface IndexedDocument extends Document {
  /**
   * Document embedding.
   */
  embedding: Embedding;

  /**
   * When the document was indexed.
   */
  indexed_at: number;
}

// =============================================================================
// Search Types
// =============================================================================

/**
 * Search query.
 */
export interface SearchQuery {
  /**
   * Query text.
   */
  text: string;

  /**
   * Maximum results to return.
   */
  limit?: number;

  /**
   * Minimum similarity threshold (0-1).
   */
  min_similarity?: number;

  /**
   * Filter by document type.
   */
  type_filter?: DocumentType[];

  /**
   * Filter by language.
   */
  language_filter?: string[];
}

/**
 * Search result.
 */
export interface SearchResult {
  /**
   * The matched document.
   */
  document: IndexedDocument;

  /**
   * Similarity score (0-1).
   */
  similarity: number;

  /**
   * Rank in results (1-indexed).
   */
  rank: number;
}

/**
 * Search response.
 */
export interface SearchResponse {
  /**
   * Search results ordered by relevance.
   */
  results: SearchResult[];

  /**
   * Query embedding used.
   */
  query_embedding: Embedding;

  /**
   * Total documents searched.
   */
  total_searched: number;

  /**
   * Search latency in milliseconds.
   */
  latency_ms: number;
}

// =============================================================================
// Vector Store Types
// =============================================================================

/**
 * Vector store statistics.
 */
export interface VectorStoreStats {
  /**
   * Total documents indexed.
   */
  total_documents: number;

  /**
   * Documents by type.
   */
  documents_by_type: Record<DocumentType, number>;

  /**
   * Documents by language.
   */
  documents_by_language: Record<string, number>;

  /**
   * Embedding dimensions.
   */
  dimensions: number;

  /**
   * Total memory used (approximate).
   */
  memory_bytes: number;
}

/**
 * Vector store interface.
 */
export interface VectorStore {
  /**
   * Add documents to the store.
   */
  add(documents: IndexedDocument[]): Promise<void>;

  /**
   * Remove documents by ID.
   */
  remove(ids: string[]): Promise<void>;

  /**
   * Search for similar documents.
   */
  search(query: Embedding, options: Omit<SearchQuery, 'text'>): Promise<SearchResult[]>;

  /**
   * Get document by ID.
   */
  get(id: string): Promise<IndexedDocument | undefined>;

  /**
   * Check if document exists.
   */
  has(id: string): Promise<boolean>;

  /**
   * Get store statistics.
   */
  stats(): Promise<VectorStoreStats>;

  /**
   * Clear all documents.
   */
  clear(): Promise<void>;
}

// =============================================================================
// Chunking Types
// =============================================================================

/**
 * Chunking strategy.
 */
export type ChunkingStrategy =
  | 'fixed'      // Fixed size chunks
  | 'sentence'   // Split on sentences
  | 'paragraph'  // Split on paragraphs
  | 'code'       // Code-aware splitting (functions, classes)
  | 'semantic';  // Semantic boundaries

/**
 * Chunking options.
 */
export interface ChunkingOptions {
  /**
   * Chunking strategy.
   */
  strategy: ChunkingStrategy;

  /**
   * Maximum chunk size in characters.
   */
  max_chunk_size: number;

  /**
   * Overlap between chunks in characters.
   */
  overlap: number;

  /**
   * Minimum chunk size (smaller chunks are merged).
   */
  min_chunk_size?: number;
}

/**
 * A chunk of a document.
 */
export interface Chunk {
  /**
   * Chunk content.
   */
  content: string;

  /**
   * Start offset in original document.
   */
  start_offset: number;

  /**
   * End offset in original document.
   */
  end_offset: number;

  /**
   * Chunk index (0-based).
   */
  index: number;
}
