// Sandboxed Code Executor - Based on Motherlabs Kernel patterns
// Security: Command allowlist, env scrubbing, symlink protection, timeouts

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync, rmSync, lstatSync, readFileSync } from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { Result, Ok, Err } from '../core/result'

// Configuration
const SANDBOX_ROOT = '.sandbox/gate4'
const DEFAULT_TIMEOUT_MS = 10_000  // 10 seconds
const MAX_STDOUT_BYTES = 1024 * 1024  // 1 MB
const MAX_STDERR_BYTES = 1024 * 1024  // 1 MB

// Command allowlist - only these can be executed
const COMMAND_ALLOWLIST = ['node', 'npx', 'tsx', 'tsc', 'bash', 'sh']

export type ExecutionConfig = {
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
}

export type ExecutionResult = {
  success: boolean
  exitCode: number
  stdout: string
  stderr: string
  runDir: string
  durationMs: number
  timedOut: boolean
}

/**
 * Assert that a path contains no symlinks in its chain.
 * SECURITY: Prevents symlink attacks where attacker creates symlinks
 * to escape sandbox or access sensitive files.
 */
function assertNoSymlinksInPath(targetPath: string): void {
  const resolvedPath = resolve(targetPath)
  const parts = resolvedPath.split('/').filter(Boolean)

  let currentPath = '/'
  for (const part of parts) {
    currentPath = join(currentPath, part)

    if (existsSync(currentPath)) {
      try {
        const lstats = lstatSync(currentPath)
        if (lstats.isSymbolicLink()) {
          throw new Error(`Symlink detected in path: ${currentPath}`)
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('Symlink detected')) {
          throw e
        }
        // If lstat fails for other reasons, path may not exist yet
      }
    }
  }
}

/**
 * Create sanitized environment for subprocess execution.
 * SECURITY: Deny-by-default. Only PATH is passed through.
 * Blocks all API keys, tokens, secrets.
 */
function createSanitizedEnv(): Record<string, string> {
  const sanitized: Record<string, string> = {}

  // Only include PATH (required for command resolution)
  if (process.env.PATH) {
    sanitized.PATH = process.env.PATH
  }

  // Add NODE_PATH if exists (for module resolution)
  if (process.env.NODE_PATH) {
    sanitized.NODE_PATH = process.env.NODE_PATH
  }

  return sanitized
}

/**
 * Resolve command to absolute path with security checks.
 * SECURITY: Commands must be in allowlist or absolute paths that exist.
 */
function resolveCommand(command: string): string {
  // Case 1: Absolute path - must exist
  if (isAbsolute(command)) {
    if (!existsSync(command)) {
      throw new Error(`Command not found: ${command}`)
    }
    assertNoSymlinksInPath(command)
    return command
  }

  // Case 2: Command name - must be in allowlist
  if (!COMMAND_ALLOWLIST.includes(command)) {
    throw new Error(
      `Command not in allowlist: ${command}. ` +
      `Allowed: ${COMMAND_ALLOWLIST.join(', ')}`
    )
  }

  // Resolve via which
  try {
    const whichResult = execSync(`which ${command}`, { encoding: 'utf8' }).trim()
    if (!whichResult || !existsSync(whichResult)) {
      throw new Error(`Command not found via which: ${command}`)
    }
    return whichResult
  } catch {
    throw new Error(`Failed to resolve command: ${command}`)
  }
}

/**
 * Kill process tree on Unix systems.
 * Uses negative PID to kill process group.
 */
function killProcessTree(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Process may already be dead
    }
  }
}

/**
 * Create a unique run directory for execution.
 */
function createRunDirectory(): string {
  const id = randomBytes(8).toString('hex')
  const timestamp = Date.now()  // DETERMINISM-EXEMPT:TIME - Used for unique directory name only
  const runDirName = `${timestamp}-${id}`
  const runDir = resolve(SANDBOX_ROOT, runDirName)

  // Ensure sandbox root exists
  if (!existsSync(SANDBOX_ROOT)) {
    mkdirSync(SANDBOX_ROOT, { recursive: true })
  }

  mkdirSync(runDir, { recursive: true })
  return runDir
}

/**
 * Execute code in sandbox with timeout and output limits.
 */
