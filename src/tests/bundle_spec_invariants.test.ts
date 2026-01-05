/**
 * Bundle Spec Invariant Tests
 * ===========================
 *
 * Docs-driven tests that verify bundles produced by the kernel
 * conform to the BUNDLE_SPEC.md contract.
 *
 * These tests load real intents and verify invariants at the bundle boundary.
 * Failures use stable error prefixes for deterministic testing.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import {
  transform,
  getBundleHash,
  canonicalize,
  validateBundle,
  type Bundle,
  type Question,
} from '../index.js';

// =============================================================================
// Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../..');
const INTENTS_DIR = join(PROJECT_ROOT, 'intents', 'real');
const MANIFEST_PATH = join(INTENTS_DIR, 'MANIFEST.json');

// =============================================================================
// Rule Registry
// =============================================================================

/**
 * Bundle spec rule IDs for stable error reporting.
 */
const RULES = {
  BS1_SCHEMA_VERSION_PRESENT: 'BS1_SCHEMA_VERSION_PRESENT',
  BS2_HASH_STABILITY: 'BS2_HASH_STABILITY',
  BS3_ARTIFACT_PATH_SORTED: 'BS3_ARTIFACT_PATH_SORTED',
  BS4_CONSTRAINTS_SORTED: 'BS4_CONSTRAINTS_SORTED',
  BS5_QUESTIONS_SORTED: 'BS5_QUESTIONS_SORTED',
  BS6_TERMINAL_NODES_SORTED: 'BS6_TERMINAL_NODES_SORTED',
  BS7_NO_PATH_TRAVERSAL: 'BS7_NO_PATH_TRAVERSAL',
  BS8_CANONICAL_IDEMPOTENT_AT_BUNDLE: 'BS8_CANONICAL_IDEMPOTENT_AT_BUNDLE',
} as const;

type RuleId = (typeof RULES)[keyof typeof RULES];

/**
 * Throw a spec violation error with stable format.
 */
function specViolation(ruleId: RuleId, details: string): never {
  throw new Error(`BUNDLE_SPEC_VIOLATION: ${ruleId}: ${details}`);
}

// =============================================================================
// Manifest Types
// =============================================================================

interface ManifestIntent {
  id: string;
  path: string;
  category: string;
  acceptance_test: string;
  description: string;
}

