#!/usr/bin/env node
/**
 * Dogfood Runner
 * ==============
 *
 * One command that yields (CLARIFY | REFUSE | BUNDLE -> EXECUTE -> ACCEPT/REJECT)
 * with evidence you can review.
 *
 * Usage:
 *   npx tsx tools/dogfood.ts <intent_path> [--policy strict|default|dev] [--mode plan-only|execute-sandbox]
 *
 * Outputs:
 *   artifacts/dogfood/<intent_id>/<run_id>/
 *     - intent.json (copied)
 *     - bundle.json (if produced)
 *     - result.json
 *     - executor/stdout.log
 *     - executor/stderr.log
 *     - outputs/... (sandbox outputs)
 *     - evidence.json
 */

import { readFile, writeFile, mkdir, copyFile, readdir, stat, cp, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { runHarness } from '../dist/harness/run_intent.js';
import { cleanupSandbox } from '../dist/harness/sandbox.js';
import type { HarnessRunInput, HarnessRunResult, ExecutionMode, PolicyProfileName } from '../dist/harness/types.js';

// =============================================================================
// Constants
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const DOGFOOD_DIR = join(PROJECT_ROOT, 'artifacts', 'dogfood');

// =============================================================================
// Intent ID Derivation
// =============================================================================

/**
 * Derive a stable intent ID from an intent file.
 * Uses the filename (without extension) as the primary ID.
 * Falls back to hash of content if filename is generic.
 */
async function deriveIntentId(intentPath: string): Promise<string> {
  const filename = basename(intentPath, '.json');

  // If filename looks like a meaningful ID, use it
  if (filename.match(/^intent_/) || filename.match(/^[a-z0-9_-]+$/i)) {
    return filename;
  }

  // Otherwise, use first 12 chars of content hash
  const content = await readFile(intentPath, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `intent_${hash}`;
}

// =============================================================================
// Output Directory Structure
// =============================================================================

/**
 * Create the dogfood output directory structure.
 */
async function createOutputDir(intentId: string, runId: string): Promise<string> {
  const outDir = join(DOGFOOD_DIR, intentId, runId);
  await mkdir(outDir, { recursive: true });
  await mkdir(join(outDir, 'executor'), { recursive: true });
  await mkdir(join(outDir, 'outputs'), { recursive: true });
  return outDir;
}

/**
 * Copy sandbox outputs to the dogfood directory.
 * If sandbox_path is provided, copies actual files. Otherwise just writes manifest.
 */
async function copySandboxOutputs(
  result: HarnessRunResult,
  outDir: string,
  sandboxPath?: string
): Promise<void> {
  if (!result.execution) return;

  // Write output manifest
  const outputsInfo = result.execution.outputs.map(o => ({
    path: o.path,
    sha256: o.sha256,
    size_bytes: o.size_bytes,
  }));

  await writeFile(
    join(outDir, 'outputs', '_manifest.json'),
    JSON.stringify(outputsInfo, null, 2),
    'utf-8'
  );

  // If sandbox is preserved, copy actual output files
  if (sandboxPath) {
    const sandboxOutDir = join(sandboxPath, 'out');
    if (existsSync(sandboxOutDir)) {
      try {
        await cp(sandboxOutDir, join(outDir, 'outputs'), { recursive: true });
      } catch (err) {
        // Log but don't fail - outputs may not exist
        console.warn(`Warning: Could not copy sandbox outputs: ${err}`);
      }
    }
  }
}

// =============================================================================
// Summary Printing
// =============================================================================

/**
 * Print a concise summary of the run.
 */
function printSummary(result: HarnessRunResult, intentId: string): void {
  const divider = '─'.repeat(60);

  console.log('\n' + divider);
  console.log('DOGFOOD RUN SUMMARY');
  console.log(divider);

  console.log(`Intent ID:      ${intentId}`);
  console.log(`Run ID:         ${result.run_id}`);
  console.log(`Result Kind:    ${result.kernel_result_kind}`);

  if (result.bundle) {
    console.log(`Bundle SHA256:  ${result.bundle.sha256}`);
  } else {
    console.log(`Bundle:         (none)`);
  }

  console.log(`Accepted:       ${result.decision.accepted ? 'YES' : 'NO'}`);
  console.log(`Policy:         ${result.policy.name}`);

  if (result.clarify_questions && result.clarify_questions.length > 0) {
    console.log(`\nClarify Questions:`);
    result.clarify_questions.forEach((q, i) => {
      console.log(`  ${i + 1}. ${q}`);
    });
  }

  if (result.refuse_reason) {
    console.log(`\nRefuse Reason:  ${result.refuse_reason}`);
  }

  console.log(`\nDecision Reasons:`);
  result.decision.reasons.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r}`);
  });

  if (result.execution) {
    console.log(`\nExecution:`);
    console.log(`  Sandbox ID:   ${result.execution.sandbox_id}`);
    console.log(`  Outputs:      ${result.execution.outputs.length} files`);
    console.log(`  Exit Code:    ${result.execution.exit_code}`);
  }

  console.log(divider);
  console.log(`Duration:       ${getDuration(result.started_at, result.completed_at)}`);
  console.log(divider + '\n');
}

/**
 * Calculate duration between two ISO timestamps.
 */
function getDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface DogfoodArgs {
  intentPath: string;
  policy: PolicyProfileName;
  mode: ExecutionMode;
}

function parseArgs(args: string[]): DogfoodArgs {
  if (args.length < 1) {
    console.error('Usage: dogfood <intent_path> [--policy strict|default|dev] [--mode plan-only|execute-sandbox]');
    console.error('');
    console.error('Options:');
    console.error('  --policy    Policy profile (default: strict)');
    console.error('  --mode      Execution mode (default: execute-sandbox)');
    process.exit(1);
  }

  const intentPath = resolve(args[0]!);
  let policy: PolicyProfileName = 'strict'; // Default to strict for dogfooding
  let mode: ExecutionMode = 'execute-sandbox'; // Default to full execution

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--policy' && args[i + 1]) {
      const p = args[i + 1];
      if (p === 'strict' || p === 'default' || p === 'dev') {
        policy = p;
      } else {
        console.error(`Invalid policy: ${p}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--mode' && args[i + 1]) {
      const m = args[i + 1];
      if (m === 'plan-only' || m === 'execute-sandbox') {
        mode = m;
      } else {
        console.error(`Invalid mode: ${m}`);
        process.exit(1);
      }
      i++;
    }
  }

  return { intentPath, policy, mode };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Dogfooding: ${args.intentPath}`);
  console.log(`Policy: ${args.policy}, Mode: ${args.mode}`);

  // Derive intent ID
  const intentId = await deriveIntentId(args.intentPath);

  // Run harness with sandbox preservation for execute mode
  const preserveSandbox = args.mode === 'execute-sandbox';
  const input: HarnessRunInput = {
    intent_path: args.intentPath,
    mode: args.mode,
    policy: args.policy,
    preserve_sandbox: preserveSandbox,
  };

  const result = await runHarness(input);

  try {
    // Create output directory
    const outDir = await createOutputDir(intentId, result.run_id);

    // Copy intent
    await copyFile(args.intentPath, join(outDir, 'intent.json'));

    // Write result (without sandbox_path - that's internal)
    const resultForStorage = { ...result };
    delete resultForStorage.sandbox_path;
    await writeFile(
      join(outDir, 'result.json'),
      JSON.stringify(resultForStorage, null, 2),
      'utf-8'
    );

    // Write bundle if produced
    if (result.bundle) {
      await writeFile(
        join(outDir, 'bundle.json'),
        JSON.stringify({
          bundle_id: result.bundle.bundle_id,
          sha256: result.bundle.sha256,
          note: 'Full bundle available in kernel transform output',
        }, null, 2),
        'utf-8'
      );
    }

    // Write evidence and copy outputs if execution happened
    if (result.execution) {
      await writeFile(
        join(outDir, 'evidence.json'),
        JSON.stringify(result.execution, null, 2),
        'utf-8'
      );

      // Copy stdout/stderr if sandbox was preserved
      if (result.sandbox_path) {
        const stdoutPath = join(result.sandbox_path, 'stdout.log');
        const stderrPath = join(result.sandbox_path, 'stderr.log');

        if (existsSync(stdoutPath)) {
          await copyFile(stdoutPath, join(outDir, 'executor', 'stdout.log'));
        } else {
          await writeFile(
            join(outDir, 'executor', 'stdout.log'),
            `# Stdout hash: ${result.execution.stdout_sha256}\n`,
            'utf-8'
          );
        }

        if (existsSync(stderrPath)) {
          await copyFile(stderrPath, join(outDir, 'executor', 'stderr.log'));
        } else {
          await writeFile(
            join(outDir, 'executor', 'stderr.log'),
            `# Stderr hash: ${result.execution.stderr_sha256}\n`,
            'utf-8'
          );
        }
      } else {
        // No sandbox preserved, write hash placeholders
        await writeFile(
          join(outDir, 'executor', 'stdout.log'),
          `# Stdout hash: ${result.execution.stdout_sha256}\n# (Sandbox not preserved)\n`,
          'utf-8'
        );
        await writeFile(
          join(outDir, 'executor', 'stderr.log'),
          `# Stderr hash: ${result.execution.stderr_sha256}\n# (Sandbox not preserved)\n`,
          'utf-8'
        );
      }

      // Copy sandbox outputs
      await copySandboxOutputs(result, outDir, result.sandbox_path);
    }

    // Print summary
    printSummary(result, intentId);

    console.log(`Outputs written to: ${outDir}`);
  } finally {
    // Clean up sandbox if it was preserved
    if (result.sandbox_path) {
      await rm(result.sandbox_path, { recursive: true, force: true });
    }
  }

  // Exit with appropriate code
  process.exit(result.decision.accepted ? 0 : 1);
}

main().catch((err) => {
  console.error('Dogfood error:', err instanceof Error ? err.message : err);
  process.exit(2);
});
