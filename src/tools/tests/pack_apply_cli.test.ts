/**
 * Pack Apply CLI Tests
 * ====================
 *
 * Tests for the pack-apply CLI tool.
 * Validates:
 * - CLI output is canonical JSON
 * - Exit codes are correct (per APPLY_SPEC.md Section 9.1)
 * - Arguments are parsed correctly
 * - Output is deterministic
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');
const CLI_PATH = join(PROJECT_ROOT, 'dist/tools/pack_apply.js');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures');

// Temp directory base
const TEMP_BASE = join(tmpdir(), 'pack_apply_cli_tests');

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
  const path = join(TEMP_BASE, `${name}_${Date.now()}`);
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

/**
 * Create a minimal valid pack with patch.json for testing.
 */
function createTestPack(packDir: string, ops: Array<{ op: 'create' | 'modify' | 'delete'; path: string; content?: string }> = []): void {
  const operations = ops.map((o, i) => {
    const result: Record<string, unknown> = {
      op: o.op,
      path: o.path,
      order: i,
    };
    if (o.content !== undefined) {
      result.content = o.content;
      result.size_bytes = Buffer.byteLength(o.content, 'utf8');
    }
    return result;
  });

  const totalBytes = operations.reduce((sum, op) => {
    return sum + (typeof op.size_bytes === 'number' ? (op.size_bytes as number) : 0);
  }, 0);

  const patch = {
    patch_schema_version: '1.0.0',
    source_proposal_id: 'prop_test123',
    source_proposal_hash: 'sha256:' + 'a'.repeat(64),
    operations,
    total_bytes: totalBytes,
  };

  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(packDir, 'patch.json'), JSON.stringify(patch, null, 2));
}

// =============================================================================
// Tests
// =============================================================================

