#!/usr/bin/env node
/**
 * Repository State CLI
 * ====================
 *
 * Captures deterministic repository state for reproducibility auditing.
 *
 * Usage:
 *   npm run repo-state
 *   npm run repo-state -- --out artifacts/repo_state.json
 *   npm run repo-state -- --no-deps --out artifacts/repo_state.json
 *
 * Exit codes:
 *   0 - Success
 *   1 - I/O error
 *   2 - Parse error
 *   3 - Validation error
 *
 * Output (canonical JSON):
 *   { "repo_state_schema_version": "1.0.0", "repo_commit": "...", ... }
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { arch, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

import type { RepoState, RepoStateContracts } from '../consumer/repo_state_types.js';
import { REPO_STATE_SCHEMA_VERSION } from '../consumer/repo_state_types.js';
import { verifyRepoState, serializeRepoState } from '../consumer/repo_state_verify.js';
import { canonicalize } from '../utils/canonical.js';

// Import schema versions from various specs
import { PATCH_SCHEMA_VERSION } from '../consumer/patch_types.js';
import { MODEL_IO_SCHEMA_VERSION } from '../consumer/model_io_types.js';
import { APPLY_SCHEMA_VERSION } from '../consumer/apply_types.js';
import { PACK_SPEC_VERSION } from '../consumer/pack_types.js';
// Bundle schema version
import { SCHEMA_VERSION as BUNDLE_SCHEMA_VERSION } from '../types/artifacts.js';

// These are defined locally since they're not exported
const RUN_SCHEMA_VERSION = '1.0.0';
const GIT_APPLY_SCHEMA_VERSION = '1.0.0';

// Exit codes
const EXIT_OK = 0;
const EXIT_IO_ERROR = 1;
const EXIT_PARSE_ERROR = 2;
const EXIT_VALIDATION_ERROR = 3;

/**
 * Get the project root directory.
 */
function getProjectRoot(): string {
  // Navigate up from dist/tools to project root
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), '..', '..');
}

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run repo-state [options]

Captures deterministic repository state for reproducibility auditing.

Options:
  --out <file>     Write output to file (default: stdout)
  --no-deps        Skip dependency analysis
  --verify <file>  Verify an existing repo_state.json file
  --help, -h       Show this help message

Exit codes:
  0 - Success
  1 - I/O error
  2 - Parse error
  3 - Validation error

