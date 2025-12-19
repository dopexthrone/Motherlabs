// URCO - Universal Recursive Clarity Operator
// The heartbeat of Motherlabs
// "Nothing is complete until it passes through URCO"
//
// Cycle: EXPAND → EXAMINE → REMOVE → SYNTHESIZE
// Each cycle reduces entropy and increases clarity

import { Result, Ok, Err } from './result'
import { contentAddress } from './contentAddress'
import { globalTimeProvider } from './ids'
import { getIdentity, getURCOCycle } from './identity'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type Entropy = number  // 0.0 = crystalline clarity, 1.0 = undefined potential

export type URCOPhase = 'expand' | 'examine' | 'remove' | 'synthesize'

export type PhaseArtifact = {
  phase: URCOPhase
  observation: string
  entropy: Entropy
  timestamp: number
}

export type PhaseResult<T> = {
  output: T
  entropy: Entropy
  artifacts: PhaseArtifact[]
  metadata: Record<string, unknown>
}

export type URCOInput<T> = {
  subject: T
  context: Record<string, unknown>
  maxDepth?: number
  entropyThreshold?: Entropy  // Stop recursing when entropy drops below this
}

export type URCOCycleResult<T> = {
  cycleId: string
  input: T
  output: T
  phases: {
    expand: PhaseResult<T>
    examine: PhaseResult<T>
    remove: PhaseResult<T>
    synthesize: PhaseResult<T>
  }
  initialEntropy: Entropy
  finalEntropy: Entropy
  entropyReduction: Entropy
  depth: number
  totalCycles: number
  artifacts: PhaseArtifact[]
  timestamp: number
  durationMs: number
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE PROCESSORS - Pluggable implementations for each phase
// ═══════════════════════════════════════════════════════════════════════════

export type PhaseProcessor<T> = {
  expand: (input: T, context: Record<string, unknown>) => Promise<PhaseResult<T>>
  examine: (input: T, context: Record<string, unknown>) => Promise<PhaseResult<T>>
  remove: (input: T, context: Record<string, unknown>) => Promise<PhaseResult<T>>
  synthesize: (input: T, context: Record<string, unknown>) => Promise<PhaseResult<T>>
}

// ═══════════════════════════════════════════════════════════════════════════
// URCO ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export class URCOEngine<T> {
  private processor: PhaseProcessor<T>
  private maxDepth: number
  private entropyThreshold: Entropy
  private cycleHistory: URCOCycleResult<T>[] = []

  constructor(
    processor: PhaseProcessor<T>,
    options: {
      maxDepth?: number
      entropyThreshold?: Entropy
    } = {}
  ) {
    this.processor = processor
    this.maxDepth = options.maxDepth ?? 5
    this.entropyThreshold = options.entropyThreshold ?? 0.1
  }

  /**
   * Execute a single URCO cycle
   * EXPAND → EXAMINE → REMOVE → SYNTHESIZE
   */
  async cycle(input: URCOInput<T>, depth: number = 0): Promise<Result<URCOCycleResult<T>, Error>> {
    const startTime = globalTimeProvider.now()
    const cycleId = contentAddress({ input: input.subject, depth, timestamp: startTime })

    try {
      // Estimate initial entropy
      const initialEntropy = this.estimateEntropy(input.subject)

      // Phase 1: EXPAND - Reveal what is unknown
      const expandResult = await this.processor.expand(input.subject, input.context)

      // Phase 2: EXAMINE - Evaluate what is revealed
      const examineResult = await this.processor.examine(expandResult.output, {
        ...input.context,
        expandArtifacts: expandResult.artifacts
      })

      // Phase 3: REMOVE - Subtract what is unnecessary
      const removeResult = await this.processor.remove(examineResult.output, {
        ...input.context,
        examineArtifacts: examineResult.artifacts
      })

      // Phase 4: SYNTHESIZE - Structure what remains
      const synthesizeResult = await this.processor.synthesize(removeResult.output, {
        ...input.context,
        removeArtifacts: removeResult.artifacts
      })

      const finalEntropy = synthesizeResult.entropy
      const endTime = globalTimeProvider.now()

      const result: URCOCycleResult<T> = {
        cycleId,
        input: input.subject,
        output: synthesizeResult.output,
        phases: {
          expand: expandResult,
          examine: examineResult,
          remove: removeResult,
          synthesize: synthesizeResult
        },
        initialEntropy,
        finalEntropy,
        entropyReduction: initialEntropy - finalEntropy,
        depth,
        totalCycles: depth + 1,
        artifacts: [
          ...expandResult.artifacts,
          ...examineResult.artifacts,
          ...removeResult.artifacts,
          ...synthesizeResult.artifacts
        ],
        timestamp: startTime,
        durationMs: endTime - startTime
      }

      this.cycleHistory.push(result)

      return Ok(result)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Execute recursive URCO cycles until entropy threshold is reached
   * or max depth is exceeded
   */
  async process(input: URCOInput<T>): Promise<Result<URCOCycleResult<T>, Error>> {
    const maxDepth = input.maxDepth ?? this.maxDepth
    const entropyThreshold = input.entropyThreshold ?? this.entropyThreshold

    let currentInput = input
    let lastResult: URCOCycleResult<T> | null = null
    let depth = 0

    while (depth < maxDepth) {
      const cycleResult = await this.cycle(currentInput, depth)

      if (!cycleResult.ok) {
        return cycleResult
      }

      lastResult = cycleResult.value

      // Check if we've reached sufficient clarity
      if (lastResult.finalEntropy <= entropyThreshold) {
        break
      }

      // Check if entropy is no longer decreasing (convergence)
      if (lastResult.entropyReduction <= 0.01) {
        break
      }

      // Prepare for next cycle
      currentInput = {
        subject: lastResult.output,
        context: {
          ...input.context,
          previousCycleId: lastResult.cycleId,
          previousEntropy: lastResult.finalEntropy
        },
        maxDepth,
        entropyThreshold
      }

      depth++
    }

    if (!lastResult) {
      return Err(new Error('URCO process failed to produce any result'))
    }

    // Update total cycles count
    lastResult.totalCycles = depth + 1

    return Ok(lastResult)
  }

  /**
   * Estimate entropy of input
   * Override this for domain-specific entropy calculation
   */
  protected estimateEntropy(input: T): Entropy {
    // Default implementation - can be overridden
    if (input === null || input === undefined) {
      return 1.0  // Maximum entropy - undefined
    }

    if (typeof input === 'string') {
      // Simple heuristic: longer strings with more variation = higher entropy
      const uniqueChars = new Set(input).size
      const ratio = uniqueChars / Math.max(input.length, 1)
      return Math.min(ratio, 1.0)
    }

    if (typeof input === 'object') {
      // Objects: more keys = potentially higher entropy
      const keys = Object.keys(input as object)
      return Math.min(keys.length / 20, 1.0)
    }

    return 0.5  // Default middle entropy
  }

  /**
   * Get cycle history
   */
  getHistory(): URCOCycleResult<T>[] {
    return [...this.cycleHistory]
  }

  /**
   * Clear cycle history
   */
  clearHistory(): void {
    this.cycleHistory = []
  }

  /**
   * Format cycle result for display
   */
  formatResult(result: URCOCycleResult<T>): string {
    const identity = getIdentity()
    const urcoDefinition = getURCOCycle()

    const lines = [
      '═══════════════════════════════════════════════════════════════════════════',
      `URCO CYCLE COMPLETE - ${identity?.name || 'Motherlabs'}`,
      '═══════════════════════════════════════════════════════════════════════════',
      '',
      `Cycle ID: ${result.cycleId.slice(0, 16)}...`,
      `Depth: ${result.depth + 1} of ${this.maxDepth}`,
      `Duration: ${result.durationMs}ms`,
      '',
      'ENTROPY:',
      `  Initial:   ${(result.initialEntropy * 100).toFixed(1)}%`,
      `  Final:     ${(result.finalEntropy * 100).toFixed(1)}%`,
      `  Reduction: ${(result.entropyReduction * 100).toFixed(1)}%`,
      '',
      'PHASES:',
    ]

    const phases: URCOPhase[] = ['expand', 'examine', 'remove', 'synthesize']
    for (const phase of phases) {
      const phaseResult = result.phases[phase]
      const definition = urcoDefinition.find(p => p.phase === phase)
      lines.push(`  ${phase.toUpperCase()}: ${definition?.action || ''}`)
      lines.push(`    Entropy: ${(phaseResult.entropy * 100).toFixed(1)}%`)
      lines.push(`    Artifacts: ${phaseResult.artifacts.length}`)
    }

    lines.push('')
    lines.push('═══════════════════════════════════════════════════════════════════════════')

    return lines.join('\n')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT TEXT PROCESSOR - Simple implementation for text processing
// ═══════════════════════════════════════════════════════════════════════════

export const textPhaseProcessor: PhaseProcessor<string> = {
  async expand(input: string, context: Record<string, unknown>): Promise<PhaseResult<string>> {
    // Expand: Add context, reveal structure
    const expanded = input.trim()
    const words = expanded.split(/\s+/)
    const sentences = expanded.split(/[.!?]+/).filter(s => s.trim())

    return {
      output: expanded,
      entropy: Math.min(words.length / 100, 1.0),
      artifacts: [{
        phase: 'expand',
        observation: `Expanded to ${words.length} words, ${sentences.length} sentences`,
        entropy: Math.min(words.length / 100, 1.0),
        timestamp: globalTimeProvider.now()
      }],
      metadata: { words: words.length, sentences: sentences.length }
    }
  },

  async examine(input: string, context: Record<string, unknown>): Promise<PhaseResult<string>> {
    // Examine: Evaluate quality, check for issues
    const issues: string[] = []

    if (input.length < 10) issues.push('Too short')
    if (input.length > 10000) issues.push('Too long')
    if (/\?\?\?|TODO|FIXME/i.test(input)) issues.push('Contains uncertainty markers')

    const entropy = issues.length > 0 ? 0.7 : 0.4

    return {
      output: input,
      entropy,
      artifacts: [{
        phase: 'examine',
        observation: issues.length > 0 ? `Issues found: ${issues.join(', ')}` : 'No issues found',
        entropy,
        timestamp: globalTimeProvider.now()
      }],
      metadata: { issues }
    }
  },

  async remove(input: string, context: Record<string, unknown>): Promise<PhaseResult<string>> {
    // Remove: Strip unnecessary content
    let cleaned = input
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/^\s+|\s+$/g, '')      // Trim
      .replace(/\n{3,}/g, '\n\n')     // Max 2 newlines

    const removed = input.length - cleaned.length

    return {
      output: cleaned,
      entropy: 0.3,
      artifacts: [{
        phase: 'remove',
        observation: `Removed ${removed} characters of noise`,
        entropy: 0.3,
        timestamp: globalTimeProvider.now()
      }],
      metadata: { removed }
    }
  },

  async synthesize(input: string, context: Record<string, unknown>): Promise<PhaseResult<string>> {
    // Synthesize: Structure the final output
    const structured = input.trim()

    return {
      output: structured,
      entropy: 0.1,
      artifacts: [{
        phase: 'synthesize',
        observation: `Synthesized to ${structured.length} characters`,
        entropy: 0.1,
        timestamp: globalTimeProvider.now()
      }],
      metadata: { finalLength: structured.length }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a text URCO engine with default processor
 */
export function createTextURCO(options?: {
  maxDepth?: number
  entropyThreshold?: Entropy
}): URCOEngine<string> {
  return new URCOEngine(textPhaseProcessor, options)
}

/**
 * Create a custom URCO engine with provided processor
 */
export function createURCO<T>(
  processor: PhaseProcessor<T>,
  options?: {
    maxDepth?: number
    entropyThreshold?: Entropy
  }
): URCOEngine<T> {
  return new URCOEngine(processor, options)
}

// ═══════════════════════════════════════════════════════════════════════════
// QUICK PROCESS - One-shot URCO for simple cases
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quick URCO process for text
 */
export async function urcoText(
  input: string,
  context: Record<string, unknown> = {}
): Promise<Result<URCOCycleResult<string>, Error>> {
  const engine = createTextURCO()
  return engine.process({ subject: input, context })
}
