// Collapse Chain - Final reduction of uncertainty before action
// "No idea may become action without critique, verification, and execution"
//
// CRITIC    → Exposes weakness
// VERIFIER  → Establishes truth
// EXECUTOR  → Performs without interpretation
//
// The chain collapses uncertainty into action only when all three approve.

import { Result, Ok, Err } from './result'
import { contentAddress } from './contentAddress'
import { globalTimeProvider } from './ids'
import { getIdentity } from './identity'
import { URCOCycleResult } from './urco'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Severity = 'fatal' | 'major' | 'minor' | 'note'

export type Weakness = {
  id: string
  severity: Severity
  category: string
  description: string
  location?: string
  suggestion?: string
}

export type CritiqueResult = {
  approved: boolean
  weaknesses: Weakness[]
  fatalCount: number
  majorCount: number
  minorCount: number
  summary: string
  timestamp: number
  durationMs: number
}

export type VerificationCheck = {
  name: string
  passed: boolean
  evidence?: string
  error?: string
}

export type VerificationResult = {
  approved: boolean
  checks: VerificationCheck[]
  passedCount: number
  failedCount: number
  provenanceVerified: boolean
  truthEstablished: boolean
  summary: string
  timestamp: number
  durationMs: number
}

export type ExecutionOutcome = {
  executed: boolean
  action: string
  result: unknown
  sideEffects: string[]
  error?: string
  timestamp: number
  durationMs: number
}

export type CollapseChainResult<T> = {
  chainId: string
  input: T
  critique: CritiqueResult
  verification: VerificationResult | null  // null if critique rejected
  execution: ExecutionOutcome | null       // null if verification rejected
  collapsed: boolean                       // true if all three approved and executed
  finalState: 'rejected_by_critic' | 'rejected_by_verifier' | 'execution_failed' | 'collapsed'
  artifacts: CollapseArtifact[]
  timestamp: number
  totalDurationMs: number
}

export type CollapseArtifact = {
  stage: 'critic' | 'verifier' | 'executor'
  observation: string
  timestamp: number
}

// ═══════════════════════════════════════════════════════════════════════════
// ROLE INTERFACES - Pluggable implementations for each role
// ═══════════════════════════════════════════════════════════════════════════

export type CriticRole<T> = {
  critique: (input: T, context: Record<string, unknown>) => Promise<CritiqueResult>
}

export type VerifierRole<T> = {
  verify: (input: T, critique: CritiqueResult, context: Record<string, unknown>) => Promise<VerificationResult>
}

