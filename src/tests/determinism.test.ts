/**
 * Determinism Test Suite
 * ======================
 *
 * Tests to verify that the kernel produces byte-identical output
 * for identical input, regardless of execution environment.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  transform,
  getBundleHash,
  getBundleCanonical,
  canonicalize,
  canonicalHash,
  verifyRoundTrip,
  validateAllGates,
} from '../index.js';

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
// Canonical Serialization Tests
// =============================================================================

describe('Canonical Serialization', () => {
  it('produces stable output for objects with different key insertion order', () => {
    // Create objects with keys in different orders
    const obj1: Record<string, unknown> = {};
    obj1['z'] = 1;
    obj1['a'] = 2;
    obj1['m'] = 3;

    const obj2: Record<string, unknown> = {};
    obj2['a'] = 2;
    obj2['m'] = 3;
    obj2['z'] = 1;

    const obj3: Record<string, unknown> = {};
    obj3['m'] = 3;
    obj3['z'] = 1;
    obj3['a'] = 2;

    const canonical1 = canonicalize(obj1);
    const canonical2 = canonicalize(obj2);
    const canonical3 = canonicalize(obj3);

    assert.strictEqual(canonical1, canonical2, 'obj1 and obj2 should canonicalize identically');
    assert.strictEqual(canonical2, canonical3, 'obj2 and obj3 should canonicalize identically');
    assert.strictEqual(canonical1, '{"a":2,"m":3,"z":1}', 'Keys should be sorted');
  });

  it('produces stable output for nested objects', () => {
    const obj = {
      b: { z: 1, a: 2 },
      a: { y: 3, x: 4 },
    };

    const expected = '{"a":{"x":4,"y":3},"b":{"a":2,"z":1}}';
    assert.strictEqual(canonicalize(obj), expected);
  });

  it('handles arrays in index order', () => {
    const arr = [3, 1, 2];
    assert.strictEqual(canonicalize(arr), '[3,1,2]', 'Array order should be preserved');
  });

  it('round-trips through JSON parse', () => {
    const values = [
      { a: 1, b: 2 },
      [1, 2, 3],
      'hello',
      123,
      true,
      false,
      null,
      { nested: { deep: { value: 'test' } } },
    ];

    for (const val of values) {
      assert.ok(verifyRoundTrip(val), `Value ${JSON.stringify(val)} should round-trip`);
    }
  });

  it('rejects unsupported values', () => {
    // These should all throw - check for "Unsupported" in message
    assert.throws(() => canonicalize(NaN), /Unsupported|number/);
    assert.throws(() => canonicalize(Infinity), /Unsupported|number/);
    assert.throws(() => canonicalize(-Infinity), /Unsupported|number/);
    assert.throws(() => canonicalize(BigInt(123)), /Unsupported|bigint/);
    assert.throws(() => canonicalize(undefined), /Unsupported|undefined/);
    assert.throws(() => canonicalize(() => {}), /Unsupported|function/);
    assert.throws(() => canonicalize(Symbol('test')), /Unsupported|symbol/);
  });
});

// =============================================================================
// Hash Stability Tests
// =============================================================================

describe('Hash Stability', () => {
  it('produces identical hash for identical objects', () => {
    const hash1 = canonicalHash({ a: 1, b: 2 });
    const hash2 = canonicalHash({ b: 2, a: 1 });

    assert.strictEqual(hash1, hash2, 'Hashes should be identical regardless of key order');
  });

  it('produces different hash for different objects', () => {
    const hash1 = canonicalHash({ a: 1 });
    const hash2 = canonicalHash({ a: 2 });

    assert.notStrictEqual(hash1, hash2, 'Different values should produce different hashes');
  });

  it('produces consistent hash across multiple calls', () => {
    const obj = SIMPLE_INTENT;
    const hashes = new Set<string>();

    for (let i = 0; i < 100; i++) {
      hashes.add(canonicalHash(obj));
    }

    assert.strictEqual(hashes.size, 1, 'All hashes should be identical');
  });
});

// =============================================================================
// Transform Determinism Tests
// =============================================================================

describe('Transform Determinism', () => {
  it('produces identical bundle for simple intent (same process)', () => {
    const bundle1 = transform(SIMPLE_INTENT);
    const bundle2 = transform(SIMPLE_INTENT);

    const hash1 = getBundleHash(bundle1);
    const hash2 = getBundleHash(bundle2);

    assert.strictEqual(hash1, hash2, 'Same intent should produce same bundle hash');

    const canonical1 = getBundleCanonical(bundle1);
    const canonical2 = getBundleCanonical(bundle2);

    assert.strictEqual(canonical1, canonical2, 'Same intent should produce byte-identical canonical output');
  });

  it('produces identical bundle for complex intent', () => {
    const bundle1 = transform(COMPLEX_INTENT);
    const bundle2 = transform(COMPLEX_INTENT);

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Complex intent should produce deterministic output'
    );
  });

  it('produces identical bundle for minimal intent', () => {
    const bundle1 = transform(MINIMAL_INTENT);
    const bundle2 = transform(MINIMAL_INTENT);

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Minimal intent should produce deterministic output'
    );
  });

  it('produces different bundle for different intents', () => {
    const bundle1 = transform(SIMPLE_INTENT);
    const bundle2 = transform(COMPLEX_INTENT);

    assert.notStrictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Different intents should produce different bundles'
    );
  });

  it('constraint order does not affect output', () => {
    const intent1 = {
      goal: 'Test',
      constraints: ['a', 'b', 'c'],
    };
    const intent2 = {
      goal: 'Test',
      constraints: ['c', 'a', 'b'],
    };

    const bundle1 = transform(intent1);
    const bundle2 = transform(intent2);

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Constraint order should be normalized'
    );
  });
});

// =============================================================================
// Validation Gate Tests
// =============================================================================

describe('Validation Gates', () => {
  it('simple intent bundle passes all gates', () => {
    const bundle = transform(SIMPLE_INTENT);
    const result = validateAllGates(bundle);

    assert.ok(result.valid, `Bundle should be valid. Errors: ${JSON.stringify(result.gates)}`);
    assert.strictEqual(result.error_count, 0, 'Should have no errors');
  });

  it('complex intent bundle passes all gates', () => {
    const bundle = transform(COMPLEX_INTENT);
    const result = validateAllGates(bundle);

    assert.ok(result.valid, `Bundle should be valid. Errors: ${JSON.stringify(result.gates)}`);
  });

  it('minimal intent bundle passes all gates', () => {
    const bundle = transform(MINIMAL_INTENT);
    const result = validateAllGates(bundle);

    assert.ok(result.valid, `Bundle should be valid. Errors: ${JSON.stringify(result.gates)}`);
  });
});

// =============================================================================
// Mutation Resistance Tests
// =============================================================================

describe('Mutation Resistance', () => {
  it('deliberately randomized key insertion produces identical output', () => {
    // Define consistent key-value pairs
    const keyValues: Record<string, number> = {
      'z': 1,
      'a': 2,
      'm': 3,
      'b': 4,
      'x': 5,
      'c': 6,
    };
    const keys = Object.keys(keyValues);
    const results = new Set<string>();

    for (let i = 0; i < 20; i++) {
      // Shuffle keys to randomize insertion order
      const shuffled = [...keys].sort(() => Math.random() - 0.5);

      // Build object with shuffled key insertion order but consistent values
      const obj: Record<string, number> = {};
      for (const key of shuffled) {
        obj[key] = keyValues[key]!;
      }

      results.add(canonicalize(obj));
    }

    // All should canonicalize to the same string since values are consistent
    assert.strictEqual(results.size, 1, 'All shuffled objects should canonicalize identically');
  });

  it('repeated transforms produce identical bundle sequence', () => {
    const hashes: string[] = [];

    for (let i = 0; i < 10; i++) {
      const bundle = transform(SIMPLE_INTENT);
      hashes.push(getBundleHash(bundle));
    }

    const uniqueHashes = new Set(hashes);
    assert.strictEqual(uniqueHashes.size, 1, 'All transforms should produce identical hash');
  });
});

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('Edge Cases', () => {
  it('handles empty constraints', () => {
    const bundle1 = transform({ goal: 'Test' });
    const bundle2 = transform({ goal: 'Test', constraints: [] });

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Undefined and empty constraints should be equivalent'
    );
  });

  it('handles unicode in goal', () => {
    const intent = {
      goal: 'Create a system for 日本語 and émojis 🎉',
      constraints: ['Support UTF-8'],
    };

    const bundle1 = transform(intent);
    const bundle2 = transform(intent);

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Unicode should be handled deterministically'
    );
  });

  it('handles special characters in constraints', () => {
    const intent = {
      goal: 'Test',
      constraints: [
        'Must handle "quotes"',
        "And 'apostrophes'",
        'And\\backslashes',
        'And\nnewlines',
        'And\ttabs',
      ],
    };

    const bundle1 = transform(intent);
    const bundle2 = transform(intent);

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Special characters should be handled deterministically'
    );
  });
});
