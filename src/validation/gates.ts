/**
 * Validation Gates
 * ================
 *
 * Pre-output validation to ensure bundle integrity.
 * All bundles must pass these gates before being emitted.
 *
 * Gates:
 * 1. Schema validation (structure correctness)
 * 2. Invariant checking (semantic correctness)
 * 3. Determinism verification (reproducibility)
 */

import { canonicalize, canonicalHash } from '../utils/canonical.js';
import {
  validateBundle,
  validateNode,
  validateOutput,
  validateScore,
  validateSorted,
  validateQuestionOrder,
} from '../types/validation.js';
import { SCHEMA_VERSION, type Bundle, type ContextNode, type Output, type Question } from '../types/artifacts.js';

// =============================================================================
// Gate Result Types
// =============================================================================

/**
 * Result of a validation gate.
 */
export interface GateResult {
  /**
   * Gate name for reporting.
   */
  gate: string;

  /**
   * Whether the gate passed.
   */
  passed: boolean;

  /**
   * Error messages if failed.
   */
  errors: string[];

  /**
   * Warnings (non-fatal issues).
   */
  warnings: string[];
}

/**
 * Complete validation result.
 */
export interface ValidationGateResult {
  /**
   * Whether all gates passed.
   */
  valid: boolean;

  /**
   * Results from each gate.
   */
  gates: GateResult[];

  /**
   * Total error count.
   */
  error_count: number;

  /**
   * Total warning count.
   */
  warning_count: number;
}

// =============================================================================
// Schema Validation Gate
// =============================================================================

/**
 * Validate bundle schema.
 * Ensures all structural requirements are met.
 *
 * @param bundle - Bundle to validate
 * @returns Gate result
 */
