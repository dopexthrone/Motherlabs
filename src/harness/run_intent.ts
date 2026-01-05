/**
 * Harness CLI Entrypoint
 * ======================
 *
 * Usage:
 *   node dist/harness/run_intent.js <intent_path> --mode plan-only|execute-sandbox --policy default|strict|dev
 *
 * The harness is NON-AUTHORITATIVE. It:
 * 1. Loads intent
 * 2. Calls kernel to transform → bundle
 * 3. Calls kernel to generate proposal
 * 4. Optionally executes in sandbox
 * 5. Calls kernel to validate evidence
 * 6. Returns decision (kernel decides, harness reports)
 */

import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

// Kernel imports (authoritative)
import { transform, KERNEL_VERSION, getBundleHash } from '../assembler/bundle.js';
import { generateProposal, validateEvidence } from '../protocol/proposal.js';

// Harness imports (non-authoritative)
import type {
  HarnessRunInput,
  HarnessRunResult,
  ExecutionMode,
  PolicyProfileName,
  KernelResultKind,
  DecisionRecord,
  SandboxExecution,
} from './types.js';
import { loadPolicy } from './policy.js';
import { createSandbox, cleanupSandbox, runInSandbox, buildSandboxExecution } from './sandbox.js';
import { buildKernelEvidence, hashFile } from './evidence.js';
import { appendHarnessResult } from './ledger.js';

// =============================================================================
// Run ID Generation
// =============================================================================

/**
 * Generate a unique run ID.
 * Format: hr_{timestamp}_{random}
 */
function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `hr_${timestamp}_${random}`;
}

// =============================================================================
// Intent Loading
// =============================================================================

/**
 * Load and parse intent file.
 *
 * @param intentPath - Path to intent JSON file
 * @returns Parsed intent and its hash
 */
async function loadIntent(
  intentPath: string
): Promise<{ intent: { goal: string; constraints?: string[]; context?: Record<string, unknown> }; sha256: string }> {
  const content = await readFile(intentPath, 'utf-8');
  const sha256 = await hashFile(intentPath);
  const intent = JSON.parse(content) as { goal: string; constraints?: string[]; context?: Record<string, unknown> };

  if (typeof intent.goal !== 'string' || intent.goal.trim().length === 0) {
    throw new Error('Intent must have a non-empty goal');
  }

  return { intent, sha256 };
}

// =============================================================================
// Executor (Simple File Writer)
// =============================================================================

/**
 * Simple executor that writes proposal files to sandbox.
 * This is a minimal "apply proposal" implementation for v0.2.0.
 *
 * @param proposal - Proposal to apply
 * @param sandboxDir - Sandbox directory
 */
