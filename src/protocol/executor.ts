/**
 * Executor Harness
 * ================
 *
 * Executes proposals in a sandboxed temp directory and returns evidence.
 *
 * Key principles:
 * - All execution happens in isolated temp dir
 * - No access to filesystem outside sandbox
 * - All I/O is logged and returned as evidence
 * - Executor is untrusted; kernel validates evidence
 *
 * This is the "execution" side of the authority/execution separation.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { canonicalHash } from '../utils/canonical.js';
import type {
  Proposal,
  ProposedAction,
  AcceptanceTest,
  ExecutionEvidence,
  ActionResult,
  ActionResultStatus,
  TestResult,
} from './proposal.js';

const execAsync = promisify(exec);

// =============================================================================
// Executor Configuration
// =============================================================================

/**
 * Configuration for the executor.
 */
export interface ExecutorConfig {
  /**
   * Base directory for temp sandboxes.
   * Default: system temp directory
   */
  baseDir?: string;

  /**
   * Timeout for individual actions in milliseconds.
   * Default: 30000 (30 seconds)
   */
  actionTimeout?: number;

  /**
   * Maximum output size in bytes.
   * Default: 10000
   */
  maxOutputSize?: number;

  /**
   * Whether to clean up sandbox after execution.
   * Default: true
   */
  cleanup?: boolean;

  /**
   * Executor identifier for audit trail.
   * Default: 'executor_default'
   */
  executorId?: string;
}

/**
 * Default executor configuration.
 */
const DEFAULT_CONFIG: Required<ExecutorConfig> = {
  baseDir: tmpdir(),
  actionTimeout: 30000,
  maxOutputSize: 10000,
  cleanup: true,
  executorId: 'executor_default',
};

// =============================================================================
// Sandbox Management
// =============================================================================

/**
 * Create a new sandbox directory.
 *
 * @param baseDir - Base directory for sandbox
 * @returns Path to sandbox directory
 */
async function createSandbox(baseDir: string): Promise<string> {
  // Use timestamp + random suffix for uniqueness
  // Note: This is for sandbox isolation, not deterministic output
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  const sandboxDir = join(baseDir, `kernel_sandbox_${timestamp}_${suffix}`);

  await mkdir(sandboxDir, { recursive: true });
  return sandboxDir;
}

/**
 * Clean up sandbox directory.
 *
 * @param sandboxDir - Path to sandbox directory
 */
