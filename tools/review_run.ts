#!/usr/bin/env node
/**
 * Review Run Command
 * ==================
 *
 * Loads a dogfood run folder and prints a detailed review.
 *
 * Usage:
 *   npx tsx tools/review_run.ts <run_path>
 *   npx tsx tools/review_run.ts artifacts/dogfood/<intent_id>/<run_id>
 *
 * Features:
 * - Intent summary
 * - Kernel decision path
 * - Evidence hashes
 * - Diff vs previous run
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import type { HarnessRunResult, SandboxExecution } from '../dist/harness/types.js';

// =============================================================================
// Types
// =============================================================================

interface RunReview {
  runPath: string;
  runId: string;
  intentId: string;
  result: HarnessRunResult;
  intent: { goal: string; constraints?: string[]; context?: Record<string, unknown> };
  bundle: { bundle_id: string; sha256: string } | null;
  evidence: SandboxExecution | null;
  previousRun: RunReview | null;
}

// =============================================================================
// Run Loading
// =============================================================================

/**
 * Load a run from its directory path.
 */
async function loadRun(runPath: string): Promise<Omit<RunReview, 'previousRun'>> {
  const absPath = resolve(runPath);
  const runId = basename(absPath);
  const intentId = basename(dirname(absPath));

  // Load result.json
  const resultPath = join(absPath, 'result.json');
  if (!existsSync(resultPath)) {
    throw new Error(`result.json not found in ${absPath}`);
  }
  const result = JSON.parse(await readFile(resultPath, 'utf-8')) as HarnessRunResult;

  // Load intent.json
  const intentPath = join(absPath, 'intent.json');
  const intent = existsSync(intentPath)
    ? JSON.parse(await readFile(intentPath, 'utf-8'))
    : { goal: '(not found)' };

  // Load bundle.json (optional)
  const bundlePath = join(absPath, 'bundle.json');
  const bundle = existsSync(bundlePath)
    ? JSON.parse(await readFile(bundlePath, 'utf-8'))
    : null;

  // Load evidence.json (optional)
  const evidencePath = join(absPath, 'evidence.json');
  const evidence = existsSync(evidencePath)
    ? JSON.parse(await readFile(evidencePath, 'utf-8'))
    : null;

  return { runPath: absPath, runId, intentId, result, intent, bundle, evidence };
}

/**
 * Find the previous run for a given intent.
 */
async function findPreviousRun(
  intentId: string,
  currentRunId: string,
  dogfoodDir: string
): Promise<string | null> {
  const intentDir = join(dogfoodDir, intentId);
  if (!existsSync(intentDir)) return null;

  const runs = await readdir(intentDir);
  const sortedRuns = runs
    .filter((r) => r.startsWith('hr_') && r !== currentRunId)
    .sort()
    .reverse();

  // Find the most recent run before current
  for (const run of sortedRuns) {
    if (run < currentRunId) {
      return join(intentDir, run);
    }
  }

  return null;
}

// =============================================================================
// Printing
// =============================================================================

const DIVIDER = '═'.repeat(70);
const SUB_DIVIDER = '─'.repeat(70);

/**
 * Print the review report.
 */
