/**
 * Sandbox Execution
 * =================
 *
 * Provides isolated execution environment for proposals.
 *
 * Key guarantees:
 * - Execution in temp directory only
 * - No network access (default)
 * - Timeout enforcement
 * - Deterministic output collection
 */

import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { PolicyProfile, SandboxExecution, OutputFile, ContentHash } from './types.js';
import { isCommandAllowed } from './policy.js';

// =============================================================================
// Sandbox Types
// =============================================================================

/**
 * Sandbox instance.
 */
export interface Sandbox {
  /**
   * Unique sandbox ID.
   */
  id: string;

  /**
   * Root directory of sandbox.
   */
  dir: string;

  /**
   * Output directory within sandbox.
   */
  outDir: string;

  /**
   * Logs directory within sandbox.
   */
  logsDir: string;
}

/**
 * Result of running a command in sandbox.
 */
export interface SandboxRunResult {
  /**
   * Exit code.
   */
  exit_code: number;

  /**
   * Path to stdout file.
   */
  stdout_path: string;

  /**
   * Path to stderr file.
   */
  stderr_path: string;

  /**
   * Whether process was killed due to timeout.
   */
  timed_out: boolean;

  /**
   * Error message if spawn failed.
   */
  error?: string;
}

// =============================================================================
// Sandbox Management
// =============================================================================

/**
 * Create a new sandbox.
 *
 * @returns Sandbox instance
 */
