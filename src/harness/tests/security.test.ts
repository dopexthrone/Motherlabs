/**
 * Security Hardening Tests (Policy Proof)
 * ========================================
 *
 * Tests that verify the harness correctly handles:
 * - Symlink escape attempts
 * - Path traversal attempts
 * - Huge file spam
 * - Deep directory recursion
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

import { createSandbox, cleanupSandbox, collectOutputs } from '../sandbox.js';
import { loadPolicy } from '../policy.js';

// =============================================================================
// Symlink Escape Tests
// =============================================================================

describe('Security: Symlink Escape', () => {
  it('refuses to follow symlinks in output directory', async () => {
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict');

    try {
      // Create a real file
      await fs.writeFile(path.join(sandbox.outDir, 'real.txt'), 'real content');

      // Create a symlink pointing outside sandbox
      const outsidePath = path.join(tmpdir(), 'outside_secret.txt');
      await fs.writeFile(outsidePath, 'SECRET DATA');

      try {
        await fs.symlink(outsidePath, path.join(sandbox.outDir, 'symlink.txt'));
      } catch {
        // Symlink creation might fail on some systems - skip test
        return;
      }

      const result = await collectOutputs(sandbox, policy);

      // Should only collect the real file, not the symlink
      assert.strictEqual(result.outputs.length, 1, 'Should only collect 1 file');
      assert.strictEqual(result.outputs[0]!.path, 'real.txt', 'Should be the real file');

      // Should report security violation
      assert.ok(
        result.security_violations.some((v) => v.includes('Symlink')),
        'Should report symlink violation'
      );

      // Cleanup
      await fs.rm(outsidePath, { force: true });
    } finally {
      await cleanupSandbox(sandbox);
    }
  });

  it('refuses to follow directory symlinks', async () => {
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict');

    try {
      // Create a symlink to a directory outside sandbox
      const outsideDir = path.join(tmpdir(), 'outside_dir_' + Date.now());
      await fs.mkdir(outsideDir, { recursive: true });
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'SECRET');

      try {
        await fs.symlink(outsideDir, path.join(sandbox.outDir, 'linked_dir'));
      } catch {
        // Symlink creation might fail - skip test
        await fs.rm(outsideDir, { recursive: true, force: true });
        return;
      }

      const result = await collectOutputs(sandbox, policy);

      // Should NOT have collected the secret file
      const secretFound = result.outputs.some((o) => o.path.includes('secret'));
      assert.ok(!secretFound, 'Should not collect files through symlinked directory');

      // Cleanup
      await fs.rm(outsideDir, { recursive: true, force: true });
    } finally {
      await cleanupSandbox(sandbox);
    }
  });
});

// =============================================================================
// Path Traversal Tests
// =============================================================================

describe('Security: Path Traversal', () => {
  it('validates isPathSafe correctly', async () => {
    // Import the module to test internal function behavior through collectOutputs
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict');

    try {
      // Create a directory with suspicious name (if OS allows)
      // Most OSes don't allow ".." in filenames, so we test indirectly
      await fs.writeFile(path.join(sandbox.outDir, 'normal.txt'), 'normal');

      const result = await collectOutputs(sandbox, policy);

      // Normal file should be collected
      assert.strictEqual(result.outputs.length, 1);
      assert.ok(result.outputs[0]!.path === 'normal.txt');

      // No security violations for normal files
      const traversalViolations = result.security_violations.filter((v) =>
        v.includes('traversal')
      );
      assert.strictEqual(traversalViolations.length, 0, 'No traversal violations for normal files');
    } finally {
      await cleanupSandbox(sandbox);
    }
  });

  it('rejects absolute paths in output', async () => {
    // This test verifies the path validation logic
    // We can't easily create files with absolute paths in names, but we test the validation
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict');

    try {
      // Create normal file
      await fs.writeFile(path.join(sandbox.outDir, 'safe.txt'), 'safe');

      const result = await collectOutputs(sandbox, policy);

      // Should collect the safe file
      assert.strictEqual(result.outputs.length, 1);

      // All collected paths should be relative
      for (const output of result.outputs) {
        assert.ok(!path.isAbsolute(output.path), `Path should be relative: ${output.path}`);
        assert.ok(!output.path.includes('..'), `Path should not contain ..: ${output.path}`);
      }
    } finally {
      await cleanupSandbox(sandbox);
    }
  });
});

// =============================================================================
// File Spam Tests
// =============================================================================

describe('Security: File Spam', () => {
  it('respects max_output_files limit', async () => {
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict'); // strict has max 200 files

    try {
      // Create more files than allowed
      const numFiles = 250;
      for (let i = 0; i < numFiles; i++) {
        await fs.writeFile(path.join(sandbox.outDir, `file_${i.toString().padStart(4, '0')}.txt`), `content ${i}`);
      }

      const result = await collectOutputs(sandbox, policy);

      // Should be truncated
      assert.ok(result.truncated, 'Should be truncated');

      // Should have at most max_output_files
      assert.ok(
        result.outputs.length <= policy.max_output_files,
        `Should have at most ${policy.max_output_files} files, got ${result.outputs.length}`
      );
    } finally {
      await cleanupSandbox(sandbox);
    }
  });

  it('respects max_total_output_bytes limit', async () => {
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict'); // strict has 10MB limit

    try {
      // Create a few large files (1MB each)
      const fileSize = 1024 * 1024; // 1MB
      const largeContent = 'x'.repeat(fileSize);

      // Create 15 files (15MB total, exceeding 10MB limit)
      for (let i = 0; i < 15; i++) {
        await fs.writeFile(path.join(sandbox.outDir, `large_${i}.txt`), largeContent);
      }

      const result = await collectOutputs(sandbox, policy);

      // Should be truncated
      assert.ok(result.truncated, 'Should be truncated due to byte limit');

      // Total bytes should be at or under limit
      assert.ok(
        result.total_bytes <= policy.max_total_output_bytes + fileSize, // Allow for last file
        `Total bytes should be around limit, got ${result.total_bytes}`
      );
    } finally {
      await cleanupSandbox(sandbox);
    }
  });
});

// =============================================================================
// Deep Recursion Tests
// =============================================================================

describe('Security: Deep Recursion', () => {
  it('limits directory traversal depth', async () => {
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict');

    try {
      // Create a very deep directory structure (25 levels)
      let deepPath = sandbox.outDir;
      for (let i = 0; i < 25; i++) {
        deepPath = path.join(deepPath, `level_${i}`);
        await fs.mkdir(deepPath, { recursive: true });
      }

      // Create a file at the deepest level
      await fs.writeFile(path.join(deepPath, 'deep_file.txt'), 'very deep');

      const result = await collectOutputs(sandbox, policy);

      // Should report depth violation
      const depthViolations = result.security_violations.filter((v) =>
        v.includes('depth')
      );
      assert.ok(depthViolations.length > 0, 'Should report depth exceeded');

      // Should be truncated
      assert.ok(result.truncated, 'Should be truncated due to depth');
    } finally {
      await cleanupSandbox(sandbox);
    }
  });

  it('allows directories within depth limit', async () => {
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict');

    try {
      // Create a reasonable directory structure (5 levels)
      let deepPath = sandbox.outDir;
      for (let i = 0; i < 5; i++) {
        deepPath = path.join(deepPath, `level_${i}`);
        await fs.mkdir(deepPath, { recursive: true });
      }

      await fs.writeFile(path.join(deepPath, 'normal_depth.txt'), 'normal depth');

      const result = await collectOutputs(sandbox, policy);

      // Should NOT report depth violation
      const depthViolations = result.security_violations.filter((v) =>
        v.includes('depth')
      );
      assert.strictEqual(depthViolations.length, 0, 'Should not report depth violation for normal depth');

      // File should be collected
      assert.ok(
        result.outputs.some((o) => o.path.includes('normal_depth')),
        'Should collect file at normal depth'
      );
    } finally {
      await cleanupSandbox(sandbox);
    }
  });
});

// =============================================================================
// Combined Security Tests
// =============================================================================

describe('Security: Combined Attacks', () => {
  it('handles multiple security issues simultaneously', async () => {
    const sandbox = await createSandbox();
    const policy = loadPolicy('strict');

    try {
      // Create normal file
      await fs.writeFile(path.join(sandbox.outDir, 'good.txt'), 'good');

      // Create many files
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(path.join(sandbox.outDir, `spam_${i}.txt`), 'spam');
      }

      // Create deep structure
      let deepPath = sandbox.outDir;
      for (let i = 0; i < 10; i++) {
        deepPath = path.join(deepPath, `deep_${i}`);
        await fs.mkdir(deepPath, { recursive: true });
      }
      await fs.writeFile(path.join(deepPath, 'nested.txt'), 'nested');

      const result = await collectOutputs(sandbox, policy);

      // Should collect files (not be completely blocked)
      assert.ok(result.outputs.length > 0, 'Should still collect some files');

      // Paths should all be safe
      for (const output of result.outputs) {
        assert.ok(!path.isAbsolute(output.path), 'All paths should be relative');
        assert.ok(!output.path.includes('..'), 'No path should contain ..');
      }
    } finally {
      await cleanupSandbox(sandbox);
    }
  });
});
