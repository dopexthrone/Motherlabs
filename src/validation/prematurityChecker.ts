// Prematurity Checker - Refuse decisions that can be safely deferred
// CONSTITUTIONAL AUTHORITY - See docs/DECISION_PHILOSOPHY.md
// Enforces: AXIOM 5 (Refusal Is First-Class)
// TCB Component: Part of the 6-Gate Validation System
//
// From DECISION_PHILOSOPHY.md:
// "Premature decisions look necessary but are not.
//  Usually driven by anxiety or imagined futures.
//  Cannot be justified with current evidence."

import { Result, Ok, Err } from '../core/result'
import { isTCBPath, getTCBClassification } from '../core/decisionClassifier'
import { hasAdequateAlternatives } from '../core/proposal'
import type { ImprovementProposal } from '../selfbuild/proposer'
import type { ProposalWithAlternatives } from '../core/proposal'

/**
 * Prematurity check result
 */
export type PrematurityCheck = {
  premature: boolean
  confidence: 'high' | 'medium' | 'low'
  reason?: string
  deferralRecommendation?: string
  signals: PrematuritySignal[]
}

/**
 * Individual prematurity signal
 */
export type PrematuritySignal = {
  signal: string
  weight: number  // 0-10, higher = more premature
  category: 'blocking' | 'alternatives' | 'assumptions' | 'justification' | 'timing'
}

/**
 * Thresholds for prematurity determination
 */
const PREMATURITY_THRESHOLDS = {
  HIGH_CONFIDENCE: 25,    // Score >= 25 = definitely premature
  MEDIUM_CONFIDENCE: 15,  // Score >= 15 = probably premature
  LOW_CONFIDENCE: 8       // Score >= 8 = possibly premature
}

/**
 * Check if a proposal is premature
 * This implements ROADMAP Step 5
 */
