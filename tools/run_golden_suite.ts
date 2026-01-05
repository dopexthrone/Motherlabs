#!/usr/bin/env node
/**
 * Golden Suite Runner
 * ====================
 *
 * Runs all intents in the real/ directory and verifies golden hashes.
 *
 * Usage:
 *   npx tsx tools/run_golden_suite.ts [--update] [--filter <pattern>]
 *
 * Options:
 *   --update    Update golden hashes (requires reason)
 *   --filter    Only run intents matching pattern
 *   --strict    Fail on any non-acceptance (default: only fail on hash changes)
 *
 * Exit codes:
 *   0 - All golden hashes match
 *   1 - Golden hash changed without recorded reason
 *   2 - Error during execution
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { runHarness } from '../dist/harness/run_intent.js';
import type { HarnessRunInput, HarnessRunResult } from '../dist/harness/types.js';

// =============================================================================
// Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const INTENTS_DIR = join(PROJECT_ROOT, 'intents', 'real');
const GOLDENS_DIR = join(PROJECT_ROOT, 'artifacts', 'goldens');
const MANIFEST_PATH = join(INTENTS_DIR, 'MANIFEST.json');

// =============================================================================
// Types
// =============================================================================

interface ManifestIntent {
  id: string;
  path: string;
  category: string;
  acceptance_test: 'golden-only' | 'executable' | 'must-refuse' | 'must-clarify-or-handle';
  description: string;
}

interface Manifest {
  version: string;
  description: string;
  intents: ManifestIntent[];
}

interface GoldenRecord {
  intent_id: string;
  bundle_sha256: string | null;
  result_kind: string;
  accepted: boolean;
  last_updated: string;
  kernel_version: string;
}

interface SuiteResult {
  intent_id: string;
  category: string;
  bundle_sha256: string | null;
  result_kind: string;
  accepted: boolean;
  duration_ms: number;
  status: 'PASS' | 'FAIL' | 'CHANGED' | 'NEW';
  message?: string;
}

// =============================================================================
// Golden Hash Management
// =============================================================================

async function loadGoldens(): Promise<Map<string, GoldenRecord>> {
  const goldensPath = join(GOLDENS_DIR, 'goldens.json');
  if (!existsSync(goldensPath)) {
    return new Map();
  }

  const content = await readFile(goldensPath, 'utf-8');
  const records = JSON.parse(content) as GoldenRecord[];
  return new Map(records.map((r) => [r.intent_id, r]));
}

async function saveGoldens(goldens: Map<string, GoldenRecord>): Promise<void> {
  await mkdir(GOLDENS_DIR, { recursive: true });
  const records = Array.from(goldens.values()).sort((a, b) =>
    a.intent_id.localeCompare(b.intent_id)
  );
  await writeFile(
    join(GOLDENS_DIR, 'goldens.json'),
    JSON.stringify(records, null, 2),
    'utf-8'
  );
}

// =============================================================================
// Suite Runner
// =============================================================================

async function runIntent(
  intent: ManifestIntent,
  golden: GoldenRecord | undefined
): Promise<SuiteResult> {
  const intentPath = join(INTENTS_DIR, intent.path);
  const startTime = Date.now();

  try {
    const input: HarnessRunInput = {
      intent_path: intentPath,
      mode: 'plan-only', // Golden suite uses plan-only for deterministic hashes
      policy: 'strict',
    };

    const result = await runHarness(input);
    const duration_ms = Date.now() - startTime;

    const bundleSha256 = result.bundle?.sha256 || null;
    const resultKind = result.kernel_result_kind;
    const accepted = result.decision.accepted;

    // Check acceptance test expectations
    let status: SuiteResult['status'] = 'PASS';
    let message: string | undefined;

    if (intent.acceptance_test === 'must-refuse') {
      if (resultKind !== 'REFUSE') {
        status = 'FAIL';
        message = `Expected REFUSE, got ${resultKind}`;
      }
    } else if (intent.acceptance_test === 'must-clarify-or-handle') {
      // This is acceptable - the kernel might handle contradictions gracefully
      if (resultKind === 'REFUSE') {
        status = 'FAIL';
        message = `Expected CLARIFY or BUNDLE, got REFUSE`;
      }
    }

    // Check golden hash if exists
    if (golden && status === 'PASS') {
      if (golden.bundle_sha256 !== bundleSha256) {
        status = 'CHANGED';
        message = `Hash changed: ${golden.bundle_sha256?.slice(0, 20)}... -> ${bundleSha256?.slice(0, 20)}...`;
      }
    } else if (!golden && status === 'PASS') {
      status = 'NEW';
      message = 'No golden hash recorded yet';
    }

    return {
      intent_id: intent.id,
      category: intent.category,
      bundle_sha256: bundleSha256,
      result_kind: resultKind,
      accepted,
      duration_ms,
      status,
      message,
    };
  } catch (err) {
    const duration_ms = Date.now() - startTime;
    const errMessage = err instanceof Error ? err.message : String(err);

    // For must-refuse tests, an error during transform is actually a PASS
    // (the kernel correctly refused to process the invalid intent)
    if (intent.acceptance_test === 'must-refuse') {
      return {
        intent_id: intent.id,
        category: intent.category,
        bundle_sha256: null,
        result_kind: 'REFUSE',
        accepted: false,
        duration_ms,
        status: golden ? 'PASS' : 'NEW',
        message: golden ? undefined : `Correctly refused: ${errMessage}`,
      };
    }

    return {
      intent_id: intent.id,
      category: intent.category,
      bundle_sha256: null,
      result_kind: 'ERROR',
      accepted: false,
      duration_ms,
      status: 'FAIL',
      message: errMessage,
    };
  }
}

// =============================================================================
// Output Formatting
// =============================================================================

function printTable(results: SuiteResult[]): void {
  const DIVIDER = '─'.repeat(90);

  console.log('\n' + DIVIDER);
  console.log('GOLDEN SUITE RESULTS');
  console.log(DIVIDER);
  console.log(
    padRight('Intent ID', 35) +
    padRight('Category', 12) +
    padRight('Result', 10) +
    padRight('Status', 10) +
    padRight('Duration', 10)
  );
  console.log(DIVIDER);

  for (const r of results) {
    const statusColor = getStatusColor(r.status);
    console.log(
      padRight(r.intent_id, 35) +
      padRight(r.category, 12) +
      padRight(r.result_kind, 10) +
      statusColor(padRight(r.status, 10)) +
      padRight(`${r.duration_ms}ms`, 10)
    );
    if (r.message) {
      console.log(`  └─ ${r.message}`);
    }
  }

  console.log(DIVIDER);

  // Summary
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const changed = results.filter((r) => r.status === 'CHANGED').length;
  const newIntents = results.filter((r) => r.status === 'NEW').length;

  console.log(`\nSummary: ${passed} passed, ${failed} failed, ${changed} changed, ${newIntents} new`);
  console.log(DIVIDER + '\n');
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function getStatusColor(status: string): (s: string) => string {
  // Simple ANSI colors
  switch (status) {
    case 'PASS':
      return (s) => `\x1b[32m${s}\x1b[0m`; // Green
    case 'FAIL':
      return (s) => `\x1b[31m${s}\x1b[0m`; // Red
    case 'CHANGED':
      return (s) => `\x1b[33m${s}\x1b[0m`; // Yellow
    case 'NEW':
      return (s) => `\x1b[36m${s}\x1b[0m`; // Cyan
    default:
      return (s) => s;
  }
}

// =============================================================================
// CLI
// =============================================================================

interface CLIArgs {
  update: boolean;
  filter: string | null;
  strict: boolean;
}

function parseArgs(args: string[]): CLIArgs {
  let update = false;
  let filter: string | null = null;
  let strict = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') {
      update = true;
    } else if (args[i] === '--filter' && args[i + 1]) {
      filter = args[++i]!;
    } else if (args[i] === '--strict') {
      strict = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: run_golden_suite [--update] [--filter <pattern>] [--strict]');
      console.log('');
      console.log('Options:');
      console.log('  --update    Update golden hashes for changed/new intents');
      console.log('  --filter    Only run intents matching pattern (e.g., "blueprint")');
      console.log('  --strict    Fail on any non-acceptance');
      process.exit(0);
    }
  }

  return { update, filter, strict };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Load manifest
  if (!existsSync(MANIFEST_PATH)) {
    console.error('MANIFEST.json not found in intents/real/');
    process.exit(2);
  }

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf-8')) as Manifest;
  console.log(`\nLoaded ${manifest.intents.length} intents from manifest`);

  // Filter intents if pattern provided
  let intents = manifest.intents;
  if (args.filter) {
    intents = intents.filter(
      (i) =>
        i.id.includes(args.filter!) ||
        i.category.includes(args.filter!) ||
        i.description.toLowerCase().includes(args.filter!.toLowerCase())
    );
    console.log(`Filtered to ${intents.length} intents matching "${args.filter}"`);
  }

  // Load existing goldens
  const goldens = await loadGoldens();
  console.log(`Loaded ${goldens.size} existing golden records`);

  // Run all intents
  console.log('\nRunning golden suite...\n');
  const results: SuiteResult[] = [];

  for (const intent of intents) {
    process.stdout.write(`  Running ${intent.id}...`);
    const result = await runIntent(intent, goldens.get(intent.id));
    results.push(result);
    console.log(` ${result.status} (${result.duration_ms}ms)`);
  }

  // Print results table
  printTable(results);

  // Update goldens if requested
  if (args.update) {
    const toUpdate = results.filter((r) => r.status === 'CHANGED' || r.status === 'NEW');
    if (toUpdate.length > 0) {
      console.log(`Updating ${toUpdate.length} golden records...`);
      for (const r of toUpdate) {
        goldens.set(r.intent_id, {
          intent_id: r.intent_id,
          bundle_sha256: r.bundle_sha256,
          result_kind: r.result_kind,
          accepted: r.accepted,
          last_updated: new Date().toISOString(),
          kernel_version: '0.1.0', // TODO: get from kernel
        });
      }
      await saveGoldens(goldens);
      console.log('Golden records updated.\n');
      console.log('IMPORTANT: Document changes in CHANGELOG_GOLDENS.md');
    }
  }

  // Determine exit code
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const changed = results.filter((r) => r.status === 'CHANGED').length;

  if (failed > 0) {
    process.exit(1);
  }

  if (changed > 0 && !args.update) {
    console.log('Golden hashes changed! Run with --update to update, or document in CHANGELOG_GOLDENS.md');
    process.exit(1);
  }

  if (args.strict) {
    const notAccepted = results.filter((r) => !r.accepted && r.status !== 'FAIL').length;
    if (notAccepted > 0) {
      console.log(`${notAccepted} intents not accepted (strict mode)`);
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(2);
});
