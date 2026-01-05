#!/usr/bin/env node
/**
 * Patch Verify CLI
 * ================
 *
 * Verifies a patch set file against PATCH_SPEC.md invariants.
 *
 * Usage:
 *   npm run patch-verify -- <path/to/patch.json>
 *   npm run patch-verify -- <path/to/patch.json> --max-bytes 10485760
 *
 * Exit codes:
 *   0 - Patch set is valid
 *   1 - IO error (file not found, not readable)
 *   2 - Parse error (invalid JSON)
 *   3 - Validation error (contract violations)
 *
 * Output (canonical JSON):
 *   { "ok": true }
 *   or
 *   { "ok": false, "violations": [...] }
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyPatch } from '../consumer/patch_verify.js';
import { canonicalize } from '../utils/canonical.js';
import type { PatchVerifyOptions } from '../consumer/patch_types.js';

// Exit codes
const EXIT_OK = 0;
const EXIT_IO_ERROR = 1;
const EXIT_PARSE_ERROR = 2;
const EXIT_VALIDATION_ERROR = 3;

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run patch-verify -- <path/to/patch.json> [options]

Verifies a patch set file against PATCH_SPEC.md invariants.

Arguments:
  path              Path to patch JSON file

Options:
  --max-bytes <n>   Maximum total bytes allowed (default: 52428800 / 50MB)
  --help, -h        Show this help message

Exit codes:
  0 - Patch set is valid
  1 - IO error (file not found, not readable)
  2 - Parse error (invalid JSON)
  3 - Validation error (contract violations)`);
  process.exit(EXIT_IO_ERROR);
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): { filePath: string; options: PatchVerifyOptions } {
  let filePath: string | undefined;
  const options: PatchVerifyOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      printUsage();
    } else if (arg === '--max-bytes') {
      const value = args[++i];
      if (!value || isNaN(parseInt(value, 10))) {
        console.error('ERROR: --max-bytes requires a numeric value');
        process.exit(EXIT_IO_ERROR);
      }
      options.maxTotalBytes = parseInt(value, 10);
    } else if (!arg.startsWith('-')) {
      filePath = arg;
    } else {
      console.error(`ERROR: Unknown option: ${arg}`);
      process.exit(EXIT_IO_ERROR);
    }
  }

  if (!filePath) {
    printUsage();
  }

  return { filePath: resolve(filePath), options };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
  }

  const { filePath, options } = parseArgs(args);

  // Read file
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`IO_ERROR: ${message}`);
    process.exit(EXIT_IO_ERROR);
  }

  // Parse JSON
  let patch: unknown;
  try {
    patch = JSON.parse(content);
  } catch {
    console.error('PARSE_ERROR: invalid JSON');
    process.exit(EXIT_PARSE_ERROR);
  }

  // Verify patch
  const result = verifyPatch(patch, options);

  // Output canonical JSON
  console.log(canonicalize(result));

  if (result.ok) {
    process.exit(EXIT_OK);
  } else {
    process.exit(EXIT_VALIDATION_ERROR);
  }
}

main().catch((err) => {
  console.error(`IO_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(EXIT_IO_ERROR);
});