Examples:
  npm run repo-state
  npm run repo-state -- --out artifacts/repo_state.json
  npm run repo-state -- --verify artifacts/repo_state.json`);
  process.exit(EXIT_IO_ERROR);
}

/**
 * Run a git command and return stdout.
 */
function runGit(args: string[], cwd: string): string | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

/**
 * Get git HEAD commit hash.
 */
function getRepoCommit(cwd: string): string | null {
  return runGit(['rev-parse', 'HEAD'], cwd);
}

/**
 * Get current branch name (for ephemeral).
 */
function getBranch(cwd: string): string | null {
  return runGit(['branch', '--show-current'], cwd);
}

/**
 * Check if repo is dirty and get dirty paths.
 */
function getDirtyState(cwd: string): { dirty: boolean; paths: string[] } {
  // Get uncommitted changes (staged + unstaged)
  const status = runGit(['status', '--porcelain'], cwd);

  if (status === null || status === '') {
    return { dirty: false, paths: [] };
  }

  // Parse status output and extract paths
  const lines = status.split('\n').filter((l) => l.length > 0);
  const paths: string[] = [];
  for (const line of lines) {
    // Status format: "XY path" or "XY path -> newpath" for renames
    const match = line.match(/^..\s+(.+?)(?:\s+->\s+.+)?$/);
    const p = match ? match[1] : line.slice(3);
    if (p) {
      paths.push(p);
    }
  }

  // Sort paths lexicographically and deduplicate
  const uniquePaths = [...new Set(paths)].sort();

  return { dirty: true, paths: uniquePaths };
}

/**
 * Get Node.js version.
 */
function getNodeVersion(): string {
  return process.version;
}

/**
 * Get npm version.
 */
function getNpmVersion(): string | null {
  const result = spawnSync('npm', ['--version'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

/**
 * Compute SHA256 hash of a file.
 */
function hashFile(filePath: string): string | null {
  try {
    const content = readFileSync(filePath);
    const hash = createHash('sha256').update(content).digest('hex');
    return `sha256:${hash}`;
  } catch {
    return null;
  }
}

/**
 * Get contract versions map.
 */
function getContracts(): RepoStateContracts {
  return {
    apply_schema_version: APPLY_SCHEMA_VERSION,
    bundle_schema_version: BUNDLE_SCHEMA_VERSION,
    git_apply_schema_version: GIT_APPLY_SCHEMA_VERSION,
    model_io_schema_version: MODEL_IO_SCHEMA_VERSION,
    pack_schema_version: PACK_SPEC_VERSION,
    patch_schema_version: PATCH_SCHEMA_VERSION,
    run_schema_version: RUN_SCHEMA_VERSION,
  };
}

/**
 * Generate repo state.
 */
function generateRepoState(projectRoot: string, noDeps: boolean): RepoState | null {
  // Git state
  const repoCommit = getRepoCommit(projectRoot);
  if (!repoCommit) {
    console.error('Error: Failed to get git commit hash');
    return null;
  }

  const { dirty, paths } = getDirtyState(projectRoot);
  const branch = getBranch(projectRoot);

  // Runtime info
  const nodeVersion = getNodeVersion();
  const npmVersion = getNpmVersion();
  if (!npmVersion) {
    console.error('Error: Failed to get npm version');
    return null;
  }

  // Package lock hash
  let packageLockHash: string | null = null;
  if (!noDeps) {
    const lockPath = resolve(projectRoot, 'package-lock.json');
    packageLockHash = hashFile(lockPath);
    if (!packageLockHash) {
      console.error('Error: Failed to hash package-lock.json');
      return null;
    }
  } else {
    // Use placeholder when deps skipped
    packageLockHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  }

  // Build repo state
  const state: RepoState = {
    repo_state_schema_version: REPO_STATE_SCHEMA_VERSION,
    repo_commit: repoCommit,
    repo_dirty: dirty,
    dirty_paths: paths,
    node_version: nodeVersion,
    npm_version: npmVersion,
    os_platform: platform(),
    os_arch: arch(),
    package_lock_sha256: packageLockHash,
    contracts: getContracts(),
    ephemeral: {
      generated_at: new Date().toISOString(),
      ...(branch ? { display_branch: branch } : {}),
    },
  };

  return state;
}

/**
 * Verify an existing repo state file.
 */
function verifyFile(filePath: string): number {
  const fullPath = resolve(filePath);

  if (!existsSync(fullPath)) {
    console.error(canonicalize({
      ok: false,
      error: `File not found: ${filePath}`,
    }));
    return EXIT_IO_ERROR;
  }

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch (err) {
    console.error(canonicalize({
      ok: false,
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    }));
    return EXIT_IO_ERROR;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error(canonicalize({
      ok: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }));
    return EXIT_PARSE_ERROR;
  }

  const result = verifyRepoState(parsed);

  if (result.valid) {
    console.log(canonicalize({
      ok: true,
      file: filePath,
      repo_state_hash: result.repo_state_hash,
      node_version_match: result.node_version_match,
    }));
    return EXIT_OK;
  } else {
    console.log(canonicalize({
      ok: false,
      file: filePath,
      violations: result.violations,
    }));
    return EXIT_VALIDATION_ERROR;
  }
}

/**
 * Parsed command line arguments.
 */
interface ParsedArgs {
  mode: 'generate' | 'verify';
  outFile?: string;
  verifyFile?: string;
  noDeps: boolean;
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): ParsedArgs {
  let outFile: string | undefined;
  let verifyFilePath: string | undefined;
  let noDeps = false;
  let mode: 'generate' | 'verify' = 'generate';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      printUsage();
    } else if (arg === '--out' && args[i + 1]) {
      outFile = args[i + 1]!;
      i++;
    } else if (arg === '--verify' && args[i + 1]) {
      verifyFilePath = args[i + 1]!;
      mode = 'verify';
      i++;
    } else if (arg === '--no-deps') {
      noDeps = true;
    } else if (!arg.startsWith('-')) {
      // Positional argument - could be verify file if no --verify
      if (!verifyFilePath && !outFile) {
        verifyFilePath = arg;
        mode = 'verify';
      }
    }
  }

  const result: ParsedArgs = { mode, noDeps };
  if (outFile) {
    result.outFile = outFile;
  }
  if (verifyFilePath) {
    result.verifyFile = verifyFilePath;
  }
  return result;
}

/**
 * Main entry point.
 */
function main(): never {
  const args = process.argv.slice(2);
  const { mode, outFile, verifyFile: verifyFilePath, noDeps } = parseArgs(args);

  // Verify mode
  if (mode === 'verify' && verifyFilePath) {
    const code = verifyFile(verifyFilePath);
    process.exit(code);
  }

  // Generate mode
  const projectRoot = getProjectRoot();
  const state = generateRepoState(projectRoot, noDeps);

  if (!state) {
    process.exit(EXIT_IO_ERROR);
  }

  // Verify the generated state
  const verification = verifyRepoState(state, { skipNodeVersionCheck: false });

  // Filter out RS2 violations (node version warning) for output
  const criticalViolations = verification.violations.filter(v => v.rule_id !== 'RS2');

  if (criticalViolations.length > 0) {
    console.error(canonicalize({
      ok: false,
      error: 'Generated repo state has violations',
      violations: criticalViolations,
    }));
    process.exit(EXIT_VALIDATION_ERROR);
  }

  // Serialize to canonical JSON
  const output = serializeRepoState(state);

  // Write to file or stdout
  if (outFile) {
    try {
      writeFileSync(resolve(outFile), output + '\n', 'utf-8');
      // Output confirmation to stdout
      console.log(canonicalize({
        ok: true,
        file: outFile,
        repo_state_hash: verification.repo_state_hash,
        node_version_match: verification.node_version_match,
      }));
    } catch (err) {
      console.error(canonicalize({
        ok: false,
        error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
      }));
      process.exit(EXIT_IO_ERROR);
    }
  } else {
    // Output to stdout
    console.log(output);
  }

  process.exit(EXIT_OK);
}

main();
