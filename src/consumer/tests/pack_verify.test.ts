/**
 * Pack Verify Tests
 * =================
 *
 * Tests for pack verification against PACK_SPEC.md invariants.
 * Covers PK1-PK12 invariants with fixture-based testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { verifyPack } from '../pack_verify.js';
import { canonicalize } from '../../utils/canonical.js';
import type { PackViolation } from '../pack_types.js';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Fixtures are in src/, not dist/, so resolve from project root
const PROJECT_ROOT = join(__dirname, '../../..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'src/consumer/tests/fixtures/packs');

// =============================================================================
// Helper: Create Temp Pack
// =============================================================================

function createTempPack(name: string): string {
  const path = join(tmpdir(), `pack_test_${name}_${Date.now()}`);
  if (existsSync(path)) {
    rmSync(path, { recursive: true });
  }
  mkdirSync(path, { recursive: true });
  return path;
}

function cleanupTempPack(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true });
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('Pack Verification', () => {
  describe('PK1: Required Files Exist', () => {
    it('valid pack with run.json and bundle.json passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok, `Expected valid pack to pass: ${JSON.stringify(result)}`);
    });

    it('missing run.json fails', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'invalid_pack_missing_run'));
      assert.ok(!result.ok);
      assert.ok(
        result.violations?.some((v: PackViolation) => v.rule_id === 'PK1' && v.message.includes('run.json')),
        'Expected PK1 violation for missing run.json'
      );
    });

    it('missing bundle.json for BUNDLE outcome fails', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'invalid_pack_missing_bundle'));
      assert.ok(!result.ok);
      assert.ok(
        result.violations?.some((v: PackViolation) => v.rule_id === 'PK1' && v.message.includes('bundle.json')),
        'Expected PK1 violation for missing bundle.json'
      );
    });

    it('REFUSE outcome without bundle.json passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_refuse'));
      assert.ok(result.ok, `Expected REFUSE pack to pass: ${JSON.stringify(result)}`);
    });
  });

  describe('PK2: No Unknown Files', () => {
    it('pack with only manifest files passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
    });

    it('pack with unknown file fails', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'invalid_pack_unknown_file'));
      assert.ok(!result.ok);
      assert.ok(
        result.violations?.some((v: PackViolation) => v.rule_id === 'PK2' && v.message.includes('unknown')),
        'Expected PK2 violation for unknown file'
      );
    });
  });

  describe('PK3: Run Spec Valid', () => {
    it('valid run.json passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
    });

    it('run.json with missing fields fails', () => {
      const tempPath = createTempPack('pk3_missing_fields');
      try {
        // Create minimal invalid run.json
        writeFileSync(join(tempPath, 'run.json'), JSON.stringify({ foo: 'bar' }));
        writeFileSync(join(tempPath, 'bundle.json'), JSON.stringify({ id: 'test' }));

        const result = verifyPack(tempPath);
        assert.ok(!result.ok);
        assert.ok(
          result.violations?.some((v: PackViolation) => v.rule_id === 'PK3'),
          'Expected PK3 violation for invalid run.json'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('PK4: Bundle Spec Valid', () => {
    it('valid bundle.json passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
    });

    it('invalid bundle.json fails deep validation', () => {
      const tempPath = createTempPack('pk4_invalid_bundle');
      try {
        // Copy valid run.json but use invalid bundle
        const validRunPath = join(FIXTURES_DIR, 'valid_pack_bundle', 'run.json');
        const validRun = readFileSync(validRunPath, 'utf-8');
        writeFileSync(join(tempPath, 'run.json'), validRun);
        writeFileSync(join(tempPath, 'bundle.json'), JSON.stringify({ invalid: 'bundle' }));

        const result = verifyPack(tempPath);
        assert.ok(!result.ok);
        assert.ok(
          result.violations?.some((v: PackViolation) => v.rule_id === 'PK4'),
          'Expected PK4 violation for invalid bundle'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });

    it('skips bundle validation when deepValidation=false', () => {
      const tempPath = createTempPack('pk4_skip_deep');
      try {
        // Copy valid run.json but use invalid bundle
        const validRunPath = join(FIXTURES_DIR, 'valid_pack_bundle', 'run.json');
        const validRun = readFileSync(validRunPath, 'utf-8');
        writeFileSync(join(tempPath, 'run.json'), validRun);
        // Empty bundle.json is invalid per BUNDLE_SPEC but we skip validation
        writeFileSync(join(tempPath, 'bundle.json'), '{}');

        const result = verifyPack(tempPath, { deepValidation: false });
        // Should still fail for PK5 hash mismatch but not PK4
        assert.ok(
          !result.ok && !result.violations?.some((v: PackViolation) => v.rule_id === 'PK4'),
          'Should not have PK4 violation when deepValidation=false'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('PK5: Hash Match (run -> bundle)', () => {
    it('matching hash passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
      // Check reference checks are populated
      if (result.ok) {
        assert.ok(result.reference_checks.length > 0, 'Expected reference checks');
        assert.ok(result.reference_checks[0]?.match, 'Expected hash to match');
      }
    });

    it('mismatched hash fails', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'invalid_pack_hash_mismatch'));
      assert.ok(!result.ok);
      assert.ok(
        result.violations?.some((v: PackViolation) => v.rule_id === 'PK5' && v.message.includes('mismatch')),
        'Expected PK5 violation for hash mismatch'
      );
    });

    it('skips hash verification when verifyReferences=false', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'invalid_pack_hash_mismatch'), {
        verifyReferences: false,
      });
      // With verifyReferences=false, should still fail for other reasons but not PK5
      if (!result.ok) {
        assert.ok(
          !result.violations.some((v: PackViolation) => v.rule_id === 'PK5'),
          'Should not have PK5 violation when verifyReferences=false'
        );
      }
    });
  });

  describe('PK6: No Symlinks', () => {
    it('regular files pass', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
    });

    it('symlink file fails', () => {
      const tempPath = createTempPack('pk6_symlink');
      try {
        // Create valid pack with symlink
        const bundlePath = join(FIXTURES_DIR, 'valid_pack_bundle', 'bundle.json');
        const runPath = join(FIXTURES_DIR, 'valid_pack_bundle', 'run.json');

        copyFileSync(runPath, join(tempPath, 'run.json'));
        // Create symlink instead of copying bundle
        try {
          symlinkSync(bundlePath, join(tempPath, 'bundle.json'));
        } catch {
          // Skip test if symlinks not supported (Windows without admin)
          return;
        }

        const result = verifyPack(tempPath);
        assert.ok(!result.ok);
        assert.ok(
          result.violations?.some((v: PackViolation) => v.rule_id === 'PK6'),
          'Expected PK6 violation for symlink'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('PK7: No Path Traversal', () => {
    it('normal path passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
    });

    // Note: Path traversal in pack directory path is checked
    // Filename traversal checks are in the file loop
  });

  describe('PK8: Optional Files Valid', () => {
    it('pack with all optional files passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_full'));
      assert.ok(result.ok, `Expected full pack to pass: ${JSON.stringify(result)}`);
    });

    it('invalid patch.json in pack fails', () => {
      const tempPath = createTempPack('pk8_invalid_patch');
      try {
        // Copy valid pack files
        copyFileSync(join(FIXTURES_DIR, 'valid_pack_bundle', 'run.json'), join(tempPath, 'run.json'));
        copyFileSync(join(FIXTURES_DIR, 'valid_pack_bundle', 'bundle.json'), join(tempPath, 'bundle.json'));
        // Add invalid patch.json
        writeFileSync(join(tempPath, 'patch.json'), JSON.stringify({ invalid: 'patch' }));

        const result = verifyPack(tempPath);
        assert.ok(!result.ok);
        assert.ok(
          result.violations?.some((v: PackViolation) => v.rule_id === 'PK8' && v.path === 'patch.json'),
          'Expected PK8 violation for invalid patch.json'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('PK9: Ledger Format Valid', () => {
    it('valid ledger.jsonl passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_full'));
      assert.ok(result.ok);
    });

    it('invalid JSONL format fails', () => {
      const tempPath = createTempPack('pk9_invalid_ledger');
      try {
        copyFileSync(join(FIXTURES_DIR, 'valid_pack_bundle', 'run.json'), join(tempPath, 'run.json'));
        copyFileSync(join(FIXTURES_DIR, 'valid_pack_bundle', 'bundle.json'), join(tempPath, 'bundle.json'));
        // Add invalid ledger (not valid JSON)
        writeFileSync(join(tempPath, 'ledger.jsonl'), 'not valid json\n');

        const result = verifyPack(tempPath);
        assert.ok(!result.ok);
        assert.ok(
          result.violations?.some((v: PackViolation) => v.rule_id === 'PK9'),
          'Expected PK9 violation for invalid ledger'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('PK10: Stable Violations', () => {
    it('violations are deterministically sorted', () => {
      const result1 = verifyPack(join(FIXTURES_DIR, 'invalid_pack_missing_bundle'));
      const result2 = verifyPack(join(FIXTURES_DIR, 'invalid_pack_missing_bundle'));

      assert.ok(!result1.ok && !result2.ok);

      const json1 = canonicalize(result1);
      const json2 = canonicalize(result2);
      assert.strictEqual(json1, json2, 'Violations should be deterministically sorted');
    });
  });

  describe('PK11: Meta Ignored', () => {
    it('meta.json is parsed but not validated', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_full'));
      assert.ok(result.ok, 'meta.json should not cause validation failure');
    });

    it('invalid JSON in meta.json fails', () => {
      const tempPath = createTempPack('pk11_invalid_meta');
      try {
        copyFileSync(join(FIXTURES_DIR, 'valid_pack_bundle', 'run.json'), join(tempPath, 'run.json'));
        copyFileSync(join(FIXTURES_DIR, 'valid_pack_bundle', 'bundle.json'), join(tempPath, 'bundle.json'));
        // Add invalid meta.json (not valid JSON)
        writeFileSync(join(tempPath, 'meta.json'), 'not valid json');

        const result = verifyPack(tempPath);
        assert.ok(!result.ok);
        assert.ok(
          result.violations?.some((v: PackViolation) => v.path === 'meta.json'),
          'Expected violation for invalid JSON in meta.json'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('PK12: Regular Files Only', () => {
    it('regular files pass', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
    });

    // Directory tests would require OS-specific setup
  });

  describe('Valid Pack Fixtures', () => {
    it('valid_pack_bundle passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok, `Expected valid_pack_bundle to pass: ${JSON.stringify(result)}`);
    });

    it('valid_pack_clarify passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_clarify'));
      assert.ok(result.ok, `Expected valid_pack_clarify to pass: ${JSON.stringify(result)}`);
    });

    it('valid_pack_refuse passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_refuse'));
      assert.ok(result.ok, `Expected valid_pack_refuse to pass: ${JSON.stringify(result)}`);
    });

    it('valid_pack_full passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_full'));
      assert.ok(result.ok, `Expected valid_pack_full to pass: ${JSON.stringify(result)}`);
    });

    it('valid_pack_with_model_io passes', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_with_model_io'));
      assert.ok(result.ok, `Expected valid_pack_with_model_io to pass: ${JSON.stringify(result)}`);
      if (result.ok) {
        assert.ok(result.files_verified.includes('model_io.json'), 'Expected model_io.json to be verified');
      }
    });
  });

  describe('Model IO Integration', () => {
    it('invalid model_io.json in pack fails', () => {
      const tempPath = createTempPack('invalid_model_io');
      try {
        // Copy valid pack files
        copyFileSync(join(FIXTURES_DIR, 'valid_pack_bundle', 'run.json'), join(tempPath, 'run.json'));
        copyFileSync(join(FIXTURES_DIR, 'valid_pack_bundle', 'bundle.json'), join(tempPath, 'bundle.json'));
        // Add invalid model_io.json
        writeFileSync(join(tempPath, 'model_io.json'), JSON.stringify({ invalid: 'model_io' }));

        const result = verifyPack(tempPath);
        assert.ok(!result.ok);
        assert.ok(
          result.violations?.some((v: PackViolation) => v.rule_id === 'PK8' && v.path === 'model_io.json'),
          'Expected PK8 violation for invalid model_io.json'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('IO Errors', () => {
    it('non-existent directory fails', () => {
      const result = verifyPack('/nonexistent/path/to/pack');
      assert.ok(!result.ok);
      assert.ok(
        result.violations?.some((v: PackViolation) => v.rule_id === 'IO'),
        'Expected IO violation for non-existent path'
      );
    });

    it('file instead of directory fails', () => {
      const tempPath = createTempPack('io_file');
      try {
        const filePath = join(tempPath, 'not_a_dir');
        writeFileSync(filePath, 'hello');

        const result = verifyPack(filePath);
        assert.ok(!result.ok);
        assert.ok(
          result.violations?.some((v: PackViolation) => v.rule_id === 'IO'),
          'Expected IO violation for file path'
        );
      } finally {
        cleanupTempPack(tempPath);
      }
    });
  });

  describe('Success Result Structure', () => {
    it('includes files_verified on success', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(Array.isArray(result.files_verified));
        assert.ok(result.files_verified.includes('run.json'));
        assert.ok(result.files_verified.includes('bundle.json'));
      }
    });

    it('includes reference_checks on success', () => {
      const result = verifyPack(join(FIXTURES_DIR, 'valid_pack_bundle'));
      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(Array.isArray(result.reference_checks));
        const bundleCheck = result.reference_checks.find((c) => c.target === 'bundle.json');
        assert.ok(bundleCheck, 'Expected bundle.json reference check');
        assert.ok(bundleCheck.match, 'Expected hash to match');
      }
    });
  });
});
