/**
 * Adapter Exports
 * ===============
 *
 * Re-export all adapter types and implementations.
 */

// Types and interface
export type {
  ModelAdapter,
  ModelCapabilities,
  TransformContext,
  TransformMode,
  TransformResult,
  AdapterErrorCode,
  RecordedInteraction,
  RecordingSession,
  // Streaming types
  StreamChunk,
  StreamResult,
  StreamEventType,
  StreamEvent,
  StreamingModelAdapter,
} from './model.js';

export {
  AdapterError,
  // Streaming utilities
  isStreamingAdapter,
  collectStream,
  simulateStream,
} from './model.js';

// Mock adapter
export type {
  MockResponse,
  MockDefaultBehavior,
  MockModelAdapterOptions,
} from './mock.js';

export {
  MockModelAdapter,
  createEchoAdapter,
  createFixedAdapter,
  createAdapterFromRecording,
} from './mock.js';

// Recording and replay adapters
export type {
  RecordingModelAdapterOptions,
  ReplayModelAdapterOptions,
} from './recording.js';

export {
  RecordingModelAdapter,
  ReplayModelAdapter,
  loadReplayAdapter,
} from './recording.js';

// Claude adapter
export type { ClaudeModel, ClaudeAdapterOptions } from './claude.js';

export {
  ClaudeAdapter,
  createClaudeAdapter,
  createClaudeDevAdapter,
  getClaudeCapabilities,
} from './claude.js';

// OpenAI adapter
export type { OpenAIModel, OpenAIAdapterOptions } from './openai.js';

export {
  OpenAIAdapter,
  createOpenAIAdapter,
  createOpenAIDevAdapter,
  getOpenAICapabilities,
} from './openai.js';

// Ollama adapter
export type { OllamaModel, OllamaAdapterOptions } from './ollama.js';

export {
  OllamaAdapter,
  createOllamaAdapter,
  createOllamaDevAdapter,
  isOllamaAvailable,
  listOllamaModels,
} from './ollama.js';

// Gemini adapter
export type { GeminiModel, GeminiAdapterOptions } from './gemini.js';

export {
  GeminiAdapter,
  createGeminiAdapter,
  createGeminiDevAdapter,
  getGeminiCapabilities,
  isGeminiConfigured,
} from './gemini.js';

// Factory
export type {
  AdapterProvider,
  AdapterFactoryOptions,
  ResolvedAdapterConfig,
  RoutingCondition,
  RoutingAction,
  RoutingRule,
  RoutingConfig,
} from './factory.js';

export {
  createAdapter,
  createAdapterWithFallback,
  createAutoAdapter,
  createRoutingAdapter,
  getConfiguredProvider,
  isProviderAvailable,
  getDefaultModel,
  // Resilient adapter factory
  ResilientAdapter,
  createResilientAdapter,
  createResilientAdapterWithFallback,
  createProductionAdapter,
} from './factory.js';

// Resilience patterns
export type {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  RetryConfig,
  RetryStats,
} from './resilience.js';

export {
  CircuitBreaker,
  CircuitOpenError,
  RetryExecutor,
  RetryExhaustedError,
  ResilientExecutor,
  createCircuitBreaker,
  createRetryExecutor,
  createResilientExecutor,
  createAPIResilientExecutor,
} from './resilience.js';

// Multi-model orchestration
export type {
  TaskType,
  ModelTier,
  ProviderHealth,
  OrchestratorConfig,
  OrchestratorStats,
} from './orchestrator.js';

export {
  ModelOrchestrator,
  createOrchestrator,
  createCostOptimizedOrchestrator,
  createLoadBalancedOrchestrator,
} from './orchestrator.js';