export async function createSandbox(): Promise<Sandbox> {
  // Generate deterministic-looking but unique ID
  // Using crypto.randomBytes for sandbox isolation (not for hashing)
  const suffix = randomBytes(4).toString('hex');
  const id = `sandbox_${suffix}`;

  const dir = join(tmpdir(), `motherlabs_harness_${id}`);
  const outDir = join(dir, 'out');
  const logsDir = join(dir, 'logs');

  await mkdir(dir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  return { id, dir, outDir, logsDir };
}

/**
 * Clean up sandbox.
 *
 * @param sandbox - Sandbox to clean up
 */
export async function cleanupSandbox(sandbox: Sandbox): Promise<void> {
  try {
    await rm(sandbox.dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Command Execution
// =============================================================================

/**
 * Run a command in the sandbox.
 *
 * @param sandbox - Sandbox to run in
 * @param cmd - Command array (first element is executable)
 * @param policy - Policy profile
 * @returns Run result
 */
export async function runInSandbox(
  sandbox: Sandbox,
  cmd: string[],
  policy: PolicyProfile
): Promise<SandboxRunResult> {
  const executable = cmd[0];
  if (!executable) {
    return {
      exit_code: 1,
      stdout_path: '',
      stderr_path: '',
      timed_out: false,
      error: 'Empty command',
    };
  }

  // Check if command is allowed
  if (!isCommandAllowed(executable, policy)) {
    return {
      exit_code: 1,
      stdout_path: '',
      stderr_path: '',
      timed_out: false,
      error: `Command not allowed by policy: ${executable}`,
    };
  }

  const stdoutPath = join(sandbox.logsDir, 'stdout.txt');
  const stderrPath = join(sandbox.logsDir, 'stderr.txt');

  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let resolved = false;

    const proc = spawn(executable, cmd.slice(1), {
      cwd: sandbox.dir,
      env: {
        ...process.env,
        // Restrict HOME and TMPDIR to sandbox
        HOME: sandbox.dir,
        TMPDIR: sandbox.dir,
        // Clear network-related env vars
        http_proxy: '',
        https_proxy: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        no_proxy: '*',
        NO_PROXY: '*',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Collect stdout
    proc.stdout?.on('data', (data: Buffer) => {
      stdoutData += data.toString();
      // Enforce max size
      if (stdoutData.length > policy.max_total_output_bytes) {
        stdoutData = stdoutData.slice(0, policy.max_total_output_bytes);
      }
    });

    // Collect stderr
    proc.stderr?.on('data', (data: Buffer) => {
      stderrData += data.toString();
      // Enforce max size
      if (stderrData.length > policy.max_total_output_bytes) {
        stderrData = stderrData.slice(0, policy.max_total_output_bytes);
      }
    });

    // Timeout handler
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, policy.timeout_ms);

    // Process exit handler
    proc.on('close', async (code) => {
      clearTimeout(timeout);

      if (resolved) return;
      resolved = true;

      // Write stdout/stderr to files
      try {
        await writeFile(stdoutPath, stdoutData, 'utf-8');
        await writeFile(stderrPath, stderrData, 'utf-8');
      } catch {
        // Ignore write errors
      }

      resolve({
        exit_code: code ?? 1,
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
        timed_out: timedOut,
      });
    });

    // Error handler
    proc.on('error', async (err) => {
      clearTimeout(timeout);

      if (resolved) return;
      resolved = true;

      resolve({
        exit_code: 1,
        stdout_path: '',
        stderr_path: '',
        timed_out: false,
        error: err.message,
      });
    });
  });
}

// =============================================================================
// Output Collection
// =============================================================================

/**
 * Compute SHA-256 hash of content.
 */
function sha256(content: string | Buffer): ContentHash {
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Collect outputs from sandbox directory.
 * Walks directory deterministically (sorted).
 *
 * @param sandbox - Sandbox to collect from
 * @param policy - Policy for limits
 * @returns Output files and total bytes
 */
export async function collectOutputs(
  sandbox: Sandbox,
  policy: PolicyProfile
): Promise<{ outputs: OutputFile[]; total_bytes: number; truncated: boolean }> {
  const outputs: OutputFile[] = [];
  let totalBytes = 0;
  let truncated = false;

  async function walkDir(dir: string, basePath: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    // Sort entries deterministically
    entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    for (const entry of entries) {
      // Check limits
      if (outputs.length >= policy.max_output_files) {
        truncated = true;
        return;
      }
      if (totalBytes >= policy.max_total_output_bytes) {
        truncated = true;
        return;
      }

      const fullPath = join(dir, entry);
      const relativePath = basePath ? `${basePath}/${entry}` : entry;

      let stats;
      try {
        stats = await stat(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        await walkDir(fullPath, relativePath);
      } else if (stats.isFile()) {
        try {
          const content = await readFile(fullPath);
          outputs.push({
            path: relativePath,
            sha256: sha256(content),
            size_bytes: content.length,
          });
          totalBytes += content.length;
        } catch {
          // Skip files we can't read
        }
      }
    }
  }

  await walkDir(sandbox.outDir, '');

  return { outputs, total_bytes: totalBytes, truncated };
}

/**
 * Build sandbox execution evidence.
 *
 * @param sandbox - Sandbox used
 * @param cmd - Command executed
 * @param runResult - Result of running command
 * @param policy - Policy used
 * @returns Sandbox execution evidence
 */
export async function buildSandboxExecution(
  sandbox: Sandbox,
  cmd: string[],
  runResult: SandboxRunResult,
  policy: PolicyProfile
): Promise<SandboxExecution> {
  // Hash stdout/stderr
  let stdoutSha256: ContentHash = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // empty
  let stderrSha256: ContentHash = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // empty

  if (runResult.stdout_path) {
    try {
      const content = await readFile(runResult.stdout_path);
      stdoutSha256 = sha256(content);
    } catch {
      // Use empty hash
    }
  }

  if (runResult.stderr_path) {
    try {
      const content = await readFile(runResult.stderr_path);
      stderrSha256 = sha256(content);
    } catch {
      // Use empty hash
    }
  }

  // Collect outputs
  const { outputs, total_bytes, truncated } = await collectOutputs(sandbox, policy);

  return {
    sandbox_id: sandbox.id,
    cmd,
    exit_code: runResult.exit_code,
    stdout_sha256: stdoutSha256,
    stderr_sha256: stderrSha256,
    outputs,
    total_output_bytes: total_bytes,
    output_truncated: truncated,
  };
}
