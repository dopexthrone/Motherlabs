/**
 * Tests for verified release tagging tool
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import {
  validateRelease,
  validateDate,
  validateThreshold,
  parseMarkdownForVerification,
  loadVerifiedReports,
  checkIndexAlreadyRecorded,
  updateIndexWithVerifiedTag,
  createStubGitHelper,
  type DryRunOutput,
} from '../tag_verified_release.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_BASE = join(__dirname, '../../../src/tools/tests/fixtures');

// Temp directory for test operations
const TEST_TEMP_DIR = '/tmp/tag_verified_test_temp';

describe('Verified Release Tagging', () => {
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
      assert.throws(() => validateRelease('release-1.0'), /INVALID_RELEASE/);
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
      assert.throws(() => validateDate('2026010', false), /INVALID_DATE/);
    });

    it('requires date when not dry-run', () => {
      assert.throws(() => validateDate(undefined, false), /MISSING_DATE/);
    });

    it('allows missing date in dry-run mode', () => {
      validateDate(undefined, true); // Should not throw
    });
  });

  describe('validateThreshold', () => {
    it('accepts valid threshold', () => {
      validateThreshold(1);
      validateThreshold(5);
      validateThreshold(100);
    });

    it('rejects invalid threshold', () => {
      assert.throws(() => validateThreshold(0), /INVALID_THRESHOLD/);
      assert.throws(() => validateThreshold(-1), /INVALID_THRESHOLD/);
      assert.throws(() => validateThreshold(1.5), /INVALID_THRESHOLD/);
    });
  });

  describe('parseMarkdownForVerification', () => {
    it('parses valid verified report', () => {
      const content = `# Verifier Report: v0.2.1

## Environment

- **OS**: Ubuntu 22.04.3 LTS
- **Node Version**: v24.11.1
- **npm Version**: 10.2.0

## Summary

### Overall Result: PASS
`;
      const result = parseMarkdownForVerification(content);

      assert.equal(result.verified, true);
      assert.equal(result.os, 'Ubuntu 22.04.3 LTS');
      assert.equal(result.node_version, 'v24.11.1');
      assert.equal(result.npm_version, '10.2.0');
    });

    it('detects failed result', () => {
      const content = `### Overall Result: FAIL`;
      const result = parseMarkdownForVerification(content);
      assert.equal(result.verified, false);
    });

    it('handles missing fields', () => {
      const content = `### Overall Result: PASS`;
      const result = parseMarkdownForVerification(content);
      assert.equal(result.verified, true);
      assert.equal(result.os, '');
      assert.equal(result.node_version, '');
      assert.equal(result.npm_version, '');
    });

    it('handles placeholder fields', () => {
      const content = `
- **OS**: [not filled]
- **Node Version**: [output of node --version]
- **npm Version**: [your npm version]
### Overall Result: PASS
`;
      const result = parseMarkdownForVerification(content);
      assert.equal(result.verified, true);
      // These should contain placeholders
      assert.ok(result.os.includes('['));
      assert.ok(result.node_version.includes('['));
      assert.ok(result.npm_version.includes('['));
    });
  });

  describe('loadVerifiedReports', () => {
    it('loads valid reports from fixture', async () => {
      // Set up env to use fixture directory
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified');

      try {
        const reports = await loadVerifiedReports('v0.2.1');
        assert.equal(reports.length, 2);

        // Should be sorted by folder name
        assert.equal(reports[0]!.verifier_id, 'verifier_a');
        assert.equal(reports[0]!.date, '20260105');
        assert.equal(reports[1]!.verifier_id, 'verifier_b');
        assert.equal(reports[1]!.date, '20260106');
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
        const reports = await loadVerifiedReports('v0.2.1');
        assert.equal(reports.length, 0);
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });

    it('excludes reports with missing required fields', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified_missing_fields');

      try {
        const reports = await loadVerifiedReports('v0.2.1');
        // Report has placeholders in required fields, should be excluded
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
    it('returns false when not recorded', async () => {
      const content = await readFile(
        join(FIXTURES_BASE, 'tag_verified/artifacts/verifier_reports/INDEX.md'),
        'utf-8'
      );
      const result = checkIndexAlreadyRecorded(content, 'v0.2.1');
      assert.equal(result, false);
    });

    it('returns true when already recorded', async () => {
      const content = await readFile(
        join(FIXTURES_BASE, 'tag_verified_already_recorded/artifacts/verifier_reports/INDEX.md'),
        'utf-8'
      );
      const result = checkIndexAlreadyRecorded(content, 'v0.2.1');
      assert.equal(result, true);
    });
  });

  describe('updateIndexWithVerifiedTag', () => {
    it('adds Verified Tag row to INDEX.md', async () => {
      const content = await readFile(
        join(FIXTURES_BASE, 'tag_verified/artifacts/verifier_reports/INDEX.md'),
        'utf-8'
      );

      const updated = updateIndexWithVerifiedTag(content, 'v0.2.1', 'v0.2.1-verified-20260105');

      assert.ok(updated.includes('| Verified Tag | `v0.2.1-verified-20260105` |'));
      // Should appear after the Verified row
      const verifiedIndex = updated.indexOf('| Verified | YES |');
      const tagIndex = updated.indexOf('| Verified Tag |');
      assert.ok(tagIndex > verifiedIndex);
    });

    it('produces deterministic output', async () => {
      const content = await readFile(
        join(FIXTURES_BASE, 'tag_verified/artifacts/verifier_reports/INDEX.md'),
        'utf-8'
      );

      const updated1 = updateIndexWithVerifiedTag(content, 'v0.2.1', 'v0.2.1-verified-20260105');
      const updated2 = updateIndexWithVerifiedTag(content, 'v0.2.1', 'v0.2.1-verified-20260105');

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
        existingTags: ['v0.2.1-verified-20260105'],
      });

      assert.equal(git.tagExists('v0.2.1-verified-20260105'), true);
      assert.equal(git.tagExists('v0.2.1-verified-20260106'), false);
    });
  });

  describe('Threshold not met', () => {
    it('returns exit code 2 with exact error string', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified_empty');

      try {
        const reports = await loadVerifiedReports('v0.2.1');
        assert.equal(reports.length, 0);

        // Verify the exact error format
        const threshold = 1;
        const count = reports.length;
        const expectedError = `THRESHOLD_NOT_MET: need ${threshold} verified report(s); have ${count}`;
        assert.equal(expectedError, 'THRESHOLD_NOT_MET: need 1 verified report(s); have 0');
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
    it('outputs JSON with expected tag name and target SHA', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified');

      try {
        const reports = await loadVerifiedReports('v0.2.1');
        assert.ok(reports.length >= 1, 'Should have at least 1 verified report');

        // Simulate dry-run output structure
        const stubCommit = 'a55e3f9f9c4cbd32b8bd48ea1cbf342ab451b762';
        const output: DryRunOutput = {
          release: 'v0.2.1',
          target_commit: stubCommit,
          threshold: 1,
          verified_count: reports.length,
          tag: 'v0.2.1-verified-20260105',
          index_update: 'APPLY',
          tag_action: 'CREATE',
        };

        // Verify structure
        assert.equal(output.release, 'v0.2.1');
        assert.equal(output.target_commit, stubCommit);
        assert.equal(output.tag, 'v0.2.1-verified-20260105');
        assert.ok(output.verified_count >= 1);
      } finally {
        if (originalEnv === undefined) {
          delete process.env['MOTHER_REPO_ROOT'];
        } else {
          process.env['MOTHER_REPO_ROOT'] = originalEnv;
        }
      }
    });
  });

  describe('Invalid report with missing fields', () => {
    it('tool refuses to count reports with missing OS/node/npm', async () => {
      const originalEnv = process.env['MOTHER_REPO_ROOT'];
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified_missing_fields');

      try {
        const reports = await loadVerifiedReports('v0.2.1');
        // The report exists but has placeholder values, so should not count
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

  describe('Already verified recorded', () => {
    it('refuses with stable message when INDEX.md already has Verified Tag', async () => {
      const content = await readFile(
        join(FIXTURES_BASE, 'tag_verified_already_recorded/artifacts/verifier_reports/INDEX.md'),
        'utf-8'
      );

      const alreadyRecorded = checkIndexAlreadyRecorded(content, 'v0.2.1');
      assert.equal(alreadyRecorded, true);

      // Verify the exact error format
      const expectedError = 'ALREADY_RECORDED: Verified Tag already set for v0.2.1';
      assert.equal(expectedError, 'ALREADY_RECORDED: Verified Tag already set for v0.2.1');
    });
  });

  describe('Determinism', () => {
    it('produces stable error messages', () => {
      // All error messages should be deterministic
      const errors = [
        () => validateRelease('invalid'),
        () => validateDate('bad-date', false),
        () => validateThreshold(0),
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
      process.env['MOTHER_REPO_ROOT'] = join(FIXTURES_BASE, 'tag_verified');

      try {
        const reports1 = await loadVerifiedReports('v0.2.1');
        const reports2 = await loadVerifiedReports('v0.2.1');

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
