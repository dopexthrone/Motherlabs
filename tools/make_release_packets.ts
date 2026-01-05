#!/usr/bin/env node
/**
 * Release Packet Generator
 * ========================
 *
 * Automates creation of verification packets and transfer bundles.
 *
 * Usage:
 *   npx tsx tools/make_release_packets.ts <version> [--force]
 *
 * Example:
 *   npx tsx tools/make_release_packets.ts v0.2.1
 *
 * This tool creates:
 *   1. artifacts/freeze/<version>/         - Freeze manifest
 *   2. artifacts/verification_packets/<version>/ - Verification packet
 *   3. artifacts/transfer/<version>/       - Transfer bundle
 *
 * Prerequisites:
 *   - Git tag must exist for the version
 *   - Clean working tree (no uncommitted changes)
 *   - All tests must pass
 */

import { readFile, writeFile, mkdir, readdir, copyFile, stat, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { platform, arch } from 'node:os';

// =============================================================================
// Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const ARTIFACTS_DIR = join(PROJECT_ROOT, 'artifacts');
const FREEZE_BASE = join(ARTIFACTS_DIR, 'freeze');
const PACKETS_BASE = join(ARTIFACTS_DIR, 'verification_packets');
const TRANSFER_BASE = join(ARTIFACTS_DIR, 'transfer');
const GOLDENS_PATH = join(ARTIFACTS_DIR, 'goldens', 'goldens.json');
const DOCS_DIR = join(PROJECT_ROOT, 'docs');

// Files to include in docs/
const DOC_FILES = [
  'CHANGELOG_GOLDENS.md',
  'GOVERNANCE.md',
  'KERNEL_DETERMINISM.md',
  'VERIFY_RELEASE.md',
];

// Directories/files to exclude from file_sha256.txt
const EXCLUDE_PATTERNS = [
  /^\.git\//,
  /^node_modules\//,
  /^dist\//,
  /^artifacts\//,
  /^\.DS_Store$/,
  /\.log$/,
  /^coverage\//,
];

// =============================================================================
// Utilities
// =============================================================================

function exec(cmd: string, options?: { cwd?: string }): string {
  return execSync(cmd, {
    cwd: options?.cwd ?? PROJECT_ROOT,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function sha256File(filePath: string): string {
  const content = execSync(`cat "${filePath}"`, { encoding: 'buffer' });
  return createHash('sha256').update(content).digest('hex');
}

function sha256String(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

async function getAllFiles(dir: string, base: string = ''): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = base ? `${base}/${entry.name}` : entry.name;

    // Check exclusions
    if (EXCLUDE_PATTERNS.some((p) => p.test(relativePath))) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await getAllFiles(join(dir, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

// =============================================================================
// Freeze Manifest
// =============================================================================

async function createFreezeManifest(version: string, freezeDir: string): Promise<void> {
  console.log('\n  Creating freeze manifest...');
  await mkdir(freezeDir, { recursive: true });

  // 1. commit.txt
  // Use ^{commit} to dereference annotated tags to the actual commit
  const commit = exec(`git rev-parse ${version}^{commit}`);
  await writeFile(join(freezeDir, 'commit.txt'), commit + '\n');
  console.log(`    commit.txt: ${commit}`);

  // 2. node_version.txt
  const nodeVersion = process.version;
  await writeFile(join(freezeDir, 'node_version.txt'), nodeVersion + '\n');
  console.log(`    node_version.txt: ${nodeVersion}`);

  // 3. host_platform.txt
  const hostPlatform = `${platform()} ${arch()}`;
  await writeFile(join(freezeDir, 'host_platform.txt'), hostPlatform + '\n');
  console.log(`    host_platform.txt: ${hostPlatform}`);

  // 4. file_sha256.txt - hash all source files at the tag
  console.log('    file_sha256.txt: computing...');

  // Create temp dir and extract tag
  const tempDir = `/tmp/freeze_extract_${version}`;
  if (existsSync(tempDir)) {
    await rm(tempDir, { recursive: true });
  }
  await mkdir(tempDir, { recursive: true });

  exec(`git archive ${version} | tar -x -C ${tempDir}`);

  const files = await getAllFiles(tempDir);
  const hashes: string[] = [];

  for (const file of files) {
    const filePath = join(tempDir, file);
    const hash = sha256File(filePath);
    hashes.push(`${hash}  ${file}`);
  }

  await writeFile(join(freezeDir, 'file_sha256.txt'), hashes.join('\n') + '\n');
  console.log(`    file_sha256.txt: ${files.length} files hashed`);

  // Cleanup temp
  await rm(tempDir, { recursive: true });

  // 5. goldens.json - copy current goldens
  if (existsSync(GOLDENS_PATH)) {
    await copyFile(GOLDENS_PATH, join(freezeDir, 'goldens.json'));
    console.log('    goldens.json: copied');
  }
}

// =============================================================================
// Verification Packet
// =============================================================================

async function createVerificationPacket(
  version: string,
  freezeDir: string,
  packetDir: string
): Promise<void> {
  console.log('\n  Creating verification packet...');
  await mkdir(packetDir, { recursive: true });

  // 1. Copy docs/
  const docsDir = join(packetDir, 'docs');
  await mkdir(docsDir, { recursive: true });

  for (const docFile of DOC_FILES) {
    // Check multiple locations for doc files
    const locations = [
      join(DOCS_DIR, docFile),
      join(PROJECT_ROOT, docFile),
    ];

    for (const loc of locations) {
      if (existsSync(loc)) {
        await copyFile(loc, join(docsDir, docFile));
        console.log(`    docs/${docFile}: copied`);
        break;
      }
    }
  }

  // 2. Copy freeze/
  await copyDir(freezeDir, join(packetDir, 'freeze'));
  console.log('    freeze/: copied');

  // 3. Create source.tar.gz from tag
  const tarPath = join(packetDir, 'source.tar.gz');
  exec(`git archive --format=tar.gz --prefix=context-engine-kernel/ ${version} > "${tarPath}"`);
  console.log('    source.tar.gz: created');

  // 4. Create source.tar.gz.sha256
  const tarHash = sha256File(tarPath);
  await writeFile(join(packetDir, 'source.tar.gz.sha256'), `${tarHash}  source.tar.gz\n`);
  console.log(`    source.tar.gz.sha256: ${tarHash.slice(0, 16)}...`);

  // 5. Create README_VERIFY.txt
  const readmeContent = `Verify ${version}:
1) Confirm sha256 of source.tar.gz matches source.tar.gz.sha256
2) Follow docs/VERIFY_RELEASE.md exactly
3) Report:
   - OS/version
   - node --version
   - npm test results
   - npm run golden results
   - any mismatching hashes and logs
`;
  await writeFile(join(packetDir, 'README_VERIFY.txt'), readmeContent);
  console.log('    README_VERIFY.txt: created');

  // 6. Create PACKET_SHA256SUMS.txt
  await createChecksumFile(packetDir, 'PACKET_SHA256SUMS.txt');
  console.log('    PACKET_SHA256SUMS.txt: created');
}

// =============================================================================
// Transfer Bundle
// =============================================================================

async function createTransferBundle(
  version: string,
  packetDir: string,
  transferDir: string
): Promise<void> {
  console.log('\n  Creating transfer bundle...');
  await mkdir(transferDir, { recursive: true });

  // 1. Copy source.tar.gz and .sha256 from packet
  await copyFile(join(packetDir, 'source.tar.gz'), join(transferDir, 'source.tar.gz'));
  await copyFile(join(packetDir, 'source.tar.gz.sha256'), join(transferDir, 'source.tar.gz.sha256'));
  console.log('    source.tar.gz: copied');

  // 2. Create source.zip from tag
  const zipPath = join(transferDir, 'source.zip');
  exec(`git archive --format=zip --prefix=context-engine-kernel/ ${version} > "${zipPath}"`);
  console.log('    source.zip: created');

  // 3. Create source.zip.sha256
  const zipHash = sha256File(zipPath);
  await writeFile(join(transferDir, 'source.zip.sha256'), `${zipHash}  source.zip\n`);
  console.log(`    source.zip.sha256: ${zipHash.slice(0, 16)}...`);

  // 4. Copy verification_packet/
  await copyDir(packetDir, join(transferDir, 'verification_packet'));
  console.log('    verification_packet/: copied');

  // 5. Create TRANSFER_SHA256SUMS.txt
  await createChecksumFile(transferDir, 'TRANSFER_SHA256SUMS.txt');
  console.log('    TRANSFER_SHA256SUMS.txt: created');
}

// =============================================================================
// Checksum File Generation
// =============================================================================

async function createChecksumFile(dir: string, filename: string): Promise<void> {
  const checksumPath = join(dir, filename);

  // Collect all files except the checksum file itself (standard practice)
  const files = await collectFilesRecursive(dir, '.');
  const fileList = files.filter((f) => f !== `./${filename}`).sort();

  // Generate checksums for all files
  const lines: string[] = [];

  for (const file of fileList) {
    const filePath = join(dir, file.slice(2)); // Remove './' prefix
    const hash = sha256File(filePath);
    lines.push(`${hash}  ${file}`);
  }

  await writeFile(checksumPath, lines.join('\n') + '\n');
}

async function collectFilesRecursive(baseDir: string, relativePath: string): Promise<string[]> {
  const files: string[] = [];
  const absPath = join(baseDir, relativePath);
  const entries = await readdir(absPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelative = relativePath === '.' ? `./${entry.name}` : `${relativePath}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursive(baseDir, entryRelative)));
    } else if (entry.isFile()) {
      files.push(entryRelative);
    }
  }

  return files;
}

// =============================================================================
// Validation
// =============================================================================

async function validatePrerequisites(version: string, force: boolean): Promise<void> {
  console.log('Validating prerequisites...');

  // Check version format
  if (!/^v\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version format: ${version}. Expected vX.Y.Z`);
  }

  // Check git tag exists
  try {
    exec(`git rev-parse ${version}`);
    console.log(`  ✓ Git tag ${version} exists`);
  } catch {
    throw new Error(`Git tag ${version} does not exist. Create it first.`);
  }

  // Check for uncommitted changes (warning only)
  const status = exec('git status --porcelain');
  if (status && !force) {
    console.log('  ⚠ Working tree has uncommitted changes');
  } else {
    console.log('  ✓ Working tree is clean');
  }

  // Check Node version
  const nodeVersion = process.version;
  console.log(`  ✓ Node version: ${nodeVersion}`);

  // Check output directories
  const freezeDir = join(FREEZE_BASE, version);
  const packetDir = join(PACKETS_BASE, version);
  const transferDir = join(TRANSFER_BASE, version);

  if ((existsSync(freezeDir) || existsSync(packetDir) || existsSync(transferDir)) && !force) {
    throw new Error(
      `Output directories already exist for ${version}. Use --force to overwrite.`
    );
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: make_release_packets <version> [--force]');
    console.log('');
    console.log('Arguments:');
    console.log('  version    Release version (e.g., v0.2.1)');
    console.log('');
    console.log('Options:');
    console.log('  --force    Overwrite existing output directories');
    console.log('  --help     Show this help message');
    console.log('');
    console.log('Example:');
    console.log('  npx tsx tools/make_release_packets.ts v0.2.1');
    process.exit(0);
  }

  const version = args[0]!;
  const force = args.includes('--force');

  console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║  Release Packet Generator                                       ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝`);
  console.log(`\nVersion: ${version}`);

  // Validate prerequisites
  await validatePrerequisites(version, force);

  // Setup directories
  const freezeDir = join(FREEZE_BASE, version);
  const packetDir = join(PACKETS_BASE, version);
  const transferDir = join(TRANSFER_BASE, version);

  // Clean if force
  if (force) {
    for (const dir of [freezeDir, packetDir, transferDir]) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true });
      }
    }
  }

  // Create artifacts
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('Creating release artifacts...');
  console.log('────────────────────────────────────────────────────────────────');

  // Step 1: Freeze manifest
  await createFreezeManifest(version, freezeDir);

  // Step 2: Verification packet
  await createVerificationPacket(version, freezeDir, packetDir);

  // Step 3: Transfer bundle
  await createTransferBundle(version, packetDir, transferDir);

  // Summary
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('Summary');
  console.log('────────────────────────────────────────────────────────────────');
  console.log(`\n  Freeze manifest:      ${freezeDir}`);
  console.log(`  Verification packet:  ${packetDir}`);
  console.log(`  Transfer bundle:      ${transferDir}`);

  // Verify checksums
  console.log('\n  Verifying checksums...');
  const tarHash = sha256File(join(transferDir, 'source.tar.gz'));
  const zipHash = sha256File(join(transferDir, 'source.zip'));
  console.log(`    source.tar.gz: ${tarHash}`);
  console.log(`    source.zip:    ${zipHash}`);

  console.log(`\n✓ Release packets created successfully for ${version}\n`);
}

main().catch((err) => {
  console.error('\n✗ Error:', err.message || err);
  process.exit(1);
});
