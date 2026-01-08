/**
 * State Management
 * ================
 *
 * Persistence, checkpointing, and state recovery for agents.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// =============================================================================
// Types
// =============================================================================

/**
 * Serializable agent state.
 */
export interface SerializableAgentState {
  /**
   * Agent ID.
   */
  agent_id: string;

  /**
   * Configuration.
   */
  config: Record<string, unknown>;

  /**
   * Statistics.
   */
  stats: Record<string, number>;

  /**
   * Pending reviews (serialized).
   */
  pending_reviews: Array<{
    id: string;
    request: Record<string, unknown>;
    result: Record<string, unknown>;
  }>;

  /**
   * Learning outcomes (from PromptLearner).
   */
  learning_outcomes: Array<{
    prompt: string;
    language: string;
    succeeded: boolean;
    confidence: number;
    timestamp: number;
    error_type?: string;
    error_message?: string;
  }>;

  /**
   * Learned patterns.
   */
  learned_patterns: Array<{
    id: string;
    description: string;
    triggers: string[];
    additions: string[];
    success_rate: number;
    applications: number;
  }>;

  /**
   * Timestamp when state was saved.
   */
  saved_at: number;

  /**
   * Schema version for forward compatibility.
   */
  schema_version: number;
}

/**
 * Checkpoint metadata.
 */
export interface CheckpointMeta {
  /**
   * Checkpoint ID.
   */
  id: string;

  /**
   * Agent ID.
   */
  agent_id: string;

  /**
   * When checkpoint was created.
   */
  created_at: number;

  /**
   * Description.
   */
  description?: string;

  /**
   * Size in bytes.
   */
  size_bytes: number;

  /**
   * File path.
   */
  path: string;
}

/**
 * State storage interface.
 */
export interface StateStorage {
  /**
   * Save state.
   */
  save(state: SerializableAgentState): Promise<void>;

  /**
   * Load state.
   */
  load(agentId: string): Promise<SerializableAgentState | null>;

  /**
   * Delete state.
   */
  delete(agentId: string): Promise<void>;

  /**
   * List all saved states.
   */
  list(): Promise<string[]>;

  /**
   * Create checkpoint.
   */
  checkpoint(state: SerializableAgentState, description?: string): Promise<CheckpointMeta>;

  /**
   * List checkpoints.
   */
  listCheckpoints(agentId: string): Promise<CheckpointMeta[]>;

  /**
   * Restore from checkpoint.
   */
  restoreCheckpoint(checkpointId: string): Promise<SerializableAgentState | null>;

  /**
   * Delete checkpoint.
   */
  deleteCheckpoint(checkpointId: string): Promise<void>;
}

// =============================================================================
// Current Schema Version
// =============================================================================

export const STATE_SCHEMA_VERSION = 1;

// =============================================================================
// File-Based State Storage
// =============================================================================

/**
 * File-based state storage.
 */
export class FileStateStorage implements StateStorage {
  private readonly baseDir: string;
  private readonly checkpointDir: string;

  constructor(baseDir: string = '.agent-state') {
    this.baseDir = baseDir;
    this.checkpointDir = join(baseDir, 'checkpoints');
  }

  /**
   * Ensure directories exist.
   */
  private async ensureDirs(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(this.checkpointDir, { recursive: true });
  }

  /**
   * Get state file path.
   */
  private getStatePath(agentId: string): string {
    return join(this.baseDir, `${agentId}.json`);
  }

  /**
   * Get checkpoint file path.
   */
  private getCheckpointPath(checkpointId: string): string {
    return join(this.checkpointDir, `${checkpointId}.json`);
  }

  async save(state: SerializableAgentState): Promise<void> {
    await this.ensureDirs();
    const path = this.getStatePath(state.agent_id);
    await writeFile(path, JSON.stringify(state, null, 2), 'utf-8');
  }

  async load(agentId: string): Promise<SerializableAgentState | null> {
    try {
      const path = this.getStatePath(agentId);
      const content = await readFile(path, 'utf-8');
      const state = JSON.parse(content) as SerializableAgentState;

      // Migrate if needed
      return this.migrate(state);
    } catch {
      return null;
    }
  }

