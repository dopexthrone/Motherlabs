/**
 * RAG Exports
 * ===========
 *
 * Vector-based Retrieval-Augmented Generation.
 */

// Types
export type {
  Embedding,
  EmbeddingResult,
  EmbeddingAdapter,
  Document,
  DocumentType,
  IndexedDocument,
  SearchQuery,
  SearchResult,
  SearchResponse,
  VectorStore,
  VectorStoreStats,
  ChunkingStrategy,
  ChunkingOptions,
  Chunk,
} from './types.js';

// Embeddings
export type {
  EmbeddingProvider,
  GeminiEmbeddingModel,
  GeminiEmbeddingOptions,
  OpenAIEmbeddingModel,
  OpenAIEmbeddingOptions,
} from './embeddings.js';

export {
  GeminiEmbeddingAdapter,
  OpenAIEmbeddingAdapter,
  MockEmbeddingAdapter,
  createEmbeddingAdapter,
} from './embeddings.js';

// Vector Store
export type {
  VectorStoreType,
  InMemoryVectorStoreOptions,
  HNSWIndexOptions,
  FileVectorStoreOptions,
} from './vector_store.js';

export {
  InMemoryVectorStore,
  HNSWIndex,
  FileVectorStore,
  createVectorStore,
  createPersistentVectorStore,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
} from './vector_store.js';

// Retriever
export type {
  RAGRetrieverOptions,
  RAGStats,
} from './retriever.js';

export {
  RAGRetriever,
  createRAGRetriever,
  chunkText,
  DEFAULT_CHUNKING,
} from './retriever.js';
