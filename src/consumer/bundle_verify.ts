/**
 * Bundle Verification
 * ===================
 *
 * Non-authoritative verification of bundle against BUNDLE_SPEC.md.
 * Returns violations deterministically without throwing.
 *
 * Rule IDs align with BUNDLE_SPEC.md invariants:
 * - BS1: Schema version present
 * - BS2: Hash stability (not checked here - requires two transforms)
 * - BS3: Artifact paths sorted
 * - BS4: Constraints sorted
 * - BS5: Questions sorted (priority desc, id asc)
 * - BS6: Terminal nodes sorted by id
 * - BS7: No path traversal
 * - BS8: Canonical idempotent (checked via round-trip)
 */

import type { Bundle, Question, ContextNode, Output } from '../types/artifacts.js';
import type { Violation, VerifyResult } from './bundle_types.js';
import { canonicalize } from '../utils/canonical.js';

/**
 * Rule IDs matching BUNDLE_SPEC.md.
 */
const RULES = {
  BS1: 'BS1',
  BS3: 'BS3',
  BS4: 'BS4',
  BS5: 'BS5',
  BS6: 'BS6',
  BS7: 'BS7',
  BS8: 'BS8',
  SCHEMA: 'SCHEMA',
} as const;

/**
 * Check if value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if array is sorted by key function.
 * Creates a copy to avoid mutating input.
 */
function isSortedBy<T>(arr: readonly T[], keyFn: (item: T) => string): boolean {
  if (arr.length <= 1) return true;
  for (let i = 1; i < arr.length; i++) {
    const prev = keyFn(arr[i - 1]!);
    const curr = keyFn(arr[i]!);
    if (prev > curr) return false;
  }
  return true;
}

/**
 * Check if questions are sorted by priority desc, then id asc.
 */
function isQuestionsSorted(questions: readonly Question[]): boolean {
  if (questions.length <= 1) return true;
  for (let i = 1; i < questions.length; i++) {
    const prev = questions[i - 1]!;
    const curr = questions[i]!;
    // Priority descending
    if (prev.priority < curr.priority) return false;
    // Same priority: id ascending
    if (prev.priority === curr.priority && prev.id > curr.id) return false;
  }
  return true;
}

/**
 * Check if path has traversal or absolute path issues.
 */
function hasPathTraversal(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.includes('..') ||
    path.includes('\\')
  );
}

/**
 * BS1: Schema version must be present and valid string.
 */
function checkSchemaVersion(bundle: unknown, violations: Violation[]): void {
  if (!isObject(bundle)) return; // Checked separately

  const schemaVersion = bundle['schema_version'];
  if (schemaVersion === undefined || schemaVersion === null) {
    violations.push({
      rule_id: RULES.BS1,
      path: '$.schema_version',
      message: 'schema_version is missing',
    });
  } else if (typeof schemaVersion !== 'string') {
    violations.push({
      rule_id: RULES.BS1,
      path: '$.schema_version',
      message: `schema_version must be string, got ${typeof schemaVersion}`,
    });
  } else if (schemaVersion.length === 0) {
    violations.push({
      rule_id: RULES.BS1,
      path: '$.schema_version',
      message: 'schema_version cannot be empty',
    });
  }
}

/**
 * BS3: Outputs must be sorted by path ascending.
 */
function checkArtifactPathsSorted(bundle: Bundle, violations: Violation[]): void {
  if (!Array.isArray(bundle.outputs)) return;

  if (!isSortedBy(bundle.outputs, (o) => o.path)) {
    const paths = bundle.outputs.map((o) => o.path);
    violations.push({
      rule_id: RULES.BS3,
      path: '$.outputs',
      message: `outputs not sorted by path: [${paths.join(', ')}]`,
    });
  }
}

/**
 * BS4: Constraints must be sorted lexicographically.
 */
function checkConstraintsSorted(bundle: Bundle, violations: Violation[]): void {
  // Check root node constraints
  if (bundle.root_node && Array.isArray(bundle.root_node.constraints)) {
    if (!isSortedBy(bundle.root_node.constraints, (c) => c)) {
      violations.push({
        rule_id: RULES.BS4,
        path: '$.root_node.constraints',
        message: 'root_node.constraints not sorted lexicographically',
      });
    }
  }

  // Check terminal node constraints
  if (Array.isArray(bundle.terminal_nodes)) {
    for (let i = 0; i < bundle.terminal_nodes.length; i++) {
      const node = bundle.terminal_nodes[i]!;
      if (Array.isArray(node.constraints) && !isSortedBy(node.constraints, (c) => c)) {
        violations.push({
          rule_id: RULES.BS4,
          path: `$.terminal_nodes[${i}].constraints`,
          message: `terminal_nodes[${i}].constraints not sorted`,
        });
      }
    }
  }

  // Check output source_constraints
  if (Array.isArray(bundle.outputs)) {
    for (let i = 0; i < bundle.outputs.length; i++) {
      const output = bundle.outputs[i]!;
      if (Array.isArray(output.source_constraints) && !isSortedBy(output.source_constraints, (c) => c)) {
        violations.push({
          rule_id: RULES.BS4,
          path: `$.outputs[${i}].source_constraints`,
          message: `outputs[${i}].source_constraints not sorted`,
        });
      }
    }
  }
}

