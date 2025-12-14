// Auto-Applier - Apply changes with automatic rollback on failure

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import { Result, Ok, Err } from '../core/result'
import { contentAddress } from '../core/contentAddress'
import { globalTimeProvider } from '../core/ids'
import type { ImprovementProposal } from './proposer'

const execAsync = promisify(exec)

export type ApplyResult = {
  success: boolean
  proposalId: string
  beforeCommit: string
  afterCommit?: string
  timestamp: number
  rolledBack: boolean
  testResults?: {
    passed: number
    failed: number
    allPass: boolean
  }
  error?: string
}

export class AutoApplier {
  private repoPath: string

  constructor(repoPath: string = '/home/motherlabs/motherlabs-runtime') {
    this.repoPath = repoPath
  }

  /**
   * Apply proposal with automatic rollback on failure
   */
  async apply(proposal: ImprovementProposal): Promise<Result<ApplyResult, Error>> {
    try {
      // 1. Get current commit (checkpoint for rollback)
      const beforeCommit = await this.getCurrentCommit()

      // 2. Apply the change
      const applied = await this.applyChange(proposal)

      if (!applied.ok) {
        return Ok({
          success: false,
          proposalId: proposal.id,
          beforeCommit,
          timestamp: globalTimeProvider.now(),
          rolledBack: false,
          error: applied.error.message
        })
      }

      // 3. Commit the change
      await this.gitCommit(`self-improve: ${proposal.issue.type}`, proposal.rationale)

      // 4. Run all tests to verify
      const testResults = await this.runAllTests()

      // 5. If tests fail → AUTOMATIC ROLLBACK
      if (!testResults.allPass) {
        await this.rollback(beforeCommit)

        return Ok({
          success: false,
          proposalId: proposal.id,
          beforeCommit,
          timestamp: globalTimeProvider.now(),
          rolledBack: true,
          testResults,
          error: 'Tests failed after apply - rolled back'
        })
      }

      // 6. Success - get new commit
      const afterCommit = await this.getCurrentCommit()

      return Ok({
        success: true,
        proposalId: proposal.id,
        beforeCommit,
        afterCommit,
        timestamp: globalTimeProvider.now(),
        rolledBack: false,
        testResults
      })

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Apply change to file system
   */
  private async applyChange(proposal: ImprovementProposal): Promise<Result<void, Error>> {
    try {
      const { targetFile, proposedChange } = proposal

      if (proposedChange.type === 'add_test') {
        // Create test file
        const testPath = targetFile.replace(/\.ts$/, '.test.ts').replace(/^src\//, 'tests/')
        fs.writeFileSync(testPath, proposedChange.code, 'utf-8')
      } else if (proposedChange.type === 'add_function') {
        // Append to existing file
        const existing = fs.readFileSync(targetFile, 'utf-8')
        fs.writeFileSync(targetFile, existing + '\n' + proposedChange.code, 'utf-8')
      }
      // Other types would be implemented here

      return Ok(void 0)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Get current git commit hash
   */
  private async getCurrentCommit(): Promise<string> {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: this.repoPath })
    return stdout.trim()
  }

  /**
   * Commit changes
   */
  private async gitCommit(message: string, body?: string): Promise<void> {
    const fullMessage = body ? `${message}\n\n${body}` : message
    await execAsync(`git add -A && git commit -m "${fullMessage}"`, { cwd: this.repoPath })
  }

  /**
   * Rollback to previous commit
   */
  private async rollback(commitHash: string): Promise<void> {
    await execAsync(`git reset --hard ${commitHash}`, { cwd: this.repoPath })
  }

  /**
   * Run all tests and return results
   */
  private async runAllTests(): Promise<{ passed: number; failed: number; allPass: boolean }> {
    try {
      await execAsync('npm test', { cwd: this.repoPath, timeout: 60000 })

      return {
        passed: 198,  // UNIMPLEMENTED: Parse actual test count
        failed: 0,
        allPass: true
      }

    } catch (error) {
      return {
        passed: 0,
        failed: 1,  // UNIMPLEMENTED: Parse actual failure count
        allPass: false
      }
    }
  }
}
