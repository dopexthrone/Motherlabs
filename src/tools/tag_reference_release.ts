#!/usr/bin/env node
/**
 * Reference Release Tagger
 * ========================
 *
 * Creates a "reference" annotated tag when internal (single-operator) verification exists.
 *
 * Usage:
 *   npm run tag-reference -- <release> --date <YYYYMMDD> [--dry-run]
 *
 * Example:
 *   npm run tag-reference -- v0.2.1 --date 20260105 --dry-run
 *
 * This tool:
 *   1. Validates release tag exists
 *   2. Counts eligible internal (verifier_kind=internal) reports
 *   3. Checks at least 1 internal report exists
 *   4. Creates annotated tag pointing to release commit
 *   5. Updates INDEX.md with reference tag record
 */

import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { canonicalize } from '../utils/canonical.js';

// =============================================================================
// Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Allow override for testing via env var - computed dynamically
function getProjectRoot(): string {
  const envRoot = process.env['MOTHER_REPO_ROOT'];
  if (envRoot) {
    return resolve(envRoot);
  }
  // When compiled, this file is at dist/tools/tag_reference_release.js
  return resolve(__dirname, '..', '..');
}

function getArtifactsDir(): string {
  return join(getProjectRoot(), 'artifacts');
}

function getVerifierReportsBase(): string {
  return join(getArtifactsDir(), 'verifier_reports');
}

function getIndexPath(): string {
  return join(getVerifierReportsBase(), 'INDEX.md');
}

// Folder name pattern: YYYYMMDD_verifier_id
const FOLDER_NAME_PATTERN = /^(\d{8})_([a-zA-Z0-9_-]+)$/;

// =============================================================================
// Types
// =============================================================================

type VerifierKind = 'internal' | 'independent';

interface VerifiedReport {
  folder_name: string;
  date: string;
  verifier_id: string;
  verifier_kind: VerifierKind;
  os: string;
  node_version: string;
  npm_version: string;
}

interface DryRunOutput {
  release: string;
  target_commit: string;
  internal_count: number;
  tag: string;
  index_update: 'APPLY' | 'SKIP';
  tag_action: 'CREATE' | 'SKIP';
}

interface GitHelper {
  revParse(ref: string): string;
  tagExists(tagName: string): boolean;
  createAnnotatedTag(tagName: string, targetCommit: string, message: string): void;
}

// =============================================================================
// Git Helpers
// =============================================================================

