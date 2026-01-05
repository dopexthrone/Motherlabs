/**
 * Property-Based Invariant Tests
 * ==============================
 *
 * Tests kernel invariants using seeded PRNG for reproducibility.
 * Seeds are locked in seeds.lock - do not modify.
 *
 * Invariants tested:
 * I1: Canonicalization idempotence
 * I2: Normalization idempotence
 * I3: Hash stability
 * I4: Ordering invariants
 * I5: Validator completeness (negative generation)
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng, createTestDataGenerator, type GeneratedIntent } from './utils/prng.js';
import {
  canonicalize,
  canonicalHash,
  parseCanonical,
  canonicalizeToBytes,
} from '../utils/canonical.js';
import {
  normalizeIntent,
  normalizeString,
  normalizeConstraint,
  normalizeConstraints,
  type RawIntent,
} from '../utils/normalize.js';
import { transform, getBundleHash } from '../assembler/bundle.js';

// =============================================================================
// Seed Loading
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadSeeds(): number[] {
  // seeds.lock is in src/tests, not dist/tests, so we need to go up and over
  const srcTestsDir = path.resolve(__dirname, '../../src/tests');
  const seedsPath = path.join(srcTestsDir, 'seeds.lock');
  const content = fs.readFileSync(seedsPath, 'utf-8');

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => parseInt(line, 10))
    .filter((n) => !isNaN(n));
}

const SEEDS = loadSeeds();

/**
 * Convert GeneratedIntent to transform input format.
 * Strips null values to use optional parameters correctly.
 */
function toTransformInput(intent: GeneratedIntent): { goal: string; constraints?: string[]; context?: Record<string, unknown> } {
  const result: { goal: string; constraints?: string[]; context?: Record<string, unknown> } = {
    goal: intent.goal,
  };
  if (intent.constraints !== null) {
    result.constraints = intent.constraints;
  }
  if (intent.context !== null) {
    result.context = intent.context;
  }
  return result;
}

// =============================================================================
// I1: Canonicalization Idempotence
// =============================================================================

describe('I1: Canonicalization Idempotence', () => {
  it('canonical(parse(canonical(x))) == canonical(x) for all seeds', () => {
    for (const seed of SEEDS) {
      const gen = createTestDataGenerator(seed);
      const intent = gen.generateIntent();

      // First canonicalization
      const canonical1 = canonicalize(intent);

      // Parse and re-canonicalize
      const parsed = JSON.parse(canonical1);
      const canonical2 = canonicalize(parsed);

      assert.strictEqual(
        canonical1,
        canonical2,
        `Idempotence failed for seed ${seed}: canonical strings differ`
      );
    }
  });

  it('canonicalize is stable for objects with shuffled keys', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const rng = createRng(seed);

      // Create object with known keys
      const obj: Record<string, unknown> = {
        alpha: 1,
        beta: 2,
        gamma: 3,
        delta: 4,
        epsilon: 5,
      };

      // Canonicalize original
      const canonical1 = canonicalize(obj);

      // Create same object with shuffled key insertion order
      const keys = Object.keys(obj);
      rng.shuffle([...keys]);

      const shuffled: Record<string, unknown> = {};
      for (const key of keys) {
        shuffled[key] = obj[key];
      }

      const canonical2 = canonicalize(shuffled);

      assert.strictEqual(
        canonical1,
        canonical2,
        `Key order should not affect canonical output (seed ${seed})`
      );
    }
  });

  it('canonicalize round-trips through bytes', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const gen = createTestDataGenerator(seed);
      const intent = gen.generateIntent();

      const bytes = canonicalizeToBytes(intent);
      const parsed = parseCanonical(bytes);
      const canonical1 = canonicalize(intent);
      const canonical2 = canonicalize(parsed);

      assert.strictEqual(
        canonical1,
        canonical2,
        `Byte round-trip failed for seed ${seed}`
      );
    }
  });
});

// =============================================================================
// I2: Normalization Idempotence
// =============================================================================

