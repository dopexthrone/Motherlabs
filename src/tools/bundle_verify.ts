#!/usr/bin/env node
/**
 * Bundle Verify CLI
 * =================
 *
 * Verifies a bundle file against BUNDLE_SPEC.md invariants.
 *
 * Usage:
 *   npm run bundle-verify -- <path/to/bundle.json>
 *
 * Exit codes:
 *   0 - Bundle is valid
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
import { verifyBundle } from '../consumer/bundle_verify.js';
import { canonicalize } from '../utils/canonical.js';

// Exit codes
const EXIT_OK = 0;
const EXIT_IO_ERROR = 1;
const EXIT_PARSE_ERROR = 2;
const EXIT_VALIDATION_ERROR = 3;

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run bundle-verify -- <path/to/bundle.json>

Verifies a bundle file against BUNDLE_SPEC.md invariants.

Arguments:
  path    Path to bundle JSON file

Exit codes:
  0 - Bundle is valid
  1 - IO error (file not found, not readable)
  2 - Parse error (invalid JSON)
  3 - Validation error (contract violations)`);
  process.exit(EXIT_IO_ERROR);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
  }

  const filePath = resolve(args[0]!);

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
  let bundle: unknown;
  try {
    bundle = JSON.parse(content);
  } catch {
    console.error('PARSE_ERROR: invalid JSON');
    process.exit(EXIT_PARSE_ERROR);
  }

  // Verify bundle
  const result = verifyBundle(bundle);

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
