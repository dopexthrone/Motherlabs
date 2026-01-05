/**
 * Evidence Builder
 * ================
 *
 * Builds execution evidence from sandbox results for kernel validation.
 * Converts sandbox execution format to kernel ExecutionEvidence format.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { canonicalHash } from '../utils/canonical.js';
import type { Bundle } from '../types/artifacts.js';
import type { Proposal, ExecutionEvidence, ActionResult, TestResult } from '../protocol/proposal.js';
import type { SandboxExecution, PolicyProfile, ContentHash } from './types.js';
import type { Sandbox } from './sandbox.js';
import { join } from 'node:path';

// =============================================================================
// Evidence Building
// =============================================================================

/**
 * Build kernel ExecutionEvidence from sandbox execution results.
 *
 * @param proposal - Original proposal
 * @param sandbox - Sandbox used
 * @param sandboxExec - Sandbox execution results
 * @param startedAt - Execution start time (ISO string)
 * @param completedAt - Execution completion time (ISO string)
 * @returns Execution evidence for kernel validation
 */
export function buildKernelEvidence(
  proposal: Proposal,
  sandbox: Sandbox,
  sandboxExec: SandboxExecution,
  startedAt: string,
  completedAt: string
): ExecutionEvidence {
  // Build action results
  const actionResults: ActionResult[] = [];

  for (const action of proposal.actions) {
    // Find corresponding output
    const expectedPath = action.target.replace(/^\//, ''); // Remove leading slash
    const output = sandboxExec.outputs.find((o) => o.path === expectedPath);

    let status: 'success' | 'failure' | 'skipped' | 'timeout';
    let actualHash: string | undefined;
    let error: string | undefined;

    if (action.type === 'create_file') {
      if (output) {
        // File was created - check hash
        actualHash = output.sha256.replace('sha256:', '');
        status = 'success';
      } else {
        status = 'failure';
        error = `File not created: ${action.target}`;
      }
    } else if (action.type === 'execute_command') {
      // Command execution status based on sandbox exit code
      if (sandboxExec.exit_code === 0) {
        status = 'success';
      } else {
        status = 'failure';
        error = `Command exited with code ${sandboxExec.exit_code}`;
      }
    } else {
      // Other action types - mark as skipped
      status = 'skipped';
    }

    const actionResult: ActionResult = {
      action_id: action.id,
      status,
      duration_ms: 0, // We don't track per-action timing in harness
    };
    if (actualHash) {
      actionResult.actual_hash = actualHash;
    }
    if (action.type === 'execute_command') {
      actionResult.exit_code = sandboxExec.exit_code;
    }
    actionResults.push(actionResult);
  }

  // Build test results
  const testResults: TestResult[] = [];

  for (const test of proposal.acceptance_tests) {
    let passed = false;
    let actual = '';
    let error: string | undefined;

    if (test.type === 'hash_match') {
      const targetPath = test.target.replace(/^\//, '');
      const output = sandboxExec.outputs.find((o) => o.path === targetPath);

      if (output) {
        actual = output.sha256.replace('sha256:', '');
        passed = actual === test.expected;
      } else {
        actual = '';
        error = `File not found: ${test.target}`;
      }
    } else if (test.type === 'file_exists') {
      const targetPath = test.target.replace(/^\//, '');
      const output = sandboxExec.outputs.find((o) => o.path === targetPath);
      actual = output ? 'true' : 'false';
      passed = actual === test.expected;
    } else {
      // Other test types
      error = `Test type not supported in harness: ${test.type}`;
    }

    const testResult: TestResult = {
      test_id: test.id,
      passed,
      actual,
    };
    if (error) {
      testResult.error = error;
    }
    testResults.push(testResult);
  }

  // Determine overall status
  const allActionsOk = actionResults.every((r) => r.status === 'success' || r.status === 'skipped');
  const allTestsOk = testResults.every((r) => r.passed);

  let status: 'complete' | 'partial' | 'failed';
  if (allActionsOk && allTestsOk) {
    status = 'complete';
  } else if (actionResults.some((r) => r.status === 'success')) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  const startTime = new Date(startedAt).getTime();
  const endTime = new Date(completedAt).getTime();

  return {
    proposal_id: proposal.id,
    proposal_hash: canonicalHash(proposal),
    action_results: actionResults,
    test_results: testResults,
    status,
    started_at: startedAt,
    completed_at: completedAt,
    total_duration_ms: endTime - startTime,
    executor_id: `harness_${sandbox.id}`,
    working_dir: sandbox.dir,
  };
}

/**
 * Compute SHA-256 hash of file.
 *
 * @param filePath - Path to file
 * @returns Content hash
 */
export async function hashFile(filePath: string): Promise<ContentHash> {
  const content = await readFile(filePath);
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Compute SHA-256 hash of string content.
 *
 * @param content - Content to hash
 * @returns Content hash
 */
export function hashContent(content: string): ContentHash {
  const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}