/**
 * BS5: Questions must be sorted by priority desc, then id asc.
 */
function checkQuestionsSorted(bundle: Bundle, violations: Violation[]): void {
  // Check bundle-level unresolved questions
  if (Array.isArray(bundle.unresolved_questions)) {
    if (!isQuestionsSorted(bundle.unresolved_questions)) {
      violations.push({
        rule_id: RULES.BS5,
        path: '$.unresolved_questions',
        message: 'unresolved_questions not sorted by priority desc, id asc',
      });
    }
  }

  // Check node-level unresolved questions
  if (Array.isArray(bundle.terminal_nodes)) {
    for (let i = 0; i < bundle.terminal_nodes.length; i++) {
      const node = bundle.terminal_nodes[i]!;
      if (Array.isArray(node.unresolved_questions) && !isQuestionsSorted(node.unresolved_questions)) {
        violations.push({
          rule_id: RULES.BS5,
          path: `$.terminal_nodes[${i}].unresolved_questions`,
          message: `terminal_nodes[${i}].unresolved_questions not sorted`,
        });
      }
    }
  }
}

/**
 * BS6: Terminal nodes must be sorted by id ascending.
 */
function checkTerminalNodesSorted(bundle: Bundle, violations: Violation[]): void {
  if (!Array.isArray(bundle.terminal_nodes)) return;

  if (!isSortedBy(bundle.terminal_nodes, (n) => n.id)) {
    violations.push({
      rule_id: RULES.BS6,
      path: '$.terminal_nodes',
      message: 'terminal_nodes not sorted by id',
    });
  }
}

/**
 * BS7: No path traversal in output paths.
 */
function checkNoPathTraversal(bundle: Bundle, violations: Violation[]): void {
  if (!Array.isArray(bundle.outputs)) return;

  for (let i = 0; i < bundle.outputs.length; i++) {
    const output = bundle.outputs[i]!;
    if (hasPathTraversal(output.path)) {
      violations.push({
        rule_id: RULES.BS7,
        path: `$.outputs[${i}].path`,
        message: `unsafe path: ${output.path}`,
      });
    }
  }
}

/**
 * BS8: Canonical serialization must be idempotent.
 */
function checkCanonicalIdempotent(bundle: Bundle, violations: Violation[]): void {
  try {
    const canonical1 = canonicalize(bundle);
    const parsed = JSON.parse(canonical1);
    const canonical2 = canonicalize(parsed);

    if (canonical1 !== canonical2) {
      violations.push({
        rule_id: RULES.BS8,
        path: '$',
        message: 'canonical serialization not idempotent',
      });
    }
  } catch {
    violations.push({
      rule_id: RULES.BS8,
      path: '$',
      message: 'failed to canonicalize bundle',
    });
  }
}

/**
 * Check basic bundle schema structure.
 */
function checkBasicSchema(bundle: unknown, violations: Violation[]): bundle is Bundle {
  if (!isObject(bundle)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      path: '$',
      message: `bundle must be object, got ${bundle === null ? 'null' : typeof bundle}`,
    });
    return false;
  }

  const required = ['id', 'schema_version', 'kernel_version', 'status', 'root_node', 'terminal_nodes', 'outputs', 'unresolved_questions', 'stats'];
  let hasRequiredFields = true;

  for (const field of required) {
    if (!(field in bundle)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        path: `$.${field}`,
        message: `required field ${field} is missing`,
      });
      hasRequiredFields = false;
    }
  }

  return hasRequiredFields;
}

/**
 * Sort violations deterministically by rule_id, then path.
 * Returns a new array (does not mutate input).
 */
function sortViolations(violations: Violation[]): Violation[] {
  return [...violations].sort((a, b) => {
    if (a.rule_id !== b.rule_id) {
      return a.rule_id < b.rule_id ? -1 : 1;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/**
 * Verify a bundle against BUNDLE_SPEC.md invariants.
 *
 * @param bundle - Unknown value to verify as Bundle
 * @returns { ok: true } if valid, { ok: false, violations: [...] } if invalid
 */
export function verifyBundle(bundle: unknown): VerifyResult {
  const violations: Violation[] = [];

  // Check basic structure first
  checkSchemaVersion(bundle, violations);

  if (!checkBasicSchema(bundle, violations)) {
    // Can't continue if basic schema is invalid
    return { ok: false, violations: sortViolations(violations) };
  }

  // Now we know bundle has the right shape
  const b = bundle as Bundle;

  // Run all invariant checks
  checkArtifactPathsSorted(b, violations);
  checkConstraintsSorted(b, violations);
  checkQuestionsSorted(b, violations);
  checkTerminalNodesSorted(b, violations);
  checkNoPathTraversal(b, violations);
  checkCanonicalIdempotent(b, violations);

  if (violations.length === 0) {
    return { ok: true };
  }

  return { ok: false, violations: sortViolations(violations) };
}
