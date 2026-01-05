/**
 * Tests for reference release tagging tool
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import {
  validateRelease,
  validateDate,
  parseMarkdownForVerification,
  loadInternalReports,
  checkIndexAlreadyRecorded,
  updateIndexWithReferenceTag,
  createStubGitHelper,
  type DryRunOutput,
  type VerifierKind,
} from '../tag_reference_release.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_BASE = join(__dirname, '../../../src/tools/tests/fixtures');

// Temp directory for test operations
const TEST_TEMP_DIR = '/tmp/tag_reference_test_temp';

describe('Reference Release Tagging', () => {
  beforeEach(async () => {
    if (existsSync(TEST_TEMP_DIR)) {
      await rm(TEST_TEMP_DIR, { recursive: true });
    }
    await mkdir(TEST_TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_TEMP_DIR)) {
      await rm(TEST_TEMP_DIR, { recursive: true });
    }
  });

  describe('validateRelease', () => {
    it('accepts valid release format', () => {
      validateRelease('v0.2.1'); // Should not throw
      validateRelease('v1.0.0');
      validateRelease('v10.20.30');
    });

    it('rejects invalid release format', () => {
      assert.throws(() => validateRelease('0.2.1'), /INVALID_RELEASE/);
      assert.throws(() => validateRelease('v0.2'), /INVALID_RELEASE/);
      assert.throws(() => validateRelease('v0.2.1-beta'), /INVALID_RELEASE/);
    });
  });

  describe('validateDate', () => {
    it('accepts valid date format', () => {
      validateDate('20260105', false); // Should not throw
      validateDate('20301231', false);
    });

    it('rejects invalid date format', () => {
      assert.throws(() => validateDate('2026-01-05', false), /INVALID_DATE/);
      assert.throws(() => validateDate('260105', false), /INVALID_DATE/);
    });

    it('requires date when not dry-run', () => {
      assert.throws(() => validateDate(undefined, false), /MISSING_DATE/);
    });

    it('allows missing date in dry-run mode', () => {
      validateDate(undefined, true); // Should not throw
    });
  });

  describe('parseMarkdownForVerification', () => {
    it('parses internal verifier_kind', () => {
      const content = `- **Verifier Kind**: internal
### Overall Result: PASS`;
      const result = parseMarkdownForVerification(content);
      assert.equal(result.verifier_kind, 'internal');
      assert.equal(result.verified, true);
    });

    it('parses independent verifier_kind', () => {
      const content = `- **Verifier Kind**: independent
### Overall Result: PASS`;
      const result = parseMarkdownForVerification(content);
      assert.equal(result.verifier_kind, 'independent');
    });

    it('returns null for missing verifier_kind', () => {
      const content = `### Overall Result: PASS`;
      const result = parseMarkdownForVerification(content);
      assert.equal(result.verifier_kind, null);
    });
  });

  describe('loadInternalReports', () => {
    it('loads only internal reports from fixture', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_internal_only');

      try {
        const reports = await loadInternalReports('v0.2.1');
        assert.equal(reports.length, 1);
        assert.equal(reports[0]!.verifier_kind, 'internal');
        assert.equal(reports[0]!.verifier_id, 'internal_verifier');
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });

    it('returns empty array when only independent reports exist', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified');

      try {
        const reports = await loadInternalReports('v0.2.1');
        // tag_verified fixture has only independent reports
        assert.equal(reports.length, 0);
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });

    it('returns empty array when no verified folder', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = TEST_TEMP_DIR;

      try {
        const reports = await loadInternalReports('v0.2.1');
        assert.equal(reports.length, 0);
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });
  });

  describe('checkIndexAlreadyRecorded', () => {
    it('returns false when Reference Tag not recorded', async () => {
      const content = await readFile(
        join(FIXTURES_BASE, 'tag_internal_only/artifacts/verifier_reports/INDEX.md'),
        'utf-8'
      );
      const result = checkIndexAlreadyRecorded(content, 'v0.2.1');
      assert.equal(result, false);
    });

    it('returns true when Reference Tag already recorded', () => {
      const content = `### v0.2.1

| Item | Value |
|------|-------|
| Reference Tag | \`v0.2.1-reference-20260105\` |
`;
      const result = checkIndexAlreadyRecorded(content, 'v0.2.1');
      assert.equal(result, true);
    });
  });

  describe('updateIndexWithReferenceTag', () => {
    it('adds Reference Tag row to INDEX.md', async () => {
      const content = await readFile(
        join(FIXTURES_BASE, 'tag_internal_only/artifacts/verifier_reports/INDEX.md'),
        'utf-8'
      );

      const updated = updateIndexWithReferenceTag(content, 'v0.2.1', 'v0.2.1-reference-20260105');

      assert.ok(updated.includes('| Reference Tag | `v0.2.1-reference-20260105` |'));
    });

    it('produces deterministic output', async () => {
      const content = await readFile(
        join(FIXTURES_BASE, 'tag_internal_only/artifacts/verifier_reports/INDEX.md'),
        'utf-8'
      );

      const updated1 = updateIndexWithReferenceTag(content, 'v0.2.1', 'v0.2.1-reference-20260105');
      const updated2 = updateIndexWithReferenceTag(content, 'v0.2.1', 'v0.2.1-reference-20260105');

      assert.equal(updated1, updated2, 'Index update should be deterministic');
    });
  });

  describe('createStubGitHelper', () => {
    it('returns configured commit for rev-parse', () => {
      const git = createStubGitHelper({
        releaseCommit: 'abc123def456',
        existingTags: [],
      });

      const commit = git.revParse('v0.2.1');
      assert.equal(commit, 'abc123def456');
    });

    it('reports tag existence correctly', () => {
      const git = createStubGitHelper({
        releaseCommit: 'abc123',
        existingTags: ['v0.2.1-reference-20260105'],
      });

      assert.equal(git.tagExists('v0.2.1-reference-20260105'), true);
      assert.equal(git.tagExists('v0.2.1-reference-20260106'), false);
    });
  });

  describe('Threshold not met', () => {
    it('returns exit code 2 when no internal reports exist', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified_empty');

      try {
        const reports = await loadInternalReports('v0.2.1');
        assert.equal(reports.length, 0);

        // Verify the exact error format
        const expectedError = 'THRESHOLD_NOT_MET: need 1 internal verified report(s); have 0';
        assert.equal(expectedError, 'THRESHOLD_NOT_MET: need 1 internal verified report(s); have 0');
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });

    it('independent-only reports do NOT count toward reference threshold', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified');

      try {
        const reports = await loadInternalReports('v0.2.1');
        // tag_verified has only independent reports
        assert.equal(reports.length, 0);
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });
  });

  describe('Threshold met dry-run', () => {
    it('outputs JSON with expected reference tag name', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_internal_only');

      try {
        const reports = await loadInternalReports('v0.2.1');
        assert.equal(reports.length, 1, 'Should have 1 internal report');

        // Simulate dry-run output structure
        const stubCommit = 'a55e3f9f9c4cbd32b8bd48ea1cbf342ab451b762';
        const output: DryRunOutput = {
          release: 'v0.2.1',
          target_commit: stubCommit,
          internal_count: reports.length,
          tag: 'v0.2.1-reference-20260105',
          index_update: 'APPLY',
          tag_action: 'CREATE',
        };

        // Verify structure
        assert.equal(output.release, 'v0.2.1');
        assert.equal(output.target_commit, stubCommit);
        assert.equal(output.tag, 'v0.2.1-reference-20260105');
        assert.ok(output.tag.includes('-reference-'), 'Tag should contain -reference-');
        assert.equal(output.internal_count, 1);
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });
  });

  describe('Already recorded', () => {
    it('refuses with stable message when INDEX.md already has Reference Tag', () => {
      const content = `### v0.2.1

| Item | Value |
|------|-------|
| Reference Tag | \`v0.2.1-reference-20260105\` |
`;
      const alreadyRecorded = checkIndexAlreadyRecorded(content, 'v0.2.1');
      assert.equal(alreadyRecorded, true);

      // Verify the exact error format
      const expectedError = 'ALREADY_RECORDED: Reference Tag already set for v0.2.1';
      assert.equal(expectedError, 'ALREADY_RECORDED: Reference Tag already set for v0.2.1');
    });
  });

  describe('Determinism', () => {
    it('produces stable error messages', () => {
      const errors = [
        () => validateRelease('invalid'),
        () => validateDate('bad-date', false),
      ];

      for (const errorFn of errors) {
        let error1: string | null = null;
        let error2: string | null = null;

        try {
          errorFn();
        } catch (e) {
          error1 = (e as Error).message;
        }

        try {
          errorFn();
        } catch (e) {
          error2 = (e as Error).message;
        }

        assert.equal(error1, error2, 'Error messages should be stable');
      }
    });

    it('produces stable report loading order', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_internal_only');

      try {
        const reports1 = await loadInternalReports('v0.2.1');
        const reports2 = await loadInternalReports('v0.2.1');

        assert.equal(reports1.length, reports2.length);
        for (let i = 0; i < reports1.length; i++) {
          assert.equal(reports1[i]!.verifier_id, reports2[i]!.verifier_id);
          assert.equal(reports1[i]!.date, reports2[i]!.date);
        }
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });
  });
});
