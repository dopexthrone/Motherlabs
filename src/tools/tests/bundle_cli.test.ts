/**
 * Bundle CLI Tests
 * ================
 *
 * Tests for bundle-verify and bundle-summarize CLI tools.
 * Tests the core functions directly to avoid child_process nondeterminism.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyBundle } from '../../consumer/bundle_verify.js';
import { summarizeBundle } from '../../consumer/bundle_summary.js';
import { canonicalize } from '../../utils/canonical.js';
import type { Bundle } from '../../types/artifacts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Fixtures are in src/, but tests run from dist/ - adjust path accordingly
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures');

/**
 * Load fixture file as unknown (for verify) or Bundle (for summary).
 */
async function loadFixture(name: string): Promise<unknown> {
  const content = await readFile(join(FIXTURES_DIR, name), 'utf-8');
  return JSON.parse(content);
}

describe('Bundle CLI Functions', () => {
  describe('bundle-verify behavior', () => {
    it('returns ok:true for valid bundle', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const result = verifyBundle(bundle);
      const output = canonicalize(result);

      assert.strictEqual(output, '{"ok":true}');
    });

    it('returns ok:false with violations for invalid bundle', async () => {
      const bundle = await loadFixture('invalid_bundle_unsorted_paths.json');
      const result = verifyBundle(bundle);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.ok(result.violations.length > 0);
      }

      // Verify output is canonical JSON
      const output = canonicalize(result);
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.ok, false);
      assert.ok(Array.isArray(parsed.violations));
    });

    it('output is deterministic', async () => {
      const bundle = await loadFixture('invalid_bundle_path_traversal.json');

      const result1 = verifyBundle(bundle);
      const result2 = verifyBundle(bundle);

      const output1 = canonicalize(result1);
      const output2 = canonicalize(result2);

      assert.strictEqual(output1, output2);
    });
  });

  describe('bundle-summarize behavior', () => {
    it('produces canonical JSON summary for valid bundle', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json') as Bundle;
      const summary = summarizeBundle(bundle);
      const output = canonicalize(summary);

      // Verify it's valid JSON
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.schema_version, '0.1.0');
      assert.strictEqual(parsed.outcome, 'BUNDLE');
      assert.strictEqual(parsed.artifact_count, 1);
    });

    it('summary includes all required fields', async () => {
      const bundle = await loadFixture('valid_bundle_clarify.json') as Bundle;
      const summary = summarizeBundle(bundle);
      const output = canonicalize(summary);
      const parsed = JSON.parse(output);

      // Check all required fields present
      assert.ok('schema_version' in parsed);
      assert.ok('outcome' in parsed);
      assert.ok('bundle_hash' in parsed);
      assert.ok('artifact_count' in parsed);
      assert.ok('artifact_paths' in parsed);
      assert.ok('unresolved_questions_count' in parsed);
      assert.ok('question_ids' in parsed);
      assert.ok('terminal_nodes_count' in parsed);
      assert.ok('terminal_node_ids' in parsed);
    });

    it('output keys are sorted (canonical)', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json') as Bundle;
      const summary = summarizeBundle(bundle);
      const output = canonicalize(summary);
      const parsed = JSON.parse(output);

      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();

      assert.deepStrictEqual(keys, sortedKeys, 'Keys must be sorted in canonical output');
    });

    it('output is byte-identical across runs', async () => {
      const bundle = await loadFixture('valid_bundle_clarify.json') as Bundle;

      const outputs: string[] = [];
      for (let i = 0; i < 3; i++) {
        const summary = summarizeBundle(bundle);
        outputs.push(canonicalize(summary));
      }

      assert.strictEqual(outputs[0], outputs[1]);
      assert.strictEqual(outputs[1], outputs[2]);
    });
  });

  describe('Error handling patterns', () => {
    it('verify handles malformed input gracefully', () => {
      const result = verifyBundle({ not: 'a bundle' });
      assert.strictEqual(result.ok, false);

      // Output is still canonical JSON
      const output = canonicalize(result);
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.ok, false);
    });

    it('verify handles array input', () => {
      const result = verifyBundle([1, 2, 3]);
      assert.strictEqual(result.ok, false);
    });

    it('verify handles primitive input', () => {
      const result = verifyBundle(42);
      assert.strictEqual(result.ok, false);
    });
  });
});
