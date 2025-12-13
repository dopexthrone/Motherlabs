// URCO v0.2 - Synthesize (Real merging with loss accounting)

import { Candidate } from './types'

export type SynthesisResult = {
  representation: string
  keptCount: number
  removedCount: number
  lossEstimate: number
  mergeStrategy: string
}

/**
 * Synthesize kept candidates into final representation
 * with explicit loss accounting
 */
export function synthesize(
  kept: Candidate[],
  removed: Candidate[]
): SynthesisResult {
  if (kept.length === 0) {
    return {
      representation: 'SYNTHESIS_FAILED: no viable candidates',
      keptCount: 0,
      removedCount: removed.length,
      lossEstimate: 1.0,
      mergeStrategy: 'abort'
    }
  }

  if (kept.length === 1) {
    // Single candidate: adopt directly
    return {
      representation: kept[0].statement,
      keptCount: 1,
      removedCount: removed.length,
      lossEstimate: calculateLoss(kept, removed),
      mergeStrategy: 'single'
    }
  }

  // Multiple candidates: merge by type
  const andSplits = kept.filter(c => c.type === 'AND_SPLIT')
  const orSplits = kept.filter(c => c.type === 'OR_SPLIT')
  const seqSplits = kept.filter(c => c.type === 'SEQ_SPLIT')
  const clarifications = kept.filter(c => c.type === 'CLARIFICATION')

  let representation: string
  let strategy: string

  if (andSplits.length >= 2) {
    // AND-merge: combine as parallel components
    representation = andSplits.map((c, i) => `${i + 1}. ${c.statement}`).join('\n')
    strategy = 'and-merge'
  } else if (seqSplits.length >= 1) {
    // SEQ-merge: ordered steps
    representation = seqSplits[0].statement
    if (seqSplits.length > 1) {
      representation += '\n(Alternative sequence: ' + seqSplits.slice(1).map(c => c.statement).join('; ') + ')'
    }
    strategy = 'seq-merge'
  } else if (clarifications.length >= 1) {
    // Clarification-merge: list questions
    representation = 'Questions to resolve:\n' + clarifications.map((c, i) => `${i + 1}. ${c.statement}`).join('\n')
    strategy = 'clarification-merge'
  } else if (orSplits.length >= 2) {
    // OR-merge: alternative paths
    representation = 'Alternative approaches:\n' + orSplits.map((c, i) => `Option ${i + 1}: ${c.statement}`).join('\n')
    strategy = 'or-merge'
  } else {
    // Mixed or single non-AND: conservative conjunction
    representation = kept.map((c, i) => `${i + 1}. ${c.statement}`).join('\n')
    strategy = 'conservative-merge'
  }

  return {
    representation,
    keptCount: kept.length,
    removedCount: removed.length,
    lossEstimate: calculateLoss(kept, removed),
    mergeStrategy: strategy
  }
}

/**
 * Calculate information loss from removing candidates
 */
function calculateLoss(kept: Candidate[], removed: Candidate[]): number {
  if (removed.length === 0) return 0.0

  const total = kept.length + removed.length
  const removalRatio = removed.length / total

  // Base loss from removal ratio
  let loss = removalRatio * 0.5

  // Additional loss if removed candidates had unique information
  // (simplified: assume each removed candidate contributes some unique information)
  loss += removed.length * 0.05

  return Math.max(0, Math.min(1, loss))
}
