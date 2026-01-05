/**
 * Model Adapter Interface
 * =======================
 *
 * Defines the boundary between the context engine kernel and AI model implementations.
 * This abstraction enables:
 *
 * 1. Model-agnostic intent processing
 * 2. Deterministic replay with recorded responses
 * 3. Testing without live model calls
 * 4. Multi-model orchestration
 *
 * Design Principles:
 * - All methods return Promises (async boundary)
 * - Context includes all information needed for audit trails
 * - Results include metrics for observability
 * - No model-specific types leak through the interface
 */

// =============================================================================
// Context Types
// =============================================================================

/**
 * Execution mode for transform operations.
 */
export type TransformMode = 'plan-only' | 'execute' | 'clarify';

/**
 * Context provided to the model for a transform operation.
 * All fields are deterministic and audit-friendly.
 */
export interface TransformContext {
  /**
   * Unique identifier for the intent being processed.
   */
  intent_id: string;

  /**
   * Unique identifier for this execution run.
   * Used for correlation in audit trails.
   */
  run_id: string;

  /**
   * Execution mode.
   */
  mode: TransformMode;

  /**
   * Constraints to apply during transformation.
   * ORDERING: Sorted lexicographically.
   */
  constraints: readonly string[];

  /**
   * Additional context key-value pairs.
   * Canonicalized for determinism.
   */
  metadata: Readonly<Record<string, unknown>>;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of a transform operation.
 */
export interface TransformResult {
  /**
   * The transformed content.
   */
  content: string;

  /**
   * Number of tokens used in the request.
   */
  tokens_input: number;

  /**
   * Number of tokens generated in the response.
   */
  tokens_output: number;

  /**
   * Latency in milliseconds.
   */
  latency_ms: number;

  /**
   * Model version string for audit trails.
   */
  model_version: string;

  /**
   * Whether the response was from cache/replay.
   */
  from_cache: boolean;
}

// =============================================================================
// Capability Types
// =============================================================================

/**
 * Declared capabilities of a model adapter.
 */
export interface ModelCapabilities {
  /**
   * Maximum context window size in tokens.
   */
  max_context_tokens: number;

  /**
   * Maximum output tokens.
   */
  max_output_tokens: number;

  /**
   * Whether the model supports structured JSON output.
   */
  supports_structured_output: boolean;

  /**
   * Whether the model supports tool/function calling.
   */
  supports_tool_use: boolean;

  /**
   * Whether the model supports streaming responses.
   */
  supports_streaming: boolean;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for adapter failures.
 */
export type AdapterErrorCode =
  | 'RATE_LIMITED'       // Model rate limit exceeded
  | 'CONTEXT_TOO_LONG'   // Input exceeds context window
  | 'INVALID_REQUEST'    // Malformed request
  | 'MODEL_ERROR'        // Model returned an error
  | 'NETWORK_ERROR'      // Network failure
  | 'TIMEOUT'            // Request timed out
  | 'REPLAY_MISS'        // No recorded response for replay
  | 'ADAPTER_ERROR';     // Generic adapter error

/**
 * Structured error from adapter operations.
 */
export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

// =============================================================================
// Model Adapter Interface
// =============================================================================

/**
 * Interface for model adapters.
 *
 * All adapters must implement this interface. The kernel interacts with
 * models exclusively through this boundary.
 *
 * Implementations:
 * - MockModelAdapter: Returns pre-configured responses for testing
 * - RecordingModelAdapter: Wraps another adapter and records interactions
 * - ReplayModelAdapter: Replays recorded interactions deterministically
 * - (Future) ClaudeAdapter: Live Claude API integration
 * - (Future) OpenAIAdapter: Live OpenAI API integration
 */
export interface ModelAdapter {
  /**
   * Unique identifier for this adapter instance.
   * Format: `{type}_{hash8}` (e.g., `mock_a1b2c3d4`)
   */
  readonly adapter_id: string;

  /**
   * Human-readable model identifier.
   * Examples: "mock", "claude-3-opus", "gpt-4-turbo"
   */
  readonly model_id: string;

  /**
   * Declared capabilities of this adapter.
   */
  readonly capabilities: ModelCapabilities;

  /**
   * Transform content using the model.
   *
   * This is the core operation. The adapter takes a prompt and context,
   * invokes the model (or mock/replay), and returns the result.
   *
   * @param prompt - The prompt to send to the model
   * @param context - Execution context for audit and determinism
   * @returns Promise resolving to transform result
   * @throws AdapterError on failure
   */
  transform(prompt: string, context: TransformContext): Promise<TransformResult>;

  /**
   * Check if the adapter is ready to accept requests.
   * Useful for health checks and initialization validation.
   */
  isReady(): Promise<boolean>;

  /**
   * Gracefully shutdown the adapter.
   * Implementations should flush any pending state.
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Recording Types
// =============================================================================

/**
 * A recorded interaction between kernel and model.
 * Used by RecordingModelAdapter and ReplayModelAdapter.
 */
export interface RecordedInteraction {
  /**
   * Sequence number within the recording.
   */
  sequence: number;

  /**
   * Hash of the prompt for lookup.
   */
  prompt_hash: string;

  /**
   * The full prompt (for debugging).
   */
  prompt: string;

  /**
   * The context provided.
   */
  context: TransformContext;

  /**
   * The result returned.
   */
  result: TransformResult;

  /**
   * Timestamp when recorded (ISO 8601).
   */
  recorded_at: string;
}

/**
 * A complete recording session.
 */
export interface RecordingSession {
  /**
   * Recording format version.
   */
  format_version: '1.0';

  /**
   * When the recording started.
   */
  started_at: string;

  /**
   * When the recording ended.
   */
  ended_at: string;

  /**
   * Model ID that was recorded.
   */
  model_id: string;

  /**
   * All recorded interactions.
   * ORDERING: By sequence number ascending.
   */
  interactions: RecordedInteraction[];

  /**
   * Summary statistics.
   */
  stats: {
    total_interactions: number;
    total_tokens_input: number;
    total_tokens_output: number;
    total_latency_ms: number;
  };
}
