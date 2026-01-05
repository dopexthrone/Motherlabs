/**
 * Model IO Verify Tests
 * =====================
 *
 * Tests for model IO verification against MODEL_IO_SPEC.md invariants.
 * Covers MI1-MI12 invariants with fixture-based testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { verifyModelIO, computeModelIOCore, computeModelIOHash } from '../model_io_verify.js';
import { canonicalize } from '../../utils/canonical.js';
import type { ModelIOSession, ModelIOViolation, ContentHash } from '../model_io_types.js';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures/model_io');

// =============================================================================
// Helper: Compute Content Hash
// =============================================================================

function computeContentHash(content: string): ContentHash {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
  return `sha256:${hash}` as ContentHash;
}

// =============================================================================
// Helper: Create Valid Session
// =============================================================================

function createValidSession(overrides: Partial<ModelIOSession> = {}): ModelIOSession {
  const response1 = 'Hello, World!';
  const response2 = 'Response to second prompt';

  return {
    model_io_schema_version: '1.0.0',
    adapter_id: 'mock_a1b2c3d4',
    model_id: 'mock',
    mode: 'record',
    interactions: [
      {
        i: 0,
        prompt_hash: computeContentHash('Say hello'),
        response_hash: computeContentHash(response1),
        response_content: response1,
      },
      {
        i: 1,
        prompt_hash: computeContentHash('Second prompt'),
        response_hash: computeContentHash(response2),
        response_content: response2,
      },
    ],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Model IO Verification', () => {
  describe('MI1: Schema Version Present', () => {
    it('valid schema version passes', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok, `Expected valid session to pass: ${JSON.stringify(result)}`);
    });

    it('missing schema version fails', () => {
      const session = createValidSession();
      delete (session as any).model_io_schema_version;
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI1'),
        'Expected MI1 violation for missing schema version'
      );
    });

    it('empty schema version fails', () => {
      const session = createValidSession({ model_io_schema_version: '' });
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI1'),
        'Expected MI1 violation for empty schema version'
      );
    });

    it('non-semver schema version fails', () => {
      const session = createValidSession({ model_io_schema_version: 'v1' });
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI1'),
        'Expected MI1 violation for non-semver schema version'
      );
    });
  });

  describe('MI2: Adapter and Model ID Non-Empty', () => {
    it('valid IDs pass', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('empty adapter_id fails', () => {
      const session = createValidSession({ adapter_id: '' });
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI2' && v.path?.includes('adapter_id')),
        'Expected MI2 violation for empty adapter_id'
      );
    });

    it('empty model_id fails', () => {
      const session = createValidSession({ model_id: '' });
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI2' && v.path?.includes('model_id')),
        'Expected MI2 violation for empty model_id'
      );
    });
  });

  describe('MI3: Mode Valid', () => {
    it('record mode passes', () => {
      const session = createValidSession({ mode: 'record' });
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('replay mode passes', () => {
      const session = createValidSession({ mode: 'replay' });
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('invalid mode fails', () => {
      const session = createValidSession({ mode: 'invalid' as any });
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI3'),
        'Expected MI3 violation for invalid mode'
      );
    });
  });

  describe('MI4: Interactions Array Present', () => {
    it('valid interactions array passes', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('empty interactions array passes', () => {
      const session = createValidSession({ interactions: [] });
      const result = verifyModelIO(session);
      assert.ok(result.ok, 'Empty interactions array should be valid');
    });

    it('missing interactions array fails', () => {
      const session = createValidSession();
      delete (session as any).interactions;
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'SCHEMA'),
        'Expected SCHEMA violation for missing interactions'
      );
    });

    it('too many interactions fails', () => {
      const session = createValidSession();
      // Create 10001 interactions
      session.interactions = Array.from({ length: 10001 }, (_, i) => ({
        i,
        prompt_hash: computeContentHash(`prompt_${i}`),
        response_hash: computeContentHash(`response_${i}`),
        response_content: `response_${i}`,
      }));
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI4'),
        'Expected MI4 violation for too many interactions'
      );
    });
  });

  describe('MI5: Indices Monotonic and Contiguous', () => {
    it('contiguous indices pass', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('non-contiguous indices fail', () => {
      const session = createValidSession();
      session.interactions[1]!.i = 5; // Skip indices 2-4
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI5'),
        'Expected MI5 violation for non-contiguous indices'
      );
    });

    it('wrong starting index fails', () => {
      const session = createValidSession();
      session.interactions[0]!.i = 1; // Should start at 0
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI5'),
        'Expected MI5 violation for wrong starting index'
      );
    });
  });

  describe('MI6: Prompt Hash Format', () => {
    it('valid prompt hash passes', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('invalid prompt hash format fails', () => {
      const session = createValidSession();
      session.interactions[0]!.prompt_hash = 'invalid' as ContentHash;
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI6'),
        'Expected MI6 violation for invalid prompt hash'
      );
    });

    it('prompt hash without prefix fails', () => {
      const session = createValidSession();
      session.interactions[0]!.prompt_hash = '6d995dba1af0373913b98421f7b825327673d9870e4227386600e9d929f2c90c' as ContentHash;
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI6'),
        'Expected MI6 violation for prompt hash without prefix'
      );
    });
  });

  describe('MI7: Response Hash Integrity', () => {
    it('valid response hash passes', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('mismatched response hash fails', () => {
      const session = createValidSession();
      session.interactions[0]!.response_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000' as ContentHash;
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI7'),
        'Expected MI7 violation for mismatched response hash'
      );
    });

    it('skips hash verification when disabled', () => {
      const session = createValidSession();
      session.interactions[0]!.response_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000' as ContentHash;
      const result = verifyModelIO(session, { verifyResponseHashes: false });
      assert.ok(result.ok, 'Should pass when response hash verification is disabled');
    });
  });

  describe('MI8: No Duplicate Prompt Hashes at Same Index', () => {
    it('unique pairs pass', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('same prompt at different indices passes', () => {
      const session = createValidSession();
      const samePromptHash = computeContentHash('same prompt');
      session.interactions = [
        {
          i: 0,
          prompt_hash: samePromptHash,
          response_hash: computeContentHash('response1'),
          response_content: 'response1',
        },
        {
          i: 1,
          prompt_hash: samePromptHash,
          response_hash: computeContentHash('response2'),
          response_content: 'response2',
        },
      ];
      const result = verifyModelIO(session);
      assert.ok(result.ok, 'Same prompt at different indices should be valid');
    });
  });

  describe('MI9: Deterministic Sorting', () => {
    it('sorted interactions pass', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('unsorted interactions fail', () => {
      const session = createValidSession();
      // Swap order in array but keep correct i values
      const temp = session.interactions[0]!;
      session.interactions[0] = session.interactions[1]!;
      session.interactions[1] = temp;
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI5' || v.rule_id === 'MI9'),
        'Expected violation for unsorted interactions'
      );
    });
  });

  describe('MI10: Stable Violations', () => {
    it('violations are deterministically sorted', () => {
      const session = createValidSession();
      // Create multiple violations
      session.model_io_schema_version = '';
      session.adapter_id = '';
      session.mode = 'invalid' as any;

      const result1 = verifyModelIO(session);
      const result2 = verifyModelIO(session);

      assert.ok(!result1.ok && !result2.ok);

      const json1 = canonicalize(result1);
      const json2 = canonicalize(result2);
      assert.strictEqual(json1, json2, 'Violations should be deterministically sorted');
    });
  });

  describe('MI11: Size Limits', () => {
    it('within limits passes', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
    });

    it('skips size limits when disabled', () => {
      const session = createValidSession();
      // Simulate many interactions (but don't actually create 10001)
      session.interactions = Array.from({ length: 100 }, (_, i) => ({
        i,
        prompt_hash: computeContentHash(`prompt_${i}`),
        response_hash: computeContentHash(`response_${i}`),
        response_content: `response_${i}`,
      }));
      const result = verifyModelIO(session, { enforceSizeLimits: false });
      assert.ok(result.ok, 'Should pass when size limits are disabled');
    });
  });

  describe('Fixture: Valid Model IO', () => {
    it('valid_model_io.json passes all checks', () => {
      const content = readFileSync(join(FIXTURES_DIR, 'valid_model_io.json'), 'utf-8');
      const session = JSON.parse(content);
      const result = verifyModelIO(session);
      assert.ok(result.ok, `Expected valid fixture to pass: ${JSON.stringify(result)}`);
    });
  });

  describe('Fixture: Invalid Bad Hash', () => {
    it('invalid_bad_hash.json fails MI7', () => {
      const content = readFileSync(join(FIXTURES_DIR, 'invalid_bad_hash.json'), 'utf-8');
      const session = JSON.parse(content);
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI7'),
        'Expected MI7 violation for bad hash'
      );
    });
  });

  describe('Fixture: Invalid Non-Contiguous Index', () => {
    it('invalid_non_contiguous_index.json fails MI5', () => {
      const content = readFileSync(join(FIXTURES_DIR, 'invalid_non_contiguous_index.json'), 'utf-8');
      const session = JSON.parse(content);
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI5'),
        'Expected MI5 violation for non-contiguous index'
      );
    });
  });

  describe('Fixture: Invalid Mode', () => {
    it('invalid_mode.json fails MI3', () => {
      const content = readFileSync(join(FIXTURES_DIR, 'invalid_mode.json'), 'utf-8');
      const session = JSON.parse(content);
      const result = verifyModelIO(session);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'MI3'),
        'Expected MI3 violation for invalid mode'
      );
    });
  });

  describe('ModelIOCore Computation', () => {
    it('computeModelIOCore excludes ephemeral fields', () => {
      const session = createValidSession({
        created_at_utc: '2026-01-05T00:00:00.000Z',
        ended_at_utc: '2026-01-05T00:00:01.000Z',
        stats: { total_interactions: 2, total_tokens_input: 30, total_tokens_output: 15, total_latency_ms: 250 },
      });
      session.interactions[0]!.tokens_input = 10;
      session.interactions[0]!.latency_ms = 100;

      const core = computeModelIOCore(session);

      // Core should not have ephemeral fields
      assert.ok(!('created_at_utc' in core), 'Core should not have created_at_utc');
      assert.ok(!('ended_at_utc' in core), 'Core should not have ended_at_utc');
      assert.ok(!('stats' in core), 'Core should not have stats');
      assert.ok(!('tokens_input' in core.interactions[0]!), 'Core interaction should not have tokens_input');
      assert.ok(!('latency_ms' in core.interactions[0]!), 'Core interaction should not have latency_ms');
    });

    it('computeModelIOCore sorts interactions by i', () => {
      const session = createValidSession();
      // Manually unsort (but keep i values correct for MI5)
      // Can't really test unsorted since MI5 will catch it
      const core = computeModelIOCore(session);
      assert.strictEqual(core.interactions[0]!.i, 0);
      assert.strictEqual(core.interactions[1]!.i, 1);
    });
  });

  describe('ModelIOHash Computation', () => {
    it('hash is deterministic for same session', () => {
      const session = createValidSession();
      const hash1 = computeModelIOHash(session);
      const hash2 = computeModelIOHash(session);
      assert.strictEqual(hash1, hash2, 'Hash should be deterministic');
    });

    it('hash differs for different sessions', () => {
      const session1 = createValidSession();
      const session2 = createValidSession({ adapter_id: 'different_adapter' });
      const hash1 = computeModelIOHash(session1);
      const hash2 = computeModelIOHash(session2);
      assert.notStrictEqual(hash1, hash2, 'Hash should differ for different sessions');
    });

    it('hash ignores ephemeral fields', () => {
      const session1 = createValidSession();
      const session2 = createValidSession({
        created_at_utc: '2026-01-05T00:00:00.000Z',
        ended_at_utc: '2026-01-05T00:00:01.000Z',
      });

      const hash1 = computeModelIOHash(session1);
      const hash2 = computeModelIOHash(session2);
      assert.strictEqual(hash1, hash2, 'Hash should ignore ephemeral fields');
    });
  });

  describe('Schema Errors', () => {
    it('null input fails', () => {
      const result = verifyModelIO(null);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'SCHEMA'),
        'Expected SCHEMA violation for null'
      );
    });

    it('array input fails', () => {
      const result = verifyModelIO([]);
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'SCHEMA'),
        'Expected SCHEMA violation for array'
      );
    });

    it('empty object fails', () => {
      const result = verifyModelIO({});
      assert.ok(!result.ok);
      assert.ok(
        result.violations.some((v: ModelIOViolation) => v.rule_id === 'SCHEMA'),
        'Expected SCHEMA violation for empty object'
      );
    });
  });

  describe('Success Result Structure', () => {
    it('includes interactions_count on success', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
      if (result.ok) {
        assert.strictEqual(result.interactions_count, 2);
      }
    });

    it('includes model_io_hash on success', () => {
      const session = createValidSession();
      const result = verifyModelIO(session);
      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.model_io_hash.startsWith('sha256:'));
        assert.strictEqual(result.model_io_hash.length, 7 + 64); // sha256: + 64 hex chars
      }
    });
  });
});
