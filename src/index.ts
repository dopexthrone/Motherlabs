/**
 * Context Engine Kernel
 * =====================
 *
 * A deterministic context engineering kernel for AI systems.
 *
 * This kernel transforms ambiguous goals into unambiguous, actionable context
 * through recursive decomposition and entropy measurement.
 *
 * Key Guarantees:
 * - Byte-identical output for identical input
 * - Stable across platforms (Linux, macOS, Windows)
 * - No external dependencies affecting output
 * - Fully testable determinism
 *
 * @packageDocumentation
 */

// Core transform function
export { transform, getBundleCanonical, getBundleHash, KERNEL_VERSION } from './assembler/bundle.js';
export type { TransformConfig } from './assembler/bundle.js';

// Schema version
export { SCHEMA_VERSION } from './types/artifacts.js';

// Types
export type {
  // Primitives
  Score,
  ContentId,
  BundleId,
  NodeId,
  QuestionId,
  OutputId,
  // Input types
  Intent,
  // Measurement types
  EntropyMeasurement,
  DensityMeasurement,
  // Decomposition types
  AnswerType,
  Question,
  SplittingQuestion,
  Branch,
  NodeStatus,
  ContextNode,
  // Output types
  OutputType,
  Output,
  // Bundle types
  BundleStatus,
  Bundle,
  BundleStats,
  // Evidence types
  EvidenceEntry,
} from './types/artifacts.js';

// Validation
export {
  validateScore,
  clampToScore,
  validateId,
  validateSorted,
  validateQuestionOrder,
  validateQuestion,
  validateNode,
  validateOutput,
  validateBundle,
} from './types/validation.js';
export type { ValidationResult } from './types/validation.js';

// Canonical serialization
export {
  canonicalize,
  canonicalizeToBytes,
  canonicalHash,
  deriveId,
  parseCanonical,
  verifyRoundTrip,
} from './utils/canonical.js';

// Input normalization
export {
  normalizeString,
  normalizeBytes,
  normalizePath,
  normalizeConstraint,
  normalizeConstraints,
  normalizeIntent,
  parseAndNormalize,
} from './utils/normalize.js';
export type { RawIntent, NormalizedIntent } from './utils/normalize.js';

// Entropy measurement
export {
  countUnresolvedRefs,
  detectSchemaGaps,
  detectContradictions,
  estimateBranchingFactor,
  measureEntropy,
  countConcreteConstraints,
  countSpecifiedOutputs,
  calculateConstraintDepth,
  measureDensity,
  isTerminal,
  calculateInformationGain,
  DEFAULT_TERMINATION_CONFIG,
} from './entropy/measure.js';
export type { TerminationConfig } from './entropy/measure.js';

// Decomposition
export {
  createNode,
  generateQuestions,
  selectSplittingQuestion,
  decomposeNode,
  decompose,
  DEFAULT_DECOMPOSITION_CONFIG,
} from './decomposition/decomposer.js';
export type {
  DecompositionResult,
  DecompositionConfig,
  FullDecompositionResult,
} from './decomposition/decomposer.js';

// Validation gates
export {
  validateSchemaGate,
  validateOrderingGate,
  validateSemanticGate,
  validateDeterminismGate,
  validateAllGates,
  assertValid,
} from './validation/gates.js';
export type { GateResult, ValidationGateResult } from './validation/gates.js';

// Proposal protocol
export { generateProposal, validateEvidence } from './protocol/proposal.js';
export type {
  ProposalId,
  ActionId,
  ActionType,
  ProposedAction,
  AcceptanceTest,
  Proposal,
  ActionResultStatus,
  ActionResult,
  TestResult,
  ExecutionEvidence,
  EvidenceValidation,
} from './protocol/proposal.js';

// Executor harness
export { executeProposal } from './protocol/executor.js';
export type { ExecutorConfig } from './protocol/executor.js';

// Model adapters
export type {
  ModelAdapter,
  ModelCapabilities,
  TransformContext,
  TransformMode,
  TransformResult,
  AdapterErrorCode,
  RecordedInteraction,
  RecordingSession,
  MockResponse,
  MockDefaultBehavior,
  MockModelAdapterOptions,
  RecordingModelAdapterOptions,
  ReplayModelAdapterOptions,
  // Resilience patterns
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  RetryConfig,
  RetryStats,
  // Streaming types
  StreamChunk,
  StreamResult,
  StreamEventType,
  StreamEvent,
  StreamingModelAdapter,
} from './adapters/index.js';

export {
  AdapterError,
  MockModelAdapter,
  RecordingModelAdapter,
  ReplayModelAdapter,
  createEchoAdapter,
  createFixedAdapter,
  createAdapterFromRecording,
  loadReplayAdapter,
  // Resilience patterns
  CircuitBreaker,
  CircuitOpenError,
  RetryExecutor,
  RetryExhaustedError,
  ResilientExecutor,
  createCircuitBreaker,
  createRetryExecutor,
  createResilientExecutor,
  createAPIResilientExecutor,
  // Streaming utilities
  isStreamingAdapter,
  collectStream,
  simulateStream,
} from './adapters/index.js';

// =============================================================================
// AI Agent System (Code Generation + Verification + RAG + Eval)
// =============================================================================

// Coding Agent
export {
  CodingAgent,
  createCodingAgent,
  CodeGenerator,
  createCodeGenerator,
  CodeVerifier,
  createVerifier,
  generateRequestId,
} from './agent/index.js';

export type {
  AgentConfig,
  AgentMode,
  AgentState,
  GenerationRequest,
  GenerationResult,
  VerificationResult,
  ReviewRequest,
  ReviewResponse,
  ActiveLearningConfig,
  ActiveLearningStrategy,
  ContextItem,
} from './agent/index.js';

