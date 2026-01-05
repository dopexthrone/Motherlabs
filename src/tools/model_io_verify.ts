#!/usr/bin/env node
/**
 * Model IO Verify CLI
 * ===================
 *
 * Verifies a model IO session file against MODEL_IO_SPEC.md invariants.
 *
 * Usage:
 *   npm run model-io-verify -- <path/to/model_io.json>
 *   npm run model-io-verify -- <path/to/model_io.json> --no-response-hashes
 *   npm run model-io-verify -- <path/to/model_io.json> --no-size-limits
 *
 * Exit codes:
 *   0 - Model IO is valid
 *   1 - IO error (file not accessible)
 *   2 - Parse error (invalid JSON)
 *   3 - Validation error (violations found)
 *
 * Output (canonical JSON):
 *   { "ok": true, "interactions_count": N, "model_io_hash": "sha256:..." }
 *   or
 *   { "ok": false, "violations": [...] }
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyModelIO } from '../consumer/model_io_verify.js';
import { canonicalize } from '../utils/canonical.js';
import type { ModelIOVerifyOptions } from '../consumer/model_io_types.js';

// Exit codes
const EXIT_OK = 0;
const EXIT_IO_ERROR = 1;
const EXIT_PARSE_ERROR = 2;
const EXIT_VALIDATION_ERROR = 3;

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run model-io-verify -- <path/to/model_io.json> [options]

Verifies a model IO session file against MODEL_IO_SPEC.md invariants.

Arguments:
  path                    Path to model_io.json file

Options:
  --no-response-hashes    Skip response hash integrity verification (MI7)
  --no-size-limits        Skip size limit enforcement (MI11)
  --help, -h              Show this help message

Exit codes:
  0 - Model IO is valid
  1 - IO error (file not accessible)
  2 - Parse error (invalid JSON)
  3 - Validation error (violations found)

Examples:
  npm run model-io-verify -- ./recordings/session_001.json
  npm run model-io-verify -- ./model_io.json --no-response-hashes
  npm run model-io-verify -- ./model_io.json --no-size-limits`);
  process.exit(EXIT_IO_ERROR);
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): { filePath: string; options: ModelIOVerifyOptions } {
  let filePath: string | undefined;
  const options: ModelIOVerifyOptions = {
    verifyResponseHashes: true,
    enforceSizeLimits: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      printUsage();
    } else if (arg === '--no-response-hashes') {
      options.verifyResponseHashes = false;
    } else if (arg === '--no-size-limits') {
      options.enforceSizeLimits = false;
    } else if (!arg.startsWith('-')) {
      filePath = arg;
    } else {
      console.log(canonicalize({
        ok: false,
        violations: [{
          rule_id: 'CLI',
          message: `Unknown option: ${arg}`,
        }],
      }));
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
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.log(canonicalize({
      ok: false,
      violations: [{
        rule_id: 'IO',
        path: filePath,
        message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      }],
    }));
    process.exit(EXIT_IO_ERROR);
  }

  // Parse JSON
  let session: unknown;
  try {
    session = JSON.parse(content);
  } catch (err) {
    console.log(canonicalize({
      ok: false,
      violations: [{
        rule_id: 'PARSE',
        path: filePath,
        message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      }],
    }));
    process.exit(EXIT_PARSE_ERROR);
  }

  // Verify
  const result = verifyModelIO(session, options);

  // Output canonical JSON
  console.log(canonicalize(result));

  if (result.ok) {
    process.exit(EXIT_OK);
  } else {
    process.exit(EXIT_VALIDATION_ERROR);
  }
}

main().catch((err) => {
  console.log(canonicalize({
    ok: false,
    violations: [{
      rule_id: 'IO',
      message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    }],
  }));
  process.exit(EXIT_IO_ERROR);
});
