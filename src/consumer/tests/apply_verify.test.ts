/**
 * Apply Verify Tests
 * ==================
 *
 * Tests for apply result verification against APPLY_SPEC.md invariants.
 * Covers AS1-AS12 invariants with fixture-based testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyApplyResult } from '../apply_verify.js';
import { APPLY_SCHEMA_VERSION } from '../apply_types.js';
import type { ApplyResult, ApplyOperationResult, ApplySummary } from '../apply_types.js';
import { canonicalize } from '../../utils/canonical.js';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Fixtures are in src/, not dist/, so resolve from project root
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures/apply');

// =============================================================================
// Helper: Load Fixture
// =============================================================================

async function loadFixture(name: string): Promise<unknown> {
  const path = join(FIXTURES_DIR, name);
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

// =============================================================================
// Helper: Create Valid ApplyResult
// =============================================================================

function createValidApplyResult(overrides: Partial<ApplyResult> = {}): ApplyResult {
  const operations: ApplyOperationResult[] = [
    {
      op: 'create',
      path: 'src/test.ts',
      status: 'success',
      before_hash: null,
      after_hash: 'sha256:' + 'a'.repeat(64),
      bytes_written: 20,
    },
  ];

  const summary: ApplySummary = {
    total_operations: 1,
    succeeded: 1,
    skipped: 0,
    failed: 0,
    total_bytes_written: 20,
  };

  return {
    apply_schema_version: APPLY_SCHEMA_VERSION,
    outcome: 'SUCCESS',
    dry_run: false,
    target_root: 'workspace',
    patch_source: {
      proposal_id: 'prop_test123',
      proposal_hash: 'sha256:' + 'b'.repeat(64),
    },
    operation_results: operations,
    summary,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Apply Result Verification', () => {
  describe('AS1: Schema Version Present', () => {
    it('valid schema version passes', () => {
      const result = createValidApplyResult();
      const verify = verifyApplyResult(result);
      assert.ok(verify.ok, 'Expected valid result to pass');
    });

    it('missing schema version fails', () => {
      const result = createValidApplyResult();
      delete (result as any).apply_schema_version;
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok, 'Expected missing schema version to fail');
      assert.ok(
        verify.violations?.some((v) => v.rule_id === 'AS1'),
        'Expected AS1 violation'
      );
    });

    it('empty schema version fails', () => {
      const result = createValidApplyResult({ apply_schema_version: '' });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS1'));
    });
  });

  describe('AS2: Deterministic Ordering', () => {
    it('properly sorted operations pass', () => {
      const result = createValidApplyResult({
        operation_results: [
          { op: 'create', path: 'a.ts', status: 'success', before_hash: null, after_hash: 'sha256:' + 'a'.repeat(64), bytes_written: 10 },
          { op: 'create', path: 'b.ts', status: 'success', before_hash: null, after_hash: 'sha256:' + 'b'.repeat(64), bytes_written: 10 },
        ],
        summary: { total_operations: 2, succeeded: 2, skipped: 0, failed: 0, total_bytes_written: 20 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(verify.ok);
    });

    it('unsorted operations fail', async () => {
      const result = await loadFixture('invalid_apply_unsorted_ops.json');
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS2'));
    });

    it('properly sorted violations pass', () => {
      const result = createValidApplyResult({
        outcome: 'REFUSED',
        violations: [
          { rule_id: 'AS1', message: 'first' },
          { rule_id: 'AS2', path: 'a.ts', message: 'second' },
          { rule_id: 'AS2', path: 'b.ts', message: 'third' },
        ],
        error: 'test error',
      });
      const verify = verifyApplyResult(result);
      // Should still pass AS2 ordering check even though it has violations
      const hasAS2Ordering = verify.ok || !verify.violations?.some((v) => v.rule_id === 'AS2');
      assert.ok(hasAS2Ordering);
    });

    it('unsorted violations fail', () => {
      const result = createValidApplyResult({
        outcome: 'REFUSED',
        violations: [
          { rule_id: 'AS2', message: 'should be second' },
          { rule_id: 'AS1', message: 'should be first' },
        ],
        error: 'test error',
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS2'));
    });
  });

  describe('AS7: Hashes Present (sha256: format)', () => {
    it('valid sha256 hashes pass', () => {
      const result = createValidApplyResult();
      const verify = verifyApplyResult(result);
      assert.ok(verify.ok);
    });

    it('null hashes pass', () => {
      const result = createValidApplyResult({
        operation_results: [
          { op: 'delete', path: 'test.ts', status: 'success', before_hash: 'sha256:' + 'a'.repeat(64), after_hash: null, bytes_written: 0 },
        ],
        summary: { total_operations: 1, succeeded: 1, skipped: 0, failed: 0, total_bytes_written: 0 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(verify.ok);
    });

    it('invalid hash format fails', async () => {
      const result = await loadFixture('invalid_apply_bad_hash.json');
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS7'));
    });

    it('md5 hash fails', () => {
      const result = createValidApplyResult({
        operation_results: [
          { op: 'create', path: 'test.ts', status: 'success', before_hash: null, after_hash: 'md5:' + 'a'.repeat(32), bytes_written: 10 },
        ],
        summary: { total_operations: 1, succeeded: 1, skipped: 0, failed: 0, total_bytes_written: 10 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS7'));
    });

    it('truncated hash fails', () => {
      const result = createValidApplyResult({
        operation_results: [
          { op: 'create', path: 'test.ts', status: 'success', before_hash: null, after_hash: 'sha256:' + 'a'.repeat(32), bytes_written: 10 },
        ],
        summary: { total_operations: 1, succeeded: 1, skipped: 0, failed: 0, total_bytes_written: 10 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS7'));
    });
  });

  describe('AS9: Stable Error Codes', () => {
    it('FAILED outcome with error message passes', () => {
      const result = createValidApplyResult({
        outcome: 'FAILED',
        operation_results: [
          { op: 'create', path: 'test.ts', status: 'error', before_hash: null, after_hash: null, bytes_written: 0, error: 'file already exists' },
        ],
        summary: { total_operations: 1, succeeded: 0, skipped: 0, failed: 1, total_bytes_written: 0 },
        error: '1 operations failed',
      });
      const verify = verifyApplyResult(result);
      assert.ok(verify.ok);
    });

    it('FAILED outcome without error message fails', () => {
      const result = createValidApplyResult({
        outcome: 'FAILED',
        operation_results: [
          { op: 'create', path: 'test.ts', status: 'error', before_hash: null, after_hash: null, bytes_written: 0, error: 'file already exists' },
        ],
        summary: { total_operations: 1, succeeded: 0, skipped: 0, failed: 1, total_bytes_written: 0 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS9'));
    });

    it('REFUSED outcome without error message fails', () => {
      const result = createValidApplyResult({
        outcome: 'REFUSED',
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS9'));
    });

    it('operation error without error message fails', () => {
      const result = createValidApplyResult({
        outcome: 'FAILED',
        operation_results: [
          { op: 'create', path: 'test.ts', status: 'error', before_hash: null, after_hash: null, bytes_written: 0 },
        ],
        summary: { total_operations: 1, succeeded: 0, skipped: 0, failed: 1, total_bytes_written: 0 },
        error: '1 operations failed',
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS9'));
    });
  });

  describe('AS12: No Absolute Path Leakage', () => {
    it('relative paths pass', () => {
      const result = createValidApplyResult();
      const verify = verifyApplyResult(result);
      assert.ok(verify.ok);
    });

    it('absolute target_root fails', async () => {
      const result = await loadFixture('invalid_apply_absolute_path.json');
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS12'));
    });

    it('absolute operation path fails', () => {
      const result = createValidApplyResult({
        operation_results: [
          { op: 'create', path: '/absolute/path/test.ts', status: 'success', before_hash: null, after_hash: 'sha256:' + 'a'.repeat(64), bytes_written: 10 },
        ],
        summary: { total_operations: 1, succeeded: 1, skipped: 0, failed: 0, total_bytes_written: 10 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'AS12'));
    });
  });

  describe('Summary Consistency', () => {
    it('matching summary passes', () => {
      const result = createValidApplyResult();
      const verify = verifyApplyResult(result);
      assert.ok(verify.ok);
    });

    it('mismatched total_operations fails', () => {
      const result = createValidApplyResult({
        summary: { total_operations: 5, succeeded: 1, skipped: 0, failed: 0, total_bytes_written: 20 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('mismatched succeeded count fails', () => {
      const result = createValidApplyResult({
        summary: { total_operations: 1, succeeded: 5, skipped: 0, failed: 0, total_bytes_written: 20 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('mismatched bytes_written fails', () => {
      const result = createValidApplyResult({
        summary: { total_operations: 1, succeeded: 1, skipped: 0, failed: 0, total_bytes_written: 100 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });
  });

  describe('Fixture: Valid Apply Result', () => {
    it('valid fixture passes all checks', async () => {
      const result = await loadFixture('valid_apply_result.json');
      const verify = verifyApplyResult(result);
      assert.ok(verify.ok, `Expected valid result to pass: ${JSON.stringify(verify)}`);
    });
  });

  describe('Schema Errors', () => {
    it('null input fails', () => {
      const verify = verifyApplyResult(null);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('array input fails', () => {
      const verify = verifyApplyResult([]);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('missing required fields fails', () => {
      const verify = verifyApplyResult({});
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('invalid outcome fails', () => {
      const result = createValidApplyResult({ outcome: 'UNKNOWN' as any });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('invalid dry_run type fails', () => {
      const result = createValidApplyResult({ dry_run: 'yes' as any });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('invalid operation status fails', () => {
      const result = createValidApplyResult({
        operation_results: [
          { op: 'create', path: 'test.ts', status: 'pending' as any, before_hash: null, after_hash: 'sha256:' + 'a'.repeat(64), bytes_written: 10 },
        ],
        summary: { total_operations: 1, succeeded: 1, skipped: 0, failed: 0, total_bytes_written: 10 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });

    it('invalid operation type fails', () => {
      const result = createValidApplyResult({
        operation_results: [
          { op: 'symlink' as any, path: 'test.ts', status: 'success', before_hash: null, after_hash: 'sha256:' + 'a'.repeat(64), bytes_written: 10 },
        ],
        summary: { total_operations: 1, succeeded: 1, skipped: 0, failed: 0, total_bytes_written: 10 },
      });
      const verify = verifyApplyResult(result);
      assert.ok(!verify.ok);
      assert.ok(verify.violations?.some((v) => v.rule_id === 'SCHEMA'));
    });
  });

  describe('Determinism', () => {
    it('verification is deterministic', () => {
      const result = createValidApplyResult();
      const verify1 = verifyApplyResult(result);
      const verify2 = verifyApplyResult(result);

      const json1 = canonicalize(verify1);
      const json2 = canonicalize(verify2);
      assert.strictEqual(json1, json2, 'Verification should be deterministic');
    });

    it('violations are sorted deterministically', () => {
      const result = createValidApplyResult({
        operation_results: [
          { op: 'create', path: 'z.ts', status: 'success', before_hash: null, after_hash: 'sha256:' + 'a'.repeat(64), bytes_written: 10 },
          { op: 'create', path: 'a.ts', status: 'success', before_hash: null, after_hash: 'md5:bad', bytes_written: 10 },
        ],
        summary: { total_operations: 2, succeeded: 2, skipped: 0, failed: 0, total_bytes_written: 20 },
      });

      const verify1 = verifyApplyResult(result);
      const verify2 = verifyApplyResult(result);

      assert.ok(!verify1.ok && !verify2.ok);
      const json1 = canonicalize(verify1);
      const json2 = canonicalize(verify2);
      assert.strictEqual(json1, json2, 'Violations should be sorted deterministically');
    });
  });
});
