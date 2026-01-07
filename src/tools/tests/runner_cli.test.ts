/**
 * Runner Verify CLI Tests
 * =======================
 *
 * Integration tests for the runner-verify CLI tool.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_PATH = resolve(PROJECT_ROOT, 'dist', 'tools', 'runner_verify.js');
const FIXTURES_DIR = resolve(PROJECT_ROOT, 'src', 'consumer', 'tests', 'fixtures', 'runner');

/**
 * Run the runner-verify CLI with given args.
 */
function runCli(args: string[], options?: { input?: string }): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    input: options?.input,
    env: { ...process.env, NODE_ENV: 'test' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('Runner Verify CLI', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'runner-cli-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Help', () => {
    it('shows help with --help', () => {
      const result = runCli(['--help']);
      // Help exits with code 1 (as per printUsage)
      assert.equal(result.status, 1);
      assert.ok(result.stdout.includes('Usage:'));
      assert.ok(result.stdout.includes('runner-verify'));
    });

    it('shows help with -h', () => {
      const result = runCli(['-h']);
      assert.equal(result.status, 1);
      assert.ok(result.stdout.includes('Usage:'));
    });

    it('shows help with no args', () => {
      const result = runCli([]);
      assert.equal(result.status, 1);
      assert.ok(result.stdout.includes('Usage:'));
    });
  });

  describe('File Verification', () => {
    it('valid_basic.json passes with exit 0', () => {
      const result = runCli([join(FIXTURES_DIR, 'valid_basic.json')]);
      assert.equal(result.status, 0, `stderr: ${result.stderr}, stdout: ${result.stdout}`);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true);
      assert.ok(output.runner_hash);
      assert.ok(output.runner_hash.startsWith('sha256:'));
    });

    it('valid_with_phases.json passes', () => {
      const result = runCli([join(FIXTURES_DIR, 'valid_with_phases.json')]);
      assert.equal(result.status, 0);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true);
      assert.ok(output.runner_hash);
    });

    it('valid_with_ephemeral.json passes', () => {
      const result = runCli([join(FIXTURES_DIR, 'valid_with_ephemeral.json')]);
      assert.equal(result.status, 0);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true);
      assert.ok(output.runner_hash);
    });

    it('valid_no_isolation.json passes', () => {
      const result = runCli([join(FIXTURES_DIR, 'valid_no_isolation.json')]);
      assert.equal(result.status, 0);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true);
    });

    it('invalid_rn1_schema_version.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn1_schema_version.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN1'));
    });

    it('invalid_rn2_runner_id.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn2_runner_id.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN2'));
    });

    it('invalid_rn3_platform.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn3_platform.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN3'));
    });

    it('invalid_rn4_sandbox.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn4_sandbox.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN4'));
    });

    it('invalid_rn5_limits.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn5_limits.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN5'));
    });

    it('invalid_rn6_commands.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn6_commands.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN6'));
    });

    it('invalid_rn7_write_roots.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn7_write_roots.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN7'));
    });

    it('invalid_rn8_context.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn8_context.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN8'));
    });

    it('invalid_rn9_timing.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn9_timing.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN9'));
    });

    it('invalid_rn10_exit.json fails with exit 3', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn10_exit.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'RN10'));
    });
  });

  describe('Error Handling', () => {
    it('non-existent file fails with exit 1', () => {
      const result = runCli(['/nonexistent/file.json']);
      assert.equal(result.status, 1);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.error.includes('not found'));
    });

    it('invalid JSON fails with exit 2', () => {
      const badFile = join(tempDir, 'bad.json');
      writeFileSync(badFile, 'not json');

      const result = runCli([badFile]);
      assert.equal(result.status, 2);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.error.includes('Invalid JSON'));
    });

    it('non-object JSON fails with exit 3', () => {
      const arrayFile = join(tempDir, 'array.json');
      writeFileSync(arrayFile, '[]');

      const result = runCli([arrayFile]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations);
      assert.ok(output.violations.some((v: { rule_id: string }) => v.rule_id === 'SCHEMA'));
    });
  });

  describe('Stdin Input', () => {
    it('reads from stdin with -', () => {
      const validRunner = JSON.stringify({
        commands: { allowlist: [], blocklist: [], shell: '/bin/sh' },
        context: {
          env_allowlist: [],
          locale: 'en_US.UTF-8',
          timezone: 'UTC',
          working_dir: '.',
        },
        exit: { code: 0, oom_killed: false, timeout_killed: false },
        limits: {
          max_output_files: 100,
          max_total_output_bytes: 10485760,
          timeout_ms: 60000,
        },
        platform: {
          arch: 'x64',
          node_version: 'v24.11.1',
          npm_version: '10.9.2',
          os: 'linux',
        },
        runner_id: 'runner_20260106_120000_abc123',
        runner_schema_version: '1.0.0',
        runner_version: '0.3.15',
        sandbox: {
          backend: 'process',
          filesystem_readonly: false,
          isolation_level: 'standard',
          network_blocked: true,
        },
        timing: {
          completed_at: '2026-01-06T12:00:05.000Z',
          duration_ms: 5000,
          started_at: '2026-01-06T12:00:00.000Z',
        },
        write_roots: [],
      });

      const result = runCli(['-'], { input: validRunner });
      assert.equal(result.status, 0, `stderr: ${result.stderr}, stdout: ${result.stdout}`);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true);
      assert.ok(output.runner_hash);
    });

    it('empty stdin fails with exit 1', () => {
      const result = runCli(['-'], { input: '' });
      assert.equal(result.status, 1);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.error.includes('Empty'));
    });

    it('invalid JSON from stdin fails with exit 2', () => {
      const result = runCli(['-'], { input: 'not json' });
      assert.equal(result.status, 2);

      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.error.includes('Invalid JSON'));
    });
  });

  describe('Output Format', () => {
    it('success output is canonical JSON', () => {
      const result = runCli([join(FIXTURES_DIR, 'valid_basic.json')]);
      assert.equal(result.status, 0);

      // Output should be valid JSON
      const output = JSON.parse(result.stdout);

      // Keys should be sorted
      const keys = Object.keys(output);
      const sortedKeys = [...keys].sort();
      assert.deepEqual(keys, sortedKeys);
    });

    it('failure output includes file path', () => {
      const result = runCli([join(FIXTURES_DIR, 'invalid_rn1_schema_version.json')]);
      assert.equal(result.status, 3);

      const output = JSON.parse(result.stdout);
      assert.ok(output.file);
      assert.ok(output.file.includes('invalid_rn1_schema_version.json'));
    });
  });
});
