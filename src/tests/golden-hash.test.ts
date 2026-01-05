/**
 * Golden Hash Test Suite
 * ======================
 *
 * Verifies that specific known inputs produce specific known outputs.
 * These hashes are computed once and then locked in as the expected values.
 *
 * If these tests fail, it means either:
 * 1. The kernel logic changed (update the golden hashes after review)
 * 2. There's a determinism bug (investigate immediately)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { transform, getBundleHash, KERNEL_VERSION } from '../index.js';

// =============================================================================
// Golden Intents
// =============================================================================

/**
 * Golden Intent 001: Simple authentication system
 */
const GOLDEN_INTENT_001 = {
  goal: 'Create a user authentication system',
  constraints: ['Must use JWT', 'Session timeout 24h'],
};

/**
 * Golden Intent 002: Minimal intent
 */
const GOLDEN_INTENT_002 = {
  goal: 'Hello world',
};

/**
 * Golden Intent 003: Complex multi-constraint
 */
const GOLDEN_INTENT_003 = {
  goal: 'Build a REST API server',
  constraints: [
    'Must use Node.js',
    'Database: PostgreSQL',
    'Authentication: API keys',
    'Rate limiting: 100 requests per minute',
    'Must return JSON responses',
  ],
};

// =============================================================================
// Golden Hashes
// =============================================================================

/**
 * Expected hashes for each golden intent.
 *
 * IMPORTANT: These values should be updated ONLY when:
 * 1. The kernel version changes
 * 2. Intentional changes are made to kernel behavior
 *
 * The format is: { [version]: { [intentName]: expectedHash } }
 *
 * When the kernel is first built, run with COMPUTE_GOLDEN=1 to generate hashes.
 */
const GOLDEN_HASHES: Record<string, Record<string, string>> = {
  // v0.1.0 with schema_version field added to Bundle
  '0.1.0': {
    'intent_001': '9d8bcbe448808132206d3e2c9a6488b089a7b28a39245b8ac37b53cd14d727a6',
    'intent_002': '8e34b3624a73b89a6f3c6bb16457afbbb6223ea3a61c8f0534d8f45f8940db0f',
    'intent_003': 'db8e245374daa508e1e2712eef34a26937d8fa978d58ce83c8ddcfe8c120c100',
  },
};

// =============================================================================
// Golden Hash Tests
// =============================================================================

describe('Golden Hash Verification', () => {
  const expectedHashes = GOLDEN_HASHES[KERNEL_VERSION];

  // If computing golden hashes (first run or after intentional change)
  const computeMode = process.env['COMPUTE_GOLDEN'] === '1';

  if (computeMode) {
    it('COMPUTE MODE: Outputting hashes for current version', () => {
      console.log('\n=== Golden Hash Computation ===');
      console.log(`Kernel Version: ${KERNEL_VERSION}`);
      console.log('\nAdd these to GOLDEN_HASHES:\n');

      const intents = [
        { name: 'intent_001', value: GOLDEN_INTENT_001 },
        { name: 'intent_002', value: GOLDEN_INTENT_002 },
        { name: 'intent_003', value: GOLDEN_INTENT_003 },
      ];

      console.log(`'${KERNEL_VERSION}': {`);
      for (const { name, value } of intents) {
        const bundle = transform(value);
        const hash = getBundleHash(bundle);
        console.log(`  '${name}': '${hash}',`);
      }
      console.log('},');
      console.log('\n=== End Computation ===\n');

      // Test passes in compute mode
      assert.ok(true);
    });
    return;
  }

  // Normal verification mode
  if (!expectedHashes) {
    it(`No golden hashes defined for version ${KERNEL_VERSION}`, () => {
      console.log(`\nNo golden hashes for version ${KERNEL_VERSION}.`);
      console.log('Run with COMPUTE_GOLDEN=1 to generate:\n');
      console.log('  COMPUTE_GOLDEN=1 npm run test:golden\n');
      assert.ok(true, 'Skipping - no hashes defined for this version');
    });
    return;
  }

  it('Golden Intent 001: User Authentication System', () => {
    const bundle = transform(GOLDEN_INTENT_001);
    const actualHash = getBundleHash(bundle);
    const expectedHash = expectedHashes['intent_001'];

    if (expectedHash === 'TO_BE_COMPUTED') {
      console.log(`Intent 001 hash: ${actualHash}`);
      assert.ok(true, 'Hash not yet locked in');
      return;
    }

    assert.strictEqual(
      actualHash,
      expectedHash,
      `Golden hash mismatch for Intent 001.\n` +
        `Expected: ${expectedHash}\n` +
        `Actual:   ${actualHash}\n` +
        `This indicates a determinism break or intentional change.`
    );
  });

  it('Golden Intent 002: Hello World', () => {
    const bundle = transform(GOLDEN_INTENT_002);
    const actualHash = getBundleHash(bundle);
    const expectedHash = expectedHashes['intent_002'];

    if (expectedHash === 'TO_BE_COMPUTED') {
      console.log(`Intent 002 hash: ${actualHash}`);
      assert.ok(true, 'Hash not yet locked in');
      return;
    }

    assert.strictEqual(
      actualHash,
      expectedHash,
      `Golden hash mismatch for Intent 002.`
    );
  });

  it('Golden Intent 003: REST API Server', () => {
    const bundle = transform(GOLDEN_INTENT_003);
    const actualHash = getBundleHash(bundle);
    const expectedHash = expectedHashes['intent_003'];

    if (expectedHash === 'TO_BE_COMPUTED') {
      console.log(`Intent 003 hash: ${actualHash}`);
      assert.ok(true, 'Hash not yet locked in');
      return;
    }

    assert.strictEqual(
      actualHash,
      expectedHash,
      `Golden hash mismatch for Intent 003.`
    );
  });
});

// =============================================================================
// Cross-Process Verification
// =============================================================================

describe('Cross-Process Determinism', () => {
  it('can serialize and deserialize bundle for verification', () => {
    // This test simulates what would happen in cross-process verification
    const bundle = transform(GOLDEN_INTENT_001);
    const hash = getBundleHash(bundle);

    // Serialize to JSON (as if writing to file)
    const serialized = JSON.stringify(bundle);

    // Deserialize (as if reading from file in different process)
    const deserialized = JSON.parse(serialized);

    // Recompute hash
    const recomputedHash = getBundleHash(deserialized);

    assert.strictEqual(
      hash,
      recomputedHash,
      'Hash should survive JSON serialization/deserialization'
    );
  });
});