export function validateSchemaGate(bundle: Bundle): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate schema version
  if (!bundle.schema_version) {
    errors.push('Bundle missing schema_version');
  } else if (bundle.schema_version !== SCHEMA_VERSION) {
    warnings.push(
      `Bundle schema_version (${bundle.schema_version}) differs from current (${SCHEMA_VERSION}). Migration may be needed.`
    );
  }

  // Validate the bundle itself
  const bundleResult = validateBundle(bundle);
  errors.push(...bundleResult.errors);

  // Validate root node
  const rootResult = validateNode(bundle.root_node);
  errors.push(...rootResult.errors.map((e) => `root_node: ${e}`));

  // Validate all terminal nodes
  for (const node of bundle.terminal_nodes) {
    const nodeResult = validateNode(node);
    errors.push(...nodeResult.errors.map((e) => `terminal_node ${node.id}: ${e}`));
  }

  // Validate all outputs
  for (const output of bundle.outputs) {
    const outputResult = validateOutput(output);
    errors.push(...outputResult.errors.map((e) => `output ${output.id}: ${e}`));
  }

  // Check stats consistency
  if (bundle.stats.total_outputs !== bundle.outputs.length) {
    errors.push(
      `stats.total_outputs (${bundle.stats.total_outputs}) !== actual outputs (${bundle.outputs.length})`
    );
  }

  if (bundle.stats.unresolved_count !== bundle.unresolved_questions.length) {
    errors.push(
      `stats.unresolved_count (${bundle.stats.unresolved_count}) !== actual questions (${bundle.unresolved_questions.length})`
    );
  }

  if (bundle.stats.terminal_nodes !== bundle.terminal_nodes.length) {
    errors.push(
      `stats.terminal_nodes (${bundle.stats.terminal_nodes}) !== actual terminal nodes (${bundle.terminal_nodes.length})`
    );
  }

  return {
    gate: 'schema',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// Ordering Invariant Gate
// =============================================================================

/**
 * Validate ordering invariants.
 * Ensures all lists are in the correct deterministic order.
 *
 * @param bundle - Bundle to validate
 * @returns Gate result
 */
export function validateOrderingGate(bundle: Bundle): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check outputs sorted by path
  try {
    validateSorted(bundle.outputs, (o) => o.path, 'outputs');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Check terminal nodes sorted by id
  try {
    validateSorted(bundle.terminal_nodes, (n) => n.id, 'terminal_nodes');
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Check unresolved questions ordering
  try {
    validateQuestionOrder(bundle.unresolved_questions);
  } catch (e) {
    errors.push((e as Error).message);
  }

  // Check root node children ordering
  if (bundle.root_node.children.length > 0) {
    try {
      validateSorted(bundle.root_node.children, (id) => id, 'root_node.children');
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  // Check root node constraints ordering
  try {
    validateSorted(bundle.root_node.constraints, (c) => c, 'root_node.constraints');
  } catch (e) {
    errors.push((e as Error).message);
  }

  return {
    gate: 'ordering',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// Semantic Invariant Gate
// =============================================================================

/**
 * Validate semantic invariants.
 * Ensures logical consistency of the bundle.
 *
 * @param bundle - Bundle to validate
 * @returns Gate result
 */
export function validateSemanticGate(bundle: Bundle): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check status consistency
  if (bundle.status === 'complete' && bundle.unresolved_questions.length > 0) {
    errors.push(
      `Bundle status is 'complete' but has ${bundle.unresolved_questions.length} unresolved questions`
    );
  }

  if (bundle.status === 'incomplete' && bundle.unresolved_questions.length === 0) {
    warnings.push(
      "Bundle status is 'incomplete' but has no unresolved questions"
    );
  }

  // Check terminal nodes are actually terminal
  for (const node of bundle.terminal_nodes) {
    if (node.status !== 'terminal') {
      errors.push(
        `Node ${node.id} in terminal_nodes has status '${node.status}', expected 'terminal'`
      );
    }

    if (node.children.length > 0) {
      errors.push(
        `Terminal node ${node.id} has ${node.children.length} children`
      );
    }
  }

  // Check scores are valid
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

  // Check output content hashes
  for (const output of bundle.outputs) {
    const actualHash = canonicalHash(output.content);
    if (output.content_hash !== actualHash) {
      errors.push(
        `Output ${output.id} content_hash mismatch: expected ${actualHash}, got ${output.content_hash}`
      );
    }
  }

  return {
    gate: 'semantic',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// Determinism Gate
// =============================================================================

/**
 * Validate determinism invariants.
 * Ensures the bundle can be reproduced.
 *
 * @param bundle - Bundle to validate
 * @returns Gate result
 */
export function validateDeterminismGate(bundle: Bundle): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check ID derivation
  const bundleWithoutId = { ...bundle };
  delete (bundleWithoutId as Record<string, unknown>)['id'];

  // The ID should be derivable from content
  // (Can't fully verify without re-deriving, but check format)
  if (!bundle.id.match(/^bundle_[a-f0-9]{16}$/)) {
    errors.push(`Bundle ID format invalid: ${bundle.id}`);
  }

  // Check all node IDs are content-derived
  const checkNode = (node: ContextNode, path: string) => {
    if (!node.id.match(/^node_[a-f0-9]{16}$/)) {
      errors.push(`${path}: Node ID format invalid: ${node.id}`);
    }
  };

  checkNode(bundle.root_node, 'root_node');
  for (const node of bundle.terminal_nodes) {
    checkNode(node, `terminal_nodes[${node.id}]`);
  }

  // Check all question IDs are content-derived
  for (const q of bundle.unresolved_questions) {
    if (!q.id.match(/^q_[a-f0-9]{16}$/)) {
      errors.push(`Question ID format invalid: ${q.id}`);
    }
  }

  // Check all output IDs are content-derived
  for (const output of bundle.outputs) {
    if (!output.id.match(/^out_[a-f0-9]{16}$/)) {
      errors.push(`Output ID format invalid: ${output.id}`);
    }
  }

  // Verify canonical serialization round-trips
  try {
    const canonical = canonicalize(bundle);
    const parsed = JSON.parse(canonical);
    const recanonical = canonicalize(parsed);
    if (canonical !== recanonical) {
      errors.push('Bundle does not round-trip through canonical serialization');
    }
  } catch (e) {
    errors.push(`Canonicalization failed: ${(e as Error).message}`);
  }

  return {
    gate: 'determinism',
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// Complete Validation
// =============================================================================

/**
 * Run all validation gates on a bundle.
 *
 * @param bundle - Bundle to validate
 * @returns Complete validation result
 */
export function validateAllGates(bundle: Bundle): ValidationGateResult {
  const gates: GateResult[] = [
    validateSchemaGate(bundle),
    validateOrderingGate(bundle),
    validateSemanticGate(bundle),
    validateDeterminismGate(bundle),
  ];

  const errorCount = gates.reduce((sum, g) => sum + g.errors.length, 0);
  const warningCount = gates.reduce((sum, g) => sum + g.warnings.length, 0);
  const allPassed = gates.every((g) => g.passed);

  return {
    valid: allPassed,
    gates,
    error_count: errorCount,
    warning_count: warningCount,
  };
}

/**
 * Assert that a bundle is valid.
 * Throws an error with details if validation fails.
 *
 * @param bundle - Bundle to validate
 * @throws Error if validation fails
 */
export function assertValid(bundle: Bundle): void {
  const result = validateAllGates(bundle);

  if (!result.valid) {
    const allErrors = result.gates
      .flatMap((g) => g.errors.map((e) => `[${g.gate}] ${e}`))
      .join('\n');
    throw new Error(`Bundle validation failed:\n${allErrors}`);
  }
}
