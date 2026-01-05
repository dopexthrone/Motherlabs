/**
 * Recording Model Adapter
 * =======================
 *
 * Wraps another adapter and records all interactions for later replay.
 * Useful for capturing live model responses for deterministic testing.
 *
 * Usage:
 * ```typescript
 * const liveAdapter = new ClaudeAdapter(...);
 * const recorder = new RecordingModelAdapter(liveAdapter);
 *
 * // Use recorder instead of liveAdapter
 * await recorder.transform(prompt, context);
 *
 * // Save the recording
 * await recorder.saveRecording('recordings/session_001.json');
 * ```
 */

import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import type {
  ModelAdapter,
  ModelCapabilities,
  TransformContext,
  TransformResult,
  RecordedInteraction,
  RecordingSession,
} from './model.js';
import { AdapterError } from './model.js';

// =============================================================================
// Recording Model Adapter Implementation
// =============================================================================

/**
 * Options for RecordingModelAdapter.
 */
export interface RecordingModelAdapterOptions {
  /**
   * Maximum interactions to record (default: unlimited).
   */
  max_interactions?: number;

  /**
   * Whether to include full prompts in recording (default: true).
   * Set to false for privacy-sensitive prompts.
   */
  include_prompts?: boolean;
}

/**
 * Model adapter that records all interactions with a delegate adapter.
 */
export class RecordingModelAdapter implements ModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly delegate: ModelAdapter;
  private readonly maxInteractions: number;
  private readonly includePrompts: boolean;
  private readonly interactions: RecordedInteraction[] = [];
  private startedAt: string;
  private sequence = 0;

  constructor(delegate: ModelAdapter, options: RecordingModelAdapterOptions = {}) {
    this.delegate = delegate;
    this.model_id = delegate.model_id;
    this.adapter_id = `recording_${this.hashString(delegate.adapter_id).slice(0, 8)}`;
    this.capabilities = delegate.capabilities;
    this.maxInteractions = options.max_interactions ?? Infinity;
    this.includePrompts = options.include_prompts ?? true;
    this.startedAt = new Date().toISOString();
  }

  async transform(prompt: string, context: TransformContext): Promise<TransformResult> {
    // Check recording limit
    if (this.interactions.length >= this.maxInteractions) {
      throw new AdapterError(
        'ADAPTER_ERROR',
        `Recording limit reached (${this.maxInteractions} interactions)`,
        false
      );
    }

    // Call delegate
    const result = await this.delegate.transform(prompt, context);

    // Record interaction
    const interaction: RecordedInteraction = {
      sequence: this.sequence++,
      prompt_hash: this.hashString(prompt),
      prompt: this.includePrompts ? prompt : '[REDACTED]',
      context,
      result,
      recorded_at: new Date().toISOString(),
    };

    this.interactions.push(interaction);

    return result;
  }

  async isReady(): Promise<boolean> {
    return this.delegate.isReady();
  }

  async shutdown(): Promise<void> {
    await this.delegate.shutdown();
  }

  /**
   * Get all recorded interactions.
   */
  getInteractions(): readonly RecordedInteraction[] {
    return this.interactions;
  }

  /**
   * Get recording statistics.
   */
  getStats(): RecordingSession['stats'] {
    return this.interactions.reduce(
      (acc, i) => ({
        total_interactions: acc.total_interactions + 1,
        total_tokens_input: acc.total_tokens_input + i.result.tokens_input,
        total_tokens_output: acc.total_tokens_output + i.result.tokens_output,
        total_latency_ms: acc.total_latency_ms + i.result.latency_ms,
      }),
      { total_interactions: 0, total_tokens_input: 0, total_tokens_output: 0, total_latency_ms: 0 }
    );
  }

  /**
   * Export recording as a session object.
   */
  exportSession(): RecordingSession {
    return {
      format_version: '1.0',
      started_at: this.startedAt,
      ended_at: new Date().toISOString(),
      model_id: this.model_id,
      interactions: [...this.interactions],
      stats: this.getStats(),
    };
  }

  /**
   * Save recording to a file.
   */
  async saveRecording(path: string): Promise<void> {
    const session = this.exportSession();
    const content = JSON.stringify(session, null, 2);
    await writeFile(path, content, 'utf-8');
  }

  /**
   * Clear recorded interactions (start fresh).
   */
  clearRecording(): void {
    this.interactions.length = 0;
    this.sequence = 0;
    this.startedAt = new Date().toISOString();
  }

  private hashString(s: string): string {
    return createHash('sha256').update(s, 'utf-8').digest('hex');
  }
}

