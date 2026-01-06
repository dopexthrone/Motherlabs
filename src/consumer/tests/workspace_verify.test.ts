/**
 * Workspace Snapshot Verification Tests
 * ======================================
 *
 * Tests for WORKSPACE_SPEC.md invariants WS1-WS14.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  verifyWorkspaceSnapshot,
  computeWorkspaceCore,
  computeWorkspaceHash,
  serializeWorkspaceSnapshot,
} from '../workspace_verify.js';
import type { WorkspaceSnapshot } from '../workspace_types.js';
import { WORKSPACE_SCHEMA_VERSION, VALID_TOOL_IDS } from '../workspace_types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// When running from dist/, go back to src/ for fixtures
const FIXTURES_DIR = resolve(__dirname, '..', '..', '..', 'src', 'consumer', 'tests', 'fixtures', 'workspace');

/**
 * Load a fixture file.
 */
function loadFixture(name: string): unknown {
  const filePath = resolve(FIXTURES_DIR, name);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Create a minimal valid workspace snapshot.
 */
function createValidSnapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    workspace_schema_version: WORKSPACE_SCHEMA_VERSION,
    tool_id: 'workspace-snapshot',
    args: { policy: 'default' },
    refs: {
      policy: {
        profile: 'default',
        policy_hash: 'sha256:abc123def456789012345678901234567890123456789012345678901234abcd',
      },
    },
    env: {
      allowlist: ['LANG', 'LC_ALL', 'NODE_ENV', 'TZ'],
      hashed: [],
    },
    safety: {
      work_root_rel: '.',
      denies_absolute: true,
      denies_traversal: true,
    },
    ...overrides,
  };
}

