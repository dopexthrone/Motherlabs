/**
 * Runner Verification Tests
 * =========================
 *
 * Tests for RUNNER_SPEC.md invariants RN1-RN12.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  verifyRunner,
  computeRunnerCore,
  computeRunnerHash,
  serializeRunner,
} from '../runner_verify.js';
import type { Runner } from '../runner_types.js';
import {
  RUNNER_SCHEMA_VERSION,
  VALID_OS,
  VALID_ARCH,
  VALID_SANDBOX_BACKENDS,
  VALID_ISOLATION_LEVELS,
} from '../runner_types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// When running from dist/, go back to src/ for fixtures
const FIXTURES_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'consumer',
  'tests',
  'fixtures',
  'runner'
);

/**
 * Load a fixture file.
 */
function loadFixture(name: string): unknown {
  const filePath = resolve(FIXTURES_DIR, name);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Create a minimal valid runner.
 */
function createValidRunner(overrides: Partial<Runner> = {}): Runner {
  return {
    runner_schema_version: RUNNER_SCHEMA_VERSION,
    runner_id: 'runner_20260106_120000_abc123',
    runner_version: '0.3.15',
    platform: {
      os: 'linux',
      arch: 'x64',
      node_version: 'v24.11.1',
      npm_version: '10.9.2',
    },
    sandbox: {
      backend: 'process',
      isolation_level: 'standard',
      network_blocked: true,
      filesystem_readonly: false,
    },
    limits: {
      timeout_ms: 60000,
      max_output_files: 500,
      max_total_output_bytes: 52428800,
    },
    commands: {
      allowlist: ['node', 'npm', 'npx'],
      blocklist: [],
      shell: '/bin/sh',
    },
    write_roots: ['build', 'dist', 'out', 'tmp'],
    context: {
      working_dir: '.',
      env_allowlist: ['LANG', 'LC_ALL', 'NODE_ENV', 'TZ'],
      locale: 'en_US.UTF-8',
      timezone: 'UTC',
    },
    timing: {
      started_at: '2026-01-06T12:00:00.000Z',
      completed_at: '2026-01-06T12:00:05.000Z',
      duration_ms: 5000,
    },
    exit: {
      code: 0,
      oom_killed: false,
      timeout_killed: false,
    },
    ...overrides,
  };
}

describe('Runner Verification', () => {
  describe('RN1: Schema Version Present', () => {
    it('valid schema version passes', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('missing schema version fails', () => {
      const runner = createValidRunner();
      delete (runner as unknown as Record<string, unknown>).runner_schema_version;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN1'));
    });

    it('wrong schema version fails', () => {
      const runner = createValidRunner();
      (runner as unknown as Record<string, unknown>).runner_schema_version = '2.0.0';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN1'));
    });

    it('empty schema version fails', () => {
      const runner = createValidRunner();
      (runner as unknown as Record<string, unknown>).runner_schema_version = '';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN1'));
    });
  });

  describe('RN2: Runner Identity Valid', () => {
    it('valid runner_id passes', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('invalid runner_id format fails', () => {
      const runner = createValidRunner();
      (runner as unknown as Record<string, unknown>).runner_id = 'bad_format';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN2'));
    });

    it('empty runner_id fails', () => {
      const runner = createValidRunner();
      (runner as unknown as Record<string, unknown>).runner_id = '';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN2'));
    });

    it('empty runner_version fails', () => {
      const runner = createValidRunner();
      (runner as unknown as Record<string, unknown>).runner_version = '';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN2'));
    });
  });

  describe('RN3: Platform Complete', () => {
    it('valid platform passes', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('all valid OS values pass', () => {
      for (const os of VALID_OS) {
        const runner = createValidRunner();
        runner.platform.os = os;
        const result = verifyRunner(runner);
        assert.equal(result.valid, true, `OS ${os} should be valid`);
      }
    });

    it('all valid arch values pass', () => {
      for (const arch of VALID_ARCH) {
        const runner = createValidRunner();
        runner.platform.arch = arch;
        const result = verifyRunner(runner);
        assert.equal(result.valid, true, `Arch ${arch} should be valid`);
      }
    });

    it('invalid OS fails', () => {
      const runner = createValidRunner();
      runner.platform.os = 'freebsd';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN3'));
    });

    it('invalid arch fails', () => {
      const runner = createValidRunner();
      runner.platform.arch = 'riscv64';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN3'));
    });

    it('node_version without v prefix fails', () => {
      const runner = createValidRunner();
      runner.platform.node_version = '24.11.1';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN3'));
    });
  });

  describe('RN4: Sandbox Configuration Valid', () => {
    it('valid sandbox configurations pass', () => {
      for (const backend of VALID_SANDBOX_BACKENDS) {
        for (const level of VALID_ISOLATION_LEVELS) {
          // Skip invalid combo: none isolation requires none backend
          if (level === 'none' && backend !== 'none') continue;

          const runner = createValidRunner();
          runner.sandbox.backend = backend;
          runner.sandbox.isolation_level = level;
          const result = verifyRunner(runner);
          assert.equal(result.valid, true, `backend=${backend}, level=${level} should be valid`);
        }
      }
    });

    it('isolation_level none with non-none backend fails', () => {
      const runner = createValidRunner();
      runner.sandbox.backend = 'process';
      runner.sandbox.isolation_level = 'none';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN4'));
    });

    it('invalid backend fails', () => {
      const runner = createValidRunner();
      (runner.sandbox as unknown as Record<string, unknown>).backend = 'docker';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN4'));
    });

    it('non-boolean network_blocked fails', () => {
      const runner = createValidRunner();
      (runner.sandbox as unknown as Record<string, unknown>).network_blocked = 'true';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN4'));
    });
  });

  describe('RN5: Limits Within Bounds', () => {
    it('valid limits pass', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('timeout_ms too low fails', () => {
      const runner = createValidRunner();
      runner.limits.timeout_ms = 100;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN5'));
    });

    it('timeout_ms too high fails', () => {
      const runner = createValidRunner();
      runner.limits.timeout_ms = 1000000;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN5'));
    });

    it('max_output_files too low fails', () => {
      const runner = createValidRunner();
      runner.limits.max_output_files = 0;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN5'));
    });

    it('max_total_output_bytes too low fails', () => {
      const runner = createValidRunner();
      runner.limits.max_total_output_bytes = 512;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN5'));
    });

    it('negative max_memory_bytes fails', () => {
      const runner = createValidRunner();
      runner.limits.max_memory_bytes = -1;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN5'));
    });

    it('zero max_cpu_seconds fails', () => {
      const runner = createValidRunner();
      runner.limits.max_cpu_seconds = 0;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN5'));
    });

    it('valid optional limits pass', () => {
      const runner = createValidRunner();
      runner.limits.max_memory_bytes = 1073741824;
      runner.limits.max_cpu_seconds = 60;
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });
  });

  describe('RN6: Commands Canonical', () => {
    it('valid commands pass', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('unsorted allowlist fails', () => {
      const runner = createValidRunner();
      runner.commands.allowlist = ['npm', 'node', 'npx'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN6'));
    });

    it('unsorted blocklist fails', () => {
      const runner = createValidRunner();
      runner.commands.blocklist = ['rm', 'dd'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN6'));
    });

    it('overlapping allowlist and blocklist fails', () => {
      const runner = createValidRunner();
      runner.commands.allowlist = ['node', 'npm'];
      runner.commands.blocklist = ['npm', 'rm'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN6'));
    });

    it('empty shell fails', () => {
      const runner = createValidRunner();
      runner.commands.shell = '';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN6'));
    });
  });

  describe('RN7: Write Roots Valid', () => {
    it('valid write_roots pass', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('unsorted write_roots fails', () => {
      const runner = createValidRunner();
      runner.write_roots = ['tmp', 'dist', 'build'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN7'));
    });

    it('absolute path in write_roots fails', () => {
      const runner = createValidRunner();
      runner.write_roots = ['/tmp', 'dist'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN7'));
    });

    it('path traversal in write_roots fails', () => {
      const runner = createValidRunner();
      runner.write_roots = ['../parent', 'dist'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN7'));
    });

    it('empty write_roots passes', () => {
      const runner = createValidRunner();
      runner.write_roots = [];
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });
  });

  describe('RN8: Context Safe', () => {
    it('valid context passes', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('non-dot working_dir fails', () => {
      const runner = createValidRunner();
      (runner.context as unknown as Record<string, unknown>).working_dir = '/tmp';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN8'));
    });

    it('unsorted env_allowlist fails', () => {
      const runner = createValidRunner();
      runner.context.env_allowlist = ['TZ', 'LANG'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN8'));
    });

    it('forbidden env prefix fails', () => {
      const runner = createValidRunner();
      runner.context.env_allowlist = ['ANTHROPIC_API_KEY', 'LANG'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN8'));
    });

    it('SSH_ prefix fails', () => {
      const runner = createValidRunner();
      runner.context.env_allowlist = ['SSH_AUTH_SOCK'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN8'));
    });

    it('AWS_ prefix fails', () => {
      const runner = createValidRunner();
      runner.context.env_allowlist = ['AWS_SECRET_KEY'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN8'));
    });
  });

  describe('RN9: Timing Consistent', () => {
    it('valid timing passes', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('completed_at before started_at fails', () => {
      const runner = createValidRunner();
      runner.timing.started_at = '2026-01-06T12:00:05.000Z';
      runner.timing.completed_at = '2026-01-06T12:00:00.000Z';
      runner.timing.duration_ms = 5000;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN9'));
    });

    it('duration_ms mismatch fails', () => {
      const runner = createValidRunner();
      runner.timing.duration_ms = 10000; // Should be 5000
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN9'));
    });

    it('invalid ISO 8601 timestamp fails', () => {
      const runner = createValidRunner();
      runner.timing.started_at = '2026-01-06 12:00:00';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN9'));
    });

    it('valid phases pass', () => {
      const runner = createValidRunner();
      runner.timing.phases = [
        { name: 'setup', started_at: '2026-01-06T12:00:00.000Z', duration_ms: 1000 },
        { name: 'execute', started_at: '2026-01-06T12:00:01.000Z', duration_ms: 3000 },
        { name: 'teardown', started_at: '2026-01-06T12:00:04.000Z', duration_ms: 1000 },
      ];
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('unsorted phases fail', () => {
      const runner = createValidRunner();
      runner.timing.phases = [
        { name: 'teardown', started_at: '2026-01-06T12:00:04.000Z', duration_ms: 1000 },
        { name: 'setup', started_at: '2026-01-06T12:00:00.000Z', duration_ms: 1000 },
      ];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN9'));
    });

    it('skipTimingValidation option works', () => {
      const runner = createValidRunner();
      runner.timing.duration_ms = 99999; // Wrong but should be skipped
      const result = verifyRunner(runner, { skipTimingValidation: true });
      assert.equal(result.valid, true);
    });
  });

  describe('RN10: Exit Status Valid', () => {
    it('valid exit status passes', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('exit code > 255 fails', () => {
      const runner = createValidRunner();
      runner.exit.code = 256;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN10'));
    });

    it('exit code < 0 fails', () => {
      const runner = createValidRunner();
      runner.exit.code = -1;
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN10'));
    });

    it('lowercase signal fails', () => {
      const runner = createValidRunner();
      runner.exit.signal = 'sigterm';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN10'));
    });

    it('uppercase signal passes', () => {
      const runner = createValidRunner();
      runner.exit.signal = 'SIGTERM';
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('non-boolean oom_killed fails', () => {
      const runner = createValidRunner();
      (runner.exit as unknown as Record<string, unknown>).oom_killed = 'false';
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN10'));
    });
  });

  describe('RN11: Core Hash Excludes Ephemeral', () => {
    it('ephemeral fields excluded from core', () => {
      const runner = createValidRunner();
      runner.ephemeral = {
        host_id: 'test-host',
        session_id: 'test-session',
        human_notes: 'Test notes',
      };

      const core = computeRunnerCore(runner);
      assert.equal('ephemeral' in core, false);
      assert.equal('timing' in core, false);
    });

    it('same runner with different ephemeral has same hash', () => {
      const runner1 = createValidRunner();
      runner1.ephemeral = { host_id: 'host1' };

      const runner2 = createValidRunner();
      runner2.ephemeral = { host_id: 'host2' };

      const hash1 = computeRunnerHash(runner1);
      const hash2 = computeRunnerHash(runner2);
      assert.equal(hash1, hash2);
    });
  });

  describe('RN12: Canonical Round-Trip', () => {
    it('valid runner survives round-trip', () => {
      const runner = createValidRunner();
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });
  });

  describe('Fixture Tests', () => {
    it('valid_basic.json passes', () => {
      const runner = loadFixture('valid_basic.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
      assert.ok(result.runner_hash);
    });

    it('valid_with_phases.json passes', () => {
      const runner = loadFixture('valid_with_phases.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
      assert.ok(result.runner_hash);
    });

    it('valid_with_ephemeral.json passes', () => {
      const runner = loadFixture('valid_with_ephemeral.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
      assert.ok(result.runner_hash);
    });

    it('valid_no_isolation.json passes', () => {
      const runner = loadFixture('valid_no_isolation.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
      assert.ok(result.runner_hash);
    });

    it('invalid_rn1_schema_version.json fails with RN1', () => {
      const runner = loadFixture('invalid_rn1_schema_version.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN1'));
    });

    it('invalid_rn2_runner_id.json fails with RN2', () => {
      const runner = loadFixture('invalid_rn2_runner_id.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN2'));
    });

    it('invalid_rn3_platform.json fails with RN3', () => {
      const runner = loadFixture('invalid_rn3_platform.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN3'));
    });

    it('invalid_rn4_sandbox.json fails with RN4', () => {
      const runner = loadFixture('invalid_rn4_sandbox.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN4'));
    });

    it('invalid_rn5_limits.json fails with RN5', () => {
      const runner = loadFixture('invalid_rn5_limits.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN5'));
    });

    it('invalid_rn6_commands.json fails with RN6', () => {
      const runner = loadFixture('invalid_rn6_commands.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN6'));
    });

    it('invalid_rn7_write_roots.json fails with RN7', () => {
      const runner = loadFixture('invalid_rn7_write_roots.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN7'));
    });

    it('invalid_rn8_context.json fails with RN8', () => {
      const runner = loadFixture('invalid_rn8_context.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN8'));
    });

    it('invalid_rn9_timing.json fails with RN9', () => {
      const runner = loadFixture('invalid_rn9_timing.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN9'));
    });

    it('invalid_rn10_exit.json fails with RN10', () => {
      const runner = loadFixture('invalid_rn10_exit.json');
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'RN10'));
    });
  });

  describe('Schema Validation', () => {
    it('non-object input fails', () => {
      const result = verifyRunner('not an object');
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('null input fails', () => {
      const result = verifyRunner(null);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('array input fails', () => {
      const result = verifyRunner([]);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });
  });

  describe('Serialization', () => {
    it('serializeRunner produces canonical JSON', () => {
      const runner = createValidRunner();
      const serialized = serializeRunner(runner);
      const parsed = JSON.parse(serialized);

      // Keys should be sorted
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      assert.deepEqual(keys, sortedKeys);
    });
  });

  describe('Hash Consistency', () => {
    it('identical runners produce identical hashes', () => {
      const runner1 = createValidRunner();
      const runner2 = createValidRunner();
      const hash1 = computeRunnerHash(runner1);
      const hash2 = computeRunnerHash(runner2);
      assert.equal(hash1, hash2);
    });

    it('different runners produce different hashes', () => {
      const runner1 = createValidRunner();
      const runner2 = createValidRunner();
      runner2.runner_id = 'runner_20260106_120001_xyz789';
      const hash1 = computeRunnerHash(runner1);
      const hash2 = computeRunnerHash(runner2);
      assert.notEqual(hash1, hash2);
    });

    it('hash format is sha256:hex64', () => {
      const runner = createValidRunner();
      const hash = computeRunnerHash(runner);
      assert.match(hash, /^sha256:[0-9a-f]{64}$/);
    });
  });

  describe('Warnings', () => {
    it('sorted warnings pass', () => {
      const runner = createValidRunner();
      runner.warnings = ['a warning', 'b warning'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, true);
    });

    it('unsorted warnings fail', () => {
      const runner = createValidRunner();
      runner.warnings = ['z warning', 'a warning'];
      const result = verifyRunner(runner);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });
  });
});