// =============================================================================
// Replay Model Adapter Implementation
// =============================================================================

/**
 * Options for ReplayModelAdapter.
 */
export interface ReplayModelAdapterOptions {
  /**
   * Whether to fail on missing recordings (default: true).
   * If false, returns empty content for unrecorded prompts.
   */
  strict?: boolean;

  /**
   * Whether to replay in sequence order (default: false).
   * If true, prompts must be replayed in the same order as recorded.
   */
  sequential?: boolean;
}

/**
 * Model adapter that replays recorded interactions deterministically.
 *
 * Responses are looked up by prompt hash, ensuring deterministic results
 * regardless of timing or network conditions.
 */
export class ReplayModelAdapter implements ModelAdapter {
  readonly adapter_id: string;
  readonly model_id: string;
  readonly capabilities: ModelCapabilities;

  private readonly responseMap: Map<string, RecordedInteraction>;
  private readonly sequentialResponses: RecordedInteraction[];
  private readonly strict: boolean;
  private readonly sequential: boolean;
  private replayIndex = 0;

  constructor(session: RecordingSession, options: ReplayModelAdapterOptions = {}) {
    this.model_id = session.model_id;
    this.adapter_id = `replay_${this.hashString(session.started_at).slice(0, 8)}`;
    this.strict = options.strict ?? true;
    this.sequential = options.sequential ?? false;

    // Build lookup map
    this.responseMap = new Map();
    for (const interaction of session.interactions) {
      this.responseMap.set(interaction.prompt_hash, interaction);
    }

    // Keep sequential order for sequential replay mode
    this.sequentialResponses = [...session.interactions].sort((a, b) => a.sequence - b.sequence);

    // Derive capabilities from recorded model
    this.capabilities = {
      max_context_tokens: 100000,
      max_output_tokens: 4096,
      supports_structured_output: true,
      supports_tool_use: false,
      supports_streaming: false,
    };
  }

  async transform(prompt: string, context: TransformContext): Promise<TransformResult> {
    const promptHash = this.hashString(prompt);
    let interaction: RecordedInteraction | undefined;

    if (this.sequential) {
      // Sequential mode: must replay in order
      interaction = this.sequentialResponses[this.replayIndex];
      if (interaction && interaction.prompt_hash !== promptHash) {
        throw new AdapterError(
          'REPLAY_MISS',
          `Sequential replay mismatch at index ${this.replayIndex}. ` +
          `Expected hash ${interaction.prompt_hash}, got ${promptHash}`,
          false
        );
      }
      this.replayIndex++;
    } else {
      // Hash lookup mode
      interaction = this.responseMap.get(promptHash);
    }

    if (!interaction) {
      if (this.strict) {
        throw new AdapterError(
          'REPLAY_MISS',
          `No recorded response for prompt hash: ${promptHash}`,
          false,
          { prompt_preview: prompt.slice(0, 100) }
        );
      }

      // Non-strict: return empty response
      return {
        content: '',
        tokens_input: 0,
        tokens_output: 0,
        latency_ms: 0,
        model_version: `${this.model_id}-replay`,
        from_cache: true,
      };
    }

    // Return recorded result (with zero latency for determinism)
    return {
      ...interaction.result,
      latency_ms: 0,
      from_cache: true,
    };
  }

  async isReady(): Promise<boolean> {
    return true;
  }

  async shutdown(): Promise<void> {
    // No-op for replay
  }

  /**
   * Get number of recorded interactions available.
   */
  getRecordingCount(): number {
    return this.responseMap.size;
  }

  /**
   * Check if a prompt hash has a recorded response.
   */
  hasRecording(promptHash: string): boolean {
    return this.responseMap.has(promptHash);
  }

  /**
   * Reset sequential replay index.
   */
  resetSequence(): void {
    this.replayIndex = 0;
  }

  private hashString(s: string): string {
    return createHash('sha256').update(s, 'utf-8').digest('hex');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Load a replay adapter from a recording file.
 */
export async function loadReplayAdapter(
  path: string,
  options?: ReplayModelAdapterOptions
): Promise<ReplayModelAdapter> {
  const content = await readFile(path, 'utf-8');
  const session = JSON.parse(content) as RecordingSession;
  return new ReplayModelAdapter(session, options);
}