describe('Workspace Snapshot Verification', () => {
  describe('WS1: Schema Version Present', () => {
    it('valid schema version passes', () => {
      const snapshot = createValidSnapshot();
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('missing schema version fails', () => {
      const snapshot = createValidSnapshot();
      delete (snapshot as unknown as Record<string, unknown>).workspace_schema_version;
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS1'));
    });

    it('wrong schema version fails', () => {
      const snapshot = createValidSnapshot();
      (snapshot as unknown as Record<string, unknown>).workspace_schema_version = '2.0.0';
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS1'));
    });
  });

  describe('WS2: Tool ID Valid', () => {
    it('valid tool IDs pass', () => {
      for (const toolId of VALID_TOOL_IDS) {
        const snapshot = createValidSnapshot({ tool_id: toolId });
        // Add required refs for specific tools
        if (toolId === 'pack-export') {
          snapshot.refs.intent = {
            rel_path: 'intents/test.json',
            sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          };
        } else if (toolId === 'pack-apply' || toolId === 'git-apply') {
          snapshot.refs.pack = {
            rel_path: 'packs/test',
            pack_hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          };
        }
        const result = verifyWorkspaceSnapshot(snapshot);
        assert.equal(result.valid, true, `tool_id ${toolId} should be valid`);
      }
    });

    it('invalid tool ID fails', () => {
      const snapshot = createValidSnapshot();
      (snapshot as unknown as Record<string, unknown>).tool_id = 'invalid-tool';
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS2'));
    });

    it('missing tool ID fails', () => {
      const snapshot = createValidSnapshot();
      delete (snapshot as unknown as Record<string, unknown>).tool_id;
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS2'));
    });
  });

  describe('WS3: Args Canonical', () => {
    it('sorted args pass', () => {
      const snapshot = createValidSnapshot({
        args: { alpha: 'a', beta: 'b', gamma: 'c' },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('unsorted args fail', () => {
      const snapshot = createValidSnapshot();
      // Manually construct unsorted object
      const unsortedArgs = Object.create(null);
      unsortedArgs.zebra = 'z';
      unsortedArgs.alpha = 'a';
      (snapshot as unknown as Record<string, unknown>).args = unsortedArgs;
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS3'));
    });

    it('null value in args fails', () => {
      const snapshot = createValidSnapshot({
        args: { policy: 'default', badValue: null as unknown as string },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS3'));
    });

    it('unsorted array in args fails', () => {
      const snapshot = createValidSnapshot({
        args: { policy: 'default', values: ['zebra', 'alpha', 'beta'] },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS3'));
    });

    it('sorted array in args passes', () => {
      const snapshot = createValidSnapshot({
        args: { policy: 'default', values: ['alpha', 'beta', 'zebra'] },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });
  });

  describe('WS4: All Refs Relative', () => {
    it('relative paths pass', () => {
      const snapshot = createValidSnapshot({
        refs: {
          intent: {
            rel_path: 'intents/test.json',
            sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          },
          policy: {
            profile: 'default',
            policy_hash: 'sha256:abc123def456789012345678901234567890123456789012345678901234abcd',
          },
        },
        tool_id: 'pack-export',
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('absolute path fails', () => {
      const fixture = loadFixture('invalid_absolute_path.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS4' || v.rule_id === 'WS14'));
    });

    it('path traversal fails', () => {
      const fixture = loadFixture('invalid_traversal.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS4'));
    });

    it('backslash path fails', () => {
      const fixture = loadFixture('invalid_backslash_path.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS4'));
    });

    it('Windows drive path fails', () => {
      const fixture = loadFixture('invalid_windows_path.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS4' || v.rule_id === 'WS14'));
    });
  });

  describe('WS5: Hash Format', () => {
    it('valid sha256 hashes pass', () => {
      const snapshot = createValidSnapshot();
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('invalid hash format fails', () => {
      const fixture = loadFixture('invalid_bad_hash.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS5'));
    });

    it('missing sha256 prefix fails', () => {
      const snapshot = createValidSnapshot({
        refs: {
          intent: {
            rel_path: 'test.json',
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          },
          policy: {
            profile: 'default',
            policy_hash: 'sha256:abc123def456789012345678901234567890123456789012345678901234abcd',
          },
        },
        tool_id: 'pack-export',
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS5'));
    });

    it('uppercase hex fails', () => {
      const snapshot = createValidSnapshot({
        refs: {
          intent: {
            rel_path: 'test.json',
            sha256: 'sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
          },
          policy: {
            profile: 'default',
            policy_hash: 'sha256:abc123def456789012345678901234567890123456789012345678901234abcd',
          },
        },
        tool_id: 'pack-export',
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS5'));
    });
  });

  describe('WS6: Env Allowlist Valid', () => {
    it('sorted allowlist passes', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['LANG', 'LC_ALL', 'NODE_ENV', 'TZ'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('unsorted allowlist fails', () => {
      const fixture = loadFixture('invalid_unsorted_allowlist.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('forbidden env var fails', () => {
      const fixture = loadFixture('invalid_forbidden_env.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('duplicate allowlist entries fail', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['NODE_ENV', 'NODE_ENV'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('SSH_ prefix rejected', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['NODE_ENV', 'SSH_AUTH_SOCK'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('NPM_ prefix rejected', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['NODE_ENV', 'NPM_TOKEN'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('GIT_ prefix rejected', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['GIT_TOKEN', 'NODE_ENV'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('AWS_ prefix rejected', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['AWS_SECRET_ACCESS_KEY', 'NODE_ENV'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('OPENAI_ prefix rejected', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['NODE_ENV', 'OPENAI_API_KEY'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('PATH exact match rejected', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['NODE_ENV', 'PATH'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('HOME exact match rejected', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['HOME', 'NODE_ENV'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });

    it('USER exact match rejected', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['NODE_ENV', 'USER'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS6'));
    });
  });

  describe('WS7: Env Hashed Subset', () => {
    it('hashed entries in allowlist pass', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['LANG', 'LC_ALL', 'NODE_ENV', 'TZ'],
          hashed: [
            { name: 'NODE_ENV', sha256: 'sha256:a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3' },
          ],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('hashed entry not in allowlist fails', () => {
      const fixture = loadFixture('invalid_hashed_not_in_allowlist.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS7'));
    });

    it('unsorted hashed entries fail', () => {
      const snapshot = createValidSnapshot({
        env: {
          allowlist: ['LANG', 'NODE_ENV', 'TZ'],
          hashed: [
            { name: 'TZ', sha256: 'sha256:a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3' },
            { name: 'LANG', sha256: 'sha256:b665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3' },
          ],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS7'));
    });
  });

  describe('WS8: No Plaintext Values', () => {
    it('hashed entry with value field fails', () => {
      const fixture = loadFixture('invalid_plaintext_value.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS8'));
    });
  });

  describe('WS9: Core Hash Excludes Ephemeral', () => {
    it('computeWorkspaceCore excludes ephemeral', () => {
      const snapshot = createValidSnapshot({
        ephemeral: {
          generated_at: '2026-01-06T12:00:00.000Z',
          tool_version: '0.3.15',
          human_notes: 'Test notes',
        },
      });
      const core = computeWorkspaceCore(snapshot);
      assert.ok(!('ephemeral' in core));
    });

    it('hash is same regardless of ephemeral', () => {
      const snapshot1 = createValidSnapshot();
      const snapshot2 = createValidSnapshot({
        ephemeral: {
          generated_at: '2026-01-06T12:00:00.000Z',
          tool_version: '0.3.15',
        },
      });
      const hash1 = computeWorkspaceHash(snapshot1);
      const hash2 = computeWorkspaceHash(snapshot2);
      assert.equal(hash1, hash2);
    });
  });

  describe('WS10: Canonical Round-Trip', () => {
    it('valid snapshot round-trips', () => {
      const snapshot = createValidSnapshot();
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('serialization produces canonical JSON', () => {
      const snapshot = createValidSnapshot();
      const json1 = serializeWorkspaceSnapshot(snapshot);
      const parsed = JSON.parse(json1);
      const json2 = serializeWorkspaceSnapshot(parsed as WorkspaceSnapshot);
      assert.equal(json1, json2);
    });
  });

  describe('WS11: Violations Stable', () => {
    it('violations are sorted by rule_id, path', () => {
      const snapshot = createValidSnapshot({
        tool_id: 'pack-export',
        refs: {
          intent: {
            rel_path: '/absolute/path',
            sha256: 'badhash',
          },
          policy: {
            profile: 'default',
            policy_hash: 'sha256:abc123def456789012345678901234567890123456789012345678901234abcd',
          },
        },
        env: {
          allowlist: ['PATH', 'NODE_ENV'],
          hashed: [],
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);

      // Check violations are sorted
      for (let i = 1; i < result.violations.length; i++) {
        const prev = result.violations[i - 1]!;
        const curr = result.violations[i]!;
        const ruleCompare = prev.rule_id.localeCompare(curr.rule_id);
        if (ruleCompare === 0) {
          const pathCompare = (prev.path ?? '').localeCompare(curr.path ?? '');
          assert.ok(pathCompare <= 0, `Violations not sorted: ${prev.path} > ${curr.path}`);
        } else {
          assert.ok(ruleCompare < 0, `Violations not sorted: ${prev.rule_id} > ${curr.rule_id}`);
        }
      }
    });

    it('verification is deterministic', () => {
      const snapshot = createValidSnapshot();
      const result1 = verifyWorkspaceSnapshot(snapshot);
      const result2 = verifyWorkspaceSnapshot(snapshot);
      assert.deepEqual(result1, result2);
    });
  });

  describe('WS12: Required Refs by Tool', () => {
    it('pack-export requires intent', () => {
      const fixture = loadFixture('invalid_missing_intent.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS12'));
    });

    it('pack-apply requires pack', () => {
      const fixture = loadFixture('invalid_missing_pack.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS12'));
    });

    it('git-apply requires pack', () => {
      const snapshot = createValidSnapshot({
        tool_id: 'git-apply',
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS12'));
    });

    it('repo-state requires no refs', () => {
      const snapshot = createValidSnapshot({
        tool_id: 'repo-state',
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('workspace-snapshot requires no refs', () => {
      const snapshot = createValidSnapshot({
        tool_id: 'workspace-snapshot',
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });
  });

  describe('WS13: Model IO Ref Conditional', () => {
    it('model_mode record without model_io fails', () => {
      const snapshot = createValidSnapshot({
        args: { model_mode: 'record', policy: 'default' },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS13'));
    });

    it('model_mode replay without model_io fails', () => {
      const snapshot = createValidSnapshot({
        args: { model_mode: 'replay', policy: 'default' },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS13'));
    });

    it('model_mode record with model_io passes', () => {
      const snapshot = createValidSnapshot({
        args: { model_mode: 'record', policy: 'default' },
        refs: {
          model_io: {
            rel_path: 'recordings/session.json',
            sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          },
          policy: {
            profile: 'default',
            policy_hash: 'sha256:abc123def456789012345678901234567890123456789012345678901234abcd',
          },
        },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });

    it('model_mode none without model_io passes', () => {
      const snapshot = createValidSnapshot({
        args: { model_mode: 'none', policy: 'default' },
      });
      const result = verifyWorkspaceSnapshot(snapshot);
      assert.equal(result.valid, true);
    });
  });

  describe('WS14: Leak Prevention', () => {
    it('Unix absolute path in any field fails', () => {
      const fixture = loadFixture('invalid_absolute_path.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS14' || v.rule_id === 'WS4'));
    });

    it('Windows absolute path in any field fails', () => {
      const fixture = loadFixture('invalid_windows_path.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS14' || v.rule_id === 'WS4'));
    });
  });

  describe('Fixture: Valid Workspace', () => {
    it('valid_workspace.json passes', () => {
      const fixture = loadFixture('valid_workspace.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, true);
      assert.ok(result.workspace_hash);
    });

    it('valid_workspace_full.json passes', () => {
      const fixture = loadFixture('valid_workspace_full.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, true);
      assert.ok(result.workspace_hash);
    });

    it('valid_pack_apply.json passes', () => {
      const fixture = loadFixture('valid_pack_apply.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, true);
    });

    it('valid_git_apply.json passes', () => {
      const fixture = loadFixture('valid_git_apply.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, true);
    });
  });

  describe('Fixture: Invalid Snapshots', () => {
    it('invalid_wrong_tool.json fails WS2', () => {
      const fixture = loadFixture('invalid_wrong_tool.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS2'));
    });

    it('invalid_missing_schema.json fails WS1', () => {
      const fixture = loadFixture('invalid_missing_schema.json');
      const result = verifyWorkspaceSnapshot(fixture);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'WS1'));
    });
  });

  describe('Schema Errors', () => {
    it('null input fails', () => {
      const result = verifyWorkspaceSnapshot(null);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('array input fails', () => {
      const result = verifyWorkspaceSnapshot([]);
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('empty object fails', () => {
      const result = verifyWorkspaceSnapshot({});
      assert.equal(result.valid, false);
    });

    it('string input fails', () => {
      const result = verifyWorkspaceSnapshot('not an object');
      assert.equal(result.valid, false);
      assert.ok(result.violations.some((v) => v.rule_id === 'SCHEMA'));
    });
  });

  describe('Hash Computation', () => {
    it('hash is deterministic', () => {
      const snapshot = createValidSnapshot();
      const hash1 = computeWorkspaceHash(snapshot);
      const hash2 = computeWorkspaceHash(snapshot);
      assert.equal(hash1, hash2);
    });

    it('hash uses sha256 prefix', () => {
      const snapshot = createValidSnapshot();
      const hash = computeWorkspaceHash(snapshot);
      assert.ok(hash.startsWith('sha256:'));
    });

    it('different snapshots produce different hashes', () => {
      const snapshot1 = createValidSnapshot({ args: { policy: 'strict' } });
      const snapshot2 = createValidSnapshot({ args: { policy: 'dev' } });
      const hash1 = computeWorkspaceHash(snapshot1);
      const hash2 = computeWorkspaceHash(snapshot2);
      assert.notEqual(hash1, hash2);
    });
  });
});
