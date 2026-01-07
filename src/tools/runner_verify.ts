#!/usr/bin/env node
/**
 * Runner Verify CLI
 * =================
 *
 * Verifies runner records against RUNNER_SPEC.md invariants.
 *
 * Usage:
 *   npm run runner-verify -- <file>
 *   npm run runner-verify -- -
 *
 * Exit codes:
 *   0 - Success (valid runner)
 *   1 - I/O error
 *   2 - Parse error
 *   3 - Validation error
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { verifyRunner } from '../consumer/runner_verify.js';
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
  console.log(`Usage: npm run runner-verify -- <file>

Verifies runner records against RUNNER_SPEC.md invariants.

Arguments:
  <file>    Runner JSON file to verify (use "-" for stdin)
  --help    Show this help message

Exit codes:
  0 - Success (valid runner)
  1 - I/O error
  2 - Parse error (invalid JSON)
  3 - Validation error (invariant violations)

Examples:
  npm run runner-verify -- runner.json
  cat runner.json | npm run runner-verify -- -`);
  process.exit(EXIT_IO_ERROR);
}

/**
 * Read content from stdin.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
  });
}

/**
 * Verify runner file.
 */
function verifyFile(filePath: string, content: string): number {
  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.log(
      canonicalize({
        ok: false,
        error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      })
    );
    return EXIT_PARSE_ERROR;
  }

  // Verify
  const result = verifyRunner(parsed);

  if (result.valid) {
    console.log(
      canonicalize({
        ok: true,
        file: filePath,
        runner_hash: result.runner_hash,
      })
    );
    return EXIT_OK;
  } else {
    console.log(
      canonicalize({
        ok: false,
        file: filePath,
        violations: result.violations,
      })
    );
    return EXIT_VALIDATION_ERROR;
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<never> {
  const args = process.argv.slice(2);

  // Handle help
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
  }

  const inputArg = args[0]!;

  // Read from stdin
  if (inputArg === '-') {
    const content = await readStdin();
    if (!content.trim()) {
      console.log(
        canonicalize({
          ok: false,
          error: 'Empty input from stdin',
        })
      );
      process.exit(EXIT_IO_ERROR);
    }
    const code = verifyFile('stdin', content);
    process.exit(code);
  }

  // Read from file
  const fullPath = resolve(inputArg);
  if (!existsSync(fullPath)) {
    console.log(
      canonicalize({
        ok: false,
        error: `File not found: ${inputArg}`,
      })
    );
    process.exit(EXIT_IO_ERROR);
  }

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch (err) {
    console.log(
      canonicalize({
        ok: false,
        error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      })
    );
    process.exit(EXIT_IO_ERROR);
  }

  const code = verifyFile(inputArg, content);
  process.exit(code);
}

main();
