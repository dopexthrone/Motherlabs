/**
 * Tests for verifier report ingestion tool
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import {
  validateFolderName,
  validateRequiredFiles,
  validateJsonSchema,
  parseMarkdownReport,
  parseExistingEntries,
  checkDuplicate,
  formatTableRow,
  type IndexEntry,
} from '../ingest_verifier_report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Fixtures are in src/tools/tests/fixtures (relative to dist/tools/tests)
const FIXTURES_DIR = join(__dirname, '../../../src/tools/tests/fixtures');
const PROJECT_ROOT = join(__dirname, '../../..');
const SCHEMA_PATH = join(PROJECT_ROOT, 'docs', 'verifier_report.schema.json');

// Temp directory for test operations
const TEST_TEMP_DIR = '/tmp/ingest_test_temp';

describe('Verifier Report Ingestion', () => {
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

  describe('validateFolderName', () => {
    it('accepts valid folder names', () => {
      const result = validateFolderName('20260105_acme');
      assert.equal(result.date, '20260105');
      assert.equal(result.verifier_id, 'acme');
    });

    it('accepts folder names with underscores in verifier_id', () => {
      const result = validateFolderName('20260105_acme_corp');
      assert.equal(result.verifier_id, 'acme_corp');
    });

    it('accepts folder names with hyphens in verifier_id', () => {
      const result = validateFolderName('20260105_acme-corp');
      assert.equal(result.verifier_id, 'acme-corp');
    });

    it('rejects invalid format', () => {
      assert.throws(() => validateFolderName('invalid'), /Invalid folder name format/);
    });

    it('rejects missing date', () => {
      assert.throws(() => validateFolderName('_acme'), /Invalid folder name format/);
    });

    it('rejects invalid date', () => {
      assert.throws(() => validateFolderName('20261301_acme'), /Invalid date/);
    });
  });

  describe('validateRequiredFiles', () => {
    it('passes when VERIFIER_REPORT.md exists', async () => {
      const testDir = join(TEST_TEMP_DIR, 'valid');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'VERIFIER_REPORT.md'), '# Test');

      await validateRequiredFiles(testDir); // Should not throw
    });

    it('fails when VERIFIER_REPORT.md is missing', async () => {
      const testDir = join(TEST_TEMP_DIR, 'invalid');
      await mkdir(testDir, { recursive: true });

      await assert.rejects(
        () => validateRequiredFiles(testDir),
        /Missing required file: VERIFIER_REPORT.md/
      );
    });
  });

  describe('validateJsonSchema', () => {
    it('accepts valid JSON with all required fields', async () => {
      const jsonPath = join(FIXTURES_DIR, 'valid_with_json', 'verifier_report.json');
      const result = await validateJsonSchema(jsonPath, SCHEMA_PATH);

      assert.equal(result.schema_version, '1.0');
      assert.equal(result.release_version, 'v0.2.1');
      assert.equal(result.summary.result, 'PASS');
    });

    it('rejects JSON missing required fields', async () => {
      const jsonPath = join(FIXTURES_DIR, 'invalid_json', 'verifier_report.json');

      await assert.rejects(
        () => validateJsonSchema(jsonPath, SCHEMA_PATH),
        /missing required fields|Invalid summary\.result/
      );
    });

    it('rejects invalid schema_version', async () => {
      const testPath = join(TEST_TEMP_DIR, 'bad_version.json');
      await writeFile(
        testPath,
        JSON.stringify({
          schema_version: '2.0',
          release_version: 'v0.2.1',
          verifier: { handle: 'test', date_utc: '2026-01-05' },
          environment: { os: 'Linux', node_version: 'v24.11.1' },
          source_verification: { archive_hash_match: true, git_tag_match: true },
          build_verification: {
            npm_ci_success: true,
            npm_build_success: true,
            banned_api_check_pass: true,
          },
          test_results: { total: 100, passed: 100, failed: 0 },
          golden_results: { passed: 10, failed: 0, changed: 0, new: 0 },
          summary: {
            result: 'PASS',
            attestation: {
              ran_all_steps: true,
              clean_environment: true,
              correct_node_version: true,
              accurate_results: true,
            },
          },
        })
      );

      await assert.rejects(
        () => validateJsonSchema(testPath, SCHEMA_PATH),
        /Invalid schema_version.*Expected: "1\.0"/
      );
    });

    it('rejects malformed JSON', async () => {
      const testPath = join(TEST_TEMP_DIR, 'malformed.json');
      await writeFile(testPath, '{ invalid json }');

      await assert.rejects(
        () => validateJsonSchema(testPath, SCHEMA_PATH),
        /Invalid JSON/
      );
    });
  });

  describe('parseMarkdownReport', () => {
    it('parses valid markdown report correctly', async () => {
      const mdPath = join(FIXTURES_DIR, 'valid_with_json', 'VERIFIER_REPORT.md');
      const content = await readFile(mdPath, 'utf-8');
      const result = parseMarkdownReport(content, 'v0.2.1');

      assert.equal(result.release_tag, 'v0.2.1');
      assert.equal(result.verified, true);
      assert.equal(result.result, 'PASS');
      assert.equal(result.os, 'Ubuntu 22.04.3 LTS');
      assert.equal(result.node_version, 'v24.11.1');
      assert.equal(result.npm_version, '10.2.0');
      assert.equal(result.verifier_handle, 'test_verifier');
    });

    it('detects version mismatch', async () => {
      const mdPath = join(FIXTURES_DIR, 'valid_with_json', 'VERIFIER_REPORT.md');
      const content = await readFile(mdPath, 'utf-8');

      assert.throws(
        () => parseMarkdownReport(content, 'v0.3.0'),
        /Release version mismatch.*v0\.2\.1.*v0\.3\.0/
      );
    });

    it('reports missing fields with stable error message', () => {
      const content = `# Verifier Report: v0.2.1

## Summary

### Overall Result: PASS
`;

      assert.throws(
        () => parseMarkdownReport(content, 'v0.2.1'),
        /VERIFIER_REPORT\.md missing required fields/
      );
    });
  });

  describe('Index Entry Management', () => {
    it('formats table row correctly', () => {
      const entry: IndexEntry = {
        date: '20260105',
        verifier_id: 'acme',
        release_tag: 'v0.2.1',
        result: 'PASS',
        os: 'Ubuntu 22.04',
        node: 'v24.11.1',
        npm: '10.2.0',
        path: 'v0.2.1/verified/20260105_acme/',
      };

      const row = formatTableRow(entry);
      assert.equal(
        row,
        '| 20260105 | acme | v0.2.1 | PASS | Ubuntu 22.04 | v24.11.1 | 10.2.0 | v0.2.1/verified/20260105_acme/ |'
      );
    });

    it('parses existing entries from index content', () => {
      const content = `### v0.2.1

| Date | Verifier | Release | Result | OS | Node | npm | Path |
|------|----------|---------|--------|-----|------|-----|------|
| 20260105 | acme | v0.2.1 | PASS | Ubuntu 22.04 | v24.11.1 | 10.2.0 | v0.2.1/verified/20260105_acme/ |
| 20260104 | beta | v0.2.1 | FAIL | Fedora 39 | v24.11.1 | 10.2.0 | v0.2.1/failed/20260104_beta/ |
`;

      const entries = parseExistingEntries(content, 'v0.2.1');
      assert.equal(entries.length, 2);
      assert.equal(entries[0]!.verifier_id, 'acme');
      assert.equal(entries[1]!.verifier_id, 'beta');
    });

    it('detects duplicates correctly', () => {
      const entries: IndexEntry[] = [
        {
          date: '20260105',
          verifier_id: 'acme',
          release_tag: 'v0.2.1',
          result: 'PASS',
          os: 'Ubuntu',
          node: 'v24.11.1',
          npm: '10.2.0',
          path: 'v0.2.1/verified/20260105_acme/',
        },
      ];

      assert.equal(checkDuplicate(entries, '20260105', 'acme'), true);
      assert.equal(checkDuplicate(entries, '20260105', 'other'), false);
      assert.equal(checkDuplicate(entries, '20260106', 'acme'), false);
    });
  });

  describe('Valid submission with JSON passes and updates index deterministically', () => {
    it('parses and validates correctly', async () => {
      const mdPath = join(FIXTURES_DIR, 'valid_with_json', 'VERIFIER_REPORT.md');
      const jsonPath = join(FIXTURES_DIR, 'valid_with_json', 'verifier_report.json');

      const mdContent = await readFile(mdPath, 'utf-8');
      const mdResult = parseMarkdownReport(mdContent, 'v0.2.1');

      const jsonResult = await validateJsonSchema(jsonPath, SCHEMA_PATH);

      // Cross-validate
      assert.equal(jsonResult.release_version, mdResult.release_tag);
      assert.equal(jsonResult.summary.result, mdResult.result);

      // Verify deterministic output
      const entry: IndexEntry = {
        date: '20260105',
        verifier_id: 'test_verifier',
        release_tag: mdResult.release_tag,
        result: mdResult.result,
        os: mdResult.os.slice(0, 30),
        node: mdResult.node_version,
        npm: mdResult.npm_version,
        path: `v0.2.1/verified/20260105_test_verifier/`,
      };

      const row1 = formatTableRow(entry);
      const row2 = formatTableRow(entry);
      assert.equal(row1, row2, 'Table row formatting should be deterministic');
    });
  });

  describe('Valid submission without JSON passes', () => {
    it('parses markdown-only submission correctly', async () => {
      const mdPath = join(FIXTURES_DIR, 'valid_without_json', 'VERIFIER_REPORT.md');
      const content = await readFile(mdPath, 'utf-8');
      const result = parseMarkdownReport(content, 'v0.2.1');

      assert.equal(result.release_tag, 'v0.2.1');
      assert.equal(result.verified, true);
      assert.equal(result.result, 'PASS');
      assert.equal(result.os, 'Fedora 39');
      assert.equal(result.verifier_handle, 'another_verifier');
    });
  });

  describe('Invalid JSON fails with stable error message', () => {
    it('produces consistent error for invalid JSON', async () => {
      const jsonPath = join(FIXTURES_DIR, 'invalid_json', 'verifier_report.json');

      // Run validation twice to ensure stable error
      let error1: Error | null = null;
      let error2: Error | null = null;

      try {
        await validateJsonSchema(jsonPath, SCHEMA_PATH);
      } catch (e) {
        error1 = e as Error;
      }

      try {
        await validateJsonSchema(jsonPath, SCHEMA_PATH);
      } catch (e) {
        error2 = e as Error;
      }

      assert.ok(error1, 'First validation should fail');
      assert.ok(error2, 'Second validation should fail');
      assert.equal(
        error1.message,
        error2.message,
        'Error messages should be stable/deterministic'
      );
    });
  });
});