function createRealGitHelper(): GitHelper {
  return {
    revParse(ref: string): string {
      try {
        return execSync(`git rev-parse "${ref}^{commit}"`, {
          cwd: getProjectRoot(),
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {
        throw new Error(`RELEASE_NOT_FOUND: git tag ${ref} does not exist`);
      }
    },

    tagExists(tagName: string): boolean {
      try {
        const result = execSync(`git show-ref --tags "${tagName}"`, {
          cwd: getProjectRoot(),
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return result.trim().length > 0;
      } catch {
        return false;
      }
    },

    createAnnotatedTag(tagName: string, targetCommit: string, message: string): void {
      execSync(`git tag -a "${tagName}" "${targetCommit}" -m "${message}"`, {
        cwd: getProjectRoot(),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    },
  };
}

function createStubGitHelper(stubConfig: {
  releaseCommit: string;
  existingTags: string[];
}): GitHelper {
  return {
    revParse(ref: string): string {
      if (ref.match(/^v\d+\.\d+\.\d+$/)) {
        return stubConfig.releaseCommit;
      }
      throw new Error(`RELEASE_NOT_FOUND: git tag ${ref} does not exist`);
    },

    tagExists(tagName: string): boolean {
      return stubConfig.existingTags.includes(tagName);
    },

    createAnnotatedTag(_tagName: string, _targetCommit: string, _message: string): void {
      // Stub does nothing
    },
  };
}

function getGitHelper(): GitHelper {
  if (process.env['MOTHER_GIT_STUB'] === '1') {
    // Parse stub config from env
    const releaseCommit =
      process.env['MOTHER_GIT_STUB_COMMIT'] ?? 'a55e3f9f9c4cbd32b8bd48ea1cbf342ab451b762';
    const existingTags = (process.env['MOTHER_GIT_STUB_TAGS'] ?? '').split(',').filter(Boolean);
    return createStubGitHelper({ releaseCommit, existingTags });
  }
  return createRealGitHelper();
}

// =============================================================================
// Validation
// =============================================================================

function validateRelease(release: string): void {
  if (!/^v\d+\.\d+\.\d+$/.test(release)) {
    throw new Error(`INVALID_RELEASE: expected vX.Y.Z format, got "${release}"`);
  }
}

function validateDate(date: string | undefined, dryRun: boolean): void {
  if (!date && !dryRun) {
    throw new Error('MISSING_DATE: --date YYYYMMDD required (or use --dry-run)');
  }
  if (date && !/^\d{8}$/.test(date)) {
    throw new Error(`INVALID_DATE: expected YYYYMMDD format, got "${date}"`);
  }
}

// =============================================================================
// Report Parsing
// =============================================================================

function parseMarkdownForVerification(content: string): {
  verified: boolean;
  verifier_kind: VerifierKind | null;
  os: string;
  node_version: string;
  npm_version: string;
} {
  // Parse Overall Result: [PASS / FAIL / PARTIAL]
  const resultMatch = content.match(/###\s*Overall Result:\s*(PASS|FAIL|PARTIAL)/i);
  const result = resultMatch?.[1]?.toUpperCase() ?? '';
  const verified = result === 'PASS';

  // Parse Verifier Kind
  const kindMatch = content.match(/\*\*Verifier Kind\*\*:\s*(internal|independent)(?:\n|$)/i);
  const verifier_kind = kindMatch?.[1]?.toLowerCase() as VerifierKind | null ?? null;

  // Parse OS - keep original content for placeholder detection
  const osMatch = content.match(/\*\*OS\*\*:\s*(.+?)(?:\n|$)/);
  const os = osMatch?.[1]?.trim() ?? '';

  // Parse Node Version - keep original content for placeholder detection
  const nodeMatch = content.match(/\*\*Node Version\*\*:\s*(.+?)(?:\n|$)/);
  const node_version = nodeMatch?.[1]?.trim() ?? '';

  // Parse npm Version - keep original content for placeholder detection
  const npmMatch = content.match(/\*\*npm Version\*\*:\s*(.+?)(?:\n|$)/);
  const npm_version = npmMatch?.[1]?.trim() ?? '';

  return { verified, verifier_kind, os, node_version, npm_version };
}

async function loadInternalReports(release: string): Promise<VerifiedReport[]> {
  const verifiedDir = join(getVerifierReportsBase(), release, 'verified');

  if (!existsSync(verifiedDir)) {
    return [];
  }

  const entries = await readdir(verifiedDir, { withFileTypes: true });
  const reports: VerifiedReport[] = [];
  const seenVerifiers = new Set<string>();

  // Process in deterministic order (sorted by folder name)
  const folders = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const folder of folders) {
    const match = folder.match(FOLDER_NAME_PATTERN);
    if (!match) {
      continue; // Skip non-conforming folders
    }

    const date = match[1]!;
    const verifier_id = match[2]!;

    // Skip duplicates
    if (seenVerifiers.has(verifier_id)) {
      continue;
    }

    const reportPath = join(verifiedDir, folder, 'VERIFIER_REPORT.md');

    try {
      await access(reportPath);
    } catch {
      continue; // Skip if VERIFIER_REPORT.md doesn't exist
    }

    const content = await readFile(reportPath, 'utf-8');
    const parsed = parseMarkdownForVerification(content);

    // Must be verified with required fields
    if (!parsed.verified) {
      continue;
    }

    // Must have verifier_kind = internal
    if (parsed.verifier_kind !== 'internal') {
      continue;
    }

    // Check required fields are not empty or placeholders
    const hasOS = parsed.os && !parsed.os.includes('[');
    const hasNode = parsed.node_version && !parsed.node_version.includes('[');
    const hasNpm = parsed.npm_version && !parsed.npm_version.includes('[');

    if (!hasOS || !hasNode || !hasNpm) {
      continue;
    }

    seenVerifiers.add(verifier_id);
    reports.push({
      folder_name: folder,
      date,
      verifier_id,
      verifier_kind: 'internal',
      os: parsed.os,
      node_version: parsed.node_version,
      npm_version: parsed.npm_version,
    });
  }

  return reports;
}

// =============================================================================
// INDEX.md Management
// =============================================================================

function checkIndexAlreadyRecorded(content: string, release: string): boolean {
  // Look for "Reference Tag" in the release section
  const sectionRegex = new RegExp(
    `###\\s*${release.replace(/\./g, '\\.')}[\\s\\S]*?(?=###\\s*v\\d|##\\s*Verification Process|$)`
  );
  const sectionMatch = content.match(sectionRegex);

  if (!sectionMatch) {
    return false;
  }

  const section = sectionMatch[0];
  return /Reference Tag\s*\|/.test(section);
}

function updateIndexWithReferenceTag(content: string, release: string, tagName: string): string {
  // Find the release section
  const sectionRegex = new RegExp(
    `(###\\s*${release.replace(/\./g, '\\.')}[\\s\\S]*?)(?=###\\s*v\\d|##\\s*Verification Process|$)`
  );
  const sectionMatch = content.match(sectionRegex);

  if (!sectionMatch) {
    throw new Error(`Release section "${release}" not found in INDEX.md`);
  }

  const section = sectionMatch[1]!;

  // Find the table and add Reference Tag row after Reference run or Verified row
  // Try to insert after "Reference run" row first
  const refRunPattern = /(\| Reference run \|[^\n]*\n)/;
  const refRunMatch = section.match(refRunPattern);

  if (refRunMatch) {
    const insertPoint = section.indexOf(refRunMatch[0]) + refRunMatch[0].length;
    const newRow = `| Reference Tag | \`${tagName}\` |\n`;
    const newSection = section.slice(0, insertPoint) + newRow + section.slice(insertPoint);
    return content.replace(sectionRegex, newSection);
  }

  // Fallback: insert after "Verified" row
  const verifiedRowPattern = /(\| Verified \|[^\n]*\n)/;
  const verifiedRowMatch = section.match(verifiedRowPattern);

  if (!verifiedRowMatch) {
    throw new Error(`Cannot find "| Reference run |" or "| Verified |" row in ${release} section`);
  }

  const insertPoint = section.indexOf(verifiedRowMatch[0]) + verifiedRowMatch[0].length;
  const newRow = `| Reference Tag | \`${tagName}\` |\n`;
  const newSection = section.slice(0, insertPoint) + newRow + section.slice(insertPoint);

  return content.replace(sectionRegex, newSection);
}

// =============================================================================
// Main Logic
// =============================================================================

interface TagReferenceOptions {
  release: string;
  date?: string;
  dryRun: boolean;
}

async function tagReferenceRelease(options: TagReferenceOptions): Promise<void> {
  const { release, date, dryRun } = options;

  // Validate inputs
  validateRelease(release);
  validateDate(date, dryRun);

  const git = getGitHelper();

  // Get target commit
  const targetCommit = git.revParse(release);

  // Load internal reports only
  const internalReports = await loadInternalReports(release);
  const internalCount = internalReports.length;

  // Check threshold (minimum 1 internal report)
  if (internalCount < 1) {
    console.error(`THRESHOLD_NOT_MET: need 1 internal verified report(s); have 0`);
    process.exit(2);
  }

  // Compute tag name
  const tagDate = date ?? '00000000'; // Placeholder for dry-run
  const tagName = `${release}-reference-${tagDate}`;

  // Check if tag already exists
  if (git.tagExists(tagName)) {
    throw new Error(`TAG_EXISTS: ${tagName} already exists`);
  }

  // Check if INDEX.md already records reference tag
  const indexContent = await readFile(getIndexPath(), 'utf-8');
  if (checkIndexAlreadyRecorded(indexContent, release)) {
    throw new Error(`ALREADY_RECORDED: Reference Tag already set for ${release}`);
  }

  // Dry run: output JSON and exit
  if (dryRun) {
    const output: DryRunOutput = {
      release,
      target_commit: targetCommit,
      internal_count: internalCount,
      tag: tagName,
      index_update: 'APPLY',
      tag_action: 'CREATE',
    };
    console.log(canonicalize(output));
    return;
  }

  // Update INDEX.md
  console.log('Updating INDEX.md...');
  const updatedIndex = updateIndexWithReferenceTag(indexContent, release, tagName);
  await writeFile(getIndexPath(), updatedIndex);
  console.log(`  ✓ Added Reference Tag: ${tagName}`);

  // Create annotated tag
  console.log('Creating annotated tag...');
  const tagMessage = `Reference verification by ${internalCount} internal report(s); see artifacts/verifier_reports/INDEX.md`;
  git.createAnnotatedTag(tagName, targetCommit, tagMessage);
  console.log(`  ✓ Created tag: ${tagName} -> ${targetCommit.slice(0, 8)}`);

  // Summary
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✓ Reference milestone recorded`);
  console.log(`  Release: ${release}`);
  console.log(`  Tag: ${tagName}`);
  console.log(`  Internal verifiers: ${internalCount}`);
  console.log(`\nNext: git push origin --tags`);
  console.log(`${'─'.repeat(60)}\n`);
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(
  args: string[]
): { release: string; date?: string; dryRun: boolean } | null {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return null;
  }

  const release = args[0]!;
  let date: string | undefined;
  let dryRun = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--date' && args[i + 1]) {
      date = args[i + 1]!;
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  // Handle exactOptionalPropertyTypes: only include date if defined
  if (date !== undefined) {
    return { release, date, dryRun };
  }
  return { release, dryRun };
}

function printHelp(): void {
  console.log('Usage: npm run tag-reference -- <release> --date <YYYYMMDD> [--dry-run]');
  console.log('');
  console.log('Creates a reference tag for releases with INTERNAL verifier reports.');
  console.log('This is for single-operator self-verification (L0 verification level).');
  console.log('');
  console.log('For verified tags (L1, requires independent verifiers), use: npm run tag-verified');
  console.log('');
  console.log('Arguments:');
  console.log('  release            Release version (e.g., v0.2.1)');
  console.log('');
  console.log('Options:');
  console.log('  --date <YYYYMMDD>  Date for tag name (required unless --dry-run)');
  console.log('  --dry-run          Preview actions without creating tag');
  console.log('  --help             Show this help message');
  console.log('');
  console.log('Environment variables (for testing):');
  console.log('  MOTHER_REPO_ROOT       Override project root path');
  console.log('  MOTHER_GIT_STUB=1      Use stub git helper');
  console.log('  MOTHER_GIT_STUB_COMMIT Stub commit SHA for rev-parse');
  console.log('  MOTHER_GIT_STUB_TAGS   Comma-separated existing tags');
  console.log('');
  console.log('Examples:');
  console.log('  npm run tag-reference -- v0.2.1 --date 20260105 --dry-run');
  console.log('  npm run tag-reference -- v0.2.1 --date 20260105');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed) {
    printHelp();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  await tagReferenceRelease(parsed);
}

// Only run CLI when this file is the entry point
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(`\n✗ Error: ${err.message || err}`);
    process.exit(1);
  });
}

// =============================================================================
// Exports for testing
// =============================================================================

export {
  validateRelease,
  validateDate,
  parseMarkdownForVerification,
  loadInternalReports,
  checkIndexAlreadyRecorded,
  updateIndexWithReferenceTag,
  tagReferenceRelease,
  createStubGitHelper,
  getProjectRoot,
  type VerifierKind,
  type VerifiedReport,
  type DryRunOutput,
  type TagReferenceOptions,
  type GitHelper,
};
