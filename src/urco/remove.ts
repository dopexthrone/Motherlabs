// URCO v0.2 - Remove (Real pruning logic, exact thresholds)

import { ScoredCandidate, Candidate } from './types'

const KEEP_THRESHOLD = 0.70  // As specified
const MAX_KEEP = 5  // As specified

/**
 * Remove low-scoring candidates using exact thresholds
 * - Keep if S(c) >= 0.70
 * - Always keep at least 2 candidates (best two)
 * - Never keep more than 5
 */
export function removeLowScoring(scored: ScoredCandidate[]): {
  kept: Candidate[]
  removed: Candidate[]
  reason: string
} {
  // Sort by score descending, with deterministic tie-breaking
  const sorted = [...scored].sort((a, b) => {
    // Primary: score
    if (b.score !== a.score) return b.score - a.score

    // Tie-break 1: coherence
    if (b.breakdown.coherence !== a.breakdown.coherence) {
      return b.breakdown.coherence - a.breakdown.coherence
    }

    // Tie-break 2: executability
    if (b.breakdown.executability !== a.breakdown.executability) {
      return b.breakdown.executability - a.breakdown.executability
    }

    // Tie-break 3: evidence alignment
    if (b.breakdown.evidenceAlign !== a.breakdown.evidenceAlign) {
      return b.breakdown.evidenceAlign - a.breakdown.evidenceAlign
    }

    // Tie-break 4: novelty
    if (b.breakdown.novelty !== a.breakdown.novelty) {
      return b.breakdown.novelty - a.breakdown.novelty
    }

    // Tie-break 5: lexical order on ID (deterministic)
    return a.candidate.id.localeCompare(b.candidate.id)
  })

  // Apply threshold
  const passingThreshold = sorted.filter(s => s.score >= KEEP_THRESHOLD)

  let kept: ScoredCandidate[]

  if (passingThreshold.length >= 2) {
    // Keep top K candidates that pass threshold
    kept = passingThreshold.slice(0, MAX_KEEP)
  } else {
    // Always keep at least 2 (unless hard-fail conditions)
    kept = sorted.slice(0, Math.min(2, sorted.length))
  }

  const keptCandidates = kept.map(s => s.candidate)
  const removedCandidates = scored
    .filter(s => !kept.includes(s))
    .map(s => s.candidate)

  const reason = `Kept ${keptCandidates.length}/${scored.length} candidates (threshold: ${KEEP_THRESHOLD}, max: ${MAX_KEEP})`

  return {
    kept: keptCandidates,
    removed: removedCandidates,
    reason
  }
}
