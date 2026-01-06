/**
 * Git Apply Spec Invariants Tests
 * ================================
 *
 * Tests for the git apply pipeline to verify:
 * - GA1-GA12 invariants per GIT_APPLY_SPEC.md
 * - Deterministic output across runs
 * - Git repository validation
 * - Branch creation and checkout behavior
 * - Commit behavior when requested
 * - Error handling and refusal conditions
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { applyPackToGitRepo, GIT_APPLY_SCHEMA_VERSION } from '../git_apply.js';
import { canonicalize, canonicalHash } from '../../utils/canonical.js';
import type { GitApplyArgs } from '../git_apply.js';

// =============================================================================
// Test Setup
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixtures directory
const fixturesDir = path.resolve(__dirname, '../../../src/consumer/tests/fixtures/packs');

// Temp directory for test outputs - use system tmp to avoid being inside git repo
const tempBase = path.join('/tmp', 'git-apply-invariants-tests');

/**
 * Create a unique temp directory for each test.
 */
async function createTempDir(suffix: string): Promise<string> {
  const dir = path.join(tempBase, `test_${suffix}_${process.pid}`);
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
 * Initialize a git repository in a directory.
 */
function initGitRepo(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, encoding: 'utf8' });
  // Create initial commit
  writeFileSync(path.join(dir, '.gitkeep'), '');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: dir, encoding: 'utf8' });
}

/**
 * Get current branch name.
 */
function getCurrentBranch(dir: string): string {
  const result = spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' });
  return result.stdout?.trim() || '';
}

/**
 * Get HEAD commit SHA.
 */
function getHeadCommit(dir: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return result.stdout?.trim() || '';
}

/**
 * Check if working tree is clean.
 */
function isClean(dir: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  return !result.stdout?.trim();
}

/**
 * Create a valid pack directory with a patch that passes pack verification.
 */
async function createTestPack(packDir: string, runId?: string): Promise<void> {
  await fs.mkdir(packDir, { recursive: true });

  // Create bundle.json first (required for pack verification)
  const bundleJson = {
    bundle_schema_version: '2.0.0',
    goal: 'Test intent',
    actions: [{ op: 'create', path: 'test.txt' }],
    files: { output: ['test.txt'] },
    determinism: { pure: true },
  };
  await fs.writeFile(path.join(packDir, 'bundle.json'), canonicalize(bundleJson));

  // Compute bundle hash
  const bundleHash = canonicalHash(bundleJson);

  // Create run.json with proper structure
  const runJson = {
    run_schema_version: '1.0.0',
    run_id: runId || 'test_run_001',
    started_at: '2026-01-05T00:00:00.000Z',
    completed_at: '2026-01-05T00:00:01.000Z',
    kernel_version: '0.1.0',
    policy: {
      name: 'default',
      allow_network: false,
      timeout_ms: 60000,
      max_output_files: 500,
      max_total_output_bytes: 52428800,
      allowed_commands: ['node'],
      allowed_write_roots: ['out'],
    },
    intent: {
      path: 'intents/test.json',
      sha256: 'sha256:' + 'a'.repeat(64),
    },
    bundle: {
      bundle_id: 'bundle_test',
      sha256: bundleHash,
    },
    kernel_result_kind: 'BUNDLE',
    execution: null,
    decision: {
      accepted: true,
      reasons: ['Test'],
      validated_by_kernel: true,
    },
    model_mode: 'none',
  };
  await fs.writeFile(path.join(packDir, 'run.json'), canonicalize(runJson));

  // Create patch.json with a simple create operation
  const content = 'Hello from git apply test';
  const patchJson = {
    patch_schema_version: '1.0.0',
    source_proposal_id: 'prop_test123456789abc',
    source_proposal_hash: 'sha256:' + 'b'.repeat(64),
    operations: [
      {
        path: 'test.txt',
        op: 'create',
        content,
        size_bytes: Buffer.byteLength(content, 'utf8'),
        order: 0,
      },
    ],
    total_bytes: Buffer.byteLength(content, 'utf8'),
  };
  await fs.writeFile(path.join(packDir, 'patch.json'), canonicalize(patchJson));
}

// =============================================================================
// Setup/Teardown
// =============================================================================

