/**
 * Repository State CLI Tests
 * ===========================
 *
 * Tests for the repo-state CLI tool.
 * Validates output is canonical and stable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');
const CLI_PATH = join(PROJECT_ROOT, 'dist/tools/repo_state.js');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures/repo_state');

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
// Helper: Temp Directory
// =============================================================================

function createTempDir(name: string): string {
  const path = join(tmpdir(), `repo_state_cli_test_${name}_${Date.now()}`);
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
// Tests: Verify Mode
// =============================================================================

describe('Repository State CLI', () => {
  describe('Verify Mode', () => {
    it('returns ok:true and exit 0 for valid_repo_state.json', async () => {
      const result = await runCli(['--verify', join(FIXTURES_DIR, 'valid_repo_state.json')]);
      assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}: ${result.stderr}`);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true);
      assert.ok(output.repo_state_hash.startsWith('sha256:'));
    });

    it('returns ok:true for dirty state', async () => {
      const result = await runCli(['--verify', join(FIXTURES_DIR, 'valid_repo_state_dirty.json')]);
      assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}: ${result.stderr}`);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true);
    });

    it('returns ok:false and exit 3 for invalid_absolute_path.json', async () => {
      const result = await runCli(['--verify', join(FIXTURES_DIR, 'invalid_absolute_path.json')]);
      assert.strictEqual(result.exitCode, 3, `Expected exit 3, got ${result.exitCode}`);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'RS6'));
    });

    it('returns ok:false for invalid_unsorted_paths.json', async () => {
      const result = await runCli(['--verify', join(FIXTURES_DIR, 'invalid_unsorted_paths.json')]);
      assert.strictEqual(result.exitCode, 3);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'RS7'));
    });

    it('returns ok:false for invalid_bad_hash.json', async () => {
      const result = await runCli(['--verify', join(FIXTURES_DIR, 'invalid_bad_hash.json')]);
      assert.strictEqual(result.exitCode, 3);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'RS5'));
    });

    it('returns ok:false for invalid_missing_schema.json', async () => {
      const result = await runCli(['--verify', join(FIXTURES_DIR, 'invalid_missing_schema.json')]);
      assert.strictEqual(result.exitCode, 3);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'RS1'));
    });
  });

  // ===========================================================================
  // Tests: Generate Mode
  // ===========================================================================

  describe('Generate Mode', () => {
    it('generates valid repo state to stdout', async () => {
      const result = await runCli([]);
      assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}: ${result.stderr}`);

      // Parse output
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.repo_state_schema_version, '1.0.0');
      assert.ok(output.repo_commit);
      assert.ok(typeof output.repo_dirty === 'boolean');
      assert.ok(Array.isArray(output.dirty_paths));
      assert.ok(output.node_version);
      assert.ok(output.npm_version);
      assert.ok(output.os_platform);
      assert.ok(output.os_arch);
      assert.ok(output.package_lock_sha256);
      assert.ok(output.contracts);
    });

    it('generates valid repo state to file with --out', async () => {
      const tempDir = createTempDir('generate_out');
      const outFile = join(tempDir, 'repo_state.json');

      try {
        const result = await runCli(['--out', outFile]);
        assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}: ${result.stderr}`);

        // Check confirmation output
        const confirmation = JSON.parse(result.stdout);
        assert.strictEqual(confirmation.ok, true);
        assert.ok(confirmation.repo_state_hash.startsWith('sha256:'));

        // Check file was written
        assert.ok(existsSync(outFile), 'Output file should exist');
        const content = readFileSync(outFile, 'utf-8');
        const state = JSON.parse(content);
        assert.strictEqual(state.repo_state_schema_version, '1.0.0');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    it('generates state with --no-deps', async () => {
      const result = await runCli(['--no-deps']);
      assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}: ${result.stderr}`);

      const output = JSON.parse(result.stdout);
      // When --no-deps, package_lock_sha256 should be a placeholder
      assert.strictEqual(
        output.package_lock_sha256,
        'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      );
    });
  });

  // ===========================================================================
  // Tests: Exit Codes
  // ===========================================================================

  describe('Exit Codes', () => {
    it('returns exit 1 for non-existent file', async () => {
      const result = await runCli(['--verify', '/nonexistent/file.json']);
      assert.strictEqual(result.exitCode, 1, 'Expected exit 1 for IO error');
    });

    it('returns exit 2 for invalid JSON file', async () => {
      const tempDir = createTempDir('invalid_json');
      const badFile = join(tempDir, 'bad.json');
      writeFileSync(badFile, 'not valid json {{{');

      try {
        const result = await runCli(['--verify', badFile]);
        assert.strictEqual(result.exitCode, 2, 'Expected exit 2 for parse error');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    it('returns exit 3 for validation error', async () => {
      const result = await runCli(['--verify', join(FIXTURES_DIR, 'invalid_bad_commit.json')]);
      assert.strictEqual(result.exitCode, 3, 'Expected exit 3 for validation error');
    });
  });

  // ===========================================================================
  // Tests: RS12 - Output Determinism
  // ===========================================================================

  describe('RS12: Output Determinism', () => {
    it('verify output is deterministic', async () => {
      const result1 = await runCli(['--verify', join(FIXTURES_DIR, 'valid_repo_state.json')]);
      const result2 = await runCli(['--verify', join(FIXTURES_DIR, 'valid_repo_state.json')]);

      assert.strictEqual(result1.stdout, result2.stdout, 'Verify output should be deterministic');
    });

    it('violations are sorted deterministically', async () => {
      const result1 = await runCli(['--verify', join(FIXTURES_DIR, 'invalid_absolute_path.json')]);
      const result2 = await runCli(['--verify', join(FIXTURES_DIR, 'invalid_absolute_path.json')]);

      assert.strictEqual(result1.stdout, result2.stdout, 'Violations should be sorted identically');
    });
  });

  // ===========================================================================
  // Tests: Canonical Output
  // ===========================================================================

  describe('Canonical Output', () => {
    it('generated state has sorted keys', async () => {
      const result = await runCli([]);
      assert.strictEqual(result.exitCode, 0);

      const output = result.stdout;
      // Check that contracts keys are sorted
      const contractsMatch = output.match(/"contracts":\{([^}]+)\}/);
      assert.ok(contractsMatch, 'Should find contracts object');

      // Verify keys are in order
      const keysInOrder = ['apply_schema_version', 'bundle_schema_version', 'git_apply_schema_version'];
      let lastIndex = -1;
      for (const key of keysInOrder) {
        const index = output.indexOf(`"${key}"`);
        assert.ok(index > lastIndex, `Key ${key} should appear after previous keys`);
        lastIndex = index;
      }
    });

    it('verify output is valid JSON', async () => {
      const result = await runCli(['--verify', join(FIXTURES_DIR, 'valid_repo_state.json')]);
      assert.doesNotThrow(() => JSON.parse(result.stdout), 'Output should be valid JSON');
    });
  });
});
