/**
 * Vector Store
 * ============
 *
 * In-memory vector storage with similarity search.
 * Uses cosine similarity for nearest neighbor search.
 */

import type {
  VectorStore,
  VectorStoreStats,
  IndexedDocument,
  Embedding,
  SearchResult,
  SearchQuery,
  DocumentType,
} from './types.js';

// =============================================================================
// Similarity Functions
// =============================================================================

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Compute euclidean distance between two vectors.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Compute dot product between two vectors.
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }

  return sum;
}

// =============================================================================
// In-Memory Vector Store
// =============================================================================

/**
 * In-memory vector store options.
 */
export interface InMemoryVectorStoreOptions {
  /**
   * Expected embedding dimensions.
   */
  dimensions?: number;

  /**
   * Similarity function to use.
   */
  similarity?: 'cosine' | 'euclidean' | 'dot';
}

/**
 * In-memory vector store implementation.
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly documents: Map<string, IndexedDocument> = new Map();
  private readonly dimensions: number;
  private readonly similarityFn: (a: number[], b: number[]) => number;

  constructor(options: InMemoryVectorStoreOptions = {}) {
    this.dimensions = options.dimensions ?? 768;

    switch (options.similarity ?? 'cosine') {
      case 'euclidean':
        // Convert distance to similarity (closer = higher)
        this.similarityFn = (a, b) => 1 / (1 + euclideanDistance(a, b));
        break;
      case 'dot':
        this.similarityFn = dotProduct;
        break;
      case 'cosine':
      default:
        this.similarityFn = cosineSimilarity;
    }
  }

  async add(documents: IndexedDocument[]): Promise<void> {
    for (const doc of documents) {
      if (doc.embedding.dimensions !== this.dimensions) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimensions}, got ${doc.embedding.dimensions}`
        );
      }
      this.documents.set(doc.id, doc);
    }
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.documents.delete(id);
    }
  }

  async search(
    query: Embedding,
    options: Omit<SearchQuery, 'text'>
  ): Promise<SearchResult[]> {
    const limit = options.limit ?? 10;
    const minSimilarity = options.min_similarity ?? 0;
    const typeFilter = options.type_filter;
    const languageFilter = options.language_filter;

    // Score all documents
    const scored: Array<{ doc: IndexedDocument; similarity: number }> = [];

    for (const doc of this.documents.values()) {
      // Apply filters
      if (typeFilter && !typeFilter.includes(doc.type)) continue;
      if (languageFilter && doc.language && !languageFilter.includes(doc.language)) continue;

      const similarity = this.similarityFn(query.vector, doc.embedding.vector);

      if (similarity >= minSimilarity) {
        scored.push({ doc, similarity });
      }
    }

    // Sort by similarity descending
    scored.sort((a, b) => b.similarity - a.similarity);

    // Take top N and format results
    return scored.slice(0, limit).map((item, index) => ({
      document: item.doc,
      similarity: item.similarity,
      rank: index + 1,
    }));
  }

  async get(id: string): Promise<IndexedDocument | undefined> {
    return this.documents.get(id);
  }

  async has(id: string): Promise<boolean> {
    return this.documents.has(id);
  }

  async stats(): Promise<VectorStoreStats> {
    const byType: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};

    for (const doc of this.documents.values()) {
      byType[doc.type] = (byType[doc.type] ?? 0) + 1;
      if (doc.language) {
        byLanguage[doc.language] = (byLanguage[doc.language] ?? 0) + 1;
      }
    }

    // Estimate memory: each float is 8 bytes, plus overhead
    const vectorBytes = this.documents.size * this.dimensions * 8;
    const overheadBytes = this.documents.size * 500; // Rough estimate for metadata

    return {
      total_documents: this.documents.size,
      documents_by_type: byType as Record<DocumentType, number>,
      documents_by_language: byLanguage,
      dimensions: this.dimensions,
      memory_bytes: vectorBytes + overheadBytes,
    };
  }

  async clear(): Promise<void> {
    this.documents.clear();
  }
}

// =============================================================================
// HNSW Index (Approximate Nearest Neighbors)
// =============================================================================

/**
 * HNSW node.
 */
interface HNSWNode {
  id: string;
  vector: number[];
  connections: Map<number, Set<string>>; // level -> connected node IDs
  level: number;
}

/**
 * HNSW (Hierarchical Navigable Small World) index options.
 */