function printReview(review: RunReview): void {
  console.log('\n' + DIVIDER);
  console.log('RUN REVIEW');
  console.log(DIVIDER + '\n');

  // Run metadata
  console.log('RUN METADATA');
  console.log(SUB_DIVIDER);
  console.log(`  Intent ID:     ${review.intentId}`);
  console.log(`  Run ID:        ${review.runId}`);
  console.log(`  Started:       ${review.result.started_at}`);
  console.log(`  Completed:     ${review.result.completed_at}`);
  console.log(`  Kernel:        ${review.result.kernel_version}`);
  console.log(`  Policy:        ${review.result.policy.name}`);
  console.log('');

  // Intent summary
  console.log('INTENT SUMMARY');
  console.log(SUB_DIVIDER);
  console.log(`  Goal: ${truncate(review.intent.goal, 60)}`);
  if (review.intent.constraints && review.intent.constraints.length > 0) {
    console.log('  Constraints:');
    review.intent.constraints.slice(0, 5).forEach((c, i) => {
      console.log(`    ${i + 1}. ${truncate(c, 55)}`);
    });
    if (review.intent.constraints.length > 5) {
      console.log(`    ... and ${review.intent.constraints.length - 5} more`);
    }
  }
  console.log(`  Intent Hash:   ${review.result.intent.sha256}`);
  console.log('');

  // Kernel decision path
  console.log('KERNEL DECISION PATH');
  console.log(SUB_DIVIDER);
  console.log(`  Result Kind:   ${review.result.kernel_result_kind}`);

  if (review.result.kernel_result_kind === 'CLARIFY') {
    console.log('  Clarify Questions:');
    (review.result.clarify_questions || []).forEach((q, i) => {
      console.log(`    ${i + 1}. ${truncate(q, 55)}`);
    });
  }

  if (review.result.kernel_result_kind === 'REFUSE') {
    console.log(`  Refuse Reason: ${review.result.refuse_reason || '(none)'}`);
  }

  if (review.bundle) {
    console.log(`  Bundle ID:     ${review.bundle.bundle_id}`);
    console.log(`  Bundle Hash:   ${review.bundle.sha256}`);
  }

  console.log(`  Decision:      ${review.result.decision.accepted ? 'ACCEPTED' : 'REJECTED'}`);
  console.log('  Reasons:');
  review.result.decision.reasons.forEach((r, i) => {
    console.log(`    ${i + 1}. ${truncate(r, 55)}`);
  });
  console.log('');

  // Evidence hashes
  if (review.evidence) {
    console.log('EVIDENCE HASHES');
    console.log(SUB_DIVIDER);
    console.log(`  Sandbox ID:    ${review.evidence.sandbox_id}`);
    console.log(`  Exit Code:     ${review.evidence.exit_code}`);
    console.log(`  Stdout Hash:   ${review.evidence.stdout_sha256}`);
    console.log(`  Stderr Hash:   ${review.evidence.stderr_sha256}`);
    console.log(`  Output Files:  ${review.evidence.outputs.length}`);
    console.log(`  Total Bytes:   ${review.evidence.total_output_bytes}`);

    if (review.evidence.outputs.length > 0) {
      console.log('  Outputs:');
      review.evidence.outputs.slice(0, 10).forEach((o) => {
        console.log(`    - ${o.path} (${o.size_bytes} bytes)`);
        console.log(`      ${o.sha256}`);
      });
      if (review.evidence.outputs.length > 10) {
        console.log(`    ... and ${review.evidence.outputs.length - 10} more`);
      }
    }
    console.log('');
  }

  // Diff vs previous run
  if (review.previousRun) {
    console.log('DIFF VS PREVIOUS RUN');
    console.log(SUB_DIVIDER);
    console.log(`  Previous Run:  ${review.previousRun.runId}`);

    // Compare bundle hashes
    const prevBundleHash = review.previousRun.bundle?.sha256 || '(none)';
    const currBundleHash = review.bundle?.sha256 || '(none)';
    const bundleChanged = prevBundleHash !== currBundleHash;
    console.log(`  Bundle Hash:   ${bundleChanged ? 'CHANGED' : 'UNCHANGED'}`);
    if (bundleChanged) {
      console.log(`    Previous:    ${prevBundleHash}`);
      console.log(`    Current:     ${currBundleHash}`);
    }

    // Compare decisions
    const prevAccepted = review.previousRun.result.decision.accepted;
    const currAccepted = review.result.decision.accepted;
    const decisionChanged = prevAccepted !== currAccepted;
    console.log(`  Decision:      ${decisionChanged ? 'CHANGED' : 'UNCHANGED'}`);
    if (decisionChanged) {
      console.log(`    Previous:    ${prevAccepted ? 'ACCEPTED' : 'REJECTED'}`);
      console.log(`    Current:     ${currAccepted ? 'ACCEPTED' : 'REJECTED'}`);
    }

    // Compare output files
    if (review.evidence && review.previousRun.evidence) {
      const prevOutputs = new Map(review.previousRun.evidence.outputs.map((o) => [o.path, o.sha256]));
      const currOutputs = new Map(review.evidence.outputs.map((o) => [o.path, o.sha256]));

      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];

      for (const [path, hash] of currOutputs) {
        if (!prevOutputs.has(path)) {
          added.push(path);
        } else if (prevOutputs.get(path) !== hash) {
          changed.push(path);
        }
      }

      for (const [path] of prevOutputs) {
        if (!currOutputs.has(path)) {
          removed.push(path);
        }
      }

      if (added.length + removed.length + changed.length === 0) {
        console.log('  Outputs:       UNCHANGED');
      } else {
        console.log('  Outputs:       CHANGED');
        added.forEach((p) => console.log(`    + ${p}`));
        removed.forEach((p) => console.log(`    - ${p}`));
        changed.forEach((p) => console.log(`    ~ ${p}`));
      }
    }
    console.log('');
  } else {
    console.log('DIFF VS PREVIOUS RUN');
    console.log(SUB_DIVIDER);
    console.log('  (No previous run found)');
    console.log('');
  }

  console.log(DIVIDER + '\n');
}

/**
 * Truncate a string to a max length.
 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

// =============================================================================
// CLI
// =============================================================================

function printUsage(): void {
  console.error('Usage: review_run <run_path>');
  console.error('');
  console.error('Examples:');
  console.error('  npx tsx tools/review_run.ts artifacts/dogfood/intent_001/hr_abc123');
  console.error('  npx tsx tools/review_run.ts ./artifacts/dogfood/my_intent/hr_xyz789');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(1);
  }

  const runPath = args[0]!;

  try {
    // Load the current run
    const run = await loadRun(runPath);

    // Try to find previous run
    const dogfoodDir = dirname(dirname(run.runPath));
    const prevRunPath = await findPreviousRun(run.intentId, run.runId, dogfoodDir);

    let previousRun: RunReview | null = null;
    if (prevRunPath) {
      const prevRun = await loadRun(prevRunPath);
      previousRun = { ...prevRun, previousRun: null };
    }

    const review: RunReview = { ...run, previousRun };

    // Print the review
    printReview(review);
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exit(2);
  }
}

main().catch(console.error);
