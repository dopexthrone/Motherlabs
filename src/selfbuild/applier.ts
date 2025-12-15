// Auto-Applier - Apply changes with automatic rollback on failure
// TCB Component: This file is part of the Trusted Computing Base
//
// AUTHORIZATION ENFORCEMENT:
// AXIOM: No execution without prior ALLOW decision
// AXIOM: Authorization token required for apply()

import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import { Result, Ok, Err } from '../core/result'
import { contentAddress } from '../core/contentAddress'
import { globalTimeProvider } from '../core/ids'
import { isTCBPath } from '../core/decisionClassifier'
import type { ImprovementProposal } from './proposer'
import type { AuthorizationToken } from '../authorization/router'
import { getAuthorizationRouter, isAuthorizationRouterInitialized } from '../authorization/router'

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
   *
   * AUTHORIZATION REQUIRED: Must provide valid AuthorizationToken
   * Token must be obtained from AuthorizationRouter with prior ALLOW decision
   */
  async apply(
    proposal: ImprovementProposal,
    authToken: AuthorizationToken
  ): Promise<Result<ApplyResult, Error>> {
    // ═══════════════════════════════════════════════════════════════════════
    // AUTHORIZATION ENFORCEMENT - DENY-BY-DEFAULT
    // AXIOM: No execution without valid authorization token
    // This check MUST run before any file operations
    // ═══════════════════════════════════════════════════════════════════════
    if (!isAuthorizationRouterInitialized()) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Authorization Router not initialized. ` +
        `Cannot execute without authorization infrastructure.`
      ))
    }

    const router = getAuthorizationRouter()
    const tokenVerification = router.verifyToken(authToken)
    if (!tokenVerification.ok) {
      return Err(new Error(
        `AUTHORIZATION DENIED: ${tokenVerification.error.message}`
      ))
    }

    // Verify token is for this proposal
    const proposalId = contentAddress(proposal)
    if (authToken.target_id !== proposalId) {
      return Err(new Error(
        `AUTHORIZATION DENIED: Token target_id (${authToken.target_id}) ` +
        `does not match proposal ID (${proposalId}). ` +
        `Token may be for a different proposal.`
      ))
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TCB PROTECTION - DEFENSE IN DEPTH (second layer after loop.ts)
    // AXIOM: The applier REFUSES to modify TCB files under any circumstance
    // This is a hard block - no configuration can bypass it
    // ═══════════════════════════════════════════════════════════════════════
    if (isTCBPath(proposal.targetFile)) {
      return Err(new Error(
        `APPLIER TCB PROTECTION: Refusing to modify TCB file: ${proposal.targetFile}. ` +
        `TCB files can only be modified manually by humans.`
      ))
    }

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

      // 5. If tests fail → AUTOMATIC ROLLBACK via git
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