describe('Git Apply Spec Invariants', () => {
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

  // ===========================================================================
  // GA1: Schema Version Present
  // ===========================================================================

  describe('GA1: Schema Version Present', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga1');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('result includes git_apply_schema_version "1.0.0"', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { dryRun: true },
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.git_apply_schema_version, '1.0.0', 'Schema version should be 1.0.0');
      assert.strictEqual(result.git_apply_schema_version, GIT_APPLY_SCHEMA_VERSION, 'Should match exported constant');
    });
  });

  // ===========================================================================
  // GA2: Git Repository Required
  // ===========================================================================

  describe('GA2: Git Repository Required', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga2');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('refuses if target is not a git repository', async () => {
      const repoDir = path.join(tempDir, 'not_a_repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.outcome, 'REFUSED', 'Should refuse non-git directory');
      assert.strictEqual(result.error, 'target is not a git repository', 'Error message should match spec');
      assert.ok(result.violations?.some((v) => v.rule_id === 'GA2'), 'Should have GA2 violation');
    });

    it('refuses if working tree is dirty without --allow-dirty', async () => {
      const repoDir = path.join(tempDir, 'dirty_repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      // Make it dirty
      await fs.writeFile(path.join(repoDir, 'dirty.txt'), 'uncommitted');
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { allowDirty: false },
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.outcome, 'REFUSED', 'Should refuse dirty working tree');
      assert.strictEqual(result.error, 'working tree has uncommitted changes', 'Error message should match spec');
    });

    it('allows dirty working tree with --allow-dirty', async () => {
      const repoDir = path.join(tempDir, 'dirty_allowed');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await fs.writeFile(path.join(repoDir, 'dirty.txt'), 'uncommitted');
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { allowDirty: true },
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.outcome, 'SUCCESS', 'Should succeed with allowDirty');
    });
  });

  // ===========================================================================
  // GA3: No Path Traversal or Absolute Paths
  // ===========================================================================

  describe('GA3: No Path Traversal or Absolute Paths', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga3');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('refuses repo_root with path traversal', async () => {
      const packDir = path.join(tempDir, 'pack');
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: tempDir + '/foo/../../../bar',
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.outcome, 'REFUSED', 'Should refuse path traversal');
      assert.ok(result.error?.includes('path traversal'), 'Error should mention traversal');
      assert.ok(result.violations?.some((v) => v.rule_id === 'GA3'), 'Should have GA3 violation');
    });

    it('result repo_root has no absolute path', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { dryRun: true },
      };

      const result = await applyPackToGitRepo(args);

      assert.ok(!result.repo_root.startsWith('/'), 'repo_root should not be absolute');
    });

    it('changed_files paths have no absolute paths', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
      };

      const result = await applyPackToGitRepo(args);

      for (const file of result.changed_files) {
        assert.ok(!file.path.startsWith('/'), `Path should not be absolute: ${file.path}`);
        assert.ok(!file.path.includes('..'), `Path should not have traversal: ${file.path}`);
      }
    });
  });

  // ===========================================================================
  // GA5: Deterministic Ordering
  // ===========================================================================

  describe('GA5: Deterministic Ordering', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga5');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('changed_files are sorted by path', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);

      // Create pack with multiple files in non-sorted order
      await fs.mkdir(packDir, { recursive: true });
      const runJson = { run_id: 'test_001', timestamp: '2026-01-05T00:00:00.000Z' };
      await fs.writeFile(path.join(packDir, 'run.json'), JSON.stringify(runJson));

      const patchJson = {
        patch_schema_version: '1.0.0',
        operations: [
          { path: 'z_file.txt', op: 'create', content: 'z' },
          { path: 'a_file.txt', op: 'create', content: 'a' },
          { path: 'm_file.txt', op: 'create', content: 'm' },
        ],
      };
      await fs.writeFile(path.join(packDir, 'patch.json'), JSON.stringify(patchJson));

      const bundleJson = {
        bundle_schema_version: '2.0.0',
        goal: 'Test',
        actions: [],
        files: { output: [] },
        determinism: { pure: true },
      };
      await fs.writeFile(path.join(packDir, 'bundle.json'), JSON.stringify(bundleJson));

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
      };

      const result = await applyPackToGitRepo(args);

      const paths = result.changed_files.map((f) => f.path);
      const sortedPaths = [...paths].sort();

      assert.deepStrictEqual(paths, sortedPaths, 'Changed files should be sorted by path');
    });

    it('violations are sorted by rule_id, path', async () => {
      const packDir = path.join(tempDir, 'pack');
      await createTestPack(packDir);

      // Use traversal path to trigger violation
      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: tempDir + '/a/../b',
      };

      const result = await applyPackToGitRepo(args);

      if (result.violations && result.violations.length > 1) {
        const sorted = [...result.violations].sort((a, b) => {
          if (a.rule_id !== b.rule_id) return a.rule_id < b.rule_id ? -1 : 1;
          const aPath = a.path ?? '';
          const bPath = b.path ?? '';
          return aPath < bPath ? -1 : aPath > bPath ? 1 : 0;
        });
        assert.deepStrictEqual(result.violations, sorted, 'Violations should be sorted');
      }
    });
  });

  // ===========================================================================
  // GA6: Deterministic Branch Naming
  // ===========================================================================

  describe('GA6: Deterministic Branch Naming', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga6');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('uses apply/{run_id} when pack has run_id', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir, 'my_run_123');

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.branch.name, 'apply/my_run_123', 'Branch name should be apply/{run_id}');
    });

    it('uses apply/manual when pack has no run_id', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);

      // Create pack without run_id
      await fs.mkdir(packDir, { recursive: true });
      await fs.writeFile(path.join(packDir, 'run.json'), JSON.stringify({ timestamp: '2026-01-05T00:00:00.000Z' }));
      await fs.writeFile(
        path.join(packDir, 'patch.json'),
        JSON.stringify({
          patch_schema_version: '1.0.0',
          operations: [{ path: 'test.txt', op: 'create', content: 'test' }],
        }),
      );
      await fs.writeFile(
        path.join(packDir, 'bundle.json'),
        JSON.stringify({
          bundle_schema_version: '2.0.0',
          goal: 'Test',
          actions: [],
          files: { output: [] },
          determinism: { pure: true },
        }),
      );

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.branch.name, 'apply/manual', 'Branch name should be apply/manual');
    });

    it('uses provided --branch when specified', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { branch: 'feature/custom-branch' },
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.branch.name, 'feature/custom-branch', 'Should use provided branch name');
    });
  });

  // ===========================================================================
  // GA7: Dry-Run No State Changes
  // ===========================================================================

  describe('GA7: Dry-Run No State Changes', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga7');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('dry-run does not write files', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { dryRun: true },
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.dry_run, true, 'Result should indicate dry-run');
      assert.ok(!existsSync(path.join(repoDir, 'test.txt')), 'File should not be created in dry-run');
    });

    it('dry-run preserves git state', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const headBefore = getHeadCommit(repoDir);
      const branchBefore = getCurrentBranch(repoDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { dryRun: true },
      };

      const result = await applyPackToGitRepo(args);

      const headAfter = getHeadCommit(repoDir);
      const branchAfter = getCurrentBranch(repoDir);

      assert.strictEqual(headAfter, headBefore, 'HEAD should not change in dry-run');
      assert.strictEqual(branchAfter, branchBefore, 'Branch should not change in dry-run');
      assert.strictEqual(result.git_state.clean_after, result.git_state.clean_before, 'Clean state should not change');
      assert.strictEqual(result.branch.head_after, result.branch.head_before, 'head_after should equal head_before');
    });
  });

  // ===========================================================================
  // GA10: Commit Requires Flag
  // ===========================================================================

  describe('GA10: Commit Requires Flag', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga10');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('no commit without --commit flag', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { commit: false },
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.commit, undefined, 'commit should be undefined without flag');
      assert.strictEqual(result.git_state.clean_after, false, 'Working tree should be dirty after apply');
    });

    it('creates commit with --commit flag', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { commit: true },
      };

      const result = await applyPackToGitRepo(args);

      assert.ok(result.commit, 'commit should be defined with flag');
      assert.ok(result.commit.sha, 'commit should have SHA');
      assert.ok(result.commit.message, 'commit should have message');
      assert.strictEqual(result.git_state.clean_after, true, 'Working tree should be clean after commit');
    });

    it('uses custom commit message when provided', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const customMessage = 'Custom commit message for testing';
      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { commit: true, commitMessage: customMessage },
      };

      const result = await applyPackToGitRepo(args);

      assert.ok(result.commit, 'commit should be defined');
      assert.strictEqual(result.commit.message, customMessage, 'commit message should match');
    });
  });

  // ===========================================================================
  // GA11: Canonical JSON Output
  // ===========================================================================

  describe('GA11: Canonical JSON Output', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga11');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('result serializes to canonical JSON', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
        options: { dryRun: true },
      };

      const result = await applyPackToGitRepo(args);

      const serialized = canonicalize(result);
      const parsed = JSON.parse(serialized);
      const reserialized = canonicalize(parsed);

      assert.strictEqual(serialized, reserialized, 'Canonical serialization should be stable');
    });
  });

  // ===========================================================================
  // GA12: Deterministic Diff Summary
  // ===========================================================================

  describe('GA12: Deterministic Diff Summary', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('ga12');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('content_hash uses sha256 format', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      await createTestPack(packDir);

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
      };

      const result = await applyPackToGitRepo(args);

      for (const file of result.changed_files) {
        if (file.op !== 'delete' && file.content_hash) {
          assert.ok(file.content_hash.startsWith('sha256:'), `Hash should start with sha256: ${file.content_hash}`);
          const hex = file.content_hash.slice(7);
          assert.strictEqual(hex.length, 64, 'Hash should be 64 hex chars');
          assert.ok(/^[a-f0-9]+$/.test(hex), 'Hash should be hex');
        }
      }
    });

    it('delete operations have null content_hash', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      initGitRepo(repoDir);
      // Create a file to delete
      await fs.writeFile(path.join(repoDir, 'to_delete.txt'), 'will be deleted');
      spawnSync('git', ['add', '-A'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'Add file to delete'], { cwd: repoDir });

      // Create pack with delete operation (proper structure)
      await fs.mkdir(packDir, { recursive: true });

      // bundle.json first
      const bundleJson = {
        bundle_schema_version: '2.0.0',
        goal: 'Test delete',
        actions: [],
        files: { output: [] },
        determinism: { pure: true },
      };
      await fs.writeFile(path.join(packDir, 'bundle.json'), canonicalize(bundleJson));
      const bundleHash = canonicalHash(bundleJson);

      // run.json with proper structure
      const runJson = {
        run_schema_version: '1.0.0',
        run_id: 'test_del',
        started_at: '2026-01-05T00:00:00.000Z',
        completed_at: '2026-01-05T00:00:01.000Z',
        kernel_version: '0.1.0',
        policy: {
          name: 'default',
          allow_network: false,
          timeout_ms: 60000,
          max_output_files: 500,
          max_total_output_bytes: 52428800,
          allowed_commands: ['node'],
          allowed_write_roots: ['out'],
        },
        intent: {
          path: 'intents/test.json',
          sha256: 'sha256:' + 'a'.repeat(64),
        },
        bundle: {
          bundle_id: 'bundle_test',
          sha256: bundleHash,
        },
        kernel_result_kind: 'BUNDLE',
        execution: null,
        decision: {
          accepted: true,
          reasons: ['Test'],
          validated_by_kernel: true,
        },
        model_mode: 'none',
      };
      await fs.writeFile(path.join(packDir, 'run.json'), canonicalize(runJson));

      // patch.json with delete
      const patchJson = {
        patch_schema_version: '1.0.0',
        source_proposal_id: 'prop_test123456789abc',
        source_proposal_hash: 'sha256:' + 'b'.repeat(64),
        operations: [{ path: 'to_delete.txt', op: 'delete', order: 0 }],
        total_bytes: 0,
      };
      await fs.writeFile(path.join(packDir, 'patch.json'), canonicalize(patchJson));

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
      };

      const result = await applyPackToGitRepo(args);

      const deleteFile = result.changed_files.find((f) => f.op === 'delete');
      assert.ok(deleteFile, 'Should have delete operation');
      assert.strictEqual(deleteFile.content_hash, null, 'Delete should have null content_hash');
    });
  });

  // ===========================================================================
  // Determinism Tests
  // ===========================================================================

  describe('Determinism', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('det');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('same inputs produce identical results (excluding git SHAs)', async () => {
      const repo1 = path.join(tempDir, 'repo1');
      const repo2 = path.join(tempDir, 'repo2');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repo1, { recursive: true });
      await fs.mkdir(repo2, { recursive: true });
      initGitRepo(repo1);
      initGitRepo(repo2);
      await createTestPack(packDir);

      const args1: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repo1,
        options: { dryRun: true },
      };

      const args2: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repo2,
        options: { dryRun: true },
      };

      const result1 = await applyPackToGitRepo(args1);
      const result2 = await applyPackToGitRepo(args2);

      // Compare non-SHA fields
      assert.strictEqual(result1.git_apply_schema_version, result2.git_apply_schema_version);
      assert.strictEqual(result1.outcome, result2.outcome);
      assert.strictEqual(result1.dry_run, result2.dry_run);
      assert.deepStrictEqual(result1.changed_files, result2.changed_files);
      assert.deepStrictEqual(result1.summary, result2.summary);
      assert.strictEqual(result1.branch.name, result2.branch.name);
      assert.strictEqual(result1.branch.created, result2.branch.created);
    });
  });

  // ===========================================================================
  // Pack Validation
  // ===========================================================================

  describe('Pack Validation', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir('pack');
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it('refuses if pack has no patch.json', async () => {
      const repoDir = path.join(tempDir, 'repo');
      const packDir = path.join(tempDir, 'pack');

      await fs.mkdir(repoDir, { recursive: true });
      await fs.mkdir(packDir, { recursive: true });
      initGitRepo(repoDir);

      // Create pack without patch.json
      await fs.writeFile(path.join(packDir, 'run.json'), JSON.stringify({ run_id: 'test' }));
      await fs.writeFile(
        path.join(packDir, 'bundle.json'),
        JSON.stringify({
          bundle_schema_version: '2.0.0',
          goal: 'Test',
          actions: [],
          files: { output: [] },
          determinism: { pure: true },
        }),
      );

      const args: GitApplyArgs = {
        pack_dir: packDir,
        repo_root: repoDir,
      };

      const result = await applyPackToGitRepo(args);

      assert.strictEqual(result.outcome, 'REFUSED', 'Should refuse pack without patch.json');
      assert.ok(result.error?.includes('patch.json'), 'Error should mention patch.json');
    });
  });
});