  async delete(agentId: string): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.getStatePath(agentId));
    } catch {
      // Ignore if doesn't exist
    }
  }

  async list(): Promise<string[]> {
    try {
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(this.baseDir);
      return files
        .filter((f) => f.endsWith('.json') && !f.startsWith('checkpoint'))
        .map((f) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  async checkpoint(
    state: SerializableAgentState,
    description?: string
  ): Promise<CheckpointMeta> {
    await this.ensureDirs();

    const checkpointId = `${state.agent_id}_${Date.now()}`;
    const path = this.getCheckpointPath(checkpointId);
    const content = JSON.stringify(state, null, 2);

    await writeFile(path, content, 'utf-8');

    const meta: CheckpointMeta = {
      id: checkpointId,
      agent_id: state.agent_id,
      created_at: Date.now(),
      size_bytes: Buffer.byteLength(content, 'utf-8'),
      path,
    };
    if (description) meta.description = description;

    // Save metadata
    await writeFile(
      this.getCheckpointPath(`${checkpointId}.meta`),
      JSON.stringify(meta, null, 2),
      'utf-8'
    );

    return meta;
  }

  async listCheckpoints(agentId: string): Promise<CheckpointMeta[]> {
    try {
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(this.checkpointDir);
      const metas: CheckpointMeta[] = [];

      for (const file of files) {
        if (file.endsWith('.meta.json') && file.startsWith(agentId)) {
          try {
            const content = await readFile(
              join(this.checkpointDir, file),
              'utf-8'
            );
            metas.push(JSON.parse(content) as CheckpointMeta);
          } catch {
            // Skip invalid
          }
        }
      }

      return metas.sort((a, b) => b.created_at - a.created_at);
    } catch {
      return [];
    }
  }

  async restoreCheckpoint(checkpointId: string): Promise<SerializableAgentState | null> {
    try {
      const path = this.getCheckpointPath(checkpointId);
      const content = await readFile(path, 'utf-8');
      const state = JSON.parse(content) as SerializableAgentState;
      return this.migrate(state);
    } catch {
      return null;
    }
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.getCheckpointPath(checkpointId));
      await unlink(this.getCheckpointPath(`${checkpointId}.meta`)).catch(() => {});
    } catch {
      // Ignore
    }
  }

  /**
   * Migrate state to current schema version.
   */
  private migrate(state: SerializableAgentState): SerializableAgentState {
    // Add migrations here as schema evolves
    if (!state.schema_version || state.schema_version < STATE_SCHEMA_VERSION) {
      state.schema_version = STATE_SCHEMA_VERSION;
    }
    return state;
  }
}

// =============================================================================
// In-Memory State Storage (for testing)
// =============================================================================

/**
 * In-memory state storage.
 */
export class MemoryStateStorage implements StateStorage {
  private states: Map<string, SerializableAgentState> = new Map();
  private checkpoints: Map<string, { state: SerializableAgentState; meta: CheckpointMeta }> = new Map();

  async save(state: SerializableAgentState): Promise<void> {
    this.states.set(state.agent_id, JSON.parse(JSON.stringify(state)));
  }

  async load(agentId: string): Promise<SerializableAgentState | null> {
    const state = this.states.get(agentId);
    return state ? JSON.parse(JSON.stringify(state)) : null;
  }

  async delete(agentId: string): Promise<void> {
    this.states.delete(agentId);
  }

  async list(): Promise<string[]> {
    return Array.from(this.states.keys());
  }

  async checkpoint(
    state: SerializableAgentState,
    description?: string
  ): Promise<CheckpointMeta> {
    const checkpointId = `${state.agent_id}_${Date.now()}`;
    const content = JSON.stringify(state);

    const meta: CheckpointMeta = {
      id: checkpointId,
      agent_id: state.agent_id,
      created_at: Date.now(),
      size_bytes: content.length,
      path: `memory://${checkpointId}`,
    };
    if (description) meta.description = description;

    this.checkpoints.set(checkpointId, {
      state: JSON.parse(content),
      meta,
    });

    return meta;
  }

  async listCheckpoints(agentId: string): Promise<CheckpointMeta[]> {
    const metas: CheckpointMeta[] = [];
    for (const [id, entry] of this.checkpoints.entries()) {
      if (id.startsWith(agentId)) {
        metas.push(entry.meta);
      }
    }
    return metas.sort((a, b) => b.created_at - a.created_at);
  }

  async restoreCheckpoint(checkpointId: string): Promise<SerializableAgentState | null> {
    const entry = this.checkpoints.get(checkpointId);
    return entry ? JSON.parse(JSON.stringify(entry.state)) : null;
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    this.checkpoints.delete(checkpointId);
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.states.clear();
    this.checkpoints.clear();
  }
}

// =============================================================================
// State Manager
// =============================================================================

/**
 * State manager for agents.
 */
export class StateManager {
  private readonly storage: StateStorage;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private dirty = false;
  private currentState: SerializableAgentState | null = null;

  constructor(storage?: StateStorage) {
    this.storage = storage ?? new FileStateStorage();
  }