async function applyProposal(
  proposal: import('../protocol/proposal.js').Proposal,
  sandboxDir: string
): Promise<void> {
  const outDir = join(sandboxDir, 'out');
  await mkdir(outDir, { recursive: true });

  for (const action of proposal.actions) {
    if (action.type === 'create_file' && action.content) {
      // Normalize target path - remove context/ prefix and put in out/
      const targetPath = action.target.replace(/^context\//, '');
      const fullPath = join(outDir, targetPath);

      // Create parent directories
      await mkdir(dirname(fullPath), { recursive: true });

      // Write content
      await writeFile(fullPath, action.content, 'utf-8');
    }
  }
}

// =============================================================================
// Main Harness Run
// =============================================================================

/**
 * Run the harness on an intent.
 *
 * @param input - Harness run input
 * @returns Harness run result
 */
export async function runHarness(input: HarnessRunInput): Promise<HarnessRunResult> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  const policy = loadPolicy(input.policy);

  // Load intent
  const { intent, sha256: intentSha256 } = await loadIntent(input.intent_path);

  // Transform intent to bundle (KERNEL AUTHORITY)
  let bundle: import('../types/artifacts.js').Bundle;
  let kernelResultKind: KernelResultKind;
  let clarifyQuestions: string[] | undefined;
  let refuseReason: string | undefined;

  try {
    bundle = transform(intent);

    // Determine result kind based on bundle status
    if (bundle.unresolved_questions.length > 0) {
      kernelResultKind = 'CLARIFY';
      clarifyQuestions = bundle.unresolved_questions.map((q) => q.text);
    } else {
      kernelResultKind = 'BUNDLE';
    }
  } catch (error) {
    // Transform failed - kernel refused
    kernelResultKind = 'REFUSE';
    refuseReason = error instanceof Error ? error.message : String(error);

    const completedAt = new Date().toISOString();
    return {
      run_id: runId,
      started_at: startedAt,
      completed_at: completedAt,
      kernel_version: KERNEL_VERSION,
      policy,
      intent: { path: input.intent_path, sha256: intentSha256 },
      bundle: null,
      kernel_result_kind: kernelResultKind,
      refuse_reason: refuseReason,
      execution: null,
      decision: {
        accepted: false,
        reasons: [`Kernel refused: ${refuseReason}`],
        validated_by_kernel: true,
      },
    };
  }

  const bundleHash = getBundleHash(bundle);

  // If CLARIFY or plan-only mode, don't execute
  if (kernelResultKind === 'CLARIFY' || input.mode === 'plan-only') {
    const completedAt = new Date().toISOString();
    const result: HarnessRunResult = {
      run_id: runId,
      started_at: startedAt,
      completed_at: completedAt,
      kernel_version: KERNEL_VERSION,
      policy,
      intent: { path: input.intent_path, sha256: intentSha256 },
      bundle: { bundle_id: bundle.id, sha256: `sha256:${bundleHash}` },
      kernel_result_kind: kernelResultKind,
      execution: null,
      decision: {
        accepted: kernelResultKind === 'BUNDLE',
        reasons: kernelResultKind === 'CLARIFY'
          ? ['Clarification needed before execution']
          : ['Plan-only mode: no execution'],
        validated_by_kernel: true,
      },
    };
    if (clarifyQuestions) {
      result.clarify_questions = clarifyQuestions;
    }
    return result;
  }

  // Generate proposal (KERNEL AUTHORITY)
  const proposal = generateProposal(bundle);

  // Create sandbox and execute
  const sandbox = await createSandbox();
  let sandboxExecution: SandboxExecution;
  let decision: DecisionRecord;
  let sandboxPreserved = false;

  try {
    // Apply proposal (write files to sandbox)
    await applyProposal(proposal, sandbox.dir);

    // Build sandbox execution evidence
    // We use a simple "apply" model - no shell commands needed
    sandboxExecution = await buildSandboxExecution(
      sandbox,
      ['apply', 'proposal'],
      { exit_code: 0, stdout_path: '', stderr_path: '', timed_out: false },
      policy
    );

    // Build kernel evidence from sandbox execution
    const executionStarted = new Date().toISOString();
    const executionCompleted = new Date().toISOString();
    const kernelEvidence = buildKernelEvidence(
      proposal,
      sandbox,
      sandboxExecution,
      executionStarted,
      executionCompleted
    );

    // Validate evidence (KERNEL AUTHORITY)
    const validation = validateEvidence(proposal, kernelEvidence);

    // Build decision based on kernel validation
    decision = {
      accepted: validation.recommendation === 'accept',
      reasons: [
        ...validation.errors,
        ...validation.warnings,
        `Kernel recommendation: ${validation.recommendation}`,
      ],
      validated_by_kernel: true,
    };

    // Mark sandbox as preserved if requested (cleanup will be skipped)
    sandboxPreserved = input.preserve_sandbox === true;
  } finally {
    // Only cleanup if not preserving
    if (!sandboxPreserved) {
      await cleanupSandbox(sandbox);
    }
  }

  const completedAt = new Date().toISOString();

  const result: HarnessRunResult = {
    run_id: runId,
    started_at: startedAt,
    completed_at: completedAt,
    kernel_version: KERNEL_VERSION,
    policy,
    intent: { path: input.intent_path, sha256: intentSha256 },
    bundle: { bundle_id: bundle.id, sha256: `sha256:${bundleHash}` },
    kernel_result_kind: kernelResultKind,
    execution: sandboxExecution,
    decision,
  };

  // Add sandbox path if preserved
  if (sandboxPreserved) {
    result.sandbox_path = sandbox.dir;
  }

  return result;
}

// =============================================================================
// CLI Entry Point
// =============================================================================

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): HarnessRunInput {
  if (args.length < 1) {
    console.error('Usage: run_intent <intent_path> --mode plan-only|execute-sandbox --policy default|strict|dev');
    process.exit(1);
  }

  const intentPath = args[0]!;
  let mode: ExecutionMode = 'plan-only';
  let policy: PolicyProfileName = 'default';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      const modeArg = args[i + 1];
      if (modeArg === 'plan-only' || modeArg === 'execute-sandbox') {
        mode = modeArg;
      } else {
        console.error(`Invalid mode: ${modeArg}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--policy' && args[i + 1]) {
      const policyArg = args[i + 1];
      if (policyArg === 'strict' || policyArg === 'default' || policyArg === 'dev') {
        policy = policyArg;
      } else {
        console.error(`Invalid policy: ${policyArg}`);
        process.exit(1);
      }
      i++;
    }
  }

  return { intent_path: intentPath, mode, policy };
}

/**
 * Write result to output directory.
 */
async function writeResult(result: HarnessRunResult): Promise<string> {
  const outDir = `artifacts/harness/out/${result.run_id}`;
  await mkdir(outDir, { recursive: true });

  const resultPath = join(outDir, 'result.json');
  await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');

  return resultPath;
}

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = parseArgs(args);

  try {
    const result = await runHarness(input);

    // Write result to file
    const resultPath = await writeResult(result);

    // Append to ledger
    await appendHarnessResult(result);

    // Output to stdout
    console.log(JSON.stringify(result, null, 2));

    // Exit with appropriate code
    process.exit(result.decision.accepted ? 0 : 1);
  } catch (error) {
    console.error('Harness error:', error instanceof Error ? error.message : error);
    process.exit(2);
  }
}

// Run if called directly (not when imported)
// Check if this is the entry point by looking for a test runner
const isDirectRun = process.argv[1]?.includes('run_intent') ?? false;
if (isDirectRun) {
  main().catch(console.error);
}
