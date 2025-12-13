// URCO v0.2 - Examine (Real scoring, exact formula)

import { Candidate, ScoredCandidate, MissingVar, Contradiction } from './types'
import { tokenOverlap, normalize } from './extractor'
import { detectMissingVars } from './missingVars'
import { detectContradictions } from './contradictions'
import { extractActions, extractEntities } from './extractor'

/**
 * Scoring weights (sum to 1.00 as specified)
 */
const WEIGHTS = {
  executability: 0.28,
  coverage: 0.18,
  novelty: 0.12,
  coherence: 0.18,
  risk: 0.10,
  evidenceAlign: 0.14
}

/**
 * E(c): Executability score
 * 1.0 if actionable with concrete inputs/outputs
 * Penalize vague verbs without metrics
 */
function scoreExecutability(c: Candidate): number {
  let score = 1.0

  // Check for concrete inputs/outputs
  if (c.requiredInputs.length === 0) score -= 0.3
  if (c.expectedOutputs.length === 0) score -= 0.3

  // Penalize vague terms
  const vagueVerbs = ['handle', 'manage', 'improve', 'process', 'deal with']
  const hasVague = vagueVerbs.some(v => c.statement.toLowerCase().includes(v))
  if (hasVague) score -= 0.2

  // Check for missing variables
  const actions = extractActions(c.statement)
  const entities = extractEntities(c.statement)
  const missing = detectMissingVars(c.statement, {}, entities, actions)

  // Penalize missing critical vars
  const errorCount = missing.filter(m => m.severity === 'error').length
  score -= errorCount * 0.15

  return Math.max(0, Math.min(1, score))
}

/**
 * C(c): Coverage contribution
 * Estimates whether c addresses distinct aspect of parent
 */
function scoreCoverage(c: Candidate, existingCandidates: Candidate[]): number {
  // If it's a clarification for a missing variable, it has coverage value
  if (c.type === 'CLARIFICATION') {
    return 0.8
  }

  // Check novelty against existing
  if (existingCandidates.length === 0) return 1.0

  const overlaps = existingCandidates.map(existing =>
    tokenOverlap(c.statement, existing.statement)
  )

  const maxOverlap = Math.max(...overlaps)
  return Math.max(0.3, 1.0 - maxOverlap) // At least 0.3 coverage
}

/**
 * N(c): Novelty (non-redundancy)
 * 1.0 - max similarity with existing candidates
 */
function scoreNovelty(c: Candidate, existingCandidates: Candidate[]): number {
  if (existingCandidates.length === 0) return 1.0

  const similarities = existingCandidates.map(existing =>
    tokenOverlap(c.statement, existing.statement)
  )

  const maxSim = Math.max(...similarities)
  return 1.0 - maxSim
}

/**
 * K(c): Coherence/Consistency
 * Penalize contradictions with parent invariants
 */
function scoreCoherence(c: Candidate, parentInvariants: string[]): number {
  const contradictions = detectContradictions(c.statement)

  // Hard fail on high-confidence contradictions
  const highConfidence = contradictions.filter(con => con.confidence === 'high')
  if (highConfidence.length > 0) {
    return 0.0
  }

  let score = 1.0

  // Check against parent invariants
  for (const invariant of parentInvariants) {
    const overlap = tokenOverlap(c.statement, invariant)
    if (overlap > 0.5) {
      // Check for negation in candidate vs positive in invariant
      const invNorm = normalize(invariant)
      const candNorm = normalize(c.statement)

      if (invNorm.includes('must') && candNorm.includes('not')) {
        score -= 0.5  // Likely violation
      }
    }
  }

  // Medium confidence contradictions
  score -= contradictions.filter(c => c.confidence === 'medium').length * 0.2

  return Math.max(0, Math.min(1, score))
}

/**
 * R(c): Risk / Blast-radius
 * Lower is better for scope expansion, irreversible actions, unknown deps
 */
function scoreRisk(c: Candidate): number {
  let riskScore = 0.0  // 0 = low risk, 1 = high risk

  // Scope expansion indicators
  if (/\b(all|every|entire|global|system-wide)\b/i.test(c.statement)) {
    riskScore += 0.3
  }

  // Irreversible action indicators
  if (/\b(delete|remove|drop|destroy|overwrite)\b/i.test(c.statement)) {
    riskScore += 0.4
  }

  // Unknown dependencies
  if (/\b(unknown|unclear|tbd|todo|later)\b/i.test(c.statement)) {
    riskScore += 0.2
  }

  // External dependencies
  if (/\b(api|network|external|third-party|call)\b/i.test(c.statement)) {
    riskScore += 0.1
  }

  return Math.max(0, Math.min(1, riskScore))
}

/**
 * A(c): Evidence alignment
 * 1.0 if candidate includes evidence plan when making claims
 */
function scoreEvidenceAlignment(c: Candidate): number {
  // Check for claims in statement
  const claimPatterns = [
    /\b(will|must|shall|guarantee|ensure)\b/i,
    /\b(faster|slower|better|improve)\b/i,
    /\b(threshold|limit)\s*[:=]\s*\d+/i
  ]

  const hasClaim = claimPatterns.some(p => p.test(c.statement))

  if (!hasClaim) {
    return 1.0  // No claims = no evidence requirement
  }

  // Has claim - check for evidence plan
  if (c.evidencePlan) {
    return 1.0
  }

  // Check for inline verification mention
  if (/\b(test|verify|check|validate|prove)\b/i.test(c.statement)) {
    return 0.5  // Partial credit
  }

  return 0.0  // Claim without evidence
}

/**
 * Examine candidates: compute scores using exact formula
 * S(c) = wE·E + wC·C + wN·N + wK·K + wR·RP + wA·A
 */
export function examineCandidates(
  candidates: Candidate[],
  parentInvariants: string[] = []
): ScoredCandidate[] {
  return candidates.map((c, index) => {
    const existingCandidates = candidates.slice(0, index)

    const E = scoreExecutability(c)
    const C = scoreCoverage(c, existingCandidates)
    const N = scoreNovelty(c, existingCandidates)
    const K = scoreCoherence(c, parentInvariants)
    const R = scoreRisk(c)
    const RP = 1 - R  // Convert to penalty
    const A = scoreEvidenceAlignment(c)

    const score =
      WEIGHTS.executability * E +
      WEIGHTS.coverage * C +
      WEIGHTS.novelty * N +
      WEIGHTS.coherence * K +
      WEIGHTS.risk * RP +
      WEIGHTS.evidenceAlign * A

    return {
      candidate: c,
      score: Math.max(0, Math.min(1, score)),
      breakdown: {
        executability: E,
        coverage: C,
        novelty: N,
        coherence: K,
        riskPenalty: RP,
        evidenceAlign: A
      }
    }
  })
}
