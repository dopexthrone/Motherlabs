#!/usr/bin/env node
/**
 * Pack Verify CLI
 * ===============
 *
 * Verifies a pack directory against PACK_SPEC.md invariants.
 *
 * Usage:
 *   npm run pack-verify -- <path/to/pack>
 *   npm run pack-verify -- <path/to/pack> --no-deep
 *   npm run pack-verify -- <path/to/pack> --no-refs
 *
 * Exit codes:
 *   0 - Pack is valid
 *   1 - Pack is invalid (violations found)
 *   2 - IO error (pack not accessible)
 *   3 - Usage error (bad arguments)
 *
 * Output (canonical JSON):
 *   { "ok": true, "pack_path": "...", "files_verified": [...], "reference_checks": [...] }
 *   or
 *   { "ok": false, "pack_path": "...", "violations": [...] }
 */

import { resolve } from 'node:path';
import { verifyPack } from '../consumer/pack_verify.js';
import { canonicalize } from '../utils/canonical.js';
import type { PackVerifyOptions } from '../consumer/pack_types.js';

// Exit codes
const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_IO_ERROR = 2;
const EXIT_USAGE_ERROR = 3;

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run pack-verify -- <path/to/pack> [options]

Verifies a pack directory against PACK_SPEC.md invariants.

Arguments:
  path              Path to pack directory

Options:
  --no-deep         Skip deep validation of embedded files (bundle, patch, etc.)
  --no-refs         Skip reference integrity verification (hash matching)
  --help, -h        Show this help message

Exit codes:
  0 - Pack is valid
  1 - Pack is invalid (violations found)
  2 - IO error (pack not accessible)
  3 - Usage error (bad arguments)

Examples:
  npm run pack-verify -- ./artifacts/packs/run_20260105
  npm run pack-verify -- ./packs/my_pack --no-deep
  npm run pack-verify -- ./packs/my_pack --no-refs`);
  process.exit(EXIT_USAGE_ERROR);
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): { packPath: string; options: PackVerifyOptions } {
  let packPath: string | undefined;
  const options: PackVerifyOptions = {
    deepValidation: true,
    verifyReferences: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      printUsage();
    } else if (arg === '--no-deep') {
      options.deepValidation = false;
    } else if (arg === '--no-refs') {
      options.verifyReferences = false;
    } else if (!arg.startsWith('-')) {
      packPath = arg;
    } else {
      console.error(`ERROR: Unknown option: ${arg}`);
      process.exit(EXIT_USAGE_ERROR);
    }
  }

  if (!packPath) {
    printUsage();
  }

  return { packPath: resolve(packPath), options };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
  }

  const { packPath, options } = parseArgs(args);

  // Verify pack
  const result = verifyPack(packPath, options);

  // Output canonical JSON
  console.log(canonicalize(result));

  if (result.ok) {
    process.exit(EXIT_OK);
  } else {
    // Check if this is an IO error vs validation error
    const hasIoError = result.violations.some((v) => v.rule_id === 'IO');
    process.exit(hasIoError ? EXIT_IO_ERROR : EXIT_INVALID);
  }
}

main().catch((err) => {
  console.error(`IO_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(EXIT_IO_ERROR);
});
