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
} from './adapters/index.js';