export type ExecutorRole<T, R> = {
  execute: (input: T, verification: VerificationResult, context: Record<string, unknown>) => Promise<ExecutionOutcome>
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLAPSE CHAIN ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export class CollapseChain<T, R = unknown> {
  private critic: CriticRole<T>
  private verifier: VerifierRole<T>
  private executor: ExecutorRole<T, R>
  private history: CollapseChainResult<T>[] = []

  constructor(
    critic: CriticRole<T>,
    verifier: VerifierRole<T>,
    executor: ExecutorRole<T, R>
  ) {
    this.critic = critic
    this.verifier = verifier
    this.executor = executor
  }

  /**
   * Execute the collapse chain
   * CRITIC → VERIFIER → EXECUTOR
   * Stops at first rejection
   */
  async collapse(input: T, context: Record<string, unknown> = {}): Promise<Result<CollapseChainResult<T>, Error>> {
    const startTime = globalTimeProvider.now()
    const chainId = contentAddress({ input, timestamp: startTime })
    const artifacts: CollapseArtifact[] = []

    try {
      // ═══════════════════════════════════════════════════════════════════
      // STAGE 1: CRITIC - Exposes weakness
      // ═══════════════════════════════════════════════════════════════════
      artifacts.push({
        stage: 'critic',
        observation: 'Beginning critique - searching for weaknesses',
        timestamp: globalTimeProvider.now()
      })

      const critique = await this.critic.critique(input, context)

      artifacts.push({
        stage: 'critic',
        observation: `Critique complete: ${critique.fatalCount} fatal, ${critique.majorCount} major, ${critique.minorCount} minor weaknesses`,
        timestamp: globalTimeProvider.now()
      })

      // If critic found fatal weaknesses, stop here
      if (!critique.approved) {
        const endTime = globalTimeProvider.now()
        const result: CollapseChainResult<T> = {
          chainId,
          input,
          critique,
          verification: null,
          execution: null,
          collapsed: false,
          finalState: 'rejected_by_critic',
          artifacts,
          timestamp: startTime,
          totalDurationMs: endTime - startTime
        }
        this.history.push(result)
        return Ok(result)
      }

      // ═══════════════════════════════════════════════════════════════════
      // STAGE 2: VERIFIER - Establishes truth
      // ═══════════════════════════════════════════════════════════════════
      artifacts.push({
        stage: 'verifier',
        observation: 'Beginning verification - establishing truth',
        timestamp: globalTimeProvider.now()
      })

      const verification = await this.verifier.verify(input, critique, context)

      artifacts.push({
        stage: 'verifier',
        observation: `Verification complete: ${verification.passedCount}/${verification.checks.length} checks passed`,
        timestamp: globalTimeProvider.now()
      })

      // If verifier rejected, stop here
      if (!verification.approved) {
        const endTime = globalTimeProvider.now()
        const result: CollapseChainResult<T> = {
          chainId,
          input,
          critique,
          verification,
          execution: null,
          collapsed: false,
          finalState: 'rejected_by_verifier',
          artifacts,
          timestamp: startTime,
          totalDurationMs: endTime - startTime
        }
        this.history.push(result)
        return Ok(result)
      }

      // ═══════════════════════════════════════════════════════════════════
      // STAGE 3: EXECUTOR - Performs without interpretation
      // ═══════════════════════════════════════════════════════════════════
      artifacts.push({
        stage: 'executor',
        observation: 'Beginning execution - performing action',
        timestamp: globalTimeProvider.now()
      })

      const execution = await this.executor.execute(input, verification, context)

      artifacts.push({
        stage: 'executor',
        observation: execution.executed
          ? `Execution complete: ${execution.action}`
          : `Execution failed: ${execution.error}`,
        timestamp: globalTimeProvider.now()
      })

      const endTime = globalTimeProvider.now()
      const result: CollapseChainResult<T> = {
        chainId,
        input,
        critique,
        verification,
        execution,
        collapsed: execution.executed,
        finalState: execution.executed ? 'collapsed' : 'execution_failed',
        artifacts,
        timestamp: startTime,
        totalDurationMs: endTime - startTime
      }

      this.history.push(result)
      return Ok(result)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Get chain history
   */
  getHistory(): CollapseChainResult<T>[] {
    return [...this.history]
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = []
  }

  /**
   * Format result for display
   */
  formatResult(result: CollapseChainResult<T>): string {
    const identity = getIdentity()

    const lines = [
      '═══════════════════════════════════════════════════════════════════════════',
      `COLLAPSE CHAIN - ${identity?.name || 'Motherlabs'}`,
      '═══════════════════════════════════════════════════════════════════════════',
      '',
      `Chain ID: ${result.chainId.slice(0, 16)}...`,
      `Duration: ${result.totalDurationMs}ms`,
      `Final State: ${result.finalState.toUpperCase()}`,
      '',
      '───────────────────────────────────────────────────────────────────────────',
      'CRITIC (Exposes weakness)',
      '───────────────────────────────────────────────────────────────────────────',
      `  Approved: ${result.critique.approved ? '✓ YES' : '✗ NO'}`,
      `  Weaknesses: ${result.critique.fatalCount} fatal, ${result.critique.majorCount} major, ${result.critique.minorCount} minor`,
      `  Summary: ${result.critique.summary}`,
    ]

    if (result.critique.weaknesses.length > 0) {
      lines.push('  Details:')
      for (const w of result.critique.weaknesses.slice(0, 5)) {
        lines.push(`    [${w.severity.toUpperCase()}] ${w.description}`)
      }
      if (result.critique.weaknesses.length > 5) {
        lines.push(`    ... and ${result.critique.weaknesses.length - 5} more`)
      }
    }

    if (result.verification) {
      lines.push('')
      lines.push('───────────────────────────────────────────────────────────────────────────')
      lines.push('VERIFIER (Establishes truth)')
      lines.push('───────────────────────────────────────────────────────────────────────────')
      lines.push(`  Approved: ${result.verification.approved ? '✓ YES' : '✗ NO'}`)
      lines.push(`  Checks: ${result.verification.passedCount}/${result.verification.checks.length} passed`)
      lines.push(`  Provenance: ${result.verification.provenanceVerified ? '✓ Verified' : '✗ Unverified'}`)
      lines.push(`  Truth: ${result.verification.truthEstablished ? '✓ Established' : '✗ Not established'}`)
      lines.push(`  Summary: ${result.verification.summary}`)
    }

    if (result.execution) {
      lines.push('')
      lines.push('───────────────────────────────────────────────────────────────────────────')
      lines.push('EXECUTOR (Performs without interpretation)')
      lines.push('───────────────────────────────────────────────────────────────────────────')
      lines.push(`  Executed: ${result.execution.executed ? '✓ YES' : '✗ NO'}`)
      lines.push(`  Action: ${result.execution.action}`)
      if (result.execution.sideEffects.length > 0) {
        lines.push(`  Side Effects:`)
        result.execution.sideEffects.forEach(e => lines.push(`    - ${e}`))
      }
      if (result.execution.error) {
        lines.push(`  Error: ${result.execution.error}`)
      }
    }

    lines.push('')
    lines.push('═══════════════════════════════════════════════════════════════════════════')
    lines.push(`RESULT: ${result.collapsed ? '✓ COLLAPSED INTO ACTION' : '✗ CHAIN BROKEN - NO ACTION'}`)
    lines.push('═══════════════════════════════════════════════════════════════════════════')

    return lines.join('\n')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default critic for code/text - looks for common weaknesses
 */
export function createDefaultCritic<T>(): CriticRole<T> {
  return {
    async critique(input: T, context: Record<string, unknown>): Promise<CritiqueResult> {
      const startTime = globalTimeProvider.now()
      const weaknesses: Weakness[] = []

      // Check for null/undefined
      if (input === null || input === undefined) {
        weaknesses.push({
          id: 'null-input',
          severity: 'fatal',
          category: 'validity',
          description: 'Input is null or undefined',
          suggestion: 'Provide valid input'
        })
      }

      // Check for empty strings
      if (typeof input === 'string' && input.trim().length === 0) {
        weaknesses.push({
          id: 'empty-string',
          severity: 'fatal',
          category: 'validity',
          description: 'Input is empty string',
          suggestion: 'Provide non-empty input'
        })
      }

      // Check for uncertainty markers in strings
      if (typeof input === 'string') {
        if (/TODO|FIXME|XXX|HACK/i.test(input)) {
          weaknesses.push({
            id: 'uncertainty-marker',
            severity: 'major',
            category: 'completeness',
            description: 'Contains uncertainty markers (TODO, FIXME, etc.)',
            suggestion: 'Resolve all TODOs before proceeding'
          })
        }

        if (/\?\?\?/.test(input)) {
          weaknesses.push({
            id: 'unknown-marker',
            severity: 'major',
            category: 'completeness',
            description: 'Contains unknown markers (???)',
            suggestion: 'Resolve unknowns before proceeding'
          })
        }
      }

      // Check URCO results if present in context
      const urcoResult = context.urcoResult as URCOCycleResult<unknown> | undefined
      if (urcoResult) {
        if (urcoResult.finalEntropy > 0.5) {
          weaknesses.push({
            id: 'high-entropy',
            severity: 'major',
            category: 'clarity',
            description: `URCO output has high entropy (${(urcoResult.finalEntropy * 100).toFixed(1)}%)`,
            suggestion: 'Run additional URCO cycles to reduce entropy'
          })
        }
      }

      const fatalCount = weaknesses.filter(w => w.severity === 'fatal').length
      const majorCount = weaknesses.filter(w => w.severity === 'major').length
      const minorCount = weaknesses.filter(w => w.severity === 'minor').length

      const endTime = globalTimeProvider.now()

      return {
        approved: fatalCount === 0,
        weaknesses,
        fatalCount,
        majorCount,
        minorCount,
        summary: fatalCount > 0
          ? `Rejected: ${fatalCount} fatal weakness(es) found`
          : majorCount > 0
            ? `Approved with concerns: ${majorCount} major weakness(es)`
            : 'Approved: No significant weaknesses found',
        timestamp: startTime,
        durationMs: endTime - startTime
      }
    }
  }
}

/**
 * Default verifier - checks provenance and basic truth
 */
export function createDefaultVerifier<T>(): VerifierRole<T> {
  return {
    async verify(input: T, critique: CritiqueResult, context: Record<string, unknown>): Promise<VerificationResult> {
      const startTime = globalTimeProvider.now()
      const checks: VerificationCheck[] = []

      // Check 1: Critique was performed
      checks.push({
        name: 'critique_performed',
        passed: critique.timestamp > 0,
        evidence: `Critique completed at ${new Date(critique.timestamp).toISOString()}`
      })

      // Check 2: No fatal weaknesses
      checks.push({
        name: 'no_fatal_weaknesses',
        passed: critique.fatalCount === 0,
        evidence: critique.fatalCount === 0
          ? 'No fatal weaknesses'
          : `${critique.fatalCount} fatal weaknesses found`,
        error: critique.fatalCount > 0 ? 'Fatal weaknesses present' : undefined
      })

      // Check 3: Input has content
      checks.push({
        name: 'input_has_content',
        passed: input !== null && input !== undefined,
        evidence: input !== null ? 'Input is present' : 'Input is missing'
      })

      // Check 4: Context is valid
      checks.push({
        name: 'context_valid',
        passed: typeof context === 'object',
        evidence: 'Context is valid object'
      })

      // Check 5: URCO provenance if available
      const urcoResult = context.urcoResult as URCOCycleResult<unknown> | undefined
      if (urcoResult) {
        checks.push({
          name: 'urco_provenance',
          passed: !!urcoResult.cycleId,
          evidence: `URCO cycle ID: ${urcoResult.cycleId?.slice(0, 16)}...`
        })
      }

      const passedCount = checks.filter(c => c.passed).length
      const failedCount = checks.filter(c => !c.passed).length
      const provenanceVerified = checks.some(c => c.name.includes('provenance') && c.passed) || !urcoResult
      const truthEstablished = failedCount === 0

      const endTime = globalTimeProvider.now()

      return {
        approved: truthEstablished,
        checks,
        passedCount,
        failedCount,
        provenanceVerified,
        truthEstablished,
        summary: truthEstablished
          ? `Verified: All ${passedCount} checks passed`
          : `Rejected: ${failedCount} check(s) failed`,
        timestamp: startTime,
        durationMs: endTime - startTime
      }
    }
  }
}

/**
 * Default executor - logs action (no-op by default)
 */
export function createDefaultExecutor<T>(): ExecutorRole<T, void> {
  return {
    async execute(input: T, verification: VerificationResult, context: Record<string, unknown>): Promise<ExecutionOutcome> {
      const startTime = globalTimeProvider.now()

      // Default executor just logs - override for real actions
      const action = context.action as string || 'log_result'

      const endTime = globalTimeProvider.now()

      return {
        executed: true,
        action,
        result: input,
        sideEffects: [`Logged at ${new Date(endTime).toISOString()}`],
        timestamp: startTime,
        durationMs: endTime - startTime
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a collapse chain with default implementations
 */
export function createDefaultCollapseChain<T>(): CollapseChain<T, void> {
  return new CollapseChain(
    createDefaultCritic<T>(),
    createDefaultVerifier<T>(),
    createDefaultExecutor<T>()
  )
}

/**
 * Create a custom collapse chain
 */
export function createCollapseChain<T, R>(
  critic: CriticRole<T>,
  verifier: VerifierRole<T>,
  executor: ExecutorRole<T, R>
): CollapseChain<T, R> {
  return new CollapseChain(critic, verifier, executor)
}

// ═══════════════════════════════════════════════════════════════════════════
// QUICK COLLAPSE - One-shot chain for simple cases
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quick collapse with default chain
 */
export async function collapse<T>(
  input: T,
  context: Record<string, unknown> = {}
): Promise<Result<CollapseChainResult<T>, Error>> {
  const chain = createDefaultCollapseChain<T>()
  return chain.collapse(input, context)
}

/**
 * Collapse URCO result through the chain
 */
export async function collapseURCO<T>(
  urcoResult: URCOCycleResult<T>,
  context: Record<string, unknown> = {}
): Promise<Result<CollapseChainResult<T>, Error>> {
  const chain = createDefaultCollapseChain<T>()
  return chain.collapse(urcoResult.output, {
    ...context,
    urcoResult
  })
}
