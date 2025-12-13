// Execution Engine - Sandboxed code execution with timeout

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Result, Ok, Err } from '../core/result'
import { contentAddress } from '../core/contentAddress'

export type ExecutionPlan = {
  id: string
  type: 'typescript' | 'javascript' | 'shell'
  code: string
  timeout: number
  sandbox: boolean
  dependencies?: string[]
}

export type ExecutionResult = {
  planId: string
  success: boolean
  startTime: number
  endTime: number
  exitCode: number
  stdout?: string
  stderr?: string
  error?: string
  evidence: {
    timedOut: boolean
    killed: boolean
    sandboxed: boolean
  }
}

export class ExecutionEngine {
  private sandboxDir: string

  constructor(config: { sandboxDir: string }) {
    this.sandboxDir = config.sandboxDir

    // Ensure sandbox directory exists
    if (!fs.existsSync(this.sandboxDir)) {
      fs.mkdirSync(this.sandboxDir, { recursive: true })
    }
  }

  /**
   * Execute plan in sandbox with timeout
   */
  async execute(plan: ExecutionPlan): Promise<Result<ExecutionResult, Error>> {
    const startTime = Date.now()  // DETERMINISM-EXEMPT: Measuring execution time

    try {
      // Validate plan
      if (!plan.code || plan.code.trim().length === 0) {
        return Err(new Error('Code is empty'))
      }

      if (!plan.sandbox) {
        return Err(new Error('Only sandboxed execution allowed'))
      }

      // Create temp file for code
      const codeFile = path.join(this.sandboxDir, `exec-${Date.now()}.ts`)  // DETERMINISM-EXEMPT: Temp file name
      fs.writeFileSync(codeFile, plan.code, 'utf-8')

      // Execute with timeout
      const result = await this.executeWithTimeout(codeFile, plan.type, plan.timeout)

      // Cleanup
      try {
        fs.unlinkSync(codeFile)
      } catch {
        // Ignore cleanup errors
      }

      const endTime = Date.now()  // DETERMINISM-EXEMPT: Measuring execution time

      return Ok({
        planId: plan.id,
        success: result.exitCode === 0 && !result.timedOut,
        startTime,
        endTime,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
        evidence: {
          timedOut: result.timedOut,
          killed: result.killed,
          sandboxed: true
        }
      })

    } catch (error) {
      const endTime = Date.now()  // DETERMINISM-EXEMPT: Measuring execution time

      return Ok({
        planId: plan.id,
        success: false,
        startTime,
        endTime,
        exitCode: 1,
        error: error instanceof Error ? error.message : String(error),
        evidence: {
          timedOut: false,
          killed: false,
          sandboxed: true
        }
      })
    }
  }

  /**
   * Execute with timeout enforcement
   */
  private executeWithTimeout(
    filepath: string,
    type: string,
    timeout: number
  ): Promise<{
    exitCode: number
    stdout: string
    stderr: string
    error?: string
    timedOut: boolean
    killed: boolean
  }> {
    return new Promise((resolve) => {
      let timedOut = false
      let killed = false

      // Determine command based on type
      const command = type === 'typescript' ? 'npx' : 'node'
      const args = type === 'typescript' ? ['tsx', filepath] : [filepath]

      const proc = spawn(command, args, {
        cwd: this.sandboxDir,
        timeout,
        killSignal: 'SIGTERM'
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      // Timeout handler
      const timeoutId = setTimeout(() => {
        timedOut = true
        killed = true
        proc.kill('SIGTERM')
      }, timeout)

      proc.on('close', (code) => {
        clearTimeout(timeoutId)

        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          error: timedOut ? 'TIMEOUT: Execution exceeded time limit' : undefined,
          timedOut,
          killed
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timeoutId)

        resolve({
          exitCode: 1,
          stdout,
          stderr,
          error: err.message,
          timedOut: false,
          killed: false
        })
      })
    })
  }
}
