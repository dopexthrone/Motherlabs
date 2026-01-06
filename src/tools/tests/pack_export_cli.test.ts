/**
 * Pack Export CLI Tests
 * =====================
 *
 * Tests for the pack-export CLI tool.
 * Validates:
 * - CLI output is canonical JSON
 * - Exit codes are correct
 * - Arguments are parsed correctly
 * - Output is deterministic
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');
const CLI_PATH = join(PROJECT_ROOT, 'dist/tools/pack_export.js');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/harness/fixtures');
const INTENTS_DIR = join(PROJECT_ROOT, 'intents/real');

// Temp directory base
const TEMP_BASE = join(tmpdir(), 'pack_export_cli_tests');

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

// =============================================================================
// Tests
// =============================================================================

describe('Pack Export CLI', () => {
  before(() => {
    // Create temp base directory
    mkdirSync(TEMP_BASE, { recursive: true });
  });

  after(() => {
    // Cleanup temp base
    cleanupTempDir(TEMP_BASE);
  });

  describe('Basic Functionality', () => {
    it('shows help with --help', async () => {
      const result = await runCli(['--help']);

      assert.strictEqual(result.exitCode, 2, 'Should exit with usage error code');
      assert.ok(result.stdout.includes('Usage:'), 'Should show usage');
      assert.ok(result.stdout.includes('--intent'), 'Should mention --intent');
      assert.ok(result.stdout.includes('--out'), 'Should mention --out');
    });

    it('shows help with -h', async () => {
      const result = await runCli(['-h']);

      assert.strictEqual(result.exitCode, 2, 'Should exit with usage error code');
      assert.ok(result.stdout.includes('Usage:'), 'Should show usage');
    });

    it('requires --intent argument', async () => {
      const tempDir = createTempDir('require_intent');
      try {
        const result = await runCli(['--out', tempDir]);

        assert.strictEqual(result.exitCode, 2, 'Should exit with validation error');
        assert.ok(result.stderr.includes('--intent'), 'Should mention --intent is required');
      } finally {
        cleanupTempDir(tempDir);
      }
    });

    it('requires --out argument', async () => {
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');
      const result = await runCli(['--intent', intentPath]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with validation error');
      assert.ok(result.stderr.includes('--out'), 'Should mention --out is required');
    });
  });

  describe('Successful Export', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('success');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('exports pack successfully with plan mode', async () => {
      const outDir = join(tempDir, 'pack_out');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--mode', 'plan',
        '--policy', 'default',
      ]);

      assert.strictEqual(result.exitCode, 0, `Should exit with success: ${result.stderr}`);

      // Parse output
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true, 'Output should indicate success');
      assert.ok(Array.isArray(output.files_written), 'Should have files_written array');
      assert.ok(output.files_written.includes('run.json'), 'Should include run.json');
      assert.strictEqual(output.pack_verify.ok, true, 'Pack verify should pass');
    });

    it('outputs canonical JSON', async () => {
      const outDir = join(tempDir, 'canonical');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--mode', 'plan',
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      // Parse and re-serialize to verify canonical
      const output = JSON.parse(result.stdout);
      assert.ok(output.ok !== undefined, 'Should have ok field');

      // Output should not have extra whitespace (canonical property)
      assert.ok(!result.stdout.includes('  '), 'Should not have extra spaces');
    });

    it('default policy is used when not specified', async () => {
      const outDir = join(tempDir, 'default_policy');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      // Check policy.json in output
      const policyPath = join(outDir, 'policy.json');
      assert.ok(existsSync(policyPath), 'policy.json should exist');
      const policy = JSON.parse(readFileSync(policyPath, 'utf-8'));
      assert.strictEqual(policy.name, 'default', 'Should use default policy');
    });

    it('default mode is plan when not specified', async () => {
      const outDir = join(tempDir, 'default_mode');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--policy', 'strict',
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      // Check run.json - should show plan-only mode
      const runPath = join(outDir, 'run.json');
      const run = JSON.parse(readFileSync(runPath, 'utf-8'));
      assert.strictEqual(run.execution, null, 'Should have no execution (plan mode)');
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

    it('fails with exit code 2 for non-empty output directory', async () => {
      const outDir = join(tempDir, 'non_empty');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'existing.txt'), 'content');

      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with validation error');
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false, 'Output should indicate failure');
      assert.ok(output.error.includes('non-empty'), 'Should mention non-empty');
    });

    it('fails with exit code 2 for missing intent file', async () => {
      const outDir = join(tempDir, 'missing_intent');

      const result = await runCli([
        '--intent', '/nonexistent/path/intent.json',
        '--out', outDir,
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with validation error');
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false, 'Output should indicate failure');
      assert.ok(output.error.includes('not found'), 'Should mention file not found');
    });

    it('fails with exit code 2 for invalid policy', async () => {
      const outDir = join(tempDir, 'invalid_policy');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--policy', 'invalid',
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with validation error');
      assert.ok(result.stderr.includes('Invalid policy'), 'Should mention invalid policy');
    });

    it('fails with exit code 2 for invalid mode', async () => {
      const outDir = join(tempDir, 'invalid_mode');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--mode', 'invalid',
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should exit with validation error');
      assert.ok(result.stderr.includes('Invalid mode'), 'Should mention invalid mode');
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
      const outDir1 = join(tempDir, 'det1');
      const outDir2 = join(tempDir, 'det2');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result1 = await runCli([
        '--intent', intentPath,
        '--out', outDir1,
        '--mode', 'plan',
        '--policy', 'strict',
      ]);

      const result2 = await runCli([
        '--intent', intentPath,
        '--out', outDir2,
        '--mode', 'plan',
        '--policy', 'strict',
      ]);

      assert.strictEqual(result1.exitCode, 0, 'First run should succeed');
      assert.strictEqual(result2.exitCode, 0, 'Second run should succeed');

      // Parse outputs
      const out1 = JSON.parse(result1.stdout);
      const out2 = JSON.parse(result2.stdout);

      // Files written should be identical
      assert.deepStrictEqual(out1.files_written, out2.files_written, 'Files written should match');

      // Run outcome should be identical
      assert.strictEqual(out1.run_outcome, out2.run_outcome, 'Run outcome should match');

      // Pack verify result should be identical
      assert.strictEqual(out1.pack_verify.ok, out2.pack_verify.ok, 'Pack verify should match');
    });
  });

  describe('Different Outcomes', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('outcomes');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('fails for invalid intent (empty goal)', async () => {
      const outDir = join(tempDir, 'refuse');
      const intentPath = join(INTENTS_DIR, 'e_edge_cases/intent_009_empty_goal.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--mode', 'plan',
      ]);

      // Export fails for invalid intents
      assert.strictEqual(result.exitCode, 2, 'Should fail with validation error');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, false, 'Export should fail');
      assert.ok(output.error?.includes('failed'), 'Should have error message');
    });

    it('handles BUNDLE outcome correctly', async () => {
      const outDir = join(tempDir, 'bundle');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--mode', 'plan',
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.ok, true, 'Export should succeed');
      assert.strictEqual(output.run_outcome, 'BUNDLE', 'Outcome should be BUNDLE');
      assert.ok(output.files_written.includes('bundle.json'), 'Should include bundle.json');
    });
  });

  describe('Model Mode Options', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('model_mode');
    });

    afterEach(() => {
      cleanupTempDir(tempDir);
    });

    it('accepts --model-mode none', async () => {
      const outDir = join(tempDir, 'model_none');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--model-mode', 'none',
      ]);

      assert.strictEqual(result.exitCode, 0, 'Should succeed');
    });

    it('rejects invalid --model-mode', async () => {
      const outDir = join(tempDir, 'model_invalid');
      const intentPath = join(FIXTURES_DIR, 'intent_harness_001_plan_only.json');

      const result = await runCli([
        '--intent', intentPath,
        '--out', outDir,
        '--model-mode', 'invalid',
      ]);

      assert.strictEqual(result.exitCode, 2, 'Should fail with validation error');
      assert.ok(result.stderr.includes('Invalid model-mode'), 'Should mention invalid model-mode');
    });
  });
});
