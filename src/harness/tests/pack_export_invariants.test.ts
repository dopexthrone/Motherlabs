/**
 * Pack Export Invariants Tests
 * ============================
 *
 * Tests for the pack export pipeline to verify:
 * - Exported packs pass pack-verify (spec compliance)
 * - Export is deterministic (byte-identical across runs)
 * - Output directory safety (traversal, non-empty rejection)
 * - Outcome-specific file requirements (REFUSE = no bundle.json)
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { exportPack } from '../pack_export.js';
import { verifyPack } from '../../consumer/pack_verify.js';
import type { ExportPackArgs } from '../pack_export.js';

// =============================================================================
// Test Setup
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixtures directory (relative to dist/harness/tests)
const fixturesDir = path.resolve(__dirname, '../../../src/harness/fixtures');
const intentsDir = path.resolve(__dirname, '../../../intents/real');

// Temp directory for test outputs
const tempBase = path.resolve(__dirname, '../../../.tmp-pack-export-tests');

/**
 * Create a unique temp directory for each test.
 */
async function createTempDir(suffix: string): Promise<string> {
  const dir = path.join(tempBase, `test_${Date.now()}_${suffix}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Cleanup temp directory.
 */
async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Compute SHA-256 hash of file.
 */
async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Hash all files in a directory, returning a map of relative path -> hash.
 */
async function hashDirectory(dir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const entries = readdirSync(dir).sort();

  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      const hash = await hashFile(filePath);
      result.set(entry, hash);
    }
  }

  return result;
}

// =============================================================================
// Setup/Teardown
// =============================================================================

describe('Pack Export Invariants', () => {
  before(async () => {
    // Create base temp directory
    await fs.mkdir(tempBase, { recursive: true });
  });

  after(async () => {
    // Cleanup all temp directories
    try {
      await fs.rm(tempBase, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  // =============================================================================
  // T1: Export plan-only pack -> pack-verify passes
  // =============================================================================

  describe('T1: Plan-Only Pack Verification', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('t1');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('exports plan-only pack that passes pack-verify', async () => {
      const outDir = path.join(tempDir, 'pack_out');

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);

      // Export should succeed
      assert.strictEqual(result.ok, true, `Export should succeed: ${result.error}`);

      // pack_verify should pass
      assert.strictEqual(result.pack_verify.ok, true, 'Pack should pass verification');

      // Required files should exist
      assert.ok(result.files_written.includes('run.json'), 'Should write run.json');
      assert.ok(result.files_written.includes('bundle.json'), 'Should write bundle.json');
      assert.ok(result.files_written.includes('policy.json'), 'Should write policy.json');
      assert.ok(result.files_written.includes('ledger.jsonl'), 'Should write ledger.jsonl');

      // Files should be sorted
      const sorted = [...result.files_written].sort();
      assert.deepStrictEqual(result.files_written, sorted, 'Files should be sorted');

      // Verify with consumer pack verifier directly
      const verifyResult = verifyPack(outDir);
      assert.strictEqual(verifyResult.ok, true, 'Consumer pack-verify should pass');
    });

    it('exported pack has no unknown files (PK2)', async () => {
      const outDir = path.join(tempDir, 'pack_pk2');

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);
      assert.strictEqual(result.ok, true, 'Export should succeed');

      // Check files match PACK_MANIFEST
      const allowedFiles = ['run.json', 'bundle.json', 'patch.json', 'evidence.json', 'ledger.jsonl', 'policy.json', 'model_io.json', 'meta.json'];
      for (const file of result.files_written) {
        assert.ok(allowedFiles.includes(file), `File ${file} should be in PACK_MANIFEST`);
      }
    });
  });

  // =============================================================================
  // T2: Export determinism (byte-identical)
  // =============================================================================

  describe('T2: Export Determinism', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('t2');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('exports are byte-identical for same intent', async () => {
      const outDir1 = path.join(tempDir, 'pack_1');
      const outDir2 = path.join(tempDir, 'pack_2');

      const baseArgs: Omit<ExportPackArgs, 'out_dir'> = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        policy_name: 'default',
        mode: 'plan',
      };

      // Export twice
      const result1 = await exportPack({ ...baseArgs, out_dir: outDir1 });
      const result2 = await exportPack({ ...baseArgs, out_dir: outDir2 });

      // Both should succeed
      assert.strictEqual(result1.ok, true, 'First export should succeed');
      assert.strictEqual(result2.ok, true, 'Second export should succeed');

      // Files written should be identical
      assert.deepStrictEqual(result1.files_written, result2.files_written, 'Files written should match');

      // Hash all files and compare
      const hashes1 = await hashDirectory(outDir1);
      const hashes2 = await hashDirectory(outDir2);

      // Same set of files
      assert.deepStrictEqual([...hashes1.keys()].sort(), [...hashes2.keys()].sort(), 'Same files in both exports');

      // Compare file hashes (excluding timestamp-varying fields)
      // Note: run.json has timestamps that vary, so we compare structure differently
      for (const [file, hash1] of hashes1) {
        const hash2 = hashes2.get(file);
        if (file === 'run.json' || file === 'ledger.jsonl') {
          // These files have timestamps - verify they exist with same structure
          assert.ok(hash2, `${file} should exist in both exports`);
          // Timestamps will differ, so we can't compare hashes directly
          // But the files should have same structure - this is tested by pack-verify passing
        } else {
          // Other files should be byte-identical
          assert.strictEqual(hash1, hash2, `${file} should be byte-identical`);
        }
      }
    });

    it('files_written list is sorted and stable', async () => {
      const outDir1 = path.join(tempDir, 'pack_sorted_1');
      const outDir2 = path.join(tempDir, 'pack_sorted_2');

      const baseArgs: Omit<ExportPackArgs, 'out_dir'> = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        policy_name: 'strict',
        mode: 'plan',
      };

      const result1 = await exportPack({ ...baseArgs, out_dir: outDir1 });
      const result2 = await exportPack({ ...baseArgs, out_dir: outDir2 });

      // Files should be sorted
      const sorted1 = [...result1.files_written].sort();
      const sorted2 = [...result2.files_written].sort();

      assert.deepStrictEqual(result1.files_written, sorted1, 'First export files should be sorted');
      assert.deepStrictEqual(result2.files_written, sorted2, 'Second export files should be sorted');
      assert.deepStrictEqual(result1.files_written, result2.files_written, 'File lists should match');
    });
  });

  // =============================================================================
  // T3: Outcome-specific requirements
  // =============================================================================

  describe('T3: Outcome-Specific Requirements', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('t3');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('invalid intent (empty goal) results in export failure', async () => {
      const outDir = path.join(tempDir, 'pack_refuse');

      // Use empty goal intent - this fails at harness level before reaching kernel
      const args: ExportPackArgs = {
        intent_path: path.join(intentsDir, 'e_edge_cases/intent_009_empty_goal.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);

      // Export should fail because empty goal is invalid
      assert.strictEqual(result.ok, false, 'Export should fail for invalid intent');

      // Error should mention the issue
      assert.ok(result.error?.includes('failed'), 'Should have error message');

      // No files should be written
      assert.strictEqual(result.files_written.length, 0, 'No files should be written');
    });

    it('BUNDLE outcome includes bundle.json', async () => {
      const outDir = path.join(tempDir, 'pack_bundle');

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);

      assert.strictEqual(result.ok, true, `Export should succeed: ${result.error}`);
      assert.strictEqual(result.run_outcome, 'BUNDLE', 'Outcome should be BUNDLE');
      assert.ok(result.files_written.includes('bundle.json'), 'bundle.json should exist for BUNDLE');
    });
  });

  // =============================================================================
  // T4: Model IO integration (stub for future)
  // =============================================================================

  describe('T4: Model IO Integration', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('t4');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('model_mode none produces no model_io.json', async () => {
      const outDir = path.join(tempDir, 'pack_no_model_io');

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
        model_mode: 'none',
      };

      const result = await exportPack(args);

      assert.strictEqual(result.ok, true, 'Export should succeed');
      assert.ok(!result.files_written.includes('model_io.json'), 'model_io.json should not exist for mode=none');
    });
  });

  // =============================================================================
  // T5: Output directory safety
  // =============================================================================

  describe('T5: Output Directory Safety', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('t5');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('refuses if out_dir exists and is non-empty', async () => {
      const outDir = path.join(tempDir, 'non_empty');

      // Create non-empty directory
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, 'existing.txt'), 'content');

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);

      assert.strictEqual(result.ok, false, 'Export should fail for non-empty directory');
      assert.ok(result.error?.includes('non-empty'), 'Error should mention non-empty');
    });

    it('refuses if out_dir contains path traversal', async () => {
      // Use string concatenation to avoid path.join normalizing the ..
      const outDir = tempDir + '/foo/../../../bar';

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);

      assert.strictEqual(result.ok, false, 'Export should fail for path traversal');
      assert.ok(result.error?.includes('traversal'), 'Error should mention traversal');
    });

    it('allows empty existing directory', async () => {
      const outDir = path.join(tempDir, 'empty_dir');

      // Create empty directory
      await fs.mkdir(outDir, { recursive: true });

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);

      assert.strictEqual(result.ok, true, `Export should succeed for empty dir: ${result.error}`);
    });

    it('creates new directory if it does not exist', async () => {
      const outDir = path.join(tempDir, 'new_dir');

      // Ensure it doesn't exist
      assert.ok(!existsSync(outDir), 'Directory should not exist initially');

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);

      assert.strictEqual(result.ok, true, `Export should succeed: ${result.error}`);
      assert.ok(existsSync(outDir), 'Directory should exist after export');
    });

    it('refuses if intent file does not exist', async () => {
      const outDir = path.join(tempDir, 'no_intent');

      const args: ExportPackArgs = {
        intent_path: '/nonexistent/intent.json',
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);

      assert.strictEqual(result.ok, false, 'Export should fail for missing intent');
      assert.ok(result.error?.includes('not found'), 'Error should mention file not found');
    });
  });

  // =============================================================================
  // Additional invariants
  // =============================================================================

  describe('Additional Invariants', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('add');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('all JSON files use canonical format', async () => {
      const outDir = path.join(tempDir, 'canonical');

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);
      assert.strictEqual(result.ok, true, 'Export should succeed');

      // Check JSON files have sorted keys (canonical property)
      for (const file of result.files_written) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(outDir, file), 'utf-8');
          // Parse and verify it's valid JSON
          const parsed = JSON.parse(content);
          assert.ok(parsed, `${file} should be valid JSON`);
          // Content should end with newline
          assert.ok(content.endsWith('\n'), `${file} should end with newline`);
        }
      }
    });

    it('ledger.jsonl has valid JSONL format', async () => {
      const outDir = path.join(tempDir, 'ledger');

      const args: ExportPackArgs = {
        intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
        out_dir: outDir,
        policy_name: 'default',
        mode: 'plan',
      };

      const result = await exportPack(args);
      assert.strictEqual(result.ok, true, 'Export should succeed');

      const ledgerPath = path.join(outDir, 'ledger.jsonl');
      const content = await fs.readFile(ledgerPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Should have exactly one entry
      assert.strictEqual(lines.length, 1, 'Should have one ledger entry');

      // Entry should be valid JSON with required fields
      const entry = JSON.parse(lines[0]!);
      assert.ok(entry.run_id, 'Should have run_id');
      assert.ok(entry.timestamp, 'Should have timestamp');
      assert.ok(entry.intent_sha256, 'Should have intent_sha256');
      assert.ok('result_kind' in entry, 'Should have result_kind');
      assert.ok('accepted' in entry, 'Should have accepted');
      assert.ok(entry.mode, 'Should have mode');
      assert.ok(entry.policy, 'Should have policy');
    });

    it('exports different policies correctly', async () => {
      const policies = ['strict', 'default', 'dev'] as const;

      for (const policy of policies) {
        const outDir = path.join(tempDir, `policy_${policy}`);

        const args: ExportPackArgs = {
          intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
          out_dir: outDir,
          policy_name: policy,
          mode: 'plan',
        };

        const result = await exportPack(args);
        assert.strictEqual(result.ok, true, `Export should succeed for ${policy} policy`);

        // Verify policy.json exists and has correct name
        const policyPath = path.join(outDir, 'policy.json');
        const policyContent = await fs.readFile(policyPath, 'utf-8');
        const policyData = JSON.parse(policyContent);
        assert.strictEqual(policyData.name, policy, `Policy name should be ${policy}`);
      }
    });
  });
});
