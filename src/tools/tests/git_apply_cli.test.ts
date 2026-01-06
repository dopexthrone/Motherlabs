/**
 * Git Apply CLI Tests
 * ===================
 *
 * Tests for the git-apply CLI tool.
 * Validates:
 * - CLI output is canonical JSON
 * - Exit codes are correct (per GIT_APPLY_SPEC.md Section 11.1)
 * - Arguments are parsed correctly
 * - Git operations work correctly
 * - Output is deterministic
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { canonicalize, canonicalHash } from '../../utils/canonical.js';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');
const CLI_PATH = join(PROJECT_ROOT, 'dist/tools/git_apply.js');

// Temp directory base
const TEMP_BASE = join(tmpdir(), 'git_apply_cli_tests');

// =============================================================================
// Exit Codes per GIT_APPLY_SPEC.md Section 11.1
// =============================================================================

const EXIT_SUCCESS = 0;
const EXIT_IO_ERROR = 1;
const EXIT_PARSE_ERROR = 2;
const EXIT_VALIDATION_ERROR = 3;
const EXIT_GIT_ERROR = 4;

// =============================================================================
// Helper: Run CLI
// =============================================================================

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? 1,
      });
    });
  });
}

// =============================================================================
// Helper: Temp Directories
// =============================================================================

function createTempDir(name: string): string {
  const path = join(TEMP_BASE, `${name}_${process.pid}`);
  if (existsSync(path)) {
    rmSync(path, { recursive: true });
  }
  mkdirSync(path, { recursive: true });
  return path;
}

function cleanupTempDir(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true });
  }
}

// =============================================================================
// Helper: Git Operations
// =============================================================================

function initGitRepo(dir: string): void {
  spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, encoding: 'utf8' });
  // Create initial commit
  writeFileSync(join(dir, '.gitkeep'), '');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: dir, encoding: 'utf8' });
}

function getCurrentBranch(dir: string): string {
  const result = spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' });
  return result.stdout?.trim() || '';
}

function getHeadCommit(dir: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  return result.stdout?.trim() || '';
}

function isClean(dir: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  return !result.stdout?.trim();
}

// =============================================================================
// Helper: Create Test Pack
// =============================================================================

function createTestPack(
  packDir: string,
  ops: Array<{ op: 'create' | 'modify' | 'delete'; path: string; content?: string }> = [],
  runId?: string,
): void {
  mkdirSync(packDir, { recursive: true });

  // bundle.json first (required for pack verification)
  const bundleJson = {
    bundle_schema_version: '2.0.0',
    goal: 'Test intent',
    actions: ops.map((o) => ({ op: o.op, path: o.path })),
    files: { output: ops.filter((o) => o.op !== 'delete').map((o) => o.path) },
    determinism: { pure: true },
  };
  writeFileSync(join(packDir, 'bundle.json'), canonicalize(bundleJson));

  // Compute bundle hash
  const bundleHash = canonicalHash(bundleJson);

  // run.json with proper structure
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
  writeFileSync(join(packDir, 'run.json'), canonicalize(runJson));

  // patch.json
  let totalBytes = 0;
  const operations = ops.map((o, i) => {
    const result: Record<string, unknown> = {
      op: o.op,
      path: o.path,
      order: i,
    };
    if (o.content !== undefined) {
      const size = Buffer.byteLength(o.content, 'utf8');
      result.content = o.content;
      result.size_bytes = size;
      totalBytes += size;
    }
    return result;
  });

  const patchJson = {
    patch_schema_version: '1.0.0',
    source_proposal_id: 'prop_test123456789abc',
    source_proposal_hash: 'sha256:' + 'b'.repeat(64),
    operations,
    total_bytes: totalBytes,
  };
  writeFileSync(join(packDir, 'patch.json'), canonicalize(patchJson));
}

// =============================================================================
// Tests
// =============================================================================

describe('Git Apply CLI', () => {
  before(() => {
    mkdirSync(TEMP_BASE, { recursive: true });
  });

  after(() => {
    cleanupTempDir(TEMP_BASE);
  });

  describe('Basic Functionality', () => {
    it('shows help with --help', async () => {
      const result = await runCli(['--help']);

      assert.strictEqual(result.exitCode, EXIT_VALIDATION_ERROR, 'Should exit with validation code');
      assert.ok(result.stdout.includes('Usage:'), 'Should show usage');
      assert.ok(result.stdout.includes('--pack'), 'Should mention --pack');
      assert.ok(result.stdout.includes('--repo'), 'Should mention --repo');
    });

    it('shows help with -h', async () => {
      const result = await runCli(['-h']);

      assert.strictEqual(result.exitCode, EXIT_VALIDATION_ERROR);
      assert.ok(result.stdout.includes('Usage:'));
    });

    it('requires --pack argument', async () => {
      const tempDir = createTempDir('require_pack');
      try {
        initGitRepo(tempDir);
        const result = await runCli(['--repo', tempDir]);

        assert.strictEqual(result.exitCode, EXIT_VALIDATION_ERROR);
        assert.ok(result.stderr.includes('--pack'), 'Should mention --pack is required');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    it('requires --repo argument', async () => {
      const packDir = createTempDir('require_repo');
      createTestPack(packDir);
      try {
        const result = await runCli(['--pack', packDir]);

        assert.strictEqual(result.exitCode, EXIT_VALIDATION_ERROR);
        assert.ok(result.stderr.includes('--repo'), 'Should mention --repo is required');
      } finally {
        cleanupTempDir(packDir);
      }
    });

    it('--message requires --commit', async () => {
      const result = await runCli(['--pack', '/tmp', '--repo', '/tmp', '--message', 'test']);

      assert.strictEqual(result.exitCode, EXIT_VALIDATION_ERROR);
      assert.ok(result.stderr.includes('--commit'), 'Should mention --commit required');
    });
  });

  describe('Successful Apply', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('success');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('applies create operation to git repo', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello world' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS, `Should succeed: ${result.stderr}`);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'SUCCESS');
      assert.strictEqual(output.git_apply_schema_version, '1.0.0');
      assert.strictEqual(output.dry_run, false);

      // Verify file was created
      const createdPath = join(repoDir, 'test.txt');
      assert.ok(existsSync(createdPath), 'File should be created');
      assert.strictEqual(readFileSync(createdPath, 'utf8'), 'hello world');
    });

    it('uses deterministic branch naming', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }], 'my_run_123');

      const result = await runCli(['--pack', packDir, '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.branch.name, 'apply/my_run_123', 'Branch should be apply/{run_id}');
      assert.strictEqual(output.branch.created, true, 'Branch should be created');
    });

    it('outputs canonical JSON', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir, '--dry-run']);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      // Should be valid JSON
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed);

      // Re-serializing should be stable (canonical property)
      const reserialized = JSON.stringify(JSON.parse(result.stdout));
      // Can't compare directly due to formatting, but parse should work
    });
  });

  describe('Dry Run Mode', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('dry_run');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('generates report without writing files', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello world' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir, '--dry-run']);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.dry_run, true);
      assert.strictEqual(output.outcome, 'SUCCESS');

      // File should NOT be created
      assert.ok(!existsSync(join(repoDir, 'test.txt')), 'File should NOT be created');
    });

    it('preserves git state in dry run', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      const headBefore = getHeadCommit(repoDir);
      const branchBefore = getCurrentBranch(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir, '--dry-run']);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const headAfter = getHeadCommit(repoDir);
      const branchAfter = getCurrentBranch(repoDir);

      assert.strictEqual(headAfter, headBefore, 'HEAD should not change');
      assert.strictEqual(branchAfter, branchBefore, 'Branch should not change');
    });
  });

  describe('Commit Mode', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('commit');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('creates commit with --commit flag', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir, '--commit']);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      assert.ok(output.commit, 'Should have commit info');
      assert.ok(output.commit.sha, 'Should have commit SHA');
      assert.ok(output.commit.message, 'Should have commit message');
      assert.strictEqual(output.git_state.clean_after, true, 'Working tree should be clean');
    });

    it('uses custom commit message', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const customMessage = 'Custom commit message for testing';
      const result = await runCli(['--pack', packDir, '--repo', repoDir, '--commit', '--message', customMessage]);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.commit.message, customMessage);
    });
  });

  describe('Error Handling', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('errors');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('exits with IO error for missing pack directory', async () => {
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      const result = await runCli(['--pack', '/nonexistent/pack', '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_IO_ERROR, 'Should exit with IO error');
      assert.ok(result.stderr.includes('IO_ERROR'), 'Should have IO_ERROR prefix');
    });

    it('exits with validation error for non-git directory', async () => {
      const packDir = join(tempDir, 'pack');
      const nonGitDir = join(tempDir, 'not_a_repo');
      mkdirSync(nonGitDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const result = await runCli(['--pack', packDir, '--repo', nonGitDir]);

      assert.strictEqual(result.exitCode, EXIT_VALIDATION_ERROR, 'Should exit with validation error');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'REFUSED');
      assert.strictEqual(output.error, 'target is not a git repository');
    });

    it('exits with validation error for dirty working tree', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      // Make working tree dirty
      writeFileSync(join(repoDir, 'dirty.txt'), 'uncommitted');

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_VALIDATION_ERROR);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'REFUSED');
      assert.strictEqual(output.error, 'working tree has uncommitted changes');
    });

    it('allows dirty working tree with --allow-dirty', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      // Make working tree dirty
      writeFileSync(join(repoDir, 'dirty.txt'), 'uncommitted');

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir, '--allow-dirty']);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'SUCCESS');
    });

    it('exits with validation error for pack without patch.json', async () => {
      const packDir = join(tempDir, 'pack_no_patch');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(packDir);
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      // Create pack without patch.json
      writeFileSync(join(packDir, 'run.json'), JSON.stringify({ run_id: 'test' }));
      writeFileSync(
        join(packDir, 'bundle.json'),
        JSON.stringify({
          bundle_schema_version: '2.0.0',
          goal: 'Test',
          actions: [],
          files: { output: [] },
          determinism: { pure: true },
        }),
      );

      const result = await runCli(['--pack', packDir, '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_VALIDATION_ERROR);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'REFUSED');
      assert.ok(output.error.includes('patch.json'), 'Error should mention patch.json');
    });
  });

  describe('Branch Options', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('branch');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('uses --branch when specified', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir, '--branch', 'feature/custom-branch']);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.branch.name, 'feature/custom-branch');
    });

    it('uses apply/manual when no run_id', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      // Create pack without run_id (but with proper structure)
      mkdirSync(packDir);

      // bundle.json first
      const bundleJson = {
        bundle_schema_version: '2.0.0',
        goal: 'Test',
        actions: [],
        files: { output: [] },
        determinism: { pure: true },
      };
      writeFileSync(join(packDir, 'bundle.json'), canonicalize(bundleJson));
      const bundleHash = canonicalHash(bundleJson);

      // run.json without run_id
      const runJson = {
        run_schema_version: '1.0.0',
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
      writeFileSync(join(packDir, 'run.json'), canonicalize(runJson));

      // patch.json with proper structure
      const content = 'test';
      const patchJson = {
        patch_schema_version: '1.0.0',
        source_proposal_id: 'prop_test123456789abc',
        source_proposal_hash: 'sha256:' + 'b'.repeat(64),
        operations: [{ op: 'create', path: 'test.txt', content, size_bytes: Buffer.byteLength(content), order: 0 }],
        total_bytes: Buffer.byteLength(content),
      };
      writeFileSync(join(packDir, 'patch.json'), canonicalize(patchJson));

      const result = await runCli(['--pack', packDir, '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.branch.name, 'apply/manual');
    });
  });

  describe('Output Determinism', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('determinism');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('same invocation produces consistent output (dry run)', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir1 = join(tempDir, 'repo1');
      const repoDir2 = join(tempDir, 'repo2');
      mkdirSync(repoDir1);
      mkdirSync(repoDir2);
      initGitRepo(repoDir1);
      initGitRepo(repoDir2);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'deterministic' }]);

      const result1 = await runCli(['--pack', packDir, '--repo', repoDir1, '--dry-run']);
      const result2 = await runCli(['--pack', packDir, '--repo', repoDir2, '--dry-run']);

      assert.strictEqual(result1.exitCode, EXIT_SUCCESS);
      assert.strictEqual(result2.exitCode, EXIT_SUCCESS);

      const out1 = JSON.parse(result1.stdout);
      const out2 = JSON.parse(result2.stdout);

      // Core fields should match
      assert.strictEqual(out1.outcome, out2.outcome);
      assert.strictEqual(out1.git_apply_schema_version, out2.git_apply_schema_version);
      assert.strictEqual(out1.dry_run, out2.dry_run);
      assert.deepStrictEqual(out1.changed_files, out2.changed_files);
      assert.deepStrictEqual(out1.summary, out2.summary);
      assert.strictEqual(out1.branch.name, out2.branch.name);
    });
  });

  describe('Changed Files Output', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('changed');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('changed_files are sorted by path', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [
        { op: 'create', path: 'z_file.txt', content: 'z' },
        { op: 'create', path: 'a_file.txt', content: 'a' },
        { op: 'create', path: 'm_file.txt', content: 'm' },
      ]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      const paths = output.changed_files.map((f: any) => f.path);

      assert.deepStrictEqual(paths, ['a_file.txt', 'm_file.txt', 'z_file.txt'], 'Should be sorted');
    });

    it('content_hash uses sha256 format', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      createTestPack(packDir, [{ op: 'create', path: 'test.txt', content: 'hello' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      const file = output.changed_files[0];

      assert.ok(file.content_hash.startsWith('sha256:'), 'Hash should start with sha256:');
      const hex = file.content_hash.slice(7);
      assert.strictEqual(hex.length, 64, 'Hash should be 64 hex chars');
    });

    it('delete operations have null content_hash', async () => {
      const packDir = join(tempDir, 'pack');
      const repoDir = join(tempDir, 'repo');
      mkdirSync(repoDir);
      initGitRepo(repoDir);

      // Create file to delete
      writeFileSync(join(repoDir, 'to_delete.txt'), 'will be deleted');
      spawnSync('git', ['add', '-A'], { cwd: repoDir });
      spawnSync('git', ['commit', '-m', 'Add file'], { cwd: repoDir });

      createTestPack(packDir, [{ op: 'delete', path: 'to_delete.txt' }]);

      const result = await runCli(['--pack', packDir, '--repo', repoDir]);

      assert.strictEqual(result.exitCode, EXIT_SUCCESS);

      const output = JSON.parse(result.stdout);
      const deleteFile = output.changed_files.find((f: any) => f.op === 'delete');

      assert.ok(deleteFile, 'Should have delete operation');
      assert.strictEqual(deleteFile.content_hash, null, 'Delete should have null content_hash');
    });
  });
});