interface Manifest {
  version: string;
  intents: ManifestIntent[];
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Check if array is sorted by key function.
 */
function isSortedBy<T>(arr: readonly T[], keyFn: (item: T) => string): boolean {
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
 * Check if path has traversal issues.
 */
function hasPathTraversal(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.includes('..') ||
    path.includes('\\')
  );
}

// =============================================================================
// Invariant Checks
// =============================================================================

/**
 * BS1: Schema version must be present.
 */
function checkSchemaVersionPresent(bundle: Bundle): void {
  if (!bundle.schema_version || typeof bundle.schema_version !== 'string') {
    specViolation(
      RULES.BS1_SCHEMA_VERSION_PRESENT,
      `schema_version missing or invalid: ${bundle.schema_version}`
    );
  }
}

/**
 * BS2: Bundle hash must be stable across two transforms.
 */
function checkHashStability(
  intent: { goal: string; constraints?: string[] },
  bundle1: Bundle,
  bundle2: Bundle
): void {
  const hash1 = getBundleHash(bundle1);
  const hash2 = getBundleHash(bundle2);

  if (hash1 !== hash2) {
    specViolation(
      RULES.BS2_HASH_STABILITY,
      `Hash mismatch for same intent: ${hash1.slice(0, 16)} !== ${hash2.slice(0, 16)}`
    );
  }
}

/**
 * BS3: Outputs must be sorted by path.
 */
function checkArtifactPathSorted(bundle: Bundle): void {
  if (!isSortedBy(bundle.outputs, (o) => o.path)) {
    const paths = bundle.outputs.map((o) => o.path).join(', ');
    specViolation(
      RULES.BS3_ARTIFACT_PATH_SORTED,
      `outputs not sorted by path: [${paths}]`
    );
  }
}

/**
 * BS4: Constraints must be sorted lexicographically.
 */
function checkConstraintsSorted(bundle: Bundle): void {
  // Check root node constraints
  if (!isSortedBy(bundle.root_node.constraints, (c) => c)) {
    specViolation(
      RULES.BS4_CONSTRAINTS_SORTED,
      `root_node.constraints not sorted`
    );
  }

  // Check all terminal node constraints
  for (const node of bundle.terminal_nodes) {
    if (!isSortedBy(node.constraints, (c) => c)) {
      specViolation(
        RULES.BS4_CONSTRAINTS_SORTED,
        `terminal_node ${node.id} constraints not sorted`
      );
    }
  }

  // Check output source_constraints
  for (const output of bundle.outputs) {
    if (!isSortedBy(output.source_constraints, (c) => c)) {
      specViolation(
        RULES.BS4_CONSTRAINTS_SORTED,
        `output ${output.id} source_constraints not sorted`
      );
    }
  }
}

/**
 * BS5: Questions must be sorted by priority desc, id asc.
 */
function checkQuestionsSorted(bundle: Bundle): void {
  // Check bundle-level unresolved questions
  if (!isQuestionsSorted(bundle.unresolved_questions)) {
    specViolation(
      RULES.BS5_QUESTIONS_SORTED,
      `unresolved_questions not sorted by priority desc, id asc`
    );
  }

  // Check node-level unresolved questions
  for (const node of bundle.terminal_nodes) {
    if (!isQuestionsSorted(node.unresolved_questions)) {
      specViolation(
        RULES.BS5_QUESTIONS_SORTED,
        `node ${node.id} unresolved_questions not sorted`
      );
    }
  }
}

/**
 * BS6: Terminal nodes must be sorted by id.
 */
function checkTerminalNodesSorted(bundle: Bundle): void {
  if (!isSortedBy(bundle.terminal_nodes, (n) => n.id)) {
    specViolation(
      RULES.BS6_TERMINAL_NODES_SORTED,
      `terminal_nodes not sorted by id`
    );
  }
}

/**
 * BS7: No path traversal in output paths.
 */
function checkNoPathTraversal(bundle: Bundle): void {
  for (const output of bundle.outputs) {
    if (hasPathTraversal(output.path)) {
      specViolation(
        RULES.BS7_NO_PATH_TRAVERSAL,
        `unsafe path in output: ${output.path}`
      );
    }
  }
}

/**
 * BS8: Canonical serialization must be idempotent at bundle boundary.
 */
function checkCanonicalIdempotent(bundle: Bundle): void {
  const canonical1 = canonicalize(bundle);
  const parsed = JSON.parse(canonical1);
  const canonical2 = canonicalize(parsed);

  if (canonical1 !== canonical2) {
    specViolation(
      RULES.BS8_CANONICAL_IDEMPOTENT_AT_BUNDLE,
      `Canonical serialization not idempotent`
    );
  }
}

/**
 * Run all bundle spec invariant checks.
 */
function checkAllInvariants(
  intent: { goal: string; constraints?: string[] },
  bundle: Bundle
): void {
  checkSchemaVersionPresent(bundle);
  checkArtifactPathSorted(bundle);
  checkConstraintsSorted(bundle);
  checkQuestionsSorted(bundle);
  checkTerminalNodesSorted(bundle);
  checkNoPathTraversal(bundle);
  checkCanonicalIdempotent(bundle);

  // Also run built-in validation
  const validation = validateBundle(bundle);
  if (!validation.valid) {
    throw new Error(
      `BUNDLE_SPEC_VIOLATION: VALIDATION_FAILED: ${validation.errors.join('; ')}`
    );
  }
}

// =============================================================================
// Test Fixtures
// =============================================================================

const SIMPLE_INTENT = {
  goal: 'Create a user authentication system',
  constraints: ['Must use JWT', 'Session timeout 24h'],
};

const COMPLEX_INTENT = {
  goal: 'Build a multi-tenant SaaS application with real-time collaboration',
  constraints: [
    'Must support 1000 concurrent users',
    'Data must be encrypted at rest',
    'API must be RESTful',
    'Must include admin dashboard',
    'Authentication via OAuth',
  ],
};

const MINIMAL_INTENT = {
  goal: 'Hello world',
};

// =============================================================================
// Tests
// =============================================================================

describe('Bundle Spec Invariants', () => {
  describe('BS1: Schema Version Present', () => {
    it('simple intent has schema_version', () => {
      const bundle = transform(SIMPLE_INTENT);
      checkSchemaVersionPresent(bundle);
    });

    it('complex intent has schema_version', () => {
      const bundle = transform(COMPLEX_INTENT);
      checkSchemaVersionPresent(bundle);
    });
  });

  describe('BS2: Hash Stability', () => {
    it('simple intent produces stable hash', () => {
      const bundle1 = transform(SIMPLE_INTENT);
      const bundle2 = transform(SIMPLE_INTENT);
      checkHashStability(SIMPLE_INTENT, bundle1, bundle2);
    });

    it('complex intent produces stable hash', () => {
      const bundle1 = transform(COMPLEX_INTENT);
      const bundle2 = transform(COMPLEX_INTENT);
      checkHashStability(COMPLEX_INTENT, bundle1, bundle2);
    });

    it('minimal intent produces stable hash', () => {
      const bundle1 = transform(MINIMAL_INTENT);
      const bundle2 = transform(MINIMAL_INTENT);
      checkHashStability(MINIMAL_INTENT, bundle1, bundle2);
    });
  });

  describe('BS3: Artifact Path Sorted', () => {
    it('simple intent outputs are sorted by path', () => {
      const bundle = transform(SIMPLE_INTENT);
      checkArtifactPathSorted(bundle);
    });

    it('complex intent outputs are sorted by path', () => {
      const bundle = transform(COMPLEX_INTENT);
      checkArtifactPathSorted(bundle);
    });
  });

  describe('BS4: Constraints Sorted', () => {
    it('simple intent constraints are sorted', () => {
      const bundle = transform(SIMPLE_INTENT);
      checkConstraintsSorted(bundle);
    });

    it('complex intent constraints are sorted', () => {
      const bundle = transform(COMPLEX_INTENT);
      checkConstraintsSorted(bundle);
    });

    it('constraint order in input does not affect sorting', () => {
      const intent1 = { goal: 'Test', constraints: ['z', 'a', 'm'] };
      const intent2 = { goal: 'Test', constraints: ['a', 'm', 'z'] };

      const bundle1 = transform(intent1);
      const bundle2 = transform(intent2);

      checkConstraintsSorted(bundle1);
      checkConstraintsSorted(bundle2);

      // Both should produce same hash due to normalization
      assert.strictEqual(getBundleHash(bundle1), getBundleHash(bundle2));
    });
  });

  describe('BS5: Questions Sorted', () => {
    it('simple intent questions are sorted', () => {
      const bundle = transform(SIMPLE_INTENT);
      checkQuestionsSorted(bundle);
    });

    it('complex intent questions are sorted', () => {
      const bundle = transform(COMPLEX_INTENT);
      checkQuestionsSorted(bundle);
    });
  });

  describe('BS6: Terminal Nodes Sorted', () => {
    it('simple intent terminal nodes are sorted', () => {
      const bundle = transform(SIMPLE_INTENT);
      checkTerminalNodesSorted(bundle);
    });

    it('complex intent terminal nodes are sorted', () => {
      const bundle = transform(COMPLEX_INTENT);
      checkTerminalNodesSorted(bundle);
    });
  });

  describe('BS7: No Path Traversal', () => {
    it('simple intent has no path traversal', () => {
      const bundle = transform(SIMPLE_INTENT);
      checkNoPathTraversal(bundle);
    });

    it('complex intent has no path traversal', () => {
      const bundle = transform(COMPLEX_INTENT);
      checkNoPathTraversal(bundle);
    });
  });

  describe('BS8: Canonical Idempotent', () => {
    it('simple intent is canonically idempotent', () => {
      const bundle = transform(SIMPLE_INTENT);
      checkCanonicalIdempotent(bundle);
    });

    it('complex intent is canonically idempotent', () => {
      const bundle = transform(COMPLEX_INTENT);
      checkCanonicalIdempotent(bundle);
    });
  });

  describe('All Invariants Combined', () => {
    it('simple intent passes all invariants', () => {
      const bundle = transform(SIMPLE_INTENT);
      checkAllInvariants(SIMPLE_INTENT, bundle);
    });

    it('complex intent passes all invariants', () => {
      const bundle = transform(COMPLEX_INTENT);
      checkAllInvariants(COMPLEX_INTENT, bundle);
    });

    it('minimal intent passes all invariants', () => {
      const bundle = transform(MINIMAL_INTENT);
      checkAllInvariants(MINIMAL_INTENT, bundle);
    });
  });

  describe('Real Intents from Manifest', () => {
    let manifest: Manifest | null = null;

    before(async () => {
      if (existsSync(MANIFEST_PATH)) {
        const content = await readFile(MANIFEST_PATH, 'utf-8');
        manifest = JSON.parse(content) as Manifest;
      }
    });

    it('loads manifest successfully', () => {
      assert.ok(manifest, 'Manifest should be loaded');
      assert.ok(manifest!.intents.length > 0, 'Manifest should have intents');
    });

    it('all non-refusing intents pass bundle spec invariants', async () => {
      if (!manifest) {
        // Skip if no manifest (test setup will report this)
        return;
      }

      const failures: string[] = [];

      for (const intentMeta of manifest.intents) {
        // Skip must-refuse intents as they don't produce bundles
        if (intentMeta.acceptance_test === 'must-refuse') {
          continue;
        }

        const intentPath = join(INTENTS_DIR, intentMeta.path);
        if (!existsSync(intentPath)) {
          failures.push(`${intentMeta.id}: Intent file not found`);
          continue;
        }

        try {
          const intentJson = await readFile(intentPath, 'utf-8');
          const intent = JSON.parse(intentJson);

          // Transform twice for hash stability check
          const bundle1 = transform(intent);
          const bundle2 = transform(intent);

          // Check all invariants
          checkAllInvariants(intent, bundle1);
          checkHashStability(intent, bundle1, bundle2);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          failures.push(`${intentMeta.id}: ${errMsg}`);
        }
      }

      if (failures.length > 0) {
        assert.fail(
          `Bundle spec violations in real intents:\n${failures.join('\n')}`
        );
      }
    });
  });
});