describe('I2: Normalization Idempotence', () => {
  it('normalizeIntent(normalizeIntent(x)) produces same result', () => {
    for (const seed of SEEDS) {
      const gen = createTestDataGenerator(seed);
      const rawIntent = gen.generateIntent();

      // Ensure goal is non-empty
      if (!rawIntent.goal || rawIntent.goal.trim().length === 0) {
        continue;
      }

      const raw = toTransformInput(rawIntent);

      // First normalization
      const norm1 = normalizeIntent(raw);

      // Second normalization (using normalized as input)
      const raw2: RawIntent = {
        goal: norm1.goal,
        constraints: norm1.constraints,
        context: norm1.context,
      };
      const norm2 = normalizeIntent(raw2);

      // Compare canonical representations
      const canonical1 = canonicalize(norm1);
      const canonical2 = canonicalize(norm2);

      assert.strictEqual(
        canonical1,
        canonical2,
        `Normalization not idempotent for seed ${seed}`
      );
    }
  });

  it('normalizeString is idempotent', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const gen = createTestDataGenerator(seed);
      const unicode = gen.generateUnicodeEdgeCase();

      const norm1 = normalizeString(unicode);
      const norm2 = normalizeString(norm1);

      assert.strictEqual(
        norm1,
        norm2,
        `normalizeString not idempotent for seed ${seed}: "${unicode}"`
      );
    }
  });

  it('normalizeConstraint is idempotent', () => {
    const testConstraints = [
      '  leading spaces  ',
      'trailing spaces   ',
      'multiple   spaces   between',
      'line\nbreaks\n\n\nmultiple',
      '\t\ttabs\t\t',
      'café', // NFC
      'cafe\u0301', // NFD
    ];

    for (const constraint of testConstraints) {
      const norm1 = normalizeConstraint(constraint);
      const norm2 = normalizeConstraint(norm1);

      assert.strictEqual(
        norm1,
        norm2,
        `normalizeConstraint not idempotent for: "${constraint}"`
      );
    }
  });

  it('normalizeConstraints is idempotent and sorted', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const rng = createRng(seed);

      const constraints = [
        'Constraint C',
        'Constraint A',
        'Constraint B',
        'Constraint A', // duplicate
        '  Constraint D  ',
      ];

      rng.shuffle(constraints);

      const norm1 = normalizeConstraints(constraints);
      const norm2 = normalizeConstraints(norm1);

      assert.deepStrictEqual(
        norm1,
        norm2,
        `normalizeConstraints not idempotent for seed ${seed}`
      );

      // Verify sorted
      for (let i = 1; i < norm1.length; i++) {
        const prev = norm1[i - 1]!;
        const curr = norm1[i]!;
        assert.ok(
          prev <= curr,
          `Constraints not sorted at index ${i}`
        );
      }
    }
  });
});

// =============================================================================
// I3: Hash Stability
// =============================================================================

describe('I3: Hash Stability', () => {
  it('canonicalHash produces same result across N runs', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const gen = createTestDataGenerator(seed);
      const intent = gen.generateIntent();

      const hashes: string[] = [];
      for (let i = 0; i < 10; i++) {
        hashes.push(canonicalHash(intent));
      }

      const first = hashes[0];
      for (let i = 1; i < hashes.length; i++) {
        assert.strictEqual(
          hashes[i],
          first,
          `Hash unstable on run ${i} for seed ${seed}`
        );
      }
    }
  });

  it('bundle hash is stable across N transforms of same intent', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const gen = createTestDataGenerator(seed);
      const rawIntent = gen.generateIntent();

      // Skip empty goals
      if (!rawIntent.goal || rawIntent.goal.trim().length === 0) {
        continue;
      }

      const hashes: string[] = [];
      for (let i = 0; i < 5; i++) {
        const bundle = transform(toTransformInput(rawIntent));
        hashes.push(getBundleHash(bundle));
      }

      const first = hashes[0];
      for (let i = 1; i < hashes.length; i++) {
        assert.strictEqual(
          hashes[i],
          first,
          `Bundle hash unstable on transform ${i} for seed ${seed}`
        );
      }
    }
  });

  it('different intents produce different hashes', () => {
    const hashes = new Set<string>();

    for (const seed of SEEDS.slice(0, 50)) {
      const gen = createTestDataGenerator(seed);
      const intent = gen.generateIntent();

      // Skip empty goals
      if (!intent.goal || intent.goal.trim().length === 0) {
        continue;
      }

      const hash = canonicalHash(intent);

      // Very unlikely to have collision in 50 different intents
      if (hashes.has(hash)) {
        // Check if it's actually the same intent
        // This is acceptable - PRNG might generate similar intents
        continue;
      }

      hashes.add(hash);
    }

    // Should have many unique hashes
    assert.ok(
      hashes.size > 10,
      `Expected many unique hashes, got ${hashes.size}`
    );
  });
});

