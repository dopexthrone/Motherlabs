/**
 * Internal Evaluation Types
 * =========================
 *
 * Types for self-validation of generated code without external benchmarks.
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Evaluation method type.
 */
export type EvalMethod =
  | 'differential'      // Compare against reference implementation
  | 'property'          // Property-based testing
  | 'self_consistency'  // Multiple generations, check agreement
  | 'round_trip'        // Code → AST → Code comparison
  | 'mutation';         // Mutation testing score

/**
 * Evaluation result for a single method.
 */
export interface EvalResult {
  /**
   * Method used.
   */
  method: EvalMethod;

  /**
   * Whether evaluation passed.
   */
  passed: boolean;

  /**
   * Score (0-1).
   */
  score: number;

  /**
   * Details about the evaluation.
   */
  details: string;

  /**
   * Individual test results.
   */
  tests: TestResult[];

  /**
   * Execution time in ms.
   */
  duration_ms: number;
}

/**
 * Individual test result.
 */
export interface TestResult {
  /**
   * Test name/description.
   */
  name: string;

  /**
   * Whether test passed.
   */
  passed: boolean;

  /**
   * Input used.
   */
  input: unknown;

  /**
   * Expected output.
   */
  expected?: unknown;

  /**
   * Actual output.
   */
  actual?: unknown;

  /**
   * Error message if failed.
   */
  error?: string;
}

/**
 * Combined evaluation report.
 */
export interface EvalReport {
  /**
   * Code being evaluated.
   */
  code: string;

  /**
   * Language of the code.
   */
  language: string;

  /**
   * Overall pass/fail.
   */
  passed: boolean;

  /**
   * Overall score (0-1).
   */
  score: number;

  /**
   * Results from each method.
   */
  results: EvalResult[];

  /**
   * Summary of findings.
   */
  summary: string;

  /**
   * Total evaluation time.
   */
  total_duration_ms: number;
}

// =============================================================================
// Differential Testing Types
// =============================================================================

/**
 * Reference implementation for differential testing.
 */
export interface ReferenceImpl {
  /**
   * Name of the reference.
   */
  name: string;

  /**
   * Python code to call reference.
   * Use {input} placeholder for input.
   */
  code: string;

  /**
   * Import statements needed.
   */
  imports: string[];
}

/**
 * Differential test config.
 */
export interface DifferentialConfig {
  /**
   * Reference implementations to compare against.
   */
  references: ReferenceImpl[];

  /**
   * Test inputs to use.
   */
  inputs: unknown[];

  /**
   * Tolerance for numeric comparisons.
   */
  tolerance?: number;
}

// =============================================================================
// Property Testing Types
// =============================================================================

/**
 * Property to test.
 */
export interface Property {
  /**
   * Property name.
   */
  name: string;

  /**
   * Property description.
   */
  description: string;

  /**
   * Python code to check property.
   * Use {result} for function result, {input} for input.
   */
  check: string;
}

/**
 * Property test config.
 */
export interface PropertyConfig {
  /**
   * Properties to verify.
   */
  properties: Property[];

  /**
   * Number of random inputs to generate.
   */
  num_tests: number;

  /**
   * Input generator strategy.
   */
  input_strategy: 'random_int' | 'random_float' | 'random_string' | 'custom';

  /**
   * Custom input generator code (if strategy is 'custom').
   */
  custom_generator?: string;

  /**
   * Input range for numeric types.
   */
  input_range?: { min: number; max: number };
}

// =============================================================================
// Self-Consistency Types
// =============================================================================

/**
 * Self-consistency config.
 */
export interface ConsistencyConfig {
  /**
   * Number of generations to compare.
   */
  num_generations: number;

  /**
   * Test inputs.
   */
  inputs: unknown[];

  /**
   * Minimum agreement ratio to pass (0-1).
   */
  min_agreement: number;
}

/**
 * Generation for consistency check.
 */
export interface Generation {
  /**
   * Generated code.
   */
  code: string;

  /**
   * Outputs for each input.
   */
  outputs: unknown[];
}

// =============================================================================
// Round-Trip Types
// =============================================================================

/**
 * Round-trip validation config.
 */
export interface RoundTripConfig {
  /**
   * Number of round-trips to perform.
   */
  num_trips: number;

  /**
   * Comparison mode.
   */
  compare_mode: 'exact' | 'ast' | 'semantic';
}

/**
 * AST node (simplified).
 */
export interface ASTNode {
  /**
   * Node type.
   */
  type: string;

  /**
   * Node name (if applicable).
   */
  name?: string;

  /**
   * Child nodes.
   */
  children: ASTNode[];
}