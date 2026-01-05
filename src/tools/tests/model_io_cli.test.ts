/**
 * Model IO CLI Tests
 * ==================
 *
 * Tests for the model-io-verify CLI tool.
 * Validates output is canonical and stable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');
const CLI_PATH = join(PROJECT_ROOT, 'dist/tools/model_io_verify.js');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures/model_io');

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
// Helper: Temp File
// =============================================================================

function createTempDir(name: string): string {
  const path = join(tmpdir(), `model_io_cli_test_${name}_${Date.now()}`);
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
// Tests
// =============================================================================

describe('Model IO CLI', () => {
  describe('Valid Sessions', () => {
    it('returns ok:true and exit 0 for valid_model_io.json', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'valid_model_io.json')]);
      assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}: ${result.stderr}`);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true);
      assert.strictEqual(output.interactions_count, 2);
      assert.ok(output.model_io_hash.startsWith('sha256:'));
    });
  });

  describe('Invalid Sessions', () => {
    it('returns exit 3 for invalid_bad_hash.json', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'invalid_bad_hash.json')]);
      assert.strictEqual(result.exitCode, 3, `Expected exit 3 (validation error), got ${result.exitCode}`);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'MI7'));
    });

    it('returns exit 3 for invalid_non_contiguous_index.json', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'invalid_non_contiguous_index.json')]);
      assert.strictEqual(result.exitCode, 3);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'MI5'));
    });

    it('returns exit 3 for invalid_mode.json', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'invalid_mode.json')]);
      assert.strictEqual(result.exitCode, 3);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'MI3'));
    });
  });

  describe('IO Errors', () => {
    it('returns exit 1 for non-existent file', async () => {
      const result = await runCli(['/nonexistent/path/to/file.json']);
      assert.strictEqual(result.exitCode, 1);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'IO'));
    });
  });

  describe('Parse Errors', () => {
    it('returns exit 2 for invalid JSON', async () => {
      const tempDir = createTempDir('cli_parse_error');
      const filePath = join(tempDir, 'invalid.json');
      writeFileSync(filePath, 'not valid json {');

      try {
        const result = await runCli([filePath]);
        assert.strictEqual(result.exitCode, 2);
        const output = JSON.parse(result.stdout);
        assert.strictEqual(output.ok, false);
        assert.ok(output.violations.some((v: any) => v.rule_id === 'PARSE'));
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('Options', () => {
    it('--no-response-hashes skips hash verification', async () => {
      const result = await runCli([
        join(FIXTURES_DIR, 'invalid_bad_hash.json'),
        '--no-response-hashes',
      ]);
      // Should pass because we're skipping hash verification
      assert.strictEqual(result.exitCode, 0);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true);
    });

    it('--help shows usage', async () => {
      const result = await runCli(['--help']);
      assert.ok(result.stdout.includes('Usage:'));
      assert.ok(result.stdout.includes('model-io-verify'));
    });
  });

  describe('Determinism', () => {
    it('produces byte-identical output across runs (valid)', async () => {
      const result1 = await runCli([join(FIXTURES_DIR, 'valid_model_io.json')]);
      const result2 = await runCli([join(FIXTURES_DIR, 'valid_model_io.json')]);

      assert.strictEqual(result1.stdout, result2.stdout, 'Output should be byte-identical');
      assert.strictEqual(result1.exitCode, result2.exitCode);
    });

    it('produces byte-identical output across runs (invalid)', async () => {
      const result1 = await runCli([join(FIXTURES_DIR, 'invalid_bad_hash.json')]);
      const result2 = await runCli([join(FIXTURES_DIR, 'invalid_bad_hash.json')]);

      assert.strictEqual(result1.stdout, result2.stdout, 'Output should be byte-identical');
      assert.strictEqual(result1.exitCode, result2.exitCode);
    });

    it('violations are sorted deterministically', async () => {
      // Create a file with multiple violations
      const tempDir = createTempDir('cli_determinism');
      const filePath = join(tempDir, 'multi_error.json');
      writeFileSync(filePath, JSON.stringify({
        model_io_schema_version: '',
        adapter_id: '',
        model_id: '',
        mode: 'invalid',
        interactions: [],
      }));

      try {
        const results = await Promise.all([
          runCli([filePath]),
          runCli([filePath]),
          runCli([filePath]),
        ]);

        const outputs = results.map((r) => r.stdout);
        assert.ok(outputs.every((o) => o === outputs[0]), 'All outputs should be identical');
      } finally {
        cleanupTempDir(tempDir);
      }
    });
  });
});