export interface HNSWIndexOptions {
  /**
   * Maximum number of connections per node per layer.
   */
  M?: number;

  /**
   * Size of the dynamic candidate list during construction.
   */
  efConstruction?: number;

  /**
   * Size of the dynamic candidate list during search.
   */
  efSearch?: number;

  /**
   * Expected embedding dimensions.
   */
  dimensions?: number;
}

/**
 * HNSW index for approximate nearest neighbor search.
 * Much faster than brute force for large datasets.
 */
export class HNSWIndex implements VectorStore {
  private readonly documents: Map<string, IndexedDocument> = new Map();
  private readonly nodes: Map<string, HNSWNode> = new Map();
  private entryPoint: string | null = null;
  private maxLevel = 0;

  private readonly M: number;
  private readonly M0: number;
  private readonly efConstruction: number;
  private readonly efSearch: number;
  private readonly dimensions: number;
  private readonly ml: number;

  constructor(options: HNSWIndexOptions = {}) {
    this.M = options.M ?? 16;
    this.M0 = this.M * 2;
    this.efConstruction = options.efConstruction ?? 200;
    this.efSearch = options.efSearch ?? 50;
    this.dimensions = options.dimensions ?? 768;
    this.ml = 1 / Math.log(this.M);
  }

  async add(documents: IndexedDocument[]): Promise<void> {
    for (const doc of documents) {
      if (doc.embedding.dimensions !== this.dimensions) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimensions}, got ${doc.embedding.dimensions}`
        );
      }

      this.documents.set(doc.id, doc);
      this.insertNode(doc.id, doc.embedding.vector);
    }
  }

  private insertNode(id: string, vector: number[]): void {
    const level = this.randomLevel();

    const node: HNSWNode = {
      id,
      vector,
      connections: new Map(),
      level,
    };

    for (let l = 0; l <= level; l++) {
      node.connections.set(l, new Set());
    }

    this.nodes.set(id, node);

    if (!this.entryPoint) {
      this.entryPoint = id;
      this.maxLevel = level;
      return;
    }

    let currentId = this.entryPoint;

    // Navigate down to the insertion level
    for (let l = this.maxLevel; l > level; l--) {
      currentId = this.greedySearch(currentId, vector, l);
    }

    // Insert at each level
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const neighbors = this.searchLayer(currentId, vector, this.efConstruction, l);

      // Connect to closest neighbors
      const maxConnections = l === 0 ? this.M0 : this.M;
      const selected = neighbors.slice(0, maxConnections);

      for (const neighbor of selected) {
        node.connections.get(l)!.add(neighbor.id);
        const neighborNode = this.nodes.get(neighbor.id)!;
        neighborNode.connections.get(l)!.add(id);

        // Prune if too many connections
        if (neighborNode.connections.get(l)!.size > maxConnections) {
          this.pruneConnections(neighborNode, l, maxConnections);
        }
      }

      const firstNeighbor = neighbors[0];
      if (firstNeighbor) {
        currentId = firstNeighbor.id;
      }
    }

    // Update entry point if new node has higher level
    if (level > this.maxLevel) {
      this.entryPoint = id;
      this.maxLevel = level;
    }
  }

  private randomLevel(): number {
    let level = 0;
    while (Math.random() < Math.exp(-level / this.ml) && level < 32) {
      level++;
    }
    return level;
  }

  private greedySearch(startId: string, query: number[], level: number): string {
    let currentId = startId;
    let currentDist = this.distance(query, this.nodes.get(currentId)!.vector);

    let changed = true;
    while (changed) {
      changed = false;
      const node = this.nodes.get(currentId)!;
      const connections = node.connections.get(level);

      if (connections) {
        for (const neighborId of connections) {
          const neighborNode = this.nodes.get(neighborId);
          if (!neighborNode) continue;

          const dist = this.distance(query, neighborNode.vector);
          if (dist < currentDist) {
            currentId = neighborId;
            currentDist = dist;
            changed = true;
          }
        }
      }
    }

    return currentId;
  }

  private searchLayer(
    entryId: string,
    query: number[],
    ef: number,
    level: number
  ): Array<{ id: string; dist: number }> {
    const visited = new Set<string>([entryId]);
    const candidates: Array<{ id: string; dist: number }> = [
      { id: entryId, dist: this.distance(query, this.nodes.get(entryId)!.vector) },
    ];
    const results: Array<{ id: string; dist: number }> = [...candidates];

    while (candidates.length > 0) {
      // Get closest candidate
      candidates.sort((a, b) => a.dist - b.dist);
      const current = candidates.shift()!;

      // Check if we're done
      const furthest = results[results.length - 1];
      if (furthest && current.dist > furthest.dist) break;

      // Explore neighbors
      const node = this.nodes.get(current.id)!;
      const connections = node.connections.get(level);

      if (connections) {
        for (const neighborId of connections) {
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);

          const neighborNode = this.nodes.get(neighborId);
          if (!neighborNode) continue;

          const dist = this.distance(query, neighborNode.vector);

          const lastResult = results[results.length - 1];
          if (results.length < ef || (lastResult && dist < lastResult.dist)) {
            candidates.push({ id: neighborId, dist });
            results.push({ id: neighborId, dist });
            results.sort((a, b) => a.dist - b.dist);

            if (results.length > ef) {
              results.pop();
            }
          }
        }
      }
    }

    return results;
  }

  private pruneConnections(node: HNSWNode, level: number, maxConnections: number): void {
    const connections = node.connections.get(level)!;
    if (connections.size <= maxConnections) return;

    const scored: Array<{ id: string; dist: number }> = [];
    for (const connId of connections) {
      const connNode = this.nodes.get(connId);
      if (connNode) {
        scored.push({
          id: connId,
          dist: this.distance(node.vector, connNode.vector),
        });
      }
    }

    scored.sort((a, b) => a.dist - b.dist);
    const keep = scored.slice(0, maxConnections);

    node.connections.set(level, new Set(keep.map((s) => s.id)));
  }

  private distance(a: number[], b: number[]): number {
    // Use 1 - cosine similarity as distance
    return 1 - cosineSimilarity(a, b);
  }

  async search(
    query: Embedding,
    options: Omit<SearchQuery, 'text'>
  ): Promise<SearchResult[]> {
    if (!this.entryPoint) return [];

    const limit = options.limit ?? 10;
    const minSimilarity = options.min_similarity ?? 0;
    const typeFilter = options.type_filter;
    const languageFilter = options.language_filter;

    // Search HNSW
    let currentId = this.entryPoint;

    for (let l = this.maxLevel; l > 0; l--) {
      currentId = this.greedySearch(currentId, query.vector, l);
    }

    // Get more candidates than needed to account for filtering
    const candidates = this.searchLayer(currentId, query.vector, this.efSearch * 2, 0);

    // Filter and format results
    const results: SearchResult[] = [];
    let rank = 1;

    for (const candidate of candidates) {
      const doc = this.documents.get(candidate.id);
      if (!doc) continue;

      // Apply filters
      if (typeFilter && !typeFilter.includes(doc.type)) continue;
      if (languageFilter && doc.language && !languageFilter.includes(doc.language)) continue;

      const similarity = 1 - candidate.dist;
      if (similarity < minSimilarity) continue;

      results.push({
        document: doc,
        similarity,
        rank: rank++,
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.documents.delete(id);

      const node = this.nodes.get(id);
      if (!node) continue;

      // Remove connections to this node
      for (const [level, connections] of node.connections) {
        for (const connId of connections) {
          const connNode = this.nodes.get(connId);
          if (connNode) {
            connNode.connections.get(level)?.delete(id);
          }
        }
      }

      this.nodes.delete(id);

      // Update entry point if needed
      if (this.entryPoint === id) {
        const nextKey = this.nodes.keys().next();
        this.entryPoint = this.nodes.size > 0 && !nextKey.done ? nextKey.value : null;
        if (this.entryPoint) {
          const entryNode = this.nodes.get(this.entryPoint);
          this.maxLevel = entryNode ? entryNode.level : 0;
        } else {
          this.maxLevel = 0;
        }
      }
    }
  }

  async get(id: string): Promise<IndexedDocument | undefined> {
    return this.documents.get(id);
  }

  async has(id: string): Promise<boolean> {
    return this.documents.has(id);
  }

  async stats(): Promise<VectorStoreStats> {
    const byType: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};

    for (const doc of this.documents.values()) {
      byType[doc.type] = (byType[doc.type] ?? 0) + 1;
      if (doc.language) {
        byLanguage[doc.language] = (byLanguage[doc.language] ?? 0) + 1;
      }
    }

    // HNSW uses more memory for the graph structure
    const vectorBytes = this.documents.size * this.dimensions * 8;
    const graphBytes = this.nodes.size * this.M * 4 * 8; // Rough estimate
    const overheadBytes = this.documents.size * 500;

    return {
      total_documents: this.documents.size,
      documents_by_type: byType as Record<DocumentType, number>,
      documents_by_language: byLanguage,
      dimensions: this.dimensions,
      memory_bytes: vectorBytes + graphBytes + overheadBytes,
    };
  }

  async clear(): Promise<void> {
    this.documents.clear();
    this.nodes.clear();
    this.entryPoint = null;
    this.maxLevel = 0;
  }
}

// =============================================================================
// File-Backed Persistent Vector Store
// =============================================================================

/**
 * Options for file vector store.
 */
export interface FileVectorStoreOptions extends InMemoryVectorStoreOptions {
  /**
   * Path to store index file.
   */
  indexPath: string;

  /**
   * Auto-save after changes (debounced).
   * @default true
   */
  autoSave?: boolean;

  /**
   * Debounce interval for auto-save in ms.
   * @default 5000
   */
  saveDebounceMs?: number;

  /**
   * Load existing index on initialization.
   * @default true
   */
  loadOnInit?: boolean;
}

/**
 * Serialized index format for persistence.
 */
interface SerializedIndex {
  version: number;
  dimensions: number;
  similarity: 'cosine' | 'euclidean' | 'dot';
  documents: Array<{
    id: string;
    content: string;
    type: DocumentType;
    language?: string;
    metadata?: Record<string, unknown>;
    embedding: {
      vector: number[];
      dimensions: number;
      model: string;
    };
    indexed_at: number;
  }>;
  created_at: number;
  updated_at: number;
}

/**
 * File-backed persistent vector store.
 * Extends InMemoryVectorStore with file persistence.
 */
export class FileVectorStore implements VectorStore {
  private readonly inner: InMemoryVectorStore;
  private readonly indexPath: string;
  private readonly autoSave: boolean;
  private readonly saveDebounceMs: number;
  private readonly dimensions: number;
  private readonly similarity: 'cosine' | 'euclidean' | 'dot';
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private initialized = false;

  constructor(options: FileVectorStoreOptions) {
    this.indexPath = options.indexPath;
    this.autoSave = options.autoSave ?? true;
    this.saveDebounceMs = options.saveDebounceMs ?? 5000;
    this.dimensions = options.dimensions ?? 768;
    this.similarity = options.similarity ?? 'cosine';
    this.inner = new InMemoryVectorStore(options);
  }

  /**
   * Initialize the store (load existing data if present).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(this.indexPath, 'utf-8');
      const data = JSON.parse(content) as SerializedIndex;

      // Validate version
      if (data.version !== 1) {
        console.warn(`[FileVectorStore] Unknown index version: ${data.version}, starting fresh`);
        this.initialized = true;
        return;
      }

      // Load documents
      const documents: IndexedDocument[] = data.documents.map((d) => {
        const doc: IndexedDocument = {
          id: d.id,
          content: d.content,
          type: d.type,
          embedding: {
            vector: d.embedding.vector,
            dimensions: d.embedding.dimensions,
            model: d.embedding.model,
          },
          indexed_at: d.indexed_at,
        };
        if (d.language !== undefined) doc.language = d.language;
        if (d.metadata !== undefined) doc.metadata = d.metadata;
        return doc;
      });

      await this.inner.add(documents);
      console.log(`[FileVectorStore] Loaded ${documents.length} documents from ${this.indexPath}`);
    } catch (error) {
      // File doesn't exist or is invalid - start fresh
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[FileVectorStore] Failed to load index: ${error}`);
      }
    }

    this.initialized = true;
  }

  async add(documents: IndexedDocument[]): Promise<void> {
    if (!this.initialized) await this.initialize();

    await this.inner.add(documents);
    this.markDirty();
  }

  async remove(ids: string[]): Promise<void> {
    if (!this.initialized) await this.initialize();

    await this.inner.remove(ids);
    this.markDirty();
  }

  async search(
    query: Embedding,
    options: Omit<SearchQuery, 'text'>
  ): Promise<SearchResult[]> {
    if (!this.initialized) await this.initialize();

    return this.inner.search(query, options);
  }

  async get(id: string): Promise<IndexedDocument | undefined> {
    if (!this.initialized) await this.initialize();

    return this.inner.get(id);
  }

  async has(id: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    return this.inner.has(id);
  }

  async stats(): Promise<VectorStoreStats> {
    if (!this.initialized) await this.initialize();

    return this.inner.stats();
  }

  async clear(): Promise<void> {
    if (!this.initialized) await this.initialize();

    await this.inner.clear();
    this.markDirty();
  }

  /**
   * Save the index to disk immediately.
   */
  async save(): Promise<void> {
    if (!this.initialized) await this.initialize();

    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');

    // Ensure directory exists
    await mkdir(dirname(this.indexPath), { recursive: true });

    // Collect all documents
    const stats = await this.inner.stats();
    const documents: SerializedIndex['documents'] = [];

    // Get all documents (we need to iterate through the internal map)
    // Since we can't directly access the private map, we'll collect via stats
    // This is a limitation - ideally we'd expose an iterator

    // For now, we'll use a workaround by searching with high limit
    if (stats.total_documents > 0) {
      // We need to get all documents - let's add a method to access them
      const allDocs = await this.getAllDocuments();
      for (const doc of allDocs) {
        const serializedDoc: SerializedIndex['documents'][number] = {
          id: doc.id,
          content: doc.content,
          type: doc.type,
          embedding: {
            vector: doc.embedding.vector,
            dimensions: doc.embedding.dimensions,
            model: doc.embedding.model,
          },
          indexed_at: doc.indexed_at,
        };
        if (doc.language !== undefined) serializedDoc.language = doc.language;
        if (doc.metadata !== undefined) serializedDoc.metadata = doc.metadata;
        documents.push(serializedDoc);
      }
    }

    const serialized: SerializedIndex = {
      version: 1,
      dimensions: this.dimensions,
      similarity: this.similarity,
      documents,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await writeFile(this.indexPath, JSON.stringify(serialized), 'utf-8');
    this.dirty = false;

    console.log(`[FileVectorStore] Saved ${documents.length} documents to ${this.indexPath}`);
  }

  /**
   * Get all documents (for serialization).
   * This is a workaround since we can't access the inner store's private map.
   */
  private async getAllDocuments(): Promise<IndexedDocument[]> {
    // Use a dummy zero-vector query with very low threshold to get all docs
    const stats = await this.inner.stats();
    if (stats.total_documents === 0) return [];

    const dummyQuery: Embedding = {
      vector: new Array(this.dimensions).fill(0),
      dimensions: this.dimensions,
      model: 'dummy',
    };

    // Search with limit set to total and very low threshold
    const results = await this.inner.search(dummyQuery, {
      limit: stats.total_documents * 2, // Safety margin
      min_similarity: -1, // Accept all
    });

    return results.map((r) => r.document);
  }

  /**
   * Mark index as dirty (needs saving).
   */
  private markDirty(): void {
    this.dirty = true;

    if (this.autoSave) {
      this.scheduleSave();
    }
  }

  /**
   * Schedule a debounced save.
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.save().catch((err) => {
        console.error('[FileVectorStore] Auto-save failed:', err);
      });
    }, this.saveDebounceMs);
  }

  /**
   * Check if there are unsaved changes.
   */
  isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Flush any pending saves and close.
   */
  async close(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    if (this.dirty) {
      await this.save();
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Vector store type.
 */
export type VectorStoreType = 'memory' | 'hnsw' | 'file';

/**
 * Create a vector store.
 */
export function createVectorStore(
  type: VectorStoreType = 'memory',
  options: InMemoryVectorStoreOptions | HNSWIndexOptions | FileVectorStoreOptions = {}
): VectorStore {
  switch (type) {
    case 'hnsw':
      return new HNSWIndex(options as HNSWIndexOptions);
    case 'file':
      return new FileVectorStore(options as FileVectorStoreOptions);
    case 'memory':
    default:
      return new InMemoryVectorStore(options as InMemoryVectorStoreOptions);
  }
}

/**
 * Create a persistent vector store.
 */
export function createPersistentVectorStore(
  indexPath: string,
  options: Partial<Omit<FileVectorStoreOptions, 'indexPath'>> = {}
): FileVectorStore {
  return new FileVectorStore({
    indexPath,
    ...options,
  });
}
