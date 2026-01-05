/**
 * Bundle Verification Tests
 * =========================
 *
 * Tests for verifyBundle() function.
 * Validates that bundles are checked against BUNDLE_SPEC.md invariants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyBundle } from '../bundle_verify.js';
import { canonicalize } from '../../utils/canonical.js';
import type { VerifyResult, Violation } from '../bundle_types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Fixtures are in src/, but tests run from dist/ - adjust path accordingly
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures');

/**
 * Load fixture file as JSON.
 */
async function loadFixture(name: string): Promise<unknown> {
  const content = await readFile(join(FIXTURES_DIR, name), 'utf-8');
  return JSON.parse(content);
}

describe('Bundle Verification', () => {
  describe('Valid Bundles', () => {
    it('accepts valid BUNDLE outcome', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const result = verifyBundle(bundle);
      assert.strictEqual(result.ok, true);
    });

    it('accepts valid CLARIFY outcome', async () => {
      const bundle = await loadFixture('valid_bundle_clarify.json');
      const result = verifyBundle(bundle);
      assert.strictEqual(result.ok, true);
    });

    it('accepts valid REFUSE outcome', async () => {
      const bundle = await loadFixture('valid_bundle_refuse.json');
      const result = verifyBundle(bundle);
      assert.strictEqual(result.ok, true);
    });
  });

  describe('Invalid Bundles', () => {
    it('rejects bundle with unsorted output paths (BS3)', async () => {
      const bundle = await loadFixture('invalid_bundle_unsorted_paths.json');
      const result = verifyBundle(bundle);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.violations.some((v) => v.rule_id === 'BS3'));
      }
    });

    it('rejects bundle with path traversal (BS7)', async () => {
      const bundle = await loadFixture('invalid_bundle_path_traversal.json');
      const result = verifyBundle(bundle);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.violations.some((v) => v.rule_id === 'BS7'));
      }
    });

    it('rejects non-object bundle', () => {
      const result = verifyBundle('not an object');
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
      }
    });

    it('rejects null bundle', () => {
      const result = verifyBundle(null);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
      }
    });

    it('rejects bundle with missing schema_version (BS1)', () => {
      const bundle = { id: 'test', kernel_version: '0.1.0' };
      const result = verifyBundle(bundle);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.violations.some((v) => v.rule_id === 'BS1'));
      }
    });

    it('rejects bundle with empty schema_version (BS1)', () => {
      const bundle = { id: 'test', schema_version: '', kernel_version: '0.1.0' };
      const result = verifyBundle(bundle);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.violations.some((v) => v.rule_id === 'BS1'));
      }
    });
  });

  describe('Violation Ordering', () => {
    it('violations are sorted by rule_id then path', async () => {
      // Create a bundle with multiple violations
      const bundle = {
        id: 'test',
        schema_version: '0.1.0',
        kernel_version: '0.1.0',
        source_intent_hash: 'abc123',
        status: 'complete',
        root_node: {
          id: 'node_test',
          parent_id: null,
          status: 'terminal',
          goal: 'test',
          constraints: ['z', 'a'], // Unsorted - BS4 violation
          entropy: { unresolved_refs: 0, schema_gaps: 0, contradiction_count: 0, branching_factor: 1, entropy_score: 10 },
          density: { concrete_constraints: 0, specified_outputs: 0, constraint_depth: 1, density_score: 50 },
          children: [],
          unresolved_questions: [],
        },
        terminal_nodes: [],
        outputs: [
          { id: 'out1', type: 'file', path: '../escape', content: '', content_hash: 'sha256:test', source_constraints: [], confidence: 50 }, // BS7 violation
        ],
        unresolved_questions: [],
        stats: { total_nodes: 1, terminal_nodes: 0, max_depth: 0, total_outputs: 1, unresolved_count: 0, avg_terminal_entropy: 10, avg_terminal_density: 50 },
      };

      const result = verifyBundle(bundle);
      assert.strictEqual(result.ok, false);

      if (!result.ok) {
        // Verify violations are sorted
        const ruleIds = result.violations.map((v) => v.rule_id);
        const sortedRuleIds = [...ruleIds].sort();
        assert.deepStrictEqual(ruleIds, sortedRuleIds, 'Violations should be sorted by rule_id');
      }
    });
  });

  describe('Determinism', () => {
    it('produces identical result for same input', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');

      const result1 = verifyBundle(bundle);
      const result2 = verifyBundle(bundle);

      // Serialize to canonical JSON and compare
      const json1 = canonicalize(result1);
      const json2 = canonicalize(result2);

      assert.strictEqual(json1, json2, 'verifyBundle should be deterministic');
    });

    it('violations are byte-identical across runs', async () => {
      const bundle = await loadFixture('invalid_bundle_unsorted_paths.json');

      const result1 = verifyBundle(bundle);
      const result2 = verifyBundle(bundle);

      const json1 = canonicalize(result1);
      const json2 = canonicalize(result2);

      assert.strictEqual(json1, json2, 'Violations should be byte-identical');
    });
  });
});