  /**
   * Start auto-save with interval.
   */
  startAutoSave(intervalMs: number = 60000): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      if (this.dirty && this.currentState) {
        await this.save(this.currentState);
        this.dirty = false;
      }
    }, intervalMs);
  }

  /**
   * Stop auto-save.
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * Mark state as dirty (needs saving).
   */
  markDirty(state: SerializableAgentState): void {
    this.currentState = state;
    this.dirty = true;
  }

  /**
   * Save state immediately.
   */
  async save(state: SerializableAgentState): Promise<void> {
    state.saved_at = Date.now();
    state.schema_version = STATE_SCHEMA_VERSION;
    await this.storage.save(state);
    this.currentState = state;
    this.dirty = false;
  }

  /**
   * Load state.
   */
  async load(agentId: string): Promise<SerializableAgentState | null> {
    const state = await this.storage.load(agentId);
    if (state) {
      this.currentState = state;
    }
    return state;
  }

  /**
   * Delete state.
   */
  async delete(agentId: string): Promise<void> {
    await this.storage.delete(agentId);
    if (this.currentState?.agent_id === agentId) {
      this.currentState = null;
    }
  }

  /**
   * List all saved agent states.
   */
  async list(): Promise<string[]> {
    return this.storage.list();
  }

  /**
   * Create a checkpoint of current state.
   */
  async createCheckpoint(
    state: SerializableAgentState,
    description?: string
  ): Promise<CheckpointMeta> {
    return this.storage.checkpoint(state, description);
  }

  /**
   * List checkpoints for an agent.
   */
  async listCheckpoints(agentId: string): Promise<CheckpointMeta[]> {
    return this.storage.listCheckpoints(agentId);
  }

  /**
   * Restore from a checkpoint.
   */
  async restoreCheckpoint(checkpointId: string): Promise<SerializableAgentState | null> {
    const state = await this.storage.restoreCheckpoint(checkpointId);
    if (state) {
      this.currentState = state;
    }
    return state;
  }

  /**
   * Delete a checkpoint.
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    await this.storage.deleteCheckpoint(checkpointId);
  }

  /**
   * Get storage backend.
   */
  getStorage(): StateStorage {
    return this.storage;
  }
}

// =============================================================================
// Memory Management
// =============================================================================

/**
 * Configuration for memory management.
 */
export interface MemoryConfig {
  /**
   * Maximum pending reviews before cleanup.
   */
  maxPendingReviews?: number;

  /**
   * Review TTL in milliseconds.
   */
  reviewTTL?: number;

  /**
   * Maximum learning outcomes to keep.
   */
  maxLearningOutcomes?: number;

  /**
   * Cleanup interval in milliseconds.
   */
  cleanupIntervalMs?: number;
}

/**
 * Memory cleanup helper.
 */
export class MemoryManager {
  private readonly config: Required<MemoryConfig>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: MemoryConfig = {}) {
    this.config = {
      maxPendingReviews: config.maxPendingReviews ?? 100,
      reviewTTL: config.reviewTTL ?? 3600000, // 1 hour
      maxLearningOutcomes: config.maxLearningOutcomes ?? 1000,
      cleanupIntervalMs: config.cleanupIntervalMs ?? 300000, // 5 minutes
    };
  }

  /**
   * Start periodic cleanup.
   */
  startPeriodicCleanup(
    cleanupFn: () => void
  ): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(cleanupFn, this.config.cleanupIntervalMs);
  }

  /**
   * Stop periodic cleanup.
   */
  stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Cleanup old pending reviews.
   */
  cleanupPendingReviews<T extends { timestamp?: number }>(
    reviews: Map<string, T>
  ): number {
    const now = Date.now();
    let removed = 0;

    // Remove expired
    for (const [id, review] of reviews.entries()) {
      if (review.timestamp && now - review.timestamp > this.config.reviewTTL) {
        reviews.delete(id);
        removed++;
      }
    }

    // Remove oldest if over limit
    while (reviews.size > this.config.maxPendingReviews) {
      const firstKey = reviews.keys().next().value;
      if (firstKey) {
        reviews.delete(firstKey);
        removed++;
      } else {
        break;
      }
    }

    return removed;
  }

  /**
   * Trim learning outcomes.
   */
  trimLearningOutcomes<T>(outcomes: T[]): T[] {
    if (outcomes.length > this.config.maxLearningOutcomes) {
      return outcomes.slice(-this.config.maxLearningOutcomes);
    }
    return outcomes;
  }

  /**
   * Get configuration.
   */
  getConfig(): Required<MemoryConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a state manager.
 */
export function createStateManager(storage?: StateStorage): StateManager {
  return new StateManager(storage);
}

/**
 * Create a file-based state manager.
 */
export function createFileStateManager(baseDir: string = '.agent-state'): StateManager {
  return new StateManager(new FileStateStorage(baseDir));
}

/**
 * Create an in-memory state manager (for testing).
 */
export function createMemoryStateManager(): StateManager {
  return new StateManager(new MemoryStateStorage());
}

/**
 * Create a memory manager.
 */
export function createMemoryManager(config?: MemoryConfig): MemoryManager {
  return new MemoryManager(config);
}
