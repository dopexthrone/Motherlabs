#!/usr/bin/env node
/**
 * Pack Apply CLI
 * ==============
 *
 * Applies a patch from a PACK_SPEC-compliant directory to a target directory.
 *
 * Usage:
 *   npm run pack-apply -- --pack <dir> --target <dir> [options]
 *
 * Options:
 *   --pack <dir>            Path to pack directory containing patch.json (required)
 *   --target <dir>          Target directory to apply patch to (required)
 *   --dry-run               Generate report without writing files
 *   --help, -h              Show this help message
 *
 * Exit codes:
 *   0 - Success (outcome=SUCCESS)
 *   1 - Partial or failed (outcome=PARTIAL or FAILED)
 *   2 - Refused or validation error (outcome=REFUSED)
 *   3 - IO error (pack not found, etc.)
 *
 * Output (canonical JSON):
 *   ApplyResult per APPLY_SPEC.md
 */

import { resolve } from 'node:path';
import { applyPatch } from '../harness/pack_apply.js';
import { canonicalize } from '../utils/canonical.js';
import type { ApplyPackArgs } from '../harness/pack_apply.js';
import type { ApplyOptions } from '../consumer/apply_types.js';

// Exit codes per APPLY_SPEC.md Section 9.1
const EXIT_SUCCESS = 0;
const EXIT_PARTIAL_OR_FAILED = 1;
const EXIT_REFUSED = 2;
const EXIT_IO_ERROR = 3;

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run pack-apply -- --pack <dir> --target <dir> [options]

Applies a patch from a PACK_SPEC-compliant directory to a target directory.

Required arguments:
  --pack <dir>              Path to pack directory containing patch.json
  --target <dir>            Target directory to apply patch to

Options:
  --dry-run                 Generate report without writing files
  --help, -h                Show this help message

Exit codes:
  0 - Success (outcome=SUCCESS)
  1 - Partial or failed (outcome=PARTIAL or FAILED)
  2 - Refused or validation error (outcome=REFUSED)
  3 - IO error (pack not found, etc.)

Examples:
  npm run pack-apply -- --pack /tmp/pack_test --target ./workspace
  npm run pack-apply -- --pack ./packs/run_001 --target /tmp/apply_test --dry-run`);
  process.exit(EXIT_REFUSED);
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): ApplyPackArgs {
  let packDir: string | undefined;
  let targetRoot: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      printUsage();
    } else if (arg === '--pack' && args[i + 1]) {
      packDir = args[i + 1];
      i++;
    } else if (arg === '--target' && args[i + 1]) {
      targetRoot = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('-')) {
      console.error(`ERROR: Unknown option: ${arg}`);
      process.exit(EXIT_REFUSED);
    }
  }

  // Validate required arguments
  if (!packDir) {
    console.error('ERROR: --pack is required');
    printUsage();
  }

  if (!targetRoot) {
    console.error('ERROR: --target is required');
    printUsage();
  }

  // Keep original paths for traversal checking
  const applyArgs: ApplyPackArgs = {
    pack_dir: resolve(packDir),
    target_root: targetRoot, // Keep original for traversal check
  };

  const options: ApplyOptions = {};
  if (dryRun) {
    options.dryRun = true;
  }

  if (Object.keys(options).length > 0) {
    applyArgs.options = options;
  }

  return applyArgs;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
  }

  const applyArgs = parseArgs(args);

  try {
    const result = await applyPatch(applyArgs);

    // Output canonical JSON
    console.log(canonicalize(result));

    // Exit code based on outcome per APPLY_SPEC.md Section 9.1
    switch (result.outcome) {
      case 'SUCCESS':
        process.exit(EXIT_SUCCESS);
        break;
      case 'PARTIAL':
      case 'FAILED':
        process.exit(EXIT_PARTIAL_OR_FAILED);
        break;
      case 'REFUSED':
        process.exit(EXIT_REFUSED);
        break;
      default:
        process.exit(EXIT_IO_ERROR);
    }
  } catch (error) {
    console.error(`IO_ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_IO_ERROR);
  }
}

main().catch((err) => {
  console.error(`IO_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(EXIT_IO_ERROR);
});
