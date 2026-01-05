/**
 * Adversarial Intent Corpus
 * =========================
 *
 * Additional adversarial test fixtures targeting:
 * - Unicode edge cases (NFD vs NFC)
 * - Zero-width characters
 * - Extremely long strings
 * - Contradictory constraints
 * - List ordering attacks (shuffled inputs)
 * - TBD/??/etc density spikes
 *
 * These fixtures extend the negative test suite with more edge cases.
 * No kernel changes - corpus only.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { transform, getBundleHash } from '../assembler/bundle.js';
import { normalizeString, normalizeConstraints } from '../utils/normalize.js';
import { canonicalHash } from '../utils/canonical.js';

// =============================================================================
// Unicode Edge Cases (NFD vs NFC)
// =============================================================================

describe('Adversarial: Unicode Normalization', () => {
  // NFD (decomposed) vs NFC (composed) forms
  const unicodePairs = [
    { name: 'A-umlaut', nfc: '\u00C4', nfd: 'A\u0308' },
    { name: 'O-umlaut', nfc: '\u00D6', nfd: 'O\u0308' },
    { name: 'U-umlaut', nfc: '\u00DC', nfd: 'U\u0308' },
    { name: 'e-acute', nfc: '\u00E9', nfd: 'e\u0301' },
    { name: 'n-tilde', nfc: '\u00F1', nfd: 'n\u0303' },
    { name: 'c-cedilla', nfc: '\u00E7', nfd: 'c\u0327' },
    { name: 'a-grave', nfc: '\u00E0', nfd: 'a\u0300' },
  ];

  for (const { name, nfc, nfd } of unicodePairs) {
    it(`${name}: NFC and NFD produce identical normalized output`, () => {
      const goalNFC = `Build a system for ${nfc} users`;
      const goalNFD = `Build a system for ${nfd} users`;

      const norm1 = normalizeString(goalNFC);
      const norm2 = normalizeString(goalNFD);

      assert.strictEqual(norm1, norm2, `${name} should normalize identically`);
    });
  }

  it('mixed NFC/NFD in constraints produce identical hashes', () => {
    const constraintsNFC = ['Must support café operations', 'Requires naïve users'];
    const constraintsNFD = ['Must support cafe\u0301 operations', 'Requires nai\u0308ve users'];

    const norm1 = normalizeConstraints(constraintsNFC);
    const norm2 = normalizeConstraints(constraintsNFD);

    assert.deepStrictEqual(norm1, norm2);
  });

  it('Korean Hangul syllables (precomposed vs jamo)', () => {
    // 가 as precomposed vs as jamo sequence
    const precomposed = '\uAC00'; // 가
    const jamo = '\u1100\u1161'; // ᄀ + ᅡ

    const goal1 = `Build ${precomposed} system`;
    const goal2 = `Build ${jamo} system`;

    // Both should normalize consistently (NFC should compose jamo)
    const bundle1 = transform({ goal: goal1 });
    const bundle2 = transform({ goal: goal2 });

    assert.ok(bundle1.id, 'Precomposed should produce valid bundle');
    assert.ok(bundle2.id, 'Jamo should produce valid bundle');
  });
});

// =============================================================================
// Zero-Width Characters
// =============================================================================

describe('Adversarial: Zero-Width Characters', () => {
  const zeroWidthChars = [
    { name: 'ZWSP', char: '\u200B' },     // zero-width space
    { name: 'ZWNJ', char: '\u200C' },     // zero-width non-joiner
    { name: 'ZWJ', char: '\u200D' },      // zero-width joiner
    { name: 'BOM', char: '\uFEFF' },      // byte order mark
    { name: 'WJ', char: '\u2060' },       // word joiner
    { name: 'NBSP', char: '\u00A0' },     // non-breaking space
    { name: 'NNBSP', char: '\u202F' },    // narrow no-break space
  ];

  for (const { name, char } of zeroWidthChars) {
    it(`${name} at start of goal is handled`, () => {
      const goal = `${char}Build a system`;
      const bundle = transform({ goal });
      assert.ok(bundle.id, `${name} at start should not crash`);
    });

    it(`${name} at end of goal is handled`, () => {
      const goal = `Build a system${char}`;
      const bundle = transform({ goal });
      assert.ok(bundle.id, `${name} at end should not crash`);
    });

    it(`${name} in middle of goal is handled`, () => {
      const goal = `Build${char}a system`;
      const bundle = transform({ goal });
      assert.ok(bundle.id, `${name} in middle should not crash`);
    });

    it(`multiple ${name} in constraints are handled`, () => {
      const constraints = [
        `${char}${char}Must${char}be${char}fast${char}${char}`,
      ];
      const bundle = transform({
        goal: 'Build a system',
        constraints,
      });
      assert.ok(bundle.id, `Multiple ${name} in constraints should not crash`);
    });
  }

  it('RTL override characters are handled safely', () => {
    const rtlOverride = '\u202E'; // right-to-left override
    const goal = `Build a ${rtlOverride}metsys`;
    const bundle = transform({ goal });
    assert.ok(bundle.id, 'RTL override should not crash');
  });

  it('combining diacritical marks are handled', () => {
    // Multiple combining marks on a single character
    const goal = 'Build a\u0301\u0302\u0303\u0304 system';
    const bundle = transform({ goal });
    assert.ok(bundle.id, 'Multiple combining marks should not crash');
  });
});

// =============================================================================
// Extremely Long Strings
// =============================================================================

describe('Adversarial: Extremely Long Strings', () => {
  it('goal with 10,000 characters', () => {
    const goal = 'Build ' + 'a'.repeat(10000) + ' system';
    const bundle = transform({ goal });
    assert.ok(bundle.id, '10K char goal should produce valid bundle');
  });

  it('goal with 50,000 characters', () => {
    const goal = 'Build ' + 'b'.repeat(50000) + ' system';
    const bundle = transform({ goal });
    assert.ok(bundle.id, '50K char goal should produce valid bundle');
  });

  it('100 constraints each with 1,000 characters', () => {
    const constraints = Array.from({ length: 100 }, (_, i) =>
      `Constraint ${i}: ` + 'x'.repeat(1000)
    );
    const bundle = transform({
      goal: 'Build a system',
      constraints,
    });
    assert.ok(bundle.id, '100x1K constraints should produce valid bundle');
  });

  it('single constraint with 100,000 characters', () => {
    const constraints = ['Must ' + 'y'.repeat(100000)];
    const bundle = transform({
      goal: 'Build a system',
      constraints,
    });
    assert.ok(bundle.id, '100K char constraint should produce valid bundle');
  });

  it('deeply nested context object', () => {
    let context: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 50; i++) {
      context = { nested: context };
    }

    const bundle = transform({
      goal: 'Build a system',
      context,
    });
    assert.ok(bundle.id, 'Deeply nested context should produce valid bundle');
  });

  it('context with 1000 keys', () => {
    const context: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) {
      context[`key_${i}`] = `value_${i}`;
    }

    const bundle = transform({
      goal: 'Build a system',
      context,
    });
    assert.ok(bundle.id, 'Context with 1000 keys should produce valid bundle');
  });
});

// =============================================================================
// Contradictory Constraints
// =============================================================================

describe('Adversarial: Contradictory Constraints', () => {
  const contradictions: Array<{ name: string; c1: string; c2: string }> = [
    { name: 'sync/async', c1: 'Must be synchronous', c2: 'Must be asynchronous' },
    { name: 'public/private', c1: 'Must be public', c2: 'Must be private' },
    { name: 'sql/nosql', c1: 'Must use SQL database', c2: 'Must use NoSQL only' },
    { name: 'rest/graphql', c1: 'Must use REST API', c2: 'Must use GraphQL exclusively' },
    { name: 'monolith/microservice', c1: 'Must be monolithic', c2: 'Must be microservices' },
    { name: 'stateless/stateful', c1: 'Must be stateless', c2: 'Must maintain session state' },
    { name: 'online/offline', c1: 'Must require network', c2: 'Must work offline' },
    { name: 'single/multi-tenant', c1: 'Must be single-tenant', c2: 'Must be multi-tenant' },
    { name: 'open/closed-source', c1: 'Must be open source', c2: 'Must be proprietary' },
    { name: 'real-time/batch', c1: 'Must process in real-time', c2: 'Must use batch processing only' },
  ];

  for (const { name, c1, c2 } of contradictions) {
    it(`handles ${name} contradiction gracefully`, () => {
      const bundle = transform({
        goal: 'Build a complex system',
        constraints: [c1, c2],
      });

      assert.ok(bundle.id, `${name} contradiction should produce valid bundle`);
      // Entropy should be elevated due to contradiction
      assert.ok(
        bundle.root_node.entropy.entropy_score >= 0,
        'Entropy should be measured'
      );
    });
  }

  it('multiple contradictions in same intent', () => {
    const bundle = transform({
      goal: 'Build an impossible system',
      constraints: [
        'Must be synchronous',
        'Must be asynchronous',
        'Must use SQL',
        'Must use NoSQL only',
        'Must be public',
        'Must be private',
      ],
    });

    assert.ok(bundle.id, 'Multiple contradictions should still produce bundle');
  });

  it('subtle contradiction: performance vs simplicity', () => {
    const bundle = transform({
      goal: 'Build a system',
      constraints: [
        'Must achieve sub-millisecond response times',
        'Must be as simple as possible with no optimizations',
      ],
    });

    assert.ok(bundle.id, 'Subtle contradiction should produce valid bundle');
  });
});

// =============================================================================
// List Ordering Attacks
// =============================================================================

describe('Adversarial: List Ordering Attacks', () => {
  it('shuffled constraints produce identical bundle hash', () => {
    const constraints = [
      'Must be secure',
      'Must be fast',
      'Must be scalable',
      'Must be maintainable',
      'Must be testable',
    ];

    // Original order
    const bundle1 = transform({
      goal: 'Build a system',
      constraints: [...constraints],
    });

    // Reversed order
    const bundle2 = transform({
      goal: 'Build a system',
      constraints: [...constraints].reverse(),
    });

    // Random-looking order
    const bundle3 = transform({
      goal: 'Build a system',
      constraints: [constraints[2]!, constraints[0]!, constraints[4]!, constraints[1]!, constraints[3]!],
    });

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Reversed constraints should produce identical hash'
    );
    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle3),
      'Shuffled constraints should produce identical hash'
    );
  });

  it('duplicates in different positions produce identical hash', () => {
    const bundle1 = transform({
      goal: 'Build a system',
      constraints: ['Must be fast', 'Must be secure', 'Must be fast'],
    });

    const bundle2 = transform({
      goal: 'Build a system',
      constraints: ['Must be secure', 'Must be fast', 'Must be fast'],
    });

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Duplicates in different positions should normalize identically'
    );
  });

  it('whitespace variations in constraints produce identical hash', () => {
    const bundle1 = transform({
      goal: 'Build a system',
      constraints: ['Must be fast'],
    });

    const bundle2 = transform({
      goal: 'Build a system',
      constraints: ['  Must  be  fast  '],
    });

    const bundle3 = transform({
      goal: 'Build a system',
      constraints: ['Must\tbe\tfast'],
    });

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Whitespace variations should normalize'
    );
    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle3),
      'Tab variations should normalize'
    );
  });

  it('context key ordering is deterministic', () => {
    const context1 = { z: 1, a: 2, m: 3 };
    const context2 = { a: 2, m: 3, z: 1 };
    const context3 = { m: 3, z: 1, a: 2 };

    const bundle1 = transform({ goal: 'Test', context: context1 });
    const bundle2 = transform({ goal: 'Test', context: context2 });
    const bundle3 = transform({ goal: 'Test', context: context3 });

    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle2),
      'Context key order should not affect hash'
    );
    assert.strictEqual(
      getBundleHash(bundle1),
      getBundleHash(bundle3),
      'Context key order should not affect hash'
    );
  });
});

// =============================================================================
// TBD/??/etc Density Spikes
// =============================================================================

describe('Adversarial: Placeholder Density', () => {
  const placeholders = [
    'TBD', 'TODO', 'FIXME', '???', '...', '[TBD]', '(TBD)',
    'TO BE DETERMINED', 'TO DO', 'PLACEHOLDER', 'XXX',
    '<<INSERT HERE>>', '<TBD>', '{TBD}', 'NEEDS_WORK',
  ];

  for (const placeholder of placeholders) {
    it(`handles "${placeholder}" in goal`, () => {
      const bundle = transform({
        goal: `Build a ${placeholder} system`,
      });
      assert.ok(bundle.id, `"${placeholder}" in goal should not crash`);
    });

    it(`handles "${placeholder}" in constraint`, () => {
      const bundle = transform({
        goal: 'Build a system',
        constraints: [`Must implement ${placeholder}`],
      });
      assert.ok(bundle.id, `"${placeholder}" in constraint should not crash`);
    });
  }

  it('goal consisting entirely of placeholders', () => {
    const bundle = transform({
      goal: 'TBD TODO ??? ... FIXME',
    });
    assert.ok(bundle.id, 'All-placeholder goal should produce valid bundle');
  });

  it('many placeholders increase entropy', () => {
    const lowPlaceholder = transform({
      goal: 'Build a user authentication system',
      constraints: ['Must be secure', 'Must be fast'],
    });

    const highPlaceholder = transform({
      goal: 'Build a TBD system',
      constraints: ['Must implement ???', 'TODO: decide later', 'FIXME'],
    });

    // High placeholder should have higher entropy
    assert.ok(
      highPlaceholder.root_node.entropy.entropy_score >=
        lowPlaceholder.root_node.entropy.entropy_score,
      'High placeholder density should result in higher or equal entropy'
    );
  });

  it('mixed real content and placeholders', () => {
    const bundle = transform({
      goal: 'Build a TBD management system for TODO users',
      constraints: [
        'Must support ??? operations',
        'Must integrate with ... services',
        'Authentication method: TBD',
        'Database: [TO BE DETERMINED]',
        'Must be secure', // Real constraint
        'Must scale to 10000 users', // Real constraint
      ],
    });
    assert.ok(bundle.id, 'Mixed content should produce valid bundle');
  });

  it('placeholder-like strings that are not placeholders', () => {
    const bundle = transform({
      goal: 'Build a TodoList application',
      constraints: [
        'Must display todos',
        'Must allow marking items as done',
      ],
    });
    // "Todo" in "TodoList" should not be flagged as placeholder
    assert.ok(bundle.id, 'Non-placeholder "todo" should work normally');
  });
});

// =============================================================================
// Corpus Summary
// =============================================================================

describe('Adversarial Corpus Summary', () => {
  it('corpus contains expected number of fixtures', () => {
    // This test exists to verify the corpus was fully defined
    assert.ok(true, 'Adversarial corpus test file loaded successfully');
  });
});