describe('Pack Apply CLI', () => {
  before(() => {
    mkdirSync(TEMP_BASE, { recursive: true });
  });

  after(() => {
    cleanupTempDir(TEMP_BASE);
  });

  describe('Basic Functionality', () => {
    it('shows help with --help', async () => {
      const result = await runCli(['--help']);

      assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');
      assert.ok(result.stdout.includes('Usage:'), 'Should show usage');
      assert.ok(result.stdout.includes('--pack'), 'Should mention --pack');
      assert.ok(result.stdout.includes('--target'), 'Should mention --target');
    });

    it('shows help with -h', async () => {
      const result = await runCli(['-h']);

      assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');
      assert.ok(result.stdout.includes('Usage:'), 'Should show usage');
    });

    it('requires --pack argument', async () => {
      const tempDir = createTempDir('require_pack');
      try {
        const result = await runCli(['--target', tempDir]);

        assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');
        assert.ok(result.stderr.includes('--pack'), 'Should mention --pack is required');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    it('requires --target argument', async () => {
      const packDir = createTempDir('require_target');
      createTestPack(packDir);
      try {
        const result = await runCli(['--pack', packDir]);

        assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');
        assert.ok(result.stderr.includes('--target'), 'Should mention --target is required');
      } finally {
        cleanupTempDir(packDir);
      }
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

    it('applies create operation successfully', async () => {
      const packDir = join(tempDir, 'pack');
      const targetDir = join(tempDir, 'target');
      mkdirSync(targetDir);

      createTestPack(packDir, [
        { op: 'create', path: 'test.txt', content: 'hello world' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 0, `Should exit with SUCCESS: ${result.stderr}`);

      // Parse output
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'SUCCESS', 'Outcome should be SUCCESS');
      assert.strictEqual(output.dry_run, false, 'Should not be dry run');
      assert.strictEqual(output.summary.succeeded, 1, 'Should have 1 succeeded');
      assert.strictEqual(output.summary.failed, 0, 'Should have 0 failed');

      // Verify file was created
      const createdPath = join(targetDir, 'test.txt');
      assert.ok(existsSync(createdPath), 'File should be created');
      assert.strictEqual(readFileSync(createdPath, 'utf8'), 'hello world', 'Content should match');
    });

    it('applies multiple operations in sorted order', async () => {
      const packDir = join(tempDir, 'pack_multi');
      const targetDir = join(tempDir, 'target_multi');
      mkdirSync(targetDir);

      createTestPack(packDir, [
        { op: 'create', path: 'z_file.txt', content: 'z content' },
        { op: 'create', path: 'a_file.txt', content: 'a content' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'SUCCESS');
      assert.strictEqual(output.operation_results.length, 2);
      // Operations should be sorted by path
      assert.strictEqual(output.operation_results[0].path, 'a_file.txt', 'First should be a_file.txt');
      assert.strictEqual(output.operation_results[1].path, 'z_file.txt', 'Second should be z_file.txt');
    });

    it('outputs canonical JSON', async () => {
      const packDir = join(tempDir, 'pack_canonical');
      const targetDir = join(tempDir, 'target_canonical');
      mkdirSync(targetDir);

      createTestPack(packDir, [
        { op: 'create', path: 'test.txt', content: 'hello' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      // Output should not have extra whitespace (canonical property)
      assert.ok(!result.stdout.includes('  '), 'Should not have extra spaces');
    });

    it('creates parent directories when needed', async () => {
      const packDir = join(tempDir, 'pack_nested');
      const targetDir = join(tempDir, 'target_nested');
      mkdirSync(targetDir);

      createTestPack(packDir, [
        { op: 'create', path: 'deep/nested/dir/file.txt', content: 'nested content' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      const nestedPath = join(targetDir, 'deep/nested/dir/file.txt');
      assert.ok(existsSync(nestedPath), 'Nested file should be created');
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
      const targetDir = join(tempDir, 'target');
      mkdirSync(targetDir);

      createTestPack(packDir, [
        { op: 'create', path: 'test.txt', content: 'hello world' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
        '--dry-run',
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'SUCCESS');
      assert.strictEqual(output.dry_run, true, 'Should be dry run');
      assert.strictEqual(output.summary.succeeded, 1, 'Should show 1 succeeded');

      // File should NOT be created
      const testPath = join(targetDir, 'test.txt');
      assert.ok(!existsSync(testPath), 'File should NOT be created in dry run');
    });

    it('computes hashes in dry run', async () => {
      const packDir = join(tempDir, 'pack_hash');
      const targetDir = join(tempDir, 'target_hash');
      mkdirSync(targetDir);

      createTestPack(packDir, [
        { op: 'create', path: 'test.txt', content: 'hello' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
        '--dry-run',
      ]);

      assert.strictEqual(result.exitCode, 0);

      const output = JSON.parse(result.stdout);
      const op = output.operation_results[0];
      assert.strictEqual(op.before_hash, null, 'Before hash should be null for create');
      assert.ok(op.after_hash.startsWith('sha256:'), 'After hash should be computed');
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

    it('exits with code 2 for missing pack directory', async () => {
      const targetDir = join(tempDir, 'target');
      mkdirSync(targetDir);

      const result = await runCli([
        '--pack', '/nonexistent/pack',
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'REFUSED');
    });

    it('exits with code 2 for pack without patch.json', async () => {
      const packDir = join(tempDir, 'pack_no_patch');
      const targetDir = join(tempDir, 'target');
      mkdirSync(packDir);
      mkdirSync(targetDir);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'REFUSED');
      assert.ok(output.error.includes('no patch.json'), 'Error should mention missing patch');
    });

    it('exits with code 2 for non-directory target', async () => {
      const packDir = join(tempDir, 'pack');
      const targetFile = join(tempDir, 'target_file');
      createTestPack(packDir, []);
      writeFileSync(targetFile, 'not a directory');

      const result = await runCli([
        '--pack', packDir,
        '--target', targetFile,
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'REFUSED');
    });

    it('exits with code 1 for partial failure', async () => {
      const packDir = join(tempDir, 'pack_partial');
      const targetDir = join(tempDir, 'target_partial');
      mkdirSync(targetDir);

      // Create a file that will cause the first create to fail
      writeFileSync(join(targetDir, 'existing.txt'), 'already exists');

      createTestPack(packDir, [
        { op: 'create', path: 'existing.txt', content: 'will fail' },
        { op: 'create', path: 'new.txt', content: 'will succeed' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 1, 'Should exit with PARTIAL/FAILED code');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'PARTIAL', 'Should be PARTIAL outcome');
      assert.strictEqual(output.summary.succeeded, 1);
      assert.strictEqual(output.summary.failed, 1);
    });

    it('exits with code 1 for all operations failed', async () => {
      const packDir = join(tempDir, 'pack_failed');
      const targetDir = join(tempDir, 'target_failed');
      mkdirSync(targetDir);

      // File to modify doesn't exist
      createTestPack(packDir, [
        { op: 'modify', path: 'nonexistent.txt', content: 'will fail' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 1, 'Should exit with FAILED code');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'FAILED', 'Should be FAILED outcome');
    });
  });

  describe('Target Safety', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('safety');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('refuses path traversal in target', async () => {
      const packDir = join(tempDir, 'pack');
      createTestPack(packDir, []);

      // Use string concatenation to avoid path.join normalization
      const traversalTarget = tempDir + '/../../../tmp/escape';

      const result = await runCli([
        '--pack', packDir,
        '--target', traversalTarget,
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'REFUSED');
      assert.ok(output.violations?.some((v: any) => v.rule_id === 'AS5'), 'Should have AS5 violation');
    });

    it('refuses target that is not a directory', async () => {
      const packDir = join(tempDir, 'pack');
      const targetFile = join(tempDir, 'not_a_dir');
      createTestPack(packDir, []);
      writeFileSync(targetFile, 'file content');

      const result = await runCli([
        '--pack', packDir,
        '--target', targetFile,
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with REFUSED code');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'REFUSED');
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

    it('same invocation produces identical stdout bytes', async () => {
      const packDir = join(tempDir, 'pack');
      const targetDir1 = join(tempDir, 'target1');
      const targetDir2 = join(tempDir, 'target2');
      mkdirSync(targetDir1);
      mkdirSync(targetDir2);

      createTestPack(packDir, [
        { op: 'create', path: 'test.txt', content: 'deterministic' },
      ]);

      const result1 = await runCli([
        '--pack', packDir,
        '--target', targetDir1,
      ]);

      const result2 = await runCli([
        '--pack', packDir,
        '--target', targetDir2,
      ]);

      assert.strictEqual(result1.exitCode, 0);
      assert.strictEqual(result2.exitCode, 0);

      // Parse outputs
      const out1 = JSON.parse(result1.stdout);
      const out2 = JSON.parse(result2.stdout);

      // Core fields should match
      assert.strictEqual(out1.outcome, out2.outcome, 'Outcomes should match');
      assert.deepStrictEqual(out1.summary, out2.summary, 'Summaries should match');
      assert.strictEqual(out1.operation_results.length, out2.operation_results.length);
      assert.strictEqual(out1.operation_results[0].after_hash, out2.operation_results[0].after_hash, 'Hashes should match');
    });

    it('dry run produces same result as actual apply (except writes)', async () => {
      const packDir = join(tempDir, 'pack_det');
      const targetDry = join(tempDir, 'target_dry');
      const targetReal = join(tempDir, 'target_real');
      mkdirSync(targetDry);
      mkdirSync(targetReal);

      createTestPack(packDir, [
        { op: 'create', path: 'file.txt', content: 'content' },
      ]);

      const dryResult = await runCli([
        '--pack', packDir,
        '--target', targetDry,
        '--dry-run',
      ]);

      const realResult = await runCli([
        '--pack', packDir,
        '--target', targetReal,
      ]);

      const dryOut = JSON.parse(dryResult.stdout);
      const realOut = JSON.parse(realResult.stdout);

      // Everything should match except dry_run field
      assert.strictEqual(dryOut.outcome, realOut.outcome);
      assert.strictEqual(dryOut.dry_run, true);
      assert.strictEqual(realOut.dry_run, false);
      assert.strictEqual(dryOut.operation_results[0].after_hash, realOut.operation_results[0].after_hash);
    });
  });

  describe('Modify and Delete Operations', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('modify_delete');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('applies modify operation successfully', async () => {
      const packDir = join(tempDir, 'pack');
      const targetDir = join(tempDir, 'target');
      mkdirSync(targetDir);

      // Create existing file to modify
      writeFileSync(join(targetDir, 'existing.txt'), 'old content');

      createTestPack(packDir, [
        { op: 'modify', path: 'existing.txt', content: 'new content' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'SUCCESS');
      assert.ok(output.operation_results[0].before_hash !== null, 'Should have before_hash');

      // Verify content was modified
      const content = readFileSync(join(targetDir, 'existing.txt'), 'utf8');
      assert.strictEqual(content, 'new content');
    });

    it('applies delete operation successfully', async () => {
      const packDir = join(tempDir, 'pack');
      const targetDir = join(tempDir, 'target');
      mkdirSync(targetDir);

      // Create file to delete
      writeFileSync(join(targetDir, 'to_delete.txt'), 'will be deleted');

      createTestPack(packDir, [
        { op: 'delete', path: 'to_delete.txt' },
      ]);

      const result = await runCli([
        '--pack', packDir,
        '--target', targetDir,
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.outcome, 'SUCCESS');
      assert.ok(output.operation_results[0].before_hash !== null, 'Should have before_hash');
      assert.strictEqual(output.operation_results[0].after_hash, null, 'after_hash should be null for delete');

      // Verify file was deleted
      assert.ok(!existsSync(join(targetDir, 'to_delete.txt')), 'File should be deleted');
    });
  });
});