async function cleanupSandbox(sandboxDir: string): Promise<void> {
  try {
    await rm(sandboxDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Action Execution
// =============================================================================

/**
 * Execute a single action.
 *
 * @param action - Action to execute
 * @param sandboxDir - Sandbox directory
 * @param config - Executor configuration
 * @returns Action result
 */
async function executeAction(
  action: ProposedAction,
  sandboxDir: string,
  config: Required<ExecutorConfig>
): Promise<ActionResult> {
  const startTime = Date.now();

  try {
    switch (action.type) {
      case 'create_file':
        return await executeCreateFile(action, sandboxDir, startTime);

      case 'modify_file':
        return await executeModifyFile(action, sandboxDir, startTime);

      case 'delete_file':
        return await executeDeleteFile(action, sandboxDir, startTime);

      case 'execute_command':
        return await executeCommand(action, sandboxDir, config, startTime);

      case 'validate':
      case 'test':
        // Validation/test actions are handled separately
        return {
          action_id: action.id,
          status: 'skipped',
          duration_ms: Date.now() - startTime,
        };

      default:
        return {
          action_id: action.id,
          status: 'failure',
          error: `Unknown action type: ${action.type}`,
          duration_ms: Date.now() - startTime,
        };
    }
  } catch (error) {
    return {
      action_id: action.id,
      status: 'failure',
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Execute create_file action.
 */
async function executeCreateFile(
  action: ProposedAction,
  sandboxDir: string,
  startTime: number
): Promise<ActionResult> {
  if (!action.content) {
    return {
      action_id: action.id,
      status: 'failure',
      error: 'create_file action requires content',
      duration_ms: Date.now() - startTime,
    };
  }

  const targetPath = join(sandboxDir, action.target);

  // Create parent directories
  const parentDir = targetPath.substring(0, targetPath.lastIndexOf('/'));
  if (parentDir) {
    await mkdir(parentDir, { recursive: true });
  }

  // Write file
  await writeFile(targetPath, action.content, 'utf-8');

  // Compute hash
  const actualHash = createHash('sha256')
    .update(action.content + '\n', 'utf-8')
    .digest('hex');

  return {
    action_id: action.id,
    status: 'success',
    actual_hash: actualHash,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Execute modify_file action.
 */
async function executeModifyFile(
  action: ProposedAction,
  sandboxDir: string,
  startTime: number
): Promise<ActionResult> {
  if (!action.content) {
    return {
      action_id: action.id,
      status: 'failure',
      error: 'modify_file action requires content',
      duration_ms: Date.now() - startTime,
    };
  }

  const targetPath = join(sandboxDir, action.target);

  // Check file exists
  try {
    await stat(targetPath);
  } catch {
    return {
      action_id: action.id,
      status: 'failure',
      error: `File does not exist: ${action.target}`,
      duration_ms: Date.now() - startTime,
    };
  }

  // Write file
  await writeFile(targetPath, action.content, 'utf-8');

  // Compute hash
  const actualHash = createHash('sha256')
    .update(action.content + '\n', 'utf-8')
    .digest('hex');

  return {
    action_id: action.id,
    status: 'success',
    actual_hash: actualHash,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Execute delete_file action.
 */
async function executeDeleteFile(
  action: ProposedAction,
  sandboxDir: string,
  startTime: number
): Promise<ActionResult> {
  const targetPath = join(sandboxDir, action.target);

  try {
    await rm(targetPath);
    return {
      action_id: action.id,
      status: 'success',
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      action_id: action.id,
      status: 'failure',
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Execute command action.
 */
async function executeCommand(
  action: ProposedAction,
  sandboxDir: string,
  config: Required<ExecutorConfig>,
  startTime: number
): Promise<ActionResult> {
  try {
    const { stdout, stderr } = await execAsync(action.target, {
      cwd: sandboxDir,
      timeout: config.actionTimeout,
      maxBuffer: config.maxOutputSize,
    });

    return {
      action_id: action.id,
      status: 'success',
      exit_code: 0,
      stdout: stdout.slice(0, config.maxOutputSize),
      stderr: stderr.slice(0, config.maxOutputSize),
      duration_ms: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const execError = error as { code?: number; stdout?: string; stderr?: string; message?: string };

    if (execError.code === undefined) {
      // Timeout or other error
      return {
        action_id: action.id,
        status: 'timeout',
        error: execError.message ?? 'Command timeout',
        duration_ms: Date.now() - startTime,
      };
    }

    const result: ActionResult = {
      action_id: action.id,
      status: 'failure',
      exit_code: execError.code,
      error: `Command exited with code ${execError.code}`,
      duration_ms: Date.now() - startTime,
    };

    if (execError.stdout) {
      result.stdout = execError.stdout.slice(0, config.maxOutputSize);
    }
    if (execError.stderr) {
      result.stderr = execError.stderr.slice(0, config.maxOutputSize);
    }

    return result;
  }
}

// =============================================================================
// Test Execution
// =============================================================================

/**
 * Execute acceptance tests.
 *
 * @param tests - Tests to execute
 * @param sandboxDir - Sandbox directory
 * @returns Test results
 */
async function executeTests(
  tests: AcceptanceTest[],
  sandboxDir: string
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const test of tests) {
    const result = await executeTest(test, sandboxDir);
    results.push(result);
  }

  return results;
}

/**
 * Execute a single test.
 */
async function executeTest(
  test: AcceptanceTest,
  sandboxDir: string
): Promise<TestResult> {
  try {
    switch (test.type) {
      case 'hash_match':
        return await testHashMatch(test, sandboxDir);

      case 'file_exists':
        return await testFileExists(test, sandboxDir);

      case 'command_success':
        return await testCommandSuccess(test, sandboxDir);

      case 'content_match':
        return await testContentMatch(test, sandboxDir);

      default:
        return {
          test_id: test.id,
          passed: false,
          actual: '',
          error: `Unknown test type: ${test.type}`,
        };
    }
  } catch (error) {
    return {
      test_id: test.id,
      passed: false,
      actual: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test that file hash matches expected.
 */
async function testHashMatch(
  test: AcceptanceTest,
  sandboxDir: string
): Promise<TestResult> {
  const targetPath = join(sandboxDir, test.target);

  try {
    const content = await readFile(targetPath, 'utf-8');
    const actualHash = createHash('sha256')
      .update(content + '\n', 'utf-8')
      .digest('hex');

    return {
      test_id: test.id,
      passed: actualHash === test.expected,
      actual: actualHash,
    };
  } catch {
    return {
      test_id: test.id,
      passed: false,
      actual: '',
      error: `File not found: ${test.target}`,
    };
  }
}

/**
 * Test that file exists.
 */
async function testFileExists(
  test: AcceptanceTest,
  sandboxDir: string
): Promise<TestResult> {
  const targetPath = join(sandboxDir, test.target);

  try {
    await stat(targetPath);
    return {
      test_id: test.id,
      passed: test.expected === 'true',
      actual: 'true',
    };
  } catch {
    return {
      test_id: test.id,
      passed: test.expected === 'false',
      actual: 'false',
    };
  }
}

/**
 * Test that command succeeds.
 */
async function testCommandSuccess(
  test: AcceptanceTest,
  sandboxDir: string
): Promise<TestResult> {
  try {
    await execAsync(test.target, { cwd: sandboxDir, timeout: 10000 });
    return {
      test_id: test.id,
      passed: test.expected === '0',
      actual: '0',
    };
  } catch (error: unknown) {
    const execError = error as { code?: number };
    const actual = String(execError.code ?? 'error');
    return {
      test_id: test.id,
      passed: actual === test.expected,
      actual,
    };
  }
}

/**
 * Test that file content matches.
 */
async function testContentMatch(
  test: AcceptanceTest,
  sandboxDir: string
): Promise<TestResult> {
  const targetPath = join(sandboxDir, test.target);

  try {
    const content = await readFile(targetPath, 'utf-8');
    return {
      test_id: test.id,
      passed: content === test.expected,
      actual: content.slice(0, 100) + (content.length > 100 ? '...' : ''),
    };
  } catch {
    return {
      test_id: test.id,
      passed: false,
      actual: '',
      error: `File not found: ${test.target}`,
    };
  }
}

// =============================================================================
// Main Executor
// =============================================================================

/**
 * Execute a proposal and return evidence.
 *
 * @param proposal - Proposal to execute
 * @param config - Executor configuration
 * @returns Execution evidence
 */
export async function executeProposal(
  proposal: Proposal,
  config: ExecutorConfig = {}
): Promise<ExecutionEvidence> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Create sandbox
  const sandboxDir = await createSandbox(fullConfig.baseDir);

  try {
    // Execute all actions
    const actionResults: ActionResult[] = [];
    for (const action of proposal.actions) {
      const result = await executeAction(action, sandboxDir, fullConfig);
      actionResults.push(result);
    }

    // Execute all tests
    const testResults = await executeTests(proposal.acceptance_tests, sandboxDir);

    // Determine overall status
    const allActionsSuccess = actionResults.every(
      (r) => r.status === 'success' || r.status === 'skipped'
    );
    const allTestsPass = testResults.every((r) => r.passed);

    let status: 'complete' | 'partial' | 'failed';
    if (allActionsSuccess && allTestsPass) {
      status = 'complete';
    } else if (actionResults.some((r) => r.status === 'success')) {
      status = 'partial';
    } else {
      status = 'failed';
    }

    const completedAt = new Date().toISOString();

    return {
      proposal_id: proposal.id,
      proposal_hash: canonicalHash(proposal),
      action_results: actionResults,
      test_results: testResults,
      status,
      started_at: startedAt,
      completed_at: completedAt,
      total_duration_ms: Date.now() - startTime,
      executor_id: fullConfig.executorId,
      working_dir: sandboxDir,
    };
  } finally {
    // Cleanup if configured
    if (fullConfig.cleanup) {
      await cleanupSandbox(sandboxDir);
    }
  }
}