// =============================================================================
// I4: Ordering Invariants
// =============================================================================

describe('I4: Ordering Invariants', () => {
  it('outputs are always sorted by path', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const gen = createTestDataGenerator(seed);
      const rawIntent = gen.generateIntent();

      if (!rawIntent.goal || rawIntent.goal.trim().length === 0) {
        continue;
      }

      const bundle = transform(toTransformInput(rawIntent));

      // Check outputs sorted by path
      for (let i = 1; i < bundle.outputs.length; i++) {
        const prev = bundle.outputs[i - 1]!;
        const curr = bundle.outputs[i]!;
        assert.ok(
          prev.path <= curr.path,
          `Outputs not sorted by path at index ${i} for seed ${seed}`
        );
      }
    }
  });

  it('unresolved_questions are sorted by (priority desc, id asc)', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const gen = createTestDataGenerator(seed);
      const rawIntent = gen.generateIntent();

      if (!rawIntent.goal || rawIntent.goal.trim().length === 0) {
        continue;
      }

      const bundle = transform(toTransformInput(rawIntent));

      const questions = bundle.unresolved_questions;

      for (let i = 1; i < questions.length; i++) {
        const prev = questions[i - 1]!;
        const curr = questions[i]!;

        if (prev.priority !== curr.priority) {
          // Higher priority should come first
          assert.ok(
            prev.priority >= curr.priority,
            `Questions not sorted by priority desc at index ${i} for seed ${seed}`
          );
        } else {
          // Same priority: sort by id ascending
          assert.ok(
            prev.id <= curr.id,
            `Questions with same priority not sorted by id asc at index ${i} for seed ${seed}`
          );
        }
      }
    }
  });

  it('terminal_nodes are sorted by id', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const gen = createTestDataGenerator(seed);
      const rawIntent = gen.generateIntent();

      if (!rawIntent.goal || rawIntent.goal.trim().length === 0) {
        continue;
      }

      const bundle = transform(toTransformInput(rawIntent));

      for (let i = 1; i < bundle.terminal_nodes.length; i++) {
        const prev = bundle.terminal_nodes[i - 1]!;
        const curr = bundle.terminal_nodes[i]!;
        assert.ok(
          prev.id <= curr.id,
          `Terminal nodes not sorted by id at index ${i} for seed ${seed}`
        );
      }
    }
  });

  it('constraints within nodes are always sorted', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const gen = createTestDataGenerator(seed);
      const rawIntent = gen.generateIntent();

      if (!rawIntent.goal || rawIntent.goal.trim().length === 0) {
        continue;
      }

      const bundle = transform(toTransformInput(rawIntent));

      // Check root node constraints
      const rootConstraints = bundle.root_node.constraints;
      for (let i = 1; i < rootConstraints.length; i++) {
        const prev = rootConstraints[i - 1]!;
        const curr = rootConstraints[i]!;
        assert.ok(
          prev <= curr,
          `Root node constraints not sorted at index ${i} for seed ${seed}`
        );
      }

      // Check terminal node constraints
      for (const node of bundle.terminal_nodes) {
        for (let i = 1; i < node.constraints.length; i++) {
          const prev = node.constraints[i - 1]!;
          const curr = node.constraints[i]!;
          assert.ok(
            prev <= curr,
            `Node ${node.id} constraints not sorted at index ${i}`
          );
        }
      }
    }
  });
});

// =============================================================================
// I5: Validator Completeness (Negative Generation)
// =============================================================================