async function executeInSandbox(
  command: string,
  args: string[],
  cwd: string,
  config: ExecutionConfig
): Promise<ExecutionResult> {
  const startTime = Date.now()  // DETERMINISM-EXEMPT:TIME - Performance measurement only

  return new Promise((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false

    const env = createSanitizedEnv()

    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true  // Required for process group killing
    })

    const pid = proc.pid

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBytes += data.length

      if (!stdoutTruncated) {
        const chunk = data.toString()
        if (stdout.length + chunk.length > config.maxStdoutBytes) {
          const remaining = config.maxStdoutBytes - stdout.length
          stdout += chunk.slice(0, remaining)
          stdoutTruncated = true
          stdout += '\n[SANDBOX] stdout truncated'
        } else {
          stdout += chunk
        }
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderrBytes += data.length

      if (!stderrTruncated) {
        const chunk = data.toString()
        if (stderr.length + chunk.length > config.maxStderrBytes) {
          const remaining = config.maxStderrBytes - stderr.length
          stderr += chunk.slice(0, remaining)
          stderrTruncated = true
          stderr += '\n[SANDBOX] stderr truncated'
        } else {
          stderr += chunk
        }
      }
    })

    const timeoutId = setTimeout(() => {
      timedOut = true
      stderr += '\n[SANDBOX] Process killed due to timeout'
      if (pid) {
        killProcessTree(pid)
      }
    }, config.timeoutMs)

    proc.on('close', (code) => {
      clearTimeout(timeoutId)
      const durationMs = Date.now() - startTime  // DETERMINISM-EXEMPT:TIME

      resolvePromise({
        success: code === 0,
        exitCode: timedOut ? -1 : (code ?? -1),
        stdout,
        stderr,
        runDir: cwd,
        durationMs,
        timedOut
      })
    })

    proc.on('error', (err) => {
      clearTimeout(timeoutId)
      const durationMs = Date.now() - startTime  // DETERMINISM-EXEMPT:TIME
      stderr += `\n[SANDBOX] Process error: ${err.message}`

      resolvePromise({
        success: false,
        exitCode: -1,
        stdout,
        stderr,
        runDir: cwd,
        durationMs,
        timedOut: false
      })
    })
  })
}

/**
 * Execute TypeScript code in a sandboxed environment.
 * Creates temp directory, writes code, runs with tsx, returns result.
 */
export async function executeCode(
  code: string,
  options: Partial<ExecutionConfig> = {}
): Promise<Result<ExecutionResult, Error>> {
  const config: ExecutionConfig = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxStdoutBytes: options.maxStdoutBytes ?? MAX_STDOUT_BYTES,
    maxStderrBytes: options.maxStderrBytes ?? MAX_STDERR_BYTES
  }

  let runDir: string

  try {
    // 1. Create isolated run directory
    runDir = createRunDirectory()

    // 2. Write code to temp file
    const codeFile = join(runDir, 'code.ts')
    writeFileSync(codeFile, code, 'utf8')

    // 3. Resolve tsx command
    let command: string
    let args: string[]

    try {
      command = resolveCommand('npx')
      args = ['tsx', codeFile]
    } catch {
      // Fallback to node if tsx not available
      // First compile to JS
      try {
        const tscCommand = resolveCommand('npx')
        execSync(`${tscCommand} tsc --target ES2020 --module NodeNext --moduleResolution NodeNext --outDir ${runDir} ${codeFile}`, {
          timeout: 30000,
          encoding: 'utf8'
        })
        command = resolveCommand('node')
        args = [join(runDir, 'code.js')]
      } catch (compileErr) {
        return Err(new Error(`Failed to compile: ${compileErr instanceof Error ? compileErr.message : String(compileErr)}`))
      }
    }

    // 4. Execute in sandbox
    const result = await executeInSandbox(command, args, runDir, config)

    return Ok(result)

  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Execute TypeScript code and verify it runs without errors.
 * Simplified version for Gate 4 - just checks if code executes cleanly.
 */
export async function verifyCodeExecution(
  code: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Result<{ passed: boolean; details: ExecutionResult }, Error>> {
  const result = await executeCode(code, { timeoutMs })

  if (!result.ok) {
    return Err(result.error)
  }

  const execution = result.value

  // Code passes if:
  // 1. Exit code is 0
  // 2. No timeout
  // 3. No runtime errors in stderr (except warnings)
  const hasRuntimeError = execution.stderr.includes('Error:') ||
                          execution.stderr.includes('TypeError:') ||
                          execution.stderr.includes('ReferenceError:') ||
                          execution.stderr.includes('SyntaxError:')

  const passed = execution.exitCode === 0 && !execution.timedOut && !hasRuntimeError

  return Ok({ passed, details: execution })
}

/**
 * Cleanup sandbox directory after execution.
 */
export function cleanupRunDirectory(runDir: string): void {
  try {
    if (existsSync(runDir) && runDir.includes(SANDBOX_ROOT)) {
      rmSync(runDir, { recursive: true, force: true })
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Ensure sandbox root directory exists.
 */
export function ensureSandboxRoot(): void {
  if (!existsSync(SANDBOX_ROOT)) {
    mkdirSync(SANDBOX_ROOT, { recursive: true })
  }
}
