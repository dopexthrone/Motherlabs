/**
 * Patch Verify Tests
 * ==================
 *
 * Tests for patch verification against PATCH_SPEC.md invariants.
 * Covers PS1-PS10 invariants with fixture-based testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyPatch } from '../patch_verify.js';
import { PATCH_SCHEMA_VERSION } from '../patch_types.js';
import type { PatchSet, PatchOperation } from '../patch_types.js';
import { canonicalize } from '../../utils/canonical.js';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Fixtures are in src/, not dist/, so resolve from project root
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures');

// =============================================================================
// Helper: Load Fixture
// =============================================================================

async function loadFixture(name: string): Promise<unknown> {
  const path = join(FIXTURES_DIR, name);
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

// =============================================================================
// Helper: Create Valid PatchSet
// =============================================================================

function createValidPatch(overrides: Partial<PatchSet> = {}): PatchSet {
  return {
    patch_schema_version: PATCH_SCHEMA_VERSION,
    source_proposal_id: 'prop_test123',
    source_proposal_hash: 'sha256:' + 'a'.repeat(64),
    operations: [
      {
        op: 'create',
        path: 'src/test.ts',
        content: 'export const x = 1;\n',
        size_bytes: 20,
        order: 0,
      },
    ],
    total_bytes: 20,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Patch Verification', () => {
  describe('PS1: Schema Version Present', () => {
    it('valid schema version passes', () => {
      const patch = createValidPatch();
      const result = verifyPatch(patch);
      assert.ok(result.ok, 'Expected valid patch to pass');
    });

    it('missing schema version fails', () => {
      const patch = createValidPatch();
      delete (patch as any).patch_schema_version;
      const result = verifyPatch(patch);
      assert.ok(!result.ok, 'Expected missing schema version to fail');
      assert.ok(
        result.violations?.some((v) => v.rule_id === 'PS1'),
        'Expected PS1 violation'
      );
    });

    it('empty schema version fails', () => {
      const patch = createValidPatch({ patch_schema_version: '' });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS1'));
    });
  });

  describe('PS2: Op Enum Valid', () => {
    it('create op passes', () => {
      const patch = createValidPatch();
      const result = verifyPatch(patch);
      assert.ok(result.ok);
    });

    it('modify op passes', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'modify', path: 'src/test.ts', content: 'updated', size_bytes: 7, order: 0 },
        ],
        total_bytes: 7,
      });
      const result = verifyPatch(patch);
      assert.ok(result.ok);
    });

    it('delete op passes', () => {
      const patch = createValidPatch({
        operations: [{ op: 'delete', path: 'src/test.ts', order: 0 }],
        total_bytes: 0,
      });
      const result = verifyPatch(patch);
      assert.ok(result.ok);
    });

    it('invalid op fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'rename' as any, path: 'src/test.ts', content: '', size_bytes: 0, order: 0 },
        ],
        total_bytes: 0,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS2'));
    });
  });

  describe('PS3: Path Relative Only', () => {
    it('relative path passes', () => {
      const patch = createValidPatch();
      const result = verifyPatch(patch);
      assert.ok(result.ok);
    });

    it('absolute path fails', async () => {
      const patch = await loadFixture('patch_invalid_absolute_path.json');
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS3'));
    });

    it('Windows drive path fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'C:\\Users\\test.txt', content: 'hi', size_bytes: 2, order: 0 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS3'));
    });
  });

  describe('PS4: No Path Traversal', () => {
    it('normal path passes', () => {
      const patch = createValidPatch();
      const result = verifyPatch(patch);
      assert.ok(result.ok);
    });

    it('traversal path fails', async () => {
      const patch = await loadFixture('patch_invalid_traversal.json');
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS4'));
    });

    it('backslash path fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'src\\test.ts', content: 'hi', size_bytes: 2, order: 0 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS4'));
    });

    it('dot-slash path fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: './src/test.ts', content: 'hi', size_bytes: 2, order: 0 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS4'));
    });

    it('double-slash path fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'src//test.ts', content: 'hi', size_bytes: 2, order: 0 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS4'));
    });

    it('trailing slash path fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'src/dir/', content: 'hi', size_bytes: 2, order: 0 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS4'));
    });
  });

  describe('PS5: No Duplicate Targets', () => {
    it('unique paths pass', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'src/a.ts', content: 'a', size_bytes: 1, order: 0 },
          { op: 'create', path: 'src/b.ts', content: 'b', size_bytes: 1, order: 1 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(result.ok);
    });

    it('duplicate paths fail', async () => {
      const patch = await loadFixture('patch_invalid_duplicate_paths.json');
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS5'));
    });
  });

  describe('PS6: Text Only UTF-8', () => {
    it('valid UTF-8 passes', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'test.ts', content: 'hello world\n', size_bytes: 12, order: 0 },
        ],
        total_bytes: 12,
      });
      const result = verifyPatch(patch);
      assert.ok(result.ok);
    });

    it('null bytes fail', async () => {
      const patch = await loadFixture('patch_invalid_binary_like.json');
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS6'));
    });

    it('delete with content fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'delete', path: 'test.ts', content: 'should not exist', order: 0 } as any,
        ],
        total_bytes: 0,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS6'));
    });

    it('create without content fails', () => {
      const patch = createValidPatch({
        operations: [{ op: 'create', path: 'test.ts', order: 0 } as any],
        total_bytes: 0,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS6'));
    });
  });

  describe('PS7: Max Bytes Enforced', () => {
    it('within limit passes', () => {
      const patch = createValidPatch();
      const result = verifyPatch(patch, { maxTotalBytes: 1000 });
      assert.ok(result.ok);
    });

    it('exceeds limit fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'test.ts', content: 'x'.repeat(100), size_bytes: 100, order: 0 },
        ],
        total_bytes: 100,
      });
      const result = verifyPatch(patch, { maxTotalBytes: 50 });
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS7'));
    });

    it('mismatched total_bytes fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'test.ts', content: 'hello', size_bytes: 5, order: 0 },
        ],
        total_bytes: 100, // Wrong!
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS7'));
    });
  });

  describe('PS8: Sorting Canonical', () => {
    it('properly sorted passes', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'a.ts', content: 'a', size_bytes: 1, order: 0 },
          { op: 'create', path: 'b.ts', content: 'b', size_bytes: 1, order: 1 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(result.ok);
    });

    it('unsorted by order fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'a.ts', content: 'a', size_bytes: 1, order: 2 },
          { op: 'create', path: 'b.ts', content: 'b', size_bytes: 1, order: 1 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS8'));
    });

    it('unsorted by path (same order) fails', () => {
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: 'z.ts', content: 'z', size_bytes: 1, order: 0 },
          { op: 'create', path: 'a.ts', content: 'a', size_bytes: 1, order: 0 },
        ],
        total_bytes: 2,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS8'));
    });
  });

  describe('PS9: No Symlink Intent', () => {
    it('symlink op fails', () => {
      const patch = createValidPatch({
        operations: [{ op: 'symlink' as any, path: 'link.ts', order: 0 }],
        total_bytes: 0,
      });
      const result = verifyPatch(patch);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'PS9'));
    });
  });

  describe('PS10: Stable Violations', () => {
    it('violations are sorted by rule_id then path', () => {
      // Create patch with multiple violations
      const patch = createValidPatch({
        operations: [
          { op: 'create', path: '/absolute', content: 'x', size_bytes: 1, order: 1 }, // PS3
          { op: 'create', path: '../traversal', content: 'x', size_bytes: 1, order: 0 }, // PS4
        ],
        total_bytes: 2,
      });
      const result1 = verifyPatch(patch);
      const result2 = verifyPatch(patch);

      assert.ok(!result1.ok && !result2.ok);

      // Violations should be in same order
      const json1 = canonicalize(result1);
      const json2 = canonicalize(result2);
      assert.strictEqual(json1, json2, 'Violations should be deterministically sorted');
    });
  });

  describe('Fixture: Valid Patch', () => {
    it('valid fixture passes all checks', async () => {
      const patch = await loadFixture('patch_valid.json');
      const result = verifyPatch(patch);
      assert.ok(result.ok, `Expected valid patch to pass: ${JSON.stringify(result)}`);
    });
  });

  describe('Schema Errors', () => {
    it('null input fails', () => {
      const result = verifyPatch(null);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('array input fails', () => {
      const result = verifyPatch([]);
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('missing required fields fails', () => {
      const result = verifyPatch({});
      assert.ok(!result.ok);
      assert.ok(result.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });
  });
});