export function checkPrematurity(
  proposal: ImprovementProposal,
  alternativeAnalysis?: ProposalWithAlternatives
): Result<PrematurityCheck, Error> {
  try {
    const signals: PrematuritySignal[] = []

    // 1. Check blocking dependencies
    const blockingSignals = checkBlockingDependencies(proposal)
    signals.push(...blockingSignals)

    // 2. Check alternative validity
    const alternativeSignals = checkAlternatives(proposal, alternativeAnalysis)
    signals.push(...alternativeSignals)

    // 3. Check assumption verification
    const assumptionSignals = checkAssumptions(proposal)
    signals.push(...assumptionSignals)

    // 4. Check justification strength
    const justificationSignals = checkJustification(proposal)
    signals.push(...justificationSignals)

    // 5. Check timing appropriateness
    const timingSignals = checkTiming(proposal)
    signals.push(...timingSignals)

    // 6. Calculate total score
    const totalScore = signals.reduce((sum, s) => sum + s.weight, 0)

    // 7. Determine prematurity
    let premature = false
    let confidence: 'high' | 'medium' | 'low' = 'low'

    if (totalScore >= PREMATURITY_THRESHOLDS.HIGH_CONFIDENCE) {
      premature = true
      confidence = 'high'
    } else if (totalScore >= PREMATURITY_THRESHOLDS.MEDIUM_CONFIDENCE) {
      premature = true
      confidence = 'medium'
    } else if (totalScore >= PREMATURITY_THRESHOLDS.LOW_CONFIDENCE) {
      premature = true
      confidence = 'low'
    }

    // 8. Generate reason and recommendation
    const reason = premature ? generatePrematurityReason(signals, confidence) : undefined
    const deferralRecommendation = premature ? generateDeferralRecommendation(proposal, signals) : undefined

    return Ok({
      premature,
      confidence,
      reason,
      deferralRecommendation,
      signals
    })

  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Check if there are blocking dependencies that require this now
 */
function checkBlockingDependencies(proposal: ImprovementProposal): PrematuritySignal[] {
  const signals: PrematuritySignal[] = []

  // Critical severity is never premature - it's blocking by definition
  if (proposal.issue.severity === 'critical') {
    signals.push({
      signal: 'Critical severity indicates blocking issue',
      weight: -10, // Negative weight = NOT premature
      category: 'blocking'
    })
    return signals
  }

  // High severity with security implications is blocking
  if (proposal.issue.severity === 'high' &&
      (proposal.issue.message.toLowerCase().includes('security') ||
       proposal.issue.message.toLowerCase().includes('vulnerability'))) {
    signals.push({
      signal: 'High severity security issue is blocking',
      weight: -8,
      category: 'blocking'
    })
    return signals
  }

  // Low severity suggests no blocking dependency
  if (proposal.issue.severity === 'low') {
    signals.push({
      signal: 'Low severity suggests no immediate blocking need',
      weight: 5,
      category: 'blocking'
    })
  }

  // Medium severity is ambiguous
  if (proposal.issue.severity === 'medium') {
    signals.push({
      signal: 'Medium severity - blocking status unclear',
      weight: 2,
      category: 'blocking'
    })
  }

  // Non-TCB changes are less likely to be blocking
  if (!isTCBPath(proposal.targetFile)) {
    signals.push({
      signal: 'Non-TCB path - unlikely to block other work',
      weight: 3,
      category: 'blocking'
    })
  }

  // Test file changes are almost never blocking
  if (proposal.targetFile.match(/\.(test|spec)\.ts$/)) {
    signals.push({
      signal: 'Test file changes are rarely blocking',
      weight: 4,
      category: 'blocking'
    })
  }

  return signals
}

/**
 * Check if multiple valid alternatives exist (sign of prematurity)
 */
function checkAlternatives(
  proposal: ImprovementProposal,
  alternativeAnalysis?: ProposalWithAlternatives
): PrematuritySignal[] {
  const signals: PrematuritySignal[] = []

  if (!alternativeAnalysis) {
    // No alternative analysis means we can't properly evaluate
    signals.push({
      signal: 'No alternative analysis available',
      weight: 3,
      category: 'alternatives'
    })
    return signals
  }

  const altCount = alternativeAnalysis.alternatives.length

  // Many valid alternatives suggests we haven't narrowed down
  if (altCount >= 4) {
    signals.push({
      signal: `${altCount} alternatives exist - decision space not narrowed`,
      weight: 6,
      category: 'alternatives'
    })
  } else if (altCount >= 3) {
    signals.push({
      signal: `${altCount} alternatives suggest room for more analysis`,
      weight: 3,
      category: 'alternatives'
    })
  }

  // Check if alternatives have similar consequence surfaces (no clear winner)
  const deferAlt = alternativeAnalysis.alternatives.find(a => a.description === 'Defer action')
  if (deferAlt) {
    // If defer has few cons, deferral is viable
    if (deferAlt.tradeoffs.cons.length <= 2) {
      signals.push({
        signal: 'Deferral has few downsides - can safely defer',
        weight: 5,
        category: 'alternatives'
      })
    }
  }

  // Check if chosen approach has weak rejection reasons for alternatives
  const weakRejections = alternativeAnalysis.alternatives.filter(
    a => a.rejectionReason.includes('fits the specific context') ||
         a.rejectionReason.length < 30
  )
  if (weakRejections.length > altCount / 2) {
    signals.push({
      signal: 'Weak rejection reasons for alternatives',
      weight: 4,
      category: 'alternatives'
    })
  }

  return signals
}

/**
 * Check if assumptions are verified
 */
function checkAssumptions(proposal: ImprovementProposal): PrematuritySignal[] {
  const signals: PrematuritySignal[] = []

  const code = proposal.proposedChange.code

  // Check for TODO/FIXME indicating incomplete understanding
  if (/\/\/\s*(TODO|FIXME|XXX|HACK)/i.test(code)) {
    signals.push({
      signal: 'Code contains TODO/FIXME - assumptions unverified',
      weight: 6,
      category: 'assumptions'
    })
  }

  // Check for placeholder comments
  if (/\/\/\s*(placeholder|temporary|stub)/i.test(code)) {
    signals.push({
      signal: 'Code contains placeholder - implementation incomplete',
      weight: 7,
      category: 'assumptions'
    })
  }

  // Check for "may" or "might" in rationale (uncertain assumptions)
  if (/\b(may|might|could|possibly|perhaps)\b/i.test(proposal.rationale)) {
    signals.push({
      signal: 'Rationale uses uncertain language',
      weight: 4,
      category: 'assumptions'
    })
  }

  // Check for magic numbers or hardcoded values
  if (/(?<![a-zA-Z_])\b\d{3,}\b(?![a-zA-Z_])/.test(code) &&
      !/(?:timeout|limit|max|min|size|length|port|year|month|day)/.test(code.toLowerCase())) {
    signals.push({
      signal: 'Unexplained magic numbers in code',
      weight: 3,
      category: 'assumptions'
    })
  }

  // No gate validation is a strong signal
  if (!proposal.gateValidation?.valid) {
    signals.push({
      signal: 'Proposal has not passed gate validation',
      weight: 5,
      category: 'assumptions'
    })
  }

  return signals
}

/**
 * Check justification strength
 */
function checkJustification(proposal: ImprovementProposal): PrematuritySignal[] {
  const signals: PrematuritySignal[] = []

  // Short rationale is weak justification
  if (proposal.rationale.length < 30) {
    signals.push({
      signal: 'Very short rationale - weak justification',
      weight: 5,
      category: 'justification'
    })
  } else if (proposal.rationale.length < 60) {
    signals.push({
      signal: 'Brief rationale - justification may be thin',
      weight: 2,
      category: 'justification'
    })
  }

  // Check consequence analysis for irreversible decisions
  if (proposal.classification?.type === 'irreversible' && !proposal.consequenceAnalysis) {
    signals.push({
      signal: 'Irreversible decision without consequence analysis',
      weight: 8,
      category: 'justification'
    })
  }

  // High risk without high severity is questionable
  if (proposal.consequenceAnalysis?.riskLevel === 'high' &&
      proposal.issue.severity !== 'high' &&
      proposal.issue.severity !== 'critical') {
    signals.push({
      signal: 'High risk change for non-high severity issue',
      weight: 6,
      category: 'justification'
    })
  }

  // Critical risk without critical severity is very questionable
  if (proposal.consequenceAnalysis?.riskLevel === 'critical' &&
      proposal.issue.severity !== 'critical') {
    signals.push({
      signal: 'Critical risk change for non-critical issue',
      weight: 8,
      category: 'justification'
    })
  }

  // Check for evidence of analysis
  if (!proposal.rationale.match(/because|since|due to|as a result|improves|fixes|resolves/i)) {
    signals.push({
      signal: 'Rationale lacks causal reasoning',
      weight: 3,
      category: 'justification'
    })
  }

  return signals
}

/**
 * Check timing appropriateness
 */
function checkTiming(proposal: ImprovementProposal): PrematuritySignal[] {
  const signals: PrematuritySignal[] = []

  // add_function is generally safe to do anytime
  if (proposal.proposedChange.type === 'add_function') {
    signals.push({
      signal: 'Add function is generally timing-safe',
      weight: -2,
      category: 'timing'
    })
  }

  // add_test is almost always appropriate
  if (proposal.proposedChange.type === 'add_test') {
    signals.push({
      signal: 'Adding tests is rarely premature',
      weight: -4,
      category: 'timing'
    })
  }

  // Refactoring TCB during freeze periods is premature
  const tcbClass = getTCBClassification(proposal.targetFile)
  if (proposal.proposedChange.type === 'refactor' && tcbClass === 'authority') {
    signals.push({
      signal: 'TCB authority refactoring requires careful timing',
      weight: 4,
      category: 'timing'
    })
  }

  // Constitutional changes should be rare
  if (tcbClass === 'constitutional') {
    signals.push({
      signal: 'Constitutional changes require exceptional justification',
      weight: 6,
      category: 'timing'
    })
  }

  // Large code changes suggest more planning needed
  const lineCount = proposal.proposedChange.code.split('\n').length
  if (lineCount > 100) {
    signals.push({
      signal: 'Large change may need incremental approach',
      weight: 4,
      category: 'timing'
    })
  }

  return signals
}

/**
 * Generate human-readable prematurity reason
 */
function generatePrematurityReason(
  signals: PrematuritySignal[],
  confidence: 'high' | 'medium' | 'low'
): string {
  const prematureSignals = signals.filter(s => s.weight > 0)
  const topSignals = prematureSignals
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)

  const reasons = topSignals.map(s => s.signal)

  const prefix = confidence === 'high'
    ? 'Decision is clearly premature'
    : confidence === 'medium'
    ? 'Decision appears premature'
    : 'Decision may be premature'

  return `${prefix}: ${reasons.join('; ')}`
}

/**
 * Generate deferral recommendation
 */
function generateDeferralRecommendation(
  proposal: ImprovementProposal,
  signals: PrematuritySignal[]
): string {
  const recommendations: string[] = []

  // Category-specific recommendations
  const categories = new Set(signals.filter(s => s.weight > 3).map(s => s.category))

  if (categories.has('blocking')) {
    recommendations.push('Confirm this is actually blocking other work')
  }

  if (categories.has('alternatives')) {
    recommendations.push('Analyze alternatives more thoroughly before deciding')
  }

  if (categories.has('assumptions')) {
    recommendations.push('Verify assumptions with evidence before proceeding')
  }

  if (categories.has('justification')) {
    recommendations.push('Strengthen justification with concrete reasoning')
  }

  if (categories.has('timing')) {
    recommendations.push('Consider if a better time exists for this change')
  }

  // Severity-specific recommendations
  if (proposal.issue.severity === 'low') {
    recommendations.push('Low severity issues can often wait for more context')
  }

  // Default if no specific recommendations
  if (recommendations.length === 0) {
    recommendations.push('Gather more evidence before committing to this change')
  }

  return recommendations.join('. ') + '.'
}

/**
 * Format prematurity check for human review
 */
export function formatPrematurityCheck(check: PrematurityCheck): string {
  const lines: string[] = []

  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('PREMATURITY ANALYSIS')
  lines.push('═══════════════════════════════════════════════════════════')
  lines.push('')
  lines.push(`Status: ${check.premature ? 'PREMATURE' : 'NOT PREMATURE'}`)
  lines.push(`Confidence: ${check.confidence}`)
  lines.push('')

  if (check.premature) {
    lines.push('REASON:')
    lines.push(`  ${check.reason}`)
    lines.push('')
    lines.push('RECOMMENDATION:')
    lines.push(`  ${check.deferralRecommendation}`)
    lines.push('')
  }

  lines.push('SIGNALS:')
  const sortedSignals = [...check.signals].sort((a, b) => b.weight - a.weight)
  for (const signal of sortedSignals) {
    const indicator = signal.weight > 0 ? '⚠' : signal.weight < 0 ? '✓' : '○'
    lines.push(`  ${indicator} [${signal.category}] ${signal.signal} (${signal.weight > 0 ? '+' : ''}${signal.weight})`)
  }

  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════')

  return lines.join('\n')
}
