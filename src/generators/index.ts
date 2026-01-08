/**
 * Generator Exports
 * =================
 *
 * LLM-powered generators for the context engine kernel.
 */

// Types
export type {
  Generator,
  GeneratorId,
  GeneratorContext,
  GeneratorOutput,
  ClarifierInput,
  ClarifierOutput,
  ClarificationQuestion,
  AmbiguityReport,
  BlueprintInput,
  BlueprintOutput,
  BlueprintSpec,
  BlueprintComponent,
  BuildPlanInput,
  BuildPlanOutput,
  BuildPlanSpec,
  BuildStep,
} from './types.js';

// Base
export { BaseGenerator, extractJSON, parseJSON, buildStructuredPrompt } from './base.js';
export type { PromptSection } from './base.js';

// G0: Clarifier
export { ClarifierGenerator, createClarifierGenerator } from './clarifier.js';

// G3: Blueprint
export { BlueprintGenerator, createBlueprintGenerator } from './blueprint.js';

// Orchestrator
export { GeneratorOrchestrator, createOrchestrator } from './orchestrator.js';

// Deep Exploration
export type {
  ExplorationNode,
  ExplorationMetrics,
  ExplorationConfig,
  ExplorationResult,
  VariantSpec,
  ExpanderInput,
  ExpanderOutput,
  PrunerInput,
  PrunerOutput,
  VariantEvaluation,
} from './exploration.js';

export {
  ExplorationEngine,
  ExpanderGenerator,
  PrunerGenerator,
  VariantSelector,
  createExplorationEngine,
} from './exploration.js';