// RAG (Retrieval-Augmented Generation)
export {
  RAGRetriever,
  createRAGRetriever,
  GeminiEmbeddingAdapter,
  OpenAIEmbeddingAdapter,
  MockEmbeddingAdapter,
  InMemoryVectorStore,
  HNSWIndex,
  FileVectorStore,
  createPersistentVectorStore,
  cosineSimilarity,
} from './rag/index.js';

export type {
  Document,
  DocumentType,
  SearchQuery,
  SearchResult,
  SearchResponse,
  EmbeddingAdapter,
  VectorStore,
  ChunkingOptions,
  RAGRetrieverOptions,
  FileVectorStoreOptions,
} from './rag/index.js';

// Internal Evaluation
export {
  evaluate,
  quickValidate,
  runDifferentialTest,
  runPropertyTest,
  runConsistencyTest,
  runRoundTripTest,
  detectReference,
  detectProperties,
  STDLIB_REFERENCES,
  COMMON_PROPERTIES,
  DEFAULT_EVALUATOR_CONFIG,
} from './eval/index.js';

export type {
  EvalMethod,
  EvalResult,
  EvalReport,
  TestResult as EvalTestResult,
  DifferentialConfig,
  PropertyConfig,
  ConsistencyConfig,
  RoundTripConfig,
  Property,
  ReferenceImpl,
  EvaluatorConfig,
} from './eval/index.js';

// Self-Improvement Protocol
export {
  ImprovementProtocol,
  createImprovementProtocol,
  DEFAULT_IMPROVEMENT_CONFIG,
} from './improve/index.js';

export type {
  ImprovementConfig,
  ImprovementCycle,
  ImprovementPhase,
  ImprovementCandidate,
  ImplementationPlan,
  ImplementationStep,
  ValidationResult as ImprovementValidationResult,
  IntegrationResult,
  GateResult as ImprovementGateResult,
  ImprovementEvent,
  ImprovementEventHandler,
} from './improve/index.js';

// Bridges (System Integration)
export {
  KernelAgentBridge,
  createBridge,
} from './bridges/index.js';

export type {
  BridgeConfig,
  DecompositionCodeResult,
  ActionCodeResult,
} from './bridges/index.js';

// Code Style Enforcement
export {
  formatCode,
  checkStyle,
  formatPython,
  formatTypeScript,
  formatJSON,
  lintPython,
  lintTypeScript,
} from './style/index.js';

export type {
  FormattableLanguage,
  StyleResult,
  StyleIssue,
  FormatOptions,
} from './style/index.js';

// Security Scanning
export {
  scanCode,
  scanPython,
  scanTypeScript,
  compareSeverity,
  maxSeverity,
} from './security/index.js';

export type {
  VulnerabilitySeverity,
  Vulnerability,
  SecurityResult,
  ScanOptions,
} from './security/index.js';

// Prompt Augmentation
export {
  extractFewShot,
  detectPatterns,
  buildAugmentedPrompt,
  formatAsExamples,
  augmentPrompt,
} from './prompt/index.js';

export type {
  FewShotExample,
  CodePatterns,
  AugmentedPrompt,
  AugmentOptions,
} from './prompt/index.js';

// Code Repair / Auto Bug Fix
export {
  CodeRepairer,
  createRepairer,
  diagnoseFromVerification,
  diagnoseFromEval,
  quickRepairFromVerification,
  quickRepairFromEval,
} from './repair/index.js';

export type {
  RepairAttempt,
  CodeDiagnosis,
  RepairOptions,
  RepairContextItem,
} from './repair/index.js';

// Prompt Learning / Refinement
export {
  PromptLearner,
  createPromptLearner,
  quickRefine,
  analyzOutcomes,
} from './learn/index.js';

export type {
  GenerationOutcome,
  PromptPattern,
  RefinementSuggestion,
  LearningInsights,
} from './learn/index.js';

// Auto Documentation
export {
  CodeDocumenter,
  createDocumenter,
  documentCode,
  extractElements,
  extractPythonElements,
  extractTypeScriptElements,
} from './docs/index.js';

export type {
  DocStyle,
  CodeElement,
  GeneratedDoc,
  DocResult,
  DocOptions,
} from './docs/index.js';

// Infrastructure (Production Hardening)
export {
  // Cache
  LRUCache,
  generateCacheKey,
  createRequestCache,
  // Rate Limiting
  RateLimiter,
  RateLimitError,
  createRateLimiter,
  createProviderRateLimiter,
  PROVIDER_LIMITS,
  // Cost Tracking
  CostTracker,
  BudgetExceededError,
  createCostTracker,
  createDailyBudgetTracker,
  MODEL_PRICING,
  // Metrics
  MetricsCollector,
  ConsoleExporter,
  createMetricsCollector,
} from './infra/index.js';

export type {
  // Cache
  CacheEntry,
  CacheStats,
  CacheOptions,
  // Rate Limiting
  RateLimitConfig,
  RateLimitStatus,
  RateLimitStats,
  // Cost Tracking
  ModelPricing,
  CostEntry,
  CostReport,
  BudgetConfig,
  // Metrics
  MetricType,
  MetricValue,
  LogLevel,
  LogEntry,
  Span,
  MetricsExporter,
} from './infra/index.js';

// State Management
export {
  FileStateStorage,
  MemoryStateStorage,
  StateManager,
  MemoryManager,
  createStateManager,
  createFileStateManager,
  createMemoryStateManager,
  createMemoryManager,
  STATE_SCHEMA_VERSION,
} from './state/index.js';

export type {
  SerializableAgentState,
  CheckpointMeta,
  StateStorage,
  MemoryConfig,
} from './state/index.js';
