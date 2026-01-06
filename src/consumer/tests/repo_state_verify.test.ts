/**
 * Repository State Verify Tests
 * ==============================
 *
 * Tests for repository state verification against REPO_STATE_SPEC.md invariants.
 * Covers RS1-RS12 invariants with fixture-based testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  verifyRepoState,
  computeRepoStateCore,
  computeRepoStateHash,
  serializeRepoState,
} from '../repo_state_verify.js';
import {
  REPO_STATE_SCHEMA_VERSION,
  NODE_VERSION_BASELINE,
} from '../repo_state_types.js';
import type { RepoState, RepoStateContracts } from '../repo_state_types.js';
import { canonicalize, verifyRoundTrip } from '../../utils/canonical.js';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Fixtures are in src/, not dist/, so resolve from project root
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures/repo_state');

// =============================================================================
// Helper: Load Fixture
// =============================================================================

async function loadFixture(name: string): Promise<unknown> {
  const path = join(FIXTURES_DIR, name);
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

// =============================================================================
// Helper: Create Valid RepoState
// =============================================================================

function createValidContracts(): RepoStateContracts {
  return {
    apply_schema_version: '1.0.0',
    bundle_schema_version: '0.1.0',
    git_apply_schema_version: '1.0.0',
    model_io_schema_version: '1.0.0',
    pack_schema_version: '1.0.0',
    patch_schema_version: '1.0.0',
    run_schema_version: '1.0.0',
  };
}

function createValidRepoState(overrides: Partial<RepoState> = {}): RepoState {
  return {
    repo_state_schema_version: REPO_STATE_SCHEMA_VERSION,
    repo_commit: 'c5e3fcc5bc857fda56e81a3aa28eff4dad497374',
    repo_dirty: false,
    dirty_paths: [],
    node_version: NODE_VERSION_BASELINE,
    npm_version: '11.6.2',
    os_platform: 'linux',
    os_arch: 'x64',
    package_lock_sha256: 'sha256:' + 'a'.repeat(64),
    contracts: createValidContracts(),
    ...overrides,
  };
}

// =============================================================================
// Tests: RS1 - Schema Version Present
// =============================================================================

describe('Repository State Verification', () => {
  describe('RS1: Schema Version Present', () => {
    it('valid schema version passes', () => {
      const state = createValidRepoState();
      const result = verifyRepoState(state);
      assert.ok(result.valid, 'Expected valid state to pass');
    });

    it('missing schema version fails', () => {
      const state = createValidRepoState();
      delete (state as any).repo_state_schema_version;
      const result = verifyRepoState(state);
      assert.ok(!result.valid, 'Expected missing schema version to fail');
      assert.ok(
        result.violations.some((v) => v.rule_id === 'RS1'),
        'Expected RS1 violation'
      );
    });

    it('wrong schema version fails', () => {
      const state = createValidRepoState({
        repo_state_schema_version: '2.0.0',
      } as any);
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS1'));
    });
  });

  // ===========================================================================
  // Tests: RS2 - Node Version Baseline
  // ===========================================================================

  describe('RS2: Node Version Baseline', () => {
    it('matching node version passes', () => {
      const state = createValidRepoState({ node_version: NODE_VERSION_BASELINE });
      const result = verifyRepoState(state);
      assert.ok(result.valid);
      assert.strictEqual(result.node_version_match, true);
    });

    it('mismatched node version flags RS2', () => {
      const state = createValidRepoState({ node_version: 'v22.0.0' });
      const result = verifyRepoState(state);
      // RS2 is a warning, not a hard failure (but it's in violations)
      assert.ok(result.violations.some((v) => v.rule_id === 'RS2'));
      assert.strictEqual(result.node_version_match, false);
    });

    it('skip node version check option works', () => {
      const state = createValidRepoState({ node_version: 'v22.0.0' });
      const result = verifyRepoState(state, { skipNodeVersionCheck: true });
      assert.ok(!result.violations.some((v) => v.rule_id === 'RS2'));
    });
  });

  // ===========================================================================
  // Tests: RS3 - Repository Commit Format
  // ===========================================================================

  describe('RS3: Repository Commit Format', () => {
    it('valid 40-hex commit passes', () => {
      const state = createValidRepoState({
        repo_commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      });
      const result = verifyRepoState(state);
      assert.ok(result.valid);
    });

    it('short commit fails', () => {
      const state = createValidRepoState({ repo_commit: 'a1b2c3d4' });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS3'));
    });

    it('HEAD string fails', () => {
      const state = createValidRepoState({ repo_commit: 'HEAD' });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS3'));
    });

    it('uppercase hex fails', () => {
      const state = createValidRepoState({
        repo_commit: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2',
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS3'));
    });
  });

  // ===========================================================================
  // Tests: RS4 - Dirty Paths Validity
  // ===========================================================================

  describe('RS4: Dirty Paths Validity', () => {
    it('empty dirty_paths passes', () => {
      const state = createValidRepoState({ dirty_paths: [] });
      const result = verifyRepoState(state);
      assert.ok(result.valid);
    });

    it('valid sorted paths pass', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['src/bar.ts', 'src/foo.ts'],
      });
      const result = verifyRepoState(state);
      assert.ok(result.valid);
    });

    it('path traversal fails', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['../escape.ts'],
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS4'));
    });

    it('duplicate paths fail', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['src/foo.ts', 'src/foo.ts'],
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS4'));
    });
  });

  // ===========================================================================
  // Tests: RS5 - Package Lock Hash Format
  // ===========================================================================

  describe('RS5: Package Lock Hash Format', () => {
    it('valid sha256 hash passes', () => {
      const state = createValidRepoState({
        package_lock_sha256: 'sha256:' + 'a'.repeat(64),
      });
      const result = verifyRepoState(state);
      assert.ok(result.valid);
    });

    it('missing prefix fails', () => {
      const state = createValidRepoState({
        package_lock_sha256: 'a'.repeat(64),
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS5'));
    });

    it('wrong algorithm fails', () => {
      const state = createValidRepoState({
        package_lock_sha256: 'md5:' + 'a'.repeat(32),
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS5'));
    });

    it('uppercase hex fails', () => {
      const state = createValidRepoState({
        package_lock_sha256: 'sha256:' + 'A'.repeat(64),
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS5'));
    });
  });

  // ===========================================================================
  // Tests: RS6 - No Absolute Paths
  // ===========================================================================

  describe('RS6: No Absolute Paths', () => {
    it('relative paths pass', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['src/foo.ts'],
      });
      const result = verifyRepoState(state);
      assert.ok(result.valid);
    });

    it('Unix absolute path fails', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['/home/user/project/src/foo.ts'],
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS6'));
    });

    it('Windows absolute path fails', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['C:\\Users\\project\\src\\foo.ts'],
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS6'));
    });
  });

  // ===========================================================================
  // Tests: RS7 - Sorted Arrays
  // ===========================================================================

  describe('RS7: Sorted Arrays', () => {
    it('sorted dirty_paths passes', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['a.ts', 'b.ts', 'c.ts'],
      });
      const result = verifyRepoState(state);
      assert.ok(result.valid);
    });

    it('unsorted dirty_paths fails', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['c.ts', 'a.ts', 'b.ts'],
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS7'));
    });
  });

  // ===========================================================================
  // Tests: RS9 - Contracts Map Validity
  // ===========================================================================

  describe('RS9: Contracts Map Validity', () => {
    it('valid contracts passes', () => {
      const state = createValidRepoState();
      const result = verifyRepoState(state);
      assert.ok(result.valid);
    });

    it('missing contract key fails', () => {
      const state = createValidRepoState();
      delete (state.contracts as any).bundle_schema_version;
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS9'));
    });

    it('empty contract value fails', () => {
      const state = createValidRepoState();
      (state.contracts as any).apply_schema_version = '';
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS9'));
    });
  });

  // ===========================================================================
  // Tests: RS10 - Core Hash Excludes Ephemeral
  // ===========================================================================

  describe('RS10: Core Hash Excludes Ephemeral', () => {
    it('computeRepoStateCore excludes ephemeral', () => {
      const state = createValidRepoState({
        ephemeral: {
          generated_at: '2026-01-06T12:00:00.000Z',
          display_branch: 'master',
        },
      });
      const core = computeRepoStateCore(state);
      assert.ok(!('ephemeral' in core), 'Core should not have ephemeral');
    });

    it('hash is same regardless of ephemeral', () => {
      const state1 = createValidRepoState({
        ephemeral: { generated_at: '2026-01-06T12:00:00.000Z' },
      });
      const state2 = createValidRepoState({
        ephemeral: { generated_at: '2026-01-07T12:00:00.000Z' },
      });
      const hash1 = computeRepoStateHash(state1);
      const hash2 = computeRepoStateHash(state2);
      assert.strictEqual(hash1, hash2, 'Hashes should match despite different ephemeral');
    });
  });

  // ===========================================================================
  // Tests: RS11 - Canonical Round-Trip
  // ===========================================================================

  describe('RS11: Canonical Round-Trip', () => {
    it('valid state round-trips', () => {
      const state = createValidRepoState();
      const canonical = serializeRepoState(state);
      const parsed = JSON.parse(canonical);
      const recanonical = canonicalize(parsed);
      assert.strictEqual(canonical, recanonical, 'Should round-trip identically');
    });

    it('verifyRoundTrip returns true for valid state', () => {
      const state = createValidRepoState();
      assert.ok(verifyRoundTrip(state));
    });
  });

  // ===========================================================================
  // Tests: Fixture-Based
  // ===========================================================================

  describe('Fixture: Valid Repo State', () => {
    it('valid_repo_state.json passes', async () => {
      const state = await loadFixture('valid_repo_state.json');
      const result = verifyRepoState(state);
      assert.ok(result.valid, `Expected valid fixture to pass: ${JSON.stringify(result.violations)}`);
    });

    it('valid_repo_state_dirty.json passes', async () => {
      const state = await loadFixture('valid_repo_state_dirty.json');
      const result = verifyRepoState(state);
      assert.ok(result.valid, `Expected valid dirty fixture to pass: ${JSON.stringify(result.violations)}`);
    });
  });

  describe('Fixture: Invalid Absolute Path', () => {
    it('invalid_absolute_path.json fails RS6', async () => {
      const state = await loadFixture('invalid_absolute_path.json');
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS6'));
    });
  });

  describe('Fixture: Invalid Unsorted Paths', () => {
    it('invalid_unsorted_paths.json fails RS7', async () => {
      const state = await loadFixture('invalid_unsorted_paths.json');
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS7'));
    });
  });

  describe('Fixture: Invalid Bad Hash', () => {
    it('invalid_bad_hash.json fails RS5', async () => {
      const state = await loadFixture('invalid_bad_hash.json');
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS5'));
    });
  });

  describe('Fixture: Invalid Bad Commit', () => {
    it('invalid_bad_commit.json fails RS3', async () => {
      const state = await loadFixture('invalid_bad_commit.json');
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS3'));
    });
  });

  describe('Fixture: Invalid Missing Schema', () => {
    it('invalid_missing_schema.json fails RS1', async () => {
      const state = await loadFixture('invalid_missing_schema.json');
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS1'));
    });
  });

  describe('Fixture: Invalid Empty Contract', () => {
    it('invalid_empty_contract.json fails RS9', async () => {
      const state = await loadFixture('invalid_empty_contract.json');
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS9'));
    });
  });

  describe('Fixture: Invalid Path Traversal', () => {
    it('invalid_path_traversal.json fails RS4', async () => {
      const state = await loadFixture('invalid_path_traversal.json');
      const result = verifyRepoState(state);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'RS4'));
    });
  });

  // ===========================================================================
  // Tests: Violation Ordering (RS8)
  // ===========================================================================

  describe('RS8: Violation Ordering', () => {
    it('violations are sorted by rule_id, path', () => {
      const state = createValidRepoState({
        repo_dirty: true,
        dirty_paths: ['/z.ts', '/a.ts'],
        repo_commit: 'invalid',
        package_lock_sha256: 'bad',
      });
      const result = verifyRepoState(state);
      assert.ok(!result.valid);

      // Check violations are sorted
      for (let i = 1; i < result.violations.length; i++) {
        const prev = result.violations[i - 1]!;
        const curr = result.violations[i]!;
        const prevKey = prev.rule_id + (prev.path ?? '');
        const currKey = curr.rule_id + (curr.path ?? '');
        assert.ok(
          prevKey <= currKey,
          `Violations should be sorted: ${prevKey} <= ${currKey}`
        );
      }
    });
  });

  // ===========================================================================
  // Tests: Schema Errors
  // ===========================================================================

  describe('Schema Errors', () => {
    it('null input fails', () => {
      const result = verifyRepoState(null);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('array input fails', () => {
      const result = verifyRepoState([]);
      assert.ok(!result.valid);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('missing required fields fails', () => {
      const result = verifyRepoState({});
      assert.ok(!result.valid);
    });
  });

  // ===========================================================================
  // Tests: Hash Computation
  // ===========================================================================

  describe('Hash Computation', () => {
    it('hash is deterministic', () => {
      const state = createValidRepoState();
      const hash1 = computeRepoStateHash(state);
      const hash2 = computeRepoStateHash(state);
      assert.strictEqual(hash1, hash2);
    });

    it('hash uses sha256 prefix', () => {
      const state = createValidRepoState();
      const hash = computeRepoStateHash(state);
      assert.ok(hash.startsWith('sha256:'));
    });

    it('different state produces different hash', () => {
      const state1 = createValidRepoState({ repo_commit: 'a'.repeat(40) });
      const state2 = createValidRepoState({ repo_commit: 'b'.repeat(40) });
      const hash1 = computeRepoStateHash(state1);
      const hash2 = computeRepoStateHash(state2);
      assert.notStrictEqual(hash1, hash2);
    });
  });
});
