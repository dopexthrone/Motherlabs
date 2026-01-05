/**
 * Pack CLI Tests
 * ==============
 *
 * Tests for the pack-verify CLI tool.
 * Validates output is canonical and stable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');
const CLI_PATH = join(PROJECT_ROOT, 'dist/tools/pack_verify.js');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures/packs');

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
// Helper: Temp Pack
// =============================================================================

function createTempPack(name: string): string {
  const path = join(tmpdir(), `pack_cli_test_${name}_${Date.now()}`);
  if (existsSync(path)) {
    rmSync(path, { recursive: true });
  }
  mkdirSync(path, { recursive: true });
  return path;
}

function cleanupTempPack(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true });
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('Pack CLI', () => {
  describe('Valid Packs', () => {
    it('returns ok:true for valid_pack_bundle', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'valid_pack_bundle')]);
      assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}: ${result.stderr}`);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true);
      assert.ok(Array.isArray(output.files_verified));
      assert.ok(output.files_verified.includes('run.json'));
      assert.ok(output.files_verified.includes('bundle.json'));
    });

    it('returns ok:true for valid_pack_clarify', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'valid_pack_clarify')]);
      assert.strictEqual(result.exitCode, 0);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true);
    });

    it('returns ok:true for valid_pack_refuse', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'valid_pack_refuse')]);
      assert.strictEqual(result.exitCode, 0);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true);
    });

    it('returns ok:true for valid_pack_full', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'valid_pack_full')]);
      assert.strictEqual(result.exitCode, 0);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true);
      // Check that all files are verified
      assert.ok(output.files_verified.includes('run.json'));
      assert.ok(output.files_verified.includes('bundle.json'));
      assert.ok(output.files_verified.includes('patch.json'));
      assert.ok(output.files_verified.includes('evidence.json'));
      assert.ok(output.files_verified.includes('ledger.jsonl'));
      assert.ok(output.files_verified.includes('policy.json'));
      assert.ok(output.files_verified.includes('meta.json'));
    });
  });

  describe('Invalid Packs', () => {
    it('returns exit 1 for missing run.json', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'invalid_pack_missing_run')]);
      assert.strictEqual(result.exitCode, 1);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'PK1'));
    });

    it('returns exit 1 for missing bundle.json', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'invalid_pack_missing_bundle')]);
      assert.strictEqual(result.exitCode, 1);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'PK1'));
    });

    it('returns exit 1 for unknown file', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'invalid_pack_unknown_file')]);
      assert.strictEqual(result.exitCode, 1);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'PK2'));
    });

    it('returns exit 1 for hash mismatch', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'invalid_pack_hash_mismatch')]);
      assert.strictEqual(result.exitCode, 1);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'PK5'));
    });
  });

  describe('Determinism', () => {
    it('produces byte-identical output across runs (valid)', async () => {
      const result1 = await runCli([join(FIXTURES_DIR, 'valid_pack_bundle')]);
      const result2 = await runCli([join(FIXTURES_DIR, 'valid_pack_bundle')]);

      assert.strictEqual(result1.stdout, result2.stdout, 'Output should be byte-identical');
      assert.strictEqual(result1.exitCode, result2.exitCode);
    });

    it('produces byte-identical output across runs (invalid)', async () => {
      const result1 = await runCli([join(FIXTURES_DIR, 'invalid_pack_hash_mismatch')]);
      const result2 = await runCli([join(FIXTURES_DIR, 'invalid_pack_hash_mismatch')]);

      assert.strictEqual(result1.stdout, result2.stdout, 'Output should be byte-identical');
      assert.strictEqual(result1.exitCode, result2.exitCode);
    });

    it('violations are sorted deterministically', async () => {
      // Run multiple times and ensure order is stable
      const results = await Promise.all([
        runCli([join(FIXTURES_DIR, 'invalid_pack_missing_bundle')]),
        runCli([join(FIXTURES_DIR, 'invalid_pack_missing_bundle')]),
        runCli([join(FIXTURES_DIR, 'invalid_pack_missing_bundle')]),
      ]);

      const outputs = results.map((r) => r.stdout);
      assert.ok(outputs.every((o) => o === outputs[0]), 'All outputs should be identical');
    });
  });

  describe('Error Handling', () => {
    it('returns exit 2 for non-existent directory', async () => {
      const result = await runCli(['/nonexistent/path/to/pack']);
      assert.strictEqual(result.exitCode, 2);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false);
      assert.ok(output.violations.some((v: any) => v.rule_id === 'IO'));
    });

    it('returns exit 2 for file instead of directory', async () => {
      const tempPath = createTempPack('cli_file');
      const filePath = join(tempPath, 'not_a_dir');
      writeFileSync(filePath, 'hello');

      try {
        const result = await runCli([filePath]);
        assert.strictEqual(result.exitCode, 2);
        const output = JSON.parse(result.stdout);
        assert.strictEqual(output.ok, false);
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('Options', () => {
    it('--no-deep skips deep validation', async () => {
      const tempPath = createTempPack('cli_no_deep');
      try {
        // Create pack with invalid bundle but should pass with --no-deep
        copyFileSync(
          join(FIXTURES_DIR, 'valid_pack_bundle', 'run.json'),
          join(tempPath, 'run.json')
        );
        // Invalid bundle (empty object)
        writeFileSync(join(tempPath, 'bundle.json'), '{}');

        const result = await runCli([tempPath, '--no-deep']);
        // Should have PK5 (hash mismatch) but not PK4 (bundle validation)
        const output = JSON.parse(result.stdout);
        assert.ok(!output.violations?.some((v: any) => v.rule_id === 'PK4'));
      } finally {
        cleanupTempPack(tempPath);
      }
    });

    it('--no-refs skips hash verification', async () => {
      const result = await runCli([
        join(FIXTURES_DIR, 'invalid_pack_hash_mismatch'),
        '--no-refs',
      ]);
      const output = JSON.parse(result.stdout);
      // Should not have PK5 violation
      assert.ok(!output.violations?.some((v: any) => v.rule_id === 'PK5'));
    });

    it('--help shows usage', async () => {
      const result = await runCli(['--help']);
      assert.ok(result.stdout.includes('Usage:'));
      assert.ok(result.stdout.includes('pack-verify'));
    });
  });

  describe('Reference Checks', () => {
    it('includes reference_checks in success output', async () => {
      const result = await runCli([join(FIXTURES_DIR, 'valid_pack_bundle')]);
      const output = JSON.parse(result.stdout);
      assert.ok(Array.isArray(output.reference_checks));
      const bundleCheck = output.reference_checks.find((c: any) => c.target === 'bundle.json');
      assert.ok(bundleCheck, 'Expected bundle.json reference check');
      assert.strictEqual(bundleCheck.match, true);
      assert.ok(bundleCheck.expected.startsWith('sha256:'));
      assert.ok(bundleCheck.computed.startsWith('sha256:'));
    });
  });
});
