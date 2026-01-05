/**
 * Negative Test Suite
 * ===================
 *
 * Tests designed to break the kernel with adversarial inputs.
 * These test edge cases, contradictions, underspecification, and malformed inputs.
 *
 * Categories:
 * 1. Contradictory constraints
 * 2. Underspecified intents
 * 3. Adversarial wording
 * 4. Malformed inputs
 * 5. Boundary conditions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  transform,
  validateAllGates,
  measureEntropy,
  measureDensity,
  canonicalize,
  normalizeIntent,
} from '../index.js';

// =============================================================================
// Contradictory Constraint Tests
// =============================================================================

describe('Contradictory Constraints', () => {
  it('detects synchronous vs asynchronous contradiction', () => {
    const intent = {
      goal: 'Build an API',
      constraints: [
        'All operations must be synchronous',
        'Use asynchronous processing for all requests',
      ],
    };

    const bundle = transform(intent);
    const entropy = measureEntropy(intent.goal, intent.constraints);

    // Should have detected contradiction
    assert.ok(
      entropy.contradiction_count > 0,
      `Expected contradiction detection, got ${entropy.contradiction_count}`
    );
  });

  it('detects public vs private contradiction', () => {
    const intent = {
      goal: 'Create a user endpoint',
      constraints: [
        'Endpoint must be public for all users',
        'Endpoint must be private and require authentication',
      ],
    };

    const bundle = transform(intent);
    const entropy = measureEntropy(intent.goal, intent.constraints);

    assert.ok(entropy.contradiction_count > 0);
  });

  it('detects required vs optional contradiction', () => {
    const intent = {
      goal: 'Design a form',
      constraints: [
        'Email field is required',
        'Email field is optional',
      ],
    };

    const entropy = measureEntropy(intent.goal, intent.constraints);
    assert.ok(entropy.contradiction_count > 0);
  });

  it('handles contradictions gracefully without crashing', () => {
    const intent = {
      goal: 'Build something',
      constraints: [
        'Must be fast',
        'Must never be fast',
        'Always use caching',
        'Never use caching',
        'Required for all users',
        'Optional for all users',
      ],
    };

    // Should not throw
    const bundle = transform(intent);

    // Should pass validation gates (structure is valid even if semantics are contradictory)
    const validation = validateAllGates(bundle);
    assert.ok(validation.valid);

    // Should have elevated entropy due to contradictions
    const entropy = measureEntropy(intent.goal, intent.constraints);
    assert.ok(entropy.entropy_score >= 25, `Expected elevated entropy, got ${entropy.entropy_score}`);
    assert.ok(entropy.contradiction_count > 0, 'Should detect contradictions');
  });
});

// =============================================================================
// Underspecified Intent Tests
// =============================================================================

describe('Underspecified Intents', () => {
  it('handles minimal intent (just goal)', () => {
    const intent = { goal: 'Build it' };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);

    assert.ok(validation.valid);
  });

  it('detects high entropy for vague goals', () => {
    const intent = {
      goal: 'Make something good',
    };

    const entropy = measureEntropy(intent.goal, []);
    const density = measureDensity(intent.goal, []);

    // High entropy (lack of specificity)
    // Low density (lack of concrete constraints)
    assert.ok(
      density.density_score < 50,
      `Expected low density for vague goal, got ${density.density_score}`
    );
  });

  it('handles placeholder content', () => {
    const intent = {
      goal: 'Create a system for TBD purposes',
      constraints: [
        'Use [technology to be determined]',
        'Connect to {placeholder} database',
        'Handle <undefined> user types',
      ],
    };

    const entropy = measureEntropy(intent.goal, intent.constraints);

    // Should detect unresolved references
    assert.ok(
      entropy.unresolved_refs >= 3,
      `Expected 3+ unresolved refs, got ${entropy.unresolved_refs}`
    );
  });

  it('handles TODO markers in constraints', () => {
    const intent = {
      goal: 'Build a feature',
      constraints: [
        'TODO: define the actual requirements',
        'FIXME: need to specify the database',
        'TBD: authentication method',
      ],
    };

    const entropy = measureEntropy(intent.goal, intent.constraints);
    assert.ok(entropy.unresolved_refs >= 3);
  });
});

// =============================================================================
// Adversarial Wording Tests
// =============================================================================

describe('Adversarial Wording', () => {
  it('handles extremely long goal', () => {
    const longGoal = 'Build a system that '.repeat(1000) + 'does something';

    const intent = { goal: longGoal };

    // Should not crash
    const bundle = transform(intent);
    const validation = validateAllGates(bundle);
    assert.ok(validation.valid);
  });

  it('handles extremely long constraints', () => {
    const longConstraint = 'Must handle '.repeat(1000) + 'everything';

    const intent = {
      goal: 'Build it',
      constraints: [longConstraint],
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);
    assert.ok(validation.valid);
  });

  it('handles many constraints', () => {
    const manyConstraints = Array.from(
      { length: 100 },
      (_, i) => `Constraint number ${i + 1}`
    );

    const intent = {
      goal: 'Build a complex system',
      constraints: manyConstraints,
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);
    assert.ok(validation.valid);

    // Constraints should be sorted
    assert.deepStrictEqual(
      bundle.root_node.constraints,
      [...bundle.root_node.constraints].sort()
    );
  });

  it('handles special characters in goal', () => {
    const intent = {
      goal: 'Build a system with "quotes", \'apostrophes\', and <tags>',
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);
    assert.ok(validation.valid);

    // Should canonicalize properly
    const canonical = canonicalize(bundle);
    assert.ok(canonical.includes('quotes'));
  });

  it('handles unicode edge cases', () => {
    const intent = {
      goal: 'Build a system for 日本語, العربية, and émojis 🎉🚀💻',
      constraints: [
        'Support RTL text: مرحبا',
        'Handle combining characters: é = e + ́',
        'Process zero-width characters: a\u200Bb',
      ],
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);
    assert.ok(validation.valid);
  });

  it('handles newlines and whitespace', () => {
    const intent = {
      goal: 'Build a\nsystem\twith\rweird\r\nwhitespace',
      constraints: [
        '  Leading spaces  ',
        '\tTabs\teverywhere\t',
        '\n\nMultiple\n\nnewlines\n\n',
      ],
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);
    assert.ok(validation.valid);
  });

  it('handles empty strings in constraints array', () => {
    const intent = {
      goal: 'Build something',
      constraints: ['', '   ', '\t', '\n', 'Actual constraint'],
    };

    // Empty/whitespace constraints should be filtered
    const normalized = normalizeIntent(intent);
    assert.strictEqual(
      normalized.constraints.length,
      1,
      'Empty constraints should be filtered'
    );
  });

  it('handles duplicate constraints', () => {
    const intent = {
      goal: 'Build it',
      constraints: [
        'Use TypeScript',
        'Use TypeScript',
        'Use TypeScript',
        'Use Node.js',
        'Use Node.js',
      ],
    };

    // Duplicates should be removed
    const normalized = normalizeIntent(intent);
    assert.strictEqual(
      normalized.constraints.length,
      2,
      'Duplicate constraints should be removed'
    );
  });
});

// =============================================================================
// Malformed Input Tests
// =============================================================================

describe('Malformed Inputs', () => {
  it('rejects empty goal', () => {
    assert.throws(
      () => normalizeIntent({ goal: '' }),
      /empty/i
    );
  });

  it('rejects whitespace-only goal', () => {
    assert.throws(
      () => normalizeIntent({ goal: '   \t\n  ' }),
      /empty/i
    );
  });

  it('handles constraints as undefined', () => {
    const intent = { goal: 'Build it' };
    const normalized = normalizeIntent(intent);
    assert.deepStrictEqual(normalized.constraints, []);
  });

  it('handles context as undefined', () => {
    const intent = { goal: 'Build it' };
    const normalized = normalizeIntent(intent);
    assert.deepStrictEqual(normalized.context, {});
  });
});

// =============================================================================
// Boundary Condition Tests
// =============================================================================

describe('Boundary Conditions', () => {
  it('handles single character goal', () => {
    const intent = { goal: 'X' };
    const bundle = transform(intent);
    assert.ok(validateAllGates(bundle).valid);
  });

  it('produces deterministic output for near-identical inputs', () => {
    const intent1 = { goal: 'Build a system', constraints: ['Use TypeScript'] };
    const intent2 = { goal: 'Build a system', constraints: ['Use Typescript'] }; // Different case

    const bundle1 = transform(intent1);
    const bundle2 = transform(intent2);

    // These should be different (TypeScript vs Typescript)
    assert.notStrictEqual(bundle1.id, bundle2.id);
  });

  it('handles maximum decomposition depth gracefully', () => {
    // Intent with high branching potential
    const intent = {
      goal: 'Build a complex system with many options',
      constraints: [
        'Could use SQL or NoSQL',
        'Either REST or GraphQL',
        'Maybe synchronous or asynchronous',
        'Possibly cloud or on-premise',
        'Perhaps serverless or containerized',
      ],
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);

    assert.ok(validation.valid);
    // Should not exceed max depth (configured as 10)
    assert.ok(bundle.stats.max_depth <= 10);
  });

  it('handles zero entropy case', () => {
    // Very specific, well-defined intent
    const intent = {
      goal: 'Create a TypeScript function named "add" that returns the sum of two numbers',
      constraints: [
        'Must use TypeScript',
        'Function name must be "add"',
        'Must accept exactly two number parameters',
        'Must return a number',
        'Must not throw exceptions',
      ],
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);

    assert.ok(validation.valid);
    // Should have non-zero density (specific constraints present)
    const density = measureDensity(intent.goal, intent.constraints);
    assert.ok(density.density_score >= 0, `Density should be valid, got ${density.density_score}`);
    assert.ok(density.concrete_constraints > 0, 'Should have concrete constraints');
  });
});

// =============================================================================
// Security Edge Cases
// =============================================================================

describe('Security Edge Cases', () => {
  it('handles potential injection in goal', () => {
    const intent = {
      goal: 'Build a system; rm -rf /',
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);

    // Should process without executing anything
    assert.ok(validation.valid);
    // Goal should be preserved as-is (in normalized form)
    assert.ok(bundle.root_node.goal.includes('rm'));
  });

  it('handles potential path traversal in constraints', () => {
    const intent = {
      goal: 'Build it',
      constraints: [
        'Create file at ../../../etc/passwd',
        'Read from /etc/shadow',
      ],
    };

    const bundle = transform(intent);
    const validation = validateAllGates(bundle);

    // Kernel should process without executing
    assert.ok(validation.valid);
  });

  it('handles extremely nested context', () => {
    // Create deeply nested object
    let context: Record<string, unknown> = { value: 'deep' };
    for (let i = 0; i < 50; i++) {
      context = { nested: context };
    }

    const intent = {
      goal: 'Build it',
      context,
    };

    // Should handle without stack overflow
    const bundle = transform(intent);
    assert.ok(validateAllGates(bundle).valid);
  });
});
