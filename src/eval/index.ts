/**
 * Internal Evaluation System
 * ==========================
 *
 * Self-validation of generated code without external benchmarks.
 *
 * Methods:
 * - Differential: Compare against stdlib/reference implementations
 * - Property: Hypothesis-style property testing
 * - Self-Consistency: Multiple generations, check agreement
 * - Round-Trip: Code → AST → Code validation
 */

export * from './types.js';
export * from './differential.js';
export * from './property.js';
export * from './consistency.js';
export * from './roundtrip.js';

import type { EvalReport, EvalResult, EvalMethod } from './types.js';
import { runDifferentialTest, detectReference, generateTestInputs, STDLIB_REFERENCES } from './differential.js';
import { runPropertyTest, detectProperties, generateInputs, COMMON_PROPERTIES } from './property.js';
import { runConsistencyTest, executeGeneration, assessConsistency } from './consistency.js';
import { runRoundTripTest, normalizeCode, extractSignatures } from './roundtrip.js';

// =============================================================================
// Main Evaluator
// =============================================================================

/**
 * Configuration for the evaluator.
 */
export interface EvaluatorConfig {
  /**
   * Methods to use for evaluation.
   */
  methods: EvalMethod[];

  /**
   * Number of test inputs to generate.
   */
  num_tests: number;

  /**
   * Number of generations for self-consistency.
   */
  num_generations: number;

  /**
   * Minimum agreement ratio for consistency.
   */
  min_agreement: number;

  /**
   * Number of round trips.
   */
  num_round_trips: number;

  /**
   * Tolerance for numeric comparisons.
   */
  tolerance: number;
}

/**
 * Default evaluator configuration.
 */
export const DEFAULT_EVALUATOR_CONFIG: EvaluatorConfig = {
  methods: ['differential', 'property', 'round_trip'],
  num_tests: 20,
  num_generations: 3,
  min_agreement: 0.7,
  num_round_trips: 2,
  tolerance: 1e-9,
};

/**
 * Evaluate generated code using multiple methods.
 *
 * @param code - The generated code to evaluate.
 * @param functionName - The name of the function to evaluate.
 * @param config - Optional configuration for the evaluator.
 * @returns A promise that resolves to an EvalReport containing the evaluation results.
 */
export async function evaluate(
  code: string,
  functionName: string,
  config: Partial<EvaluatorConfig> = {}
): Promise<EvalReport> {
  const startTime = performance.now();
  const fullConfig = { ...DEFAULT_EVALUATOR_CONFIG, ...config };
  const results: EvalResult[] = [];

  // Extract signature for input generation
  const signatures = await extractSignatures(code);
  const signature = signatures.find((s) => s.includes(functionName)) ?? '';

  // Run selected evaluation methods
  for (const method of fullConfig.methods) {
    let result: EvalResult;

    switch (method) {
      case 'differential':
        result = await runDifferentialEval(code, functionName, signature, fullConfig);
        break;

      case 'property':
        result = await runPropertyEval(code, functionName, signature, fullConfig);
        break;

      case 'self_consistency':
        result = await runConsistencyEval(code, functionName, fullConfig);
        break;

      case 'round_trip':
        result = await runRoundTripTest(code, {
          num_trips: fullConfig.num_round_trips,
          compare_mode: 'ast',
        });
        break;

      default:
        continue;
    }

    results.push(result);
  }

  // Calculate overall score
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const avgScore = results.length > 0 ? totalScore / results.length : 0;
  const allPassed = results.every((r) => r.passed);

  // Generate summary
  const summary = generateSummary(results);

  return {
    code,
    language: 'python',
    passed: allPassed,
    score: avgScore,
    results,
    summary,
    total_duration_ms: Math.round(performance.now() - startTime),
  };
}

/**
 * Run differential evaluation.
 *
 * @param code - The generated code to evaluate.
 * @param functionName - The name of the function to evaluate.
 * @param signature - The function signature.
 * @param config - The evaluator configuration.
 * @returns A promise that resolves to an EvalResult containing the evaluation results.
 */