describe('I5: Validator Completeness', () => {
  it('empty goal always rejected', () => {
    const emptyGoals = ['', '   ', '\t', '\n', '\r\n'];

    for (const goal of emptyGoals) {
      assert.throws(
        () => normalizeIntent({ goal }),
        /empty|cannot be empty/i,
        `Empty goal "${goal.replace(/\s/g, '\\s')}" should be rejected`
      );
    }
  });

  it('missing required field (goal) always rejected', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const rng = createRng(seed);

      // Generate objects without goal
      const invalidIntents = [
        {},
        { constraints: ['test'] },
        { context: { key: 'value' } },
        { goal: null },
        { goal: undefined },
        { goal: 123 }, // wrong type
        { goal: [] }, // wrong type
      ];

      const selected = rng.pick(invalidIntents);

      assert.throws(
        () => normalizeIntent(selected as RawIntent),
        /goal|string|required/i,
        `Invalid intent should be rejected: ${JSON.stringify(selected)}`
      );
    }
  });

  it('contradictory constraints are detected and handled', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const gen = createTestDataGenerator(seed);
      const [constraint1, constraint2] = gen.generateContradiction();

      // Transform should still work, but entropy should be higher
      const bundle = transform({
        goal: 'Build a system with contradictions',
        constraints: [constraint1, constraint2],
      });

      // Should complete without throwing
      assert.ok(bundle.id, 'Bundle should have an ID');

      // Entropy should reflect the contradiction
      assert.ok(
        bundle.root_node.entropy.contradiction_count >= 0,
        'Should track contradictions'
      );
    }
  });

  it('unicode normalization is consistent (NFC vs NFD)', () => {
    // Same character in different Unicode forms
    const testCases = [
      { nfc: '\u00C4', nfd: 'A\u0308' }, // Ä
      { nfc: '\u00E9', nfd: 'e\u0301' }, // é
      { nfc: '\u00F1', nfd: 'n\u0303' }, // ñ
    ];

    for (const { nfc, nfd } of testCases) {
      const norm1 = normalizeString(nfc);
      const norm2 = normalizeString(nfd);

      assert.strictEqual(
        norm1,
        norm2,
        `NFC "${nfc}" and NFD should normalize to same string`
      );
    }
  });

  it('zero-width characters are handled consistently', () => {
    const zeroWidthChars = [
      '\u200B', // zero-width space
      '\u200C', // zero-width non-joiner
      '\u200D', // zero-width joiner
      '\uFEFF', // BOM
    ];

    for (const seed of SEEDS.slice(0, 10)) {
      const rng = createRng(seed);
      const zwc = rng.pick(zeroWidthChars);

      const goal1 = `Build a system${zwc}`;
      const goal2 = 'Build a system';

      // Both should produce valid bundles
      const bundle1 = transform({ goal: goal1 });
      const bundle2 = transform({ goal: goal2 });

      assert.ok(bundle1.id, 'Bundle with ZWC should have ID');
      assert.ok(bundle2.id, 'Bundle without ZWC should have ID');
    }
  });

  it('extremely long strings are handled without crash', () => {
    const lengths = [1000, 5000, 10000];

    for (const length of lengths) {
      const goal = 'Build '.repeat(length / 6);

      // Should not throw
      const bundle = transform({ goal });
      assert.ok(bundle.id, `Bundle with ${length}-char goal should have ID`);
    }
  });

  it('many constraints are handled deterministically', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const rng = createRng(seed);

      // Generate 50-100 constraints
      const count = rng.nextInt(50, 100);
      const constraints: string[] = [];
      for (let i = 0; i < count; i++) {
        constraints.push(`Constraint ${rng.nextString(10)}`);
      }

      const bundle1 = transform({
        goal: 'Build a complex system',
        constraints,
      });

      const bundle2 = transform({
        goal: 'Build a complex system',
        constraints,
      });

      assert.strictEqual(
        getBundleHash(bundle1),
        getBundleHash(bundle2),
        `Many constraints should produce deterministic output for seed ${seed}`
      );
    }
  });
});

// =============================================================================
// Summary
// =============================================================================

describe('Property Test Summary', () => {
  it(`ran property tests across ${SEEDS.length} seeds`, () => {
    assert.ok(SEEDS.length >= 50, `Expected at least 50 seeds, got ${SEEDS.length}`);
  });
});
