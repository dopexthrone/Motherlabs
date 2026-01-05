/**
 * Type Validation
 * ===============
 *
 * Runtime validation for artifact types.
 * Ensures all constraints are met before processing.
 */

import type { Score, ContentId, Question, ContextNode, Output, Bundle } from './artifacts.js';

// =============================================================================
// Score Validation
// =============================================================================

/**
 * Validate that a value is a valid Score (integer 0-100).
 *
 * @param value - Value to validate
 * @param name - Name for error messages
 * @returns The validated score
 * @throws Error if invalid
 */
export function validateScore(value: unknown, name: string): Score {
  if (typeof value !== 'number') {
    throw new Error(`${name} must be a number, got ${typeof value}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, got ${value}`);
  }
  if (value < 0 || value > 100) {
    throw new Error(`${name} must be in range [0, 100], got ${value}`);
  }
  return value;
}

/**
 * Clamp a value to valid Score range and round to integer.
 *
 * @param value - Value to clamp
 * @returns Clamped integer score
 */
export function clampToScore(value: number): Score {
  const clamped = Math.max(0, Math.min(100, value));
  return Math.round(clamped);
}

// =============================================================================
// ID Validation
// =============================================================================

/**
 * Valid ID prefixes and their regex patterns.
 */
const ID_PATTERNS: Record<string, RegExp> = {
  bundle: /^bundle_[a-f0-9]{16}$/,
  node: /^node_[a-f0-9]{16}$/,
  q: /^q_[a-f0-9]{16}$/,
  out: /^out_[a-f0-9]{16}$/,
};

/**
 * Validate that a value is a valid ContentId with given prefix.
 *
 * @param value - Value to validate
 * @param prefix - Expected prefix
 * @returns The validated ID
 * @throws Error if invalid
 */
export function validateId(value: unknown, prefix: string): ContentId {
  if (typeof value !== 'string') {
    throw new Error(`ID must be a string, got ${typeof value}`);
  }

  const pattern = ID_PATTERNS[prefix];
  if (!pattern) {
    throw new Error(`Unknown ID prefix: ${prefix}`);
  }

  if (!pattern.test(value)) {
    throw new Error(`Invalid ${prefix} ID format: ${value}`);
  }

  return value;
}

// =============================================================================
// Ordering Validation
// =============================================================================

/**
 * Validate that an array is sorted according to a key function.
 *
 * @param arr - Array to validate
 * @param keyFn - Function to extract sort key
 * @param name - Name for error messages
 * @throws Error if not sorted
 */
export function validateSorted<T>(
  arr: readonly T[],
  keyFn: (item: T) => string,
  name: string
): void {
  for (let i = 1; i < arr.length; i++) {
    const prev = keyFn(arr[i - 1]!);
    const curr = keyFn(arr[i]!);
    if (prev > curr) {
      throw new Error(
        `${name} is not sorted: "${prev}" should come after "${curr}"`
      );
    }
  }
}

/**
 * Validate that questions are sorted by priority desc, then id asc.
 *
 * @param questions - Questions to validate
 * @throws Error if not sorted
 */
export function validateQuestionOrder(questions: readonly Question[]): void {
  for (let i = 1; i < questions.length; i++) {
    const prev = questions[i - 1]!;
    const curr = questions[i]!;

    // Priority descending
    if (prev.priority < curr.priority) {
      throw new Error(
        `Questions not sorted by priority: ${prev.id} (${prev.priority}) should come after ${curr.id} (${curr.priority})`
      );
    }

    // If same priority, id ascending
    if (prev.priority === curr.priority && prev.id > curr.id) {
      throw new Error(
        `Questions with same priority not sorted by id: ${prev.id} should come after ${curr.id}`
      );
    }
  }
}

// =============================================================================
// Full Artifact Validation
// =============================================================================

/**
 * Validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a Question.
 *
 * @param question - Question to validate
 * @returns Validation result
 */
export function validateQuestion(question: Question): ValidationResult {
  const errors: string[] = [];

  try {
    validateId(question.id, 'q');
  } catch (e) {
    errors.push((e as Error).message);
  }

  if (typeof question.text !== 'string' || question.text.length === 0) {
    errors.push('Question text must be a non-empty string');
  }

  if (typeof question.why_needed !== 'string' || question.why_needed.length === 0) {
    errors.push('Question why_needed must be a non-empty string');
  }

  try {
    validateScore(question.information_gain, 'information_gain');
  } catch (e) {
    errors.push((e as Error).message);
  }

  try {
    validateScore(question.priority, 'priority');
  } catch (e) {
    errors.push((e as Error).message);
  }

  if (question.options !== undefined) {
    if (!Array.isArray(question.options)) {
      errors.push('Question options must be an array');
    } else {
      try {
        validateSorted(question.options, (o) => o, 'Question options');
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a ContextNode.
 *
 * @param node - Node to validate
 * @returns Validation result
 */
export function validateNode(node: ContextNode): ValidationResult {
  const errors: string[] = [];

  try {
    validateId(node.id, 'node');
  } catch (e) {
    errors.push((e as Error).message);
  }

  if (node.parent_id !== null) {
    try {
      validateId(node.parent_id, 'node');
    } catch (e) {
      errors.push(`parent_id: ${(e as Error).message}`);
    }
  }

  // Validate constraints are sorted
  try {
    validateSorted(node.constraints, (c) => c, 'Node constraints');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate children are sorted
  try {
    validateSorted(node.children, (c) => c, 'Node children');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate unresolved questions ordering
  try {
    validateQuestionOrder(node.unresolved_questions);
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate entropy scores
  try {
    validateScore(node.entropy.entropy_score, 'entropy_score');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate density scores
  try {
    validateScore(node.density.density_score, 'density_score');
  } catch (e) {
    errors.push((e as Error).message);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an Output.
 *
 * @param output - Output to validate
 * @returns Validation result
 */
export function validateOutput(output: Output): ValidationResult {
  const errors: string[] = [];

  try {
    validateId(output.id, 'out');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Path must not be absolute
  if (output.path.startsWith('/')) {
    errors.push('Output path must be relative');
  }

  // Path must use forward slashes
  if (output.path.includes('\\')) {
    errors.push('Output path must use forward slashes');
  }

  // Validate source constraints are sorted
  try {
    validateSorted(output.source_constraints, (c) => c, 'Output source_constraints');
  } catch (e) {
    errors.push((e as Error).message);
  }

  try {
    validateScore(output.confidence, 'confidence');
  } catch (e) {
    errors.push((e as Error).message);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a Bundle.
 *
 * @param bundle - Bundle to validate
 * @returns Validation result
 */
export function validateBundle(bundle: Bundle): ValidationResult {
  const errors: string[] = [];

  try {
    validateId(bundle.id, 'bundle');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate outputs are sorted by path
  try {
    validateSorted(bundle.outputs, (o) => o.path, 'Bundle outputs');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate terminal nodes are sorted by id
  try {
    validateSorted(bundle.terminal_nodes, (n) => n.id, 'Bundle terminal_nodes');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate unresolved questions ordering
  try {
    validateQuestionOrder(bundle.unresolved_questions);
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate stats scores
  try {
    validateScore(bundle.stats.avg_terminal_entropy, 'avg_terminal_entropy');
  } catch (e) {
    errors.push((e as Error).message);
  }

  try {
    validateScore(bundle.stats.avg_terminal_density, 'avg_terminal_density');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Validate each output
  for (const output of bundle.outputs) {
    const result = validateOutput(output);
    errors.push(...result.errors.map((e) => `Output ${output.id}: ${e}`));
  }

  return { valid: errors.length === 0, errors };
}
