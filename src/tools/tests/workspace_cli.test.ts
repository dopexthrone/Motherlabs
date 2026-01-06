/**
 * Workspace Snapshot CLI Tests
 * ============================
 *
 * Integration tests for the workspace-snapshot CLI tool.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_PATH = resolve(PROJECT_ROOT, 'dist', 'tools', 'workspace_snapshot.js');
const FIXTURES_DIR = resolve(PROJECT_ROOT, 'src', 'consumer', 'tests', 'fixtures', 'workspace');

/**
 * Run the workspace-snapshot CLI with given args.
 */
function runCli(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: cwd || PROJECT_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, NODE_ENV: 'test' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('Workspace Snapshot CLI', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'workspace-cli-test-'));
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
      assert.ok(result.stdout.includes('--out'));
      assert.ok(result.stdout.includes('--intent'));
      assert.ok(result.stdout.includes('--pack'));
    });

    it('shows help with -h', () => {
      const result = runCli(['-h']);
      assert.equal(result.status, 1);
      assert.ok(result.stdout.includes('Usage:'));
    });
  });

  describe('Generate Mode', () => {
    it('generates snapshot to stdout', () => {
      const result = runCli(['--policy', 'strict']);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.equal(snapshot.workspace_schema_version, '1.0.0');
      assert.equal(snapshot.tool_id, 'workspace-snapshot');
    });

    it('generates snapshot to file with --out', () => {
      const outFile = join(tempDir, 'snapshot.json');
      const result = runCli(['--out', outFile, '--policy', 'default']);
      assert.equal(result.status, 0);

      // Parse stdout confirmation
      const confirmation = JSON.parse(result.stdout);
      assert.equal(confirmation.ok, true);
      assert.equal(confirmation.file, outFile);
      assert.ok(confirmation.workspace_hash);

      // Verify file was written
      const content = readFileSync(outFile, 'utf-8');
      const snapshot = JSON.parse(content);
      assert.equal(snapshot.workspace_schema_version, '1.0.0');
    });

    it('includes policy hash', () => {
      const result = runCli(['--policy', 'strict']);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.ok(snapshot.refs.policy.policy_hash);
      assert.ok(snapshot.refs.policy.policy_hash.startsWith('sha256:'));
    });

    it('includes env allowlist', () => {
      const result = runCli(['--policy', 'default']);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.ok(Array.isArray(snapshot.env.allowlist));
      assert.ok(snapshot.env.allowlist.includes('NODE_ENV'));
    });

    it('adds custom env vars with --env-allow', () => {
      const result = runCli(['--policy', 'default', '--env-allow', 'CI', '--env-allow', 'BUILD_ID']);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.ok(snapshot.env.allowlist.includes('CI'));
      assert.ok(snapshot.env.allowlist.includes('BUILD_ID'));
    });

    it('rejects forbidden env vars', () => {
      // Trying to add PATH should be silently ignored
      const result = runCli(['--policy', 'default', '--env-allow', 'PATH']);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.ok(!snapshot.env.allowlist.includes('PATH'));
    });

    it('sets tool_id with --tool', () => {
      const result = runCli(['--tool', 'repo-state']);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.equal(snapshot.tool_id, 'repo-state');
    });

    it('sets mode in args', () => {
      const result = runCli(['--mode', 'exec']);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.equal(snapshot.args.mode, 'exec');
    });

    it('sets dry_run in args', () => {
      const result = runCli(['--dry-run']);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.equal(snapshot.args.dry_run, true);
    });

    it('includes ephemeral fields', () => {
      const result = runCli([]);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.ok(snapshot.ephemeral);
      assert.ok(snapshot.ephemeral.generated_at);
      assert.ok(snapshot.ephemeral.tool_version);
    });
  });

  describe('Intent Reference', () => {
    it('includes intent ref when --intent provided', () => {
      // Create a test intent file
      const intentFile = join(tempDir, 'intent.json');
      writeFileSync(intentFile, JSON.stringify({ goal: 'Test' }));

      const result = runCli(['--intent', intentFile, '--tool', 'pack-export'], tempDir);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.ok(snapshot.refs.intent);
      assert.ok(snapshot.refs.intent.sha256.startsWith('sha256:'));
      // Path should be relative
      assert.ok(!snapshot.refs.intent.rel_path.startsWith('/'));
    });

    it('fails when intent file does not exist', () => {
      const result = runCli(['--intent', 'nonexistent.json', '--tool', 'pack-export']);
      assert.equal(result.status, 1);
      const error = JSON.parse(result.stderr);
      assert.equal(error.ok, false);
      assert.ok(error.error.includes('not found'));
    });
  });

  describe('Pack Reference', () => {
    it('includes pack ref when --pack provided', () => {
      // Create a minimal valid pack in tempDir
      const packRelPath = 'test_pack';
      const packAbsPath = join(tempDir, packRelPath);
      mkdirSync(packAbsPath, { recursive: true });

      // Create required pack files with all necessary fields
      const runJson = {
        run_schema_version: '1.0.0',
        run_id: 'run_test_pack',
        started_at: '2026-01-06T12:00:00.000Z',
        completed_at: '2026-01-06T12:00:01.000Z',
        kernel_version: '0.1.0',
        policy: {
          name: 'default',
          allow_network: false,
          timeout_ms: 60000,
          max_output_files: 500,
          max_total_output_bytes: 52428800,
          allowed_commands: ['node', 'npm', 'npx'],
          allowed_write_roots: ['out', 'dist', 'build', 'tmp'],
        },
        intent: {
          path: 'intents/test.json',
          sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
        bundle: {
          bundle_id: 'bundle_test',
          sha256: 'sha256:70bc0e6f72af6c79e2142c81026d7b1797d78ff24086ae7b02ec557af5e53a80',
        },
        kernel_result_kind: 'BUNDLE',
        execution: null,
        decision: {
          accepted: true,
          reasons: ['Bundle produced successfully'],
          validated_by_kernel: true,
        },
        model_mode: 'none',
      };
      writeFileSync(join(packAbsPath, 'run.json'), JSON.stringify(runJson));

      const bundleJson = {
        schema_version: '1.0.0',
        status: 'complete',
        outputs: {},
        questions: [],
        terminal_nodes: [],
      };
      writeFileSync(join(packAbsPath, 'bundle.json'), JSON.stringify(bundleJson));

      // Use relative path from tempDir cwd
      const result = runCli(['--pack', packRelPath, '--tool', 'pack-apply'], tempDir);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.ok(snapshot.refs.pack);
      assert.ok(snapshot.refs.pack.pack_hash);
      assert.ok(!snapshot.refs.pack.rel_path.startsWith('/'));
    });

    it('fails when pack directory does not exist', () => {
      const result = runCli(['--pack', 'nonexistent_pack', '--tool', 'pack-apply']);
      assert.equal(result.status, 1);
      const error = JSON.parse(result.stderr);
      assert.equal(error.ok, false);
      assert.ok(error.error.includes('not found'));
    });
  });

  describe('Verify Mode', () => {
    it('verifies valid snapshot', () => {
      const validFixture = join(FIXTURES_DIR, 'valid_workspace.json');
      const result = runCli(['--verify', validFixture]);
      assert.equal(result.status, 0);
      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true);
      assert.ok(output.workspace_hash);
    });

    it('rejects invalid snapshot', () => {
      const invalidFixture = join(FIXTURES_DIR, 'invalid_missing_schema.json');
      const result = runCli(['--verify', invalidFixture]);
      assert.equal(result.status, 3); // Validation error
      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, false);
      assert.ok(output.violations.length > 0);
    });

    it('fails when file does not exist', () => {
      const result = runCli(['--verify', 'nonexistent.json']);
      assert.equal(result.status, 1); // IO error
      const error = JSON.parse(result.stderr);
      assert.equal(error.ok, false);
      assert.ok(error.error.includes('not found'));
    });

    it('fails on invalid JSON', () => {
      const badFile = join(tempDir, 'bad.json');
      writeFileSync(badFile, 'not valid json');

      const result = runCli(['--verify', badFile]);
      assert.equal(result.status, 2); // Parse error
      const error = JSON.parse(result.stderr);
      assert.equal(error.ok, false);
      assert.ok(error.error.includes('Invalid JSON'));
    });
  });

  describe('Safety', () => {
    it('safety block has correct values', () => {
      const result = runCli([]);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);
      assert.equal(snapshot.safety.work_root_rel, '.');
      assert.equal(snapshot.safety.denies_absolute, true);
      assert.equal(snapshot.safety.denies_traversal, true);
    });

    it('all paths in output are relative', () => {
      const intentFile = join(tempDir, 'intent.json');
      writeFileSync(intentFile, JSON.stringify({ goal: 'Test' }));

      const result = runCli(['--intent', intentFile, '--tool', 'pack-export'], tempDir);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);

      // Check intent path is relative
      if (snapshot.refs.intent) {
        assert.ok(!snapshot.refs.intent.rel_path.startsWith('/'));
        assert.ok(!snapshot.refs.intent.rel_path.includes('..'));
      }
    });
  });

  describe('Determinism', () => {
    it('produces identical output for same inputs', () => {
      const intentFile = join(tempDir, 'intent.json');
      writeFileSync(intentFile, JSON.stringify({ goal: 'Test' }));

      const result1 = runCli(['--intent', intentFile, '--tool', 'pack-export', '--policy', 'strict'], tempDir);
      const result2 = runCli(['--intent', intentFile, '--tool', 'pack-export', '--policy', 'strict'], tempDir);

      assert.equal(result1.status, 0);
      assert.equal(result2.status, 0);

      const snapshot1 = JSON.parse(result1.stdout);
      const snapshot2 = JSON.parse(result2.stdout);

      // Core fields should match (ephemeral may differ)
      assert.equal(snapshot1.workspace_schema_version, snapshot2.workspace_schema_version);
      assert.equal(snapshot1.tool_id, snapshot2.tool_id);
      assert.deepEqual(snapshot1.refs, snapshot2.refs);
      assert.deepEqual(snapshot1.env, snapshot2.env);
      assert.deepEqual(snapshot1.safety, snapshot2.safety);
    });

    it('output is canonical JSON', () => {
      const result = runCli([]);
      assert.equal(result.status, 0);
      const snapshot = JSON.parse(result.stdout);

      // Check keys are sorted
      const keys = Object.keys(snapshot);
      const sortedKeys = [...keys].sort();
      assert.deepEqual(keys, sortedKeys);
    });
  });

  describe('Exit Codes', () => {
    it('returns 0 on success', () => {
      const result = runCli([]);
      assert.equal(result.status, 0);
    });

    it('returns 1 on IO error', () => {
      const result = runCli(['--intent', 'nonexistent.json', '--tool', 'pack-export']);
      assert.equal(result.status, 1);
    });

    it('returns 2 on parse error', () => {
      const badFile = join(tempDir, 'bad.json');
      writeFileSync(badFile, 'not json');
      const result = runCli(['--verify', badFile]);
      assert.equal(result.status, 2);
    });

    it('returns 3 on validation error', () => {
      const invalidFixture = join(FIXTURES_DIR, 'invalid_forbidden_env.json');
      const result = runCli(['--verify', invalidFixture]);
      assert.equal(result.status, 3);
    });
  });
});