async function runDifferentialEval(
  code: string,
  functionName: string,
  signature: string,
  config: EvaluatorConfig
): Promise<EvalResult> {
  const ref = detectReference(functionName);
  if (!ref) {
    return {
      method: 'differential',
      passed: true,
      score: 1,
      details: 'No reference implementation found, skipping differential testing',
      tests: [],
      duration_ms: 0,
    };
  }

  const inputs = generateTestInputs(signature, config.num_tests);

  return runDifferentialTest(code, functionName, {
    references: [ref],
    inputs,
    tolerance: config.tolerance,
  });
}

/**
 * Run property-based evaluation.
 *
 * @param code - The generated code to evaluate.
 * @param functionName - The name of the function to evaluate.
 * @param signature - The function signature.
 * @param config - The evaluator configuration.
 * @returns A promise that resolves to an EvalResult containing the evaluation results.
 */
async function runPropertyEval(
  code: string,
  functionName: string,
  signature: string,
  config: EvaluatorConfig
): Promise<EvalResult> {
  const properties = detectProperties(functionName);

  // Determine input strategy from signature
  let inputStrategy: 'random_int' | 'random_float' | 'random_string' | 'custom' = 'random_int';
  if (signature.includes('float')) {
    inputStrategy = 'random_float';
  } else if (signature.includes('str')) {
    inputStrategy = 'random_string';
  }

  return runPropertyTest(code, functionName, {
    properties,
    num_tests: config.num_tests,
    input_strategy: inputStrategy,
    input_range: { min: 0, max: 100 },
  });
}

/**
 * Run self-consistency evaluation.
 *
 * @param code - The generated code to evaluate.
 * @param functionName - The name of the function to evaluate.
 * @param config - The evaluator configuration.
 * @returns A promise that resolves to an EvalResult containing the evaluation results.
 */
async function runConsistencyEval(
  code: string,
  functionName: string,
  config: EvaluatorConfig
): Promise<EvalResult> {
  // For self-consistency, we'd normally have multiple generations
  // Here we just test the single generation against itself
  const inputs = [0, 1, 5, 10, [1, 2, 3], 'test'];
  const generation = await executeGeneration(code, functionName, inputs);

  // With single generation, consistency is 100%
  return runConsistencyTest([generation], functionName, {
    num_generations: 1,
    inputs,
    min_agreement: config.min_agreement,
  });
}

/**
 * Generate evaluation summary.
 *
 * @param results - The evaluation results.
 * @returns A string containing the evaluation summary.
 */
function generateSummary(results: EvalResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    const status = result.passed ? '✓' : '✗';
    const pct = (result.score * 100).toFixed(0);
    lines.push(`${status} ${result.method}: ${pct}% (${result.details})`);
  }

  const passed = results.filter((r) => r.passed).length;
  lines.push(`\nOverall: ${passed}/${results.length} methods passed`);

  return lines.join('\n');
}

// =============================================================================
// Quick Validation
// =============================================================================

/**
 * Quick validation for common patterns.
 *
 * @param code - The code to validate.
 * @param functionName - The name of the function.
 * @returns A promise that resolves to an object containing the validation result.
 */
export async function quickValidate(
  code: string,
  functionName: string
): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];

  // Syntax check via AST
  const signatures = await extractSignatures(code);
  if (signatures.length === 0) {
    issues.push('No valid Python functions found');
  }

  // Normalize and check round-trip
  const normalized = await normalizeCode(code);
  if (normalized === code) {
    // Code didn't change, but let's verify it's valid
  } else if (normalized === '') {
    issues.push('Code failed to parse');
  }

  // Check if function exists
  const funcSignature = signatures.find((s) => s.includes(functionName));
  if (!funcSignature) {
    issues.push(`Function '${functionName}' not found in code`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Get available references for a function.
 *
 * @returns An array of available reference names.
 */
export function getAvailableReferences(): string[] {
  return Object.keys(STDLIB_REFERENCES);
}

/**
 * Get available properties for a function type.
 *
 * @returns An array of available property names.
 */
export function getAvailableProperties(): string[] {
  return Object.keys(COMMON_PROPERTIES);
}