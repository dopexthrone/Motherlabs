#!/usr/bin/env node
/**
 * Git Apply CLI
 * =============
 *
 * Applies a patch from a PACK_SPEC-compliant directory to a git repository.
 *
 * Usage:
 *   npm run git-apply -- --pack <dir> --repo <dir> [options]
 *
 * Options:
 *   --pack <dir>            Path to pack directory containing patch.json (required)
 *   --repo <dir>            Path to git repository root (required)
 *   --branch <name>         Target branch name (default: apply/{run_id} or apply/manual)
 *   --dry-run               Generate report without writing files or git changes
 *   --commit                Create a commit after applying
 *   --message <msg>         Custom commit message (requires --commit)
 *   --allow-dirty           Allow apply on dirty working tree
 *   --help, -h              Show this help message
 *
 * Exit codes (per GIT_APPLY_SPEC.md Section 11.1):
 *   0 - Success (outcome=SUCCESS)
 *   1 - IO error (file not found, etc.)
 *   2 - Parse error (invalid JSON, etc.)
 *   3 - Validation/spec violation (GA*)
 *   4 - Git error (command failed)
 *
 * Output (canonical JSON):
 *   GitApplyResult per GIT_APPLY_SPEC.md
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { applyPackToGitRepo } from '../harness/git_apply.js';
import { canonicalize } from '../utils/canonical.js';
import type { GitApplyArgs, GitApplyOptions } from '../harness/git_apply.js';

// Exit codes per GIT_APPLY_SPEC.md Section 11.1
const EXIT_SUCCESS = 0;
const EXIT_IO_ERROR = 1;
const EXIT_PARSE_ERROR = 2;
const EXIT_VALIDATION_ERROR = 3;
const EXIT_GIT_ERROR = 4;

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run git-apply -- --pack <dir> --repo <dir> [options]

Applies a patch from a PACK_SPEC-compliant directory to a git repository.

Required arguments:
  --pack <dir>              Path to pack directory containing patch.json
  --repo <dir>              Path to git repository root

Options:
  --branch <name>           Target branch name (default: apply/{run_id} or apply/manual)
  --dry-run                 Generate report without writing files or git changes
  --commit                  Create a commit after applying
  --message <msg>           Custom commit message (requires --commit)
  --allow-dirty             Allow apply on dirty working tree
  --help, -h                Show this help message

Exit codes:
  0 - Success (outcome=SUCCESS)
  1 - IO error (file not found, etc.)
  2 - Parse error (invalid JSON, etc.)
  3 - Validation/spec violation (GA*)
  4 - Git error (command failed)

Examples:
  npm run git-apply -- --pack /tmp/pack_test --repo ./my-repo
  npm run git-apply -- --pack ./packs/run_001 --repo /tmp/git_test --dry-run
  npm run git-apply -- --pack ./packs/run_001 --repo ./project --commit --branch feature/apply`);
  process.exit(EXIT_VALIDATION_ERROR);
}

/**
 * Parsed CLI arguments.
 */
interface ParsedArgs {
  packDir: string;
  repoRoot: string;
  options: GitApplyOptions;
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): ParsedArgs {
  let packDir: string | undefined;
  let repoRoot: string | undefined;
  const options: GitApplyOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      printUsage();
    } else if (arg === '--pack' && args[i + 1]) {
      packDir = args[i + 1];
      i++;
    } else if (arg === '--repo' && args[i + 1]) {
      repoRoot = args[i + 1];
      i++;
    } else if (arg === '--branch' && args[i + 1]) {
      options.branch = args[i + 1]!;
      i++;
    } else if (arg === '--message' && args[i + 1]) {
      options.commitMessage = args[i + 1]!;
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--commit') {
      options.commit = true;
    } else if (arg === '--allow-dirty') {
      options.allowDirty = true;
    } else if (arg.startsWith('-')) {
      console.error(`ERROR: Unknown option: ${arg}`);
      process.exit(EXIT_VALIDATION_ERROR);
    }
  }

  // Validate required arguments
  if (!packDir) {
    console.error('ERROR: --pack is required');
    printUsage();
  }

  if (!repoRoot) {
    console.error('ERROR: --repo is required');
    printUsage();
  }

  // Validate --message requires --commit
  if (options.commitMessage && !options.commit) {
    console.error('ERROR: --message requires --commit');
    process.exit(EXIT_VALIDATION_ERROR);
  }

  return {
    packDir: resolve(packDir),
    repoRoot: repoRoot, // Keep original for traversal check in engine
    options,
  };
}

/**
 * Determine exit code from result.
 */
function getExitCode(result: { outcome: string; error?: string }): number {
  switch (result.outcome) {
    case 'SUCCESS':
      return EXIT_SUCCESS;
    case 'PARTIAL':
    case 'FAILED':
      // Check if it's a git error
      if (result.error?.startsWith('GIT_ERROR:')) {
        return EXIT_GIT_ERROR;
      }
      return EXIT_IO_ERROR;
    case 'REFUSED':
      // Check if it's a git error
      if (result.error?.startsWith('GIT_ERROR:')) {
        return EXIT_GIT_ERROR;
      }
      return EXIT_VALIDATION_ERROR;
    default:
      return EXIT_IO_ERROR;
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
  }

  const parsed = parseArgs(args);

  // Check pack directory exists
  if (!existsSync(parsed.packDir)) {
    console.error(`IO_ERROR: pack directory not found: ${parsed.packDir}`);
    process.exit(EXIT_IO_ERROR);
  }

  // Check repo root exists
  if (!existsSync(parsed.repoRoot)) {
    console.error(`IO_ERROR: repository not found: ${parsed.repoRoot}`);
    process.exit(EXIT_IO_ERROR);
  }

  try {
    const applyArgs: GitApplyArgs = {
      pack_dir: parsed.packDir,
      repo_root: parsed.repoRoot,
      options: parsed.options,
    };

    const result = await applyPackToGitRepo(applyArgs);

    // Output canonical JSON
    console.log(canonicalize(result));

    // Exit code based on outcome
    const exitCode = getExitCode(result);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Categorize error
    if (message.includes('JSON') || message.includes('parse')) {
      console.error(`PARSE_ERROR: ${message}`);
      process.exit(EXIT_PARSE_ERROR);
    } else if (message.startsWith('GIT_ERROR:')) {
      console.error(message);
      process.exit(EXIT_GIT_ERROR);
    } else {
      console.error(`IO_ERROR: ${message}`);
      process.exit(EXIT_IO_ERROR);
    }
  }
}

main().catch((err) => {
  console.error(`IO_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(EXIT_IO_ERROR);
});
