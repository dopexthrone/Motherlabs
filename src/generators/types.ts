/**
 * Generator Types
 * ===============
 *
 * Types for LLM-powered generators (N9 in kernel topology).
 * Generators transform intents into structured outputs using ModelAdapter.
 *
 * Generator Catalog (from Kernel Spec):
 * - G0: ClarifierGenerator - Ask clarifying questions
 * - G1: PlanExpanderGenerator - Generate plan candidates
 * - G2: PlanPrunerGenerator - Remove invalid plans
 * - G3: BlueprintSpecGenerator - Generate X artifacts
 * - G4: BuildPlanGenerator - Generate Y artifacts
 * - G5: VerificationPackGenerator - Generate Z artifacts
 * - G6: PatchGenerator - Generate code patches
 * - G7: TestGenerator - Generate test cases
 * - G8: DocGenerator - Generate documentation
 */

import type { ModelAdapter, TransformContext, TransformResult } from '../adapters/model.js';

// =============================================================================
// Generator Interface
// =============================================================================

/**
 * Base interface for all generators.
 */
export interface Generator<TInput, TOutput> {
  /**
   * Generator identifier.
   */
  readonly id: GeneratorId;

  /**
   * Human-readable name.
   */
  readonly name: string;

  /**
   * Description of what this generator does.
   */
  readonly description: string;

  /**
   * Generate output from input using the model adapter.
   *
   * @param input - Generator-specific input
   * @param adapter - Model adapter to use
   * @param context - Transform context for audit
   * @returns Generator output with metadata
   */
  generate(
    input: TInput,
    adapter: ModelAdapter,
    context: GeneratorContext
  ): Promise<GeneratorOutput<TOutput>>;
}

/**
 * Generator identifiers matching the kernel spec.
 */
export type GeneratorId =
  | 'G0' // ClarifierGenerator
  | 'G1' // PlanExpanderGenerator
  | 'G2' // PlanPrunerGenerator
  | 'G3' // BlueprintSpecGenerator
  | 'G4' // BuildPlanGenerator
  | 'G5' // VerificationPackGenerator
  | 'G6' // PatchGenerator
  | 'G7' // TestGenerator
  | 'G8'; // DocGenerator

// =============================================================================
// Context and Output Types
// =============================================================================

/**
 * Context provided to generators.
 */
export interface GeneratorContext {
  /**
   * Unique run identifier.
   */
  run_id: string;

  /**
   * Intent identifier.
   */
  intent_id: string;

  /**
   * Current execution mode.
   */
  mode: 'plan-only' | 'execute' | 'clarify';

  /**
   * Policy constraints.
   */
  constraints: string[];

  /**
   * Working directory (for file operations).
   */
  working_dir: string;

  /**
   * Additional metadata.
   */
  metadata: Record<string, unknown>;
}

/**
 * Output from a generator.
 */
export interface GeneratorOutput<T> {
  /**
   * The generated output.
   */
  result: T;

  /**
   * Raw LLM response (for audit).
   */
  raw_response: string;

  /**
   * Model metadata from the transform.
   */
  model_info: {
    model_id: string;
    tokens_input: number;
    tokens_output: number;
    latency_ms: number;
  };

  /**
   * Whether the output was successfully parsed.
   */
  parsed: boolean;

  /**
   * Any parsing errors.
   */
  parse_errors?: string[];
}

// =============================================================================
// G0: Clarifier Types
// =============================================================================

/**
 * Input for the clarifier generator.
 */
export interface ClarifierInput {
  /**
   * The original intent goal.
   */
  goal: string;

  /**
   * Optional constraints from the intent.
   */
  constraints?: string[];

  /**
   * Optional context from the intent.
   */
  context?: Record<string, unknown>;

  /**
   * Ambiguity report from gatekeeper (if any).
   */
  ambiguity_report?: AmbiguityReport;
}

/**
 * Ambiguity detected by the gatekeeper.
 */
export interface AmbiguityReport {
  /**
   * Ambiguous terms found.
   */
  ambiguous_terms: string[];

  /**
   * Missing required information.
   */
  missing_info: string[];

  /**
   * Confidence score (0-1).
   */
  confidence: number;
}

/**
 * Output from the clarifier generator.
 */
export interface ClarifierOutput {
  /**
   * Questions to ask the user.
   */
  questions: ClarificationQuestion[];

  /**
   * Whether clarification is needed.
   */
  needs_clarification: boolean;

  /**
   * Reason for needing clarification.
   */
  reason?: string;
}

/**
 * A clarification question.
 */
export interface ClarificationQuestion {
  /**
   * The question text.
   */
  question: string;

  /**
   * Category of the question.
   */
  category: 'scope' | 'requirements' | 'constraints' | 'preferences' | 'technical';

  /**
   * Suggested options (if applicable).
   */
  options?: string[];

  /**
   * Whether this question is required.
   */
  required: boolean;

  /**
   * Priority (1 = highest).
   */
  priority: number;
}

// =============================================================================
// G3: Blueprint Types
// =============================================================================

/**
 * Input for the blueprint generator.
 */
export interface BlueprintInput {
  /**
   * The clarified intent goal.
   */
  goal: string;

  /**
   * Constraints to apply.
   */
  constraints: string[];

  /**
   * Context information.
   */
  context: Record<string, unknown>;

  /**
   * Existing codebase summary (if available).
   */
  codebase_summary?: string;

  /**
   * User answers to clarification questions.
   */
  clarifications?: Record<string, string>;
}

/**
 * Output from the blueprint generator (X artifact).
 */
export interface BlueprintOutput {
  /**
   * Blueprint specification.
   */
  blueprint: BlueprintSpec;

  /**
   * Confidence score (0-1).
   */
  confidence: number;

  /**
   * Warnings or notes.
   */
  warnings?: string[];
}

/**
 * Blueprint specification (X artifact).
 */
export interface BlueprintSpec {
  /**
   * Blueprint version.
   */
  version: '1.0';

  /**
   * Blueprint title.
   */
  title: string;

  /**
   * Description of what will be built.
   */
  description: string;

  /**
   * Components to create/modify.
   */
  components: BlueprintComponent[];

  /**
   * Dependencies between components.
   */
  dependencies: string[][];

  /**
   * Acceptance criteria.
   */
  acceptance_criteria: string[];

  /**
   * Estimated complexity.
   */
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';

  /**
   * Risks identified.
   */
  risks: string[];
}

/**
 * A component in the blueprint.
 */
export interface BlueprintComponent {
  /**
   * Component identifier.
   */
  id: string;

  /**
   * Component name.
   */
  name: string;

  /**
   * What this component does.
   */
  purpose: string;

  /**
   * Type of component.
   */
  type: 'file' | 'function' | 'class' | 'module' | 'config' | 'test' | 'doc';

  /**
   * File path (relative).
   */
  path?: string;

  /**
   * Action to take.
   */
  action: 'create' | 'modify' | 'delete';

  /**
   * Details of the changes.
   */
  details: string;
}

// =============================================================================
// G4: BuildPlan Types
// =============================================================================

/**
 * Input for the build plan generator.
 */
export interface BuildPlanInput {
  /**
   * The blueprint to implement.
   */
  blueprint: BlueprintSpec;

  /**
   * Context for implementation.
   */
  context: Record<string, unknown>;
}

/**
 * Output from the build plan generator (Y artifact).
 */
export interface BuildPlanOutput {
  /**
   * Build plan specification.
   */
  plan: BuildPlanSpec;

  /**
   * Confidence score.
   */
  confidence: number;
}

/**
 * Build plan specification (Y artifact).
 */
export interface BuildPlanSpec {
  /**
   * Plan version.
   */
  version: '1.0';

  /**
   * Reference to blueprint.
   */
  blueprint_ref: string;

  /**
   * Ordered steps to execute.
   */
  steps: BuildStep[];

  /**
   * Rollback procedure.
   */
  rollback: string[];
}

/**
 * A step in the build plan.
 */
export interface BuildStep {
  /**
   * Step identifier.
   */
  id: string;

  /**
   * Step name.
   */
  name: string;

  /**
   * What this step does.
   */
  description: string;

  /**
   * Component this step operates on.
   */
  component_ref: string;

  /**
   * Type of operation.
   */
  operation: 'write_file' | 'modify_file' | 'delete_file' | 'run_command' | 'validate';

  /**
   * Step-specific parameters.
   */
  params: Record<string, unknown>;

  /**
   * Dependencies (step IDs that must complete first).
   */
  depends_on: string[];

  /**
   * Whether this step can be skipped on failure.
   */
  optional: boolean;
}
