/**
 * Bundle Summary Tests
 * ====================
 *
 * Tests for summarizeBundle() function.
 * Validates deterministic summary output.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizeBundle } from '../bundle_summary.js';
import { canonicalize } from '../../utils/canonical.js';
import type { Bundle } from '../../types/artifacts.js';
import type { BundleSummary } from '../bundle_types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Fixtures are in src/, but tests run from dist/ - adjust path accordingly
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures');

/**
 * Load fixture file as Bundle.
 */
async function loadFixture(name: string): Promise<Bundle> {
  const content = await readFile(join(FIXTURES_DIR, name), 'utf-8');
  return JSON.parse(content) as Bundle;
}

describe('Bundle Summary', () => {
  describe('Outcome Detection', () => {
    it('detects BUNDLE outcome for complete status', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);
      assert.strictEqual(summary.outcome, 'BUNDLE');
    });

    it('detects CLARIFY outcome for incomplete status', async () => {
      const bundle = await loadFixture('valid_bundle_clarify.json');
      const summary = summarizeBundle(bundle);
      assert.strictEqual(summary.outcome, 'CLARIFY');
    });

    it('detects REFUSE outcome for error status', async () => {
      const bundle = await loadFixture('valid_bundle_refuse.json');
      const summary = summarizeBundle(bundle);
      assert.strictEqual(summary.outcome, 'REFUSE');
    });
  });

  describe('Field Extraction', () => {
    it('extracts schema_version correctly', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);
      assert.strictEqual(summary.schema_version, '0.1.0');
    });

    it('computes bundle_hash', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);
      assert.ok(summary.bundle_hash !== null, 'bundle_hash should be computed');
      assert.ok(summary.bundle_hash!.length === 64, 'bundle_hash should be 64 hex chars');
    });

    it('counts artifacts correctly', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);
      assert.strictEqual(summary.artifact_count, 1);
      assert.strictEqual(summary.artifact_paths.length, 1);
      assert.strictEqual(summary.artifact_paths[0], 'src/hello.ts');
    });

    it('counts unresolved questions correctly', async () => {
      const bundle = await loadFixture('valid_bundle_clarify.json');
      const summary = summarizeBundle(bundle);
      assert.strictEqual(summary.unresolved_questions_count, 2);
      assert.strictEqual(summary.question_ids.length, 2);
    });

    it('counts terminal nodes correctly', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);
      assert.strictEqual(summary.terminal_nodes_count, 1);
      assert.strictEqual(summary.terminal_node_ids.length, 1);
    });
  });

  describe('Sorting', () => {
    it('artifact_paths are sorted lexicographically', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);

      const sorted = [...summary.artifact_paths].sort();
      assert.deepStrictEqual(summary.artifact_paths, sorted, 'artifact_paths should be sorted');
    });

    it('question_ids are sorted by priority desc, id asc', async () => {
      const bundle = await loadFixture('valid_bundle_clarify.json');
      const summary = summarizeBundle(bundle);

      // First question should have higher priority
      assert.strictEqual(summary.question_ids[0], 'q_framework00001a');
      assert.strictEqual(summary.question_ids[1], 'q_database000001a');
    });

    it('terminal_node_ids are sorted lexicographically', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);

      const sorted = [...summary.terminal_node_ids].sort();
      assert.deepStrictEqual(summary.terminal_node_ids, sorted, 'terminal_node_ids should be sorted');
    });
  });

  describe('Determinism', () => {
    it('produces identical summary for same bundle', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');

      const summary1 = summarizeBundle(bundle);
      const summary2 = summarizeBundle(bundle);

      const json1 = canonicalize(summary1);
      const json2 = canonicalize(summary2);

      assert.strictEqual(json1, json2, 'summarizeBundle should be deterministic');
    });

    it('summary is byte-identical across multiple runs', async () => {
      const bundle = await loadFixture('valid_bundle_clarify.json');

      const summaries: BundleSummary[] = [];
      for (let i = 0; i < 5; i++) {
        summaries.push(summarizeBundle(bundle));
      }

      const jsons = summaries.map((s) => canonicalize(s));
      const first = jsons[0];

      for (let i = 1; i < jsons.length; i++) {
        assert.strictEqual(jsons[i], first, `Run ${i} should be byte-identical to run 0`);
      }
    });

    it('canonical JSON has sorted keys', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);
      const json = canonicalize(summary);
      const parsed = JSON.parse(json);

      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();

      assert.deepStrictEqual(keys, sortedKeys, 'Keys should be sorted in canonical output');
    });
  });

  describe('Edge Cases', () => {
    it('handles bundle with no outputs', async () => {
      const bundle = await loadFixture('valid_bundle_clarify.json');
      const summary = summarizeBundle(bundle);

      assert.strictEqual(summary.artifact_count, 0);
      assert.deepStrictEqual(summary.artifact_paths, []);
    });

    it('handles bundle with no unresolved questions', async () => {
      const bundle = await loadFixture('valid_bundle_bundle.json');
      const summary = summarizeBundle(bundle);

      assert.strictEqual(summary.unresolved_questions_count, 0);
      assert.deepStrictEqual(summary.question_ids, []);
    });

    it('handles bundle with no terminal nodes', async () => {
      const bundle = await loadFixture('valid_bundle_refuse.json');
      const summary = summarizeBundle(bundle);

      assert.strictEqual(summary.terminal_nodes_count, 0);
      assert.deepStrictEqual(summary.terminal_node_ids, []);
    });
  });
});
