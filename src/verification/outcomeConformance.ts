// Outcome Conformance - Validate proposal outcomes have required evidence
// Ported from manual kernel verifier governance patterns

import { EvidenceArtifact, EvidenceKind } from '../persistence/evidenceArtifact'

/**
 * Terminal status of a proposal
 */
export type TerminalStatus =
  | 'COMPLETED'     // All gates passed, code applied
  | 'FAILED'        // Gate failed or tests failed
  | 'REJECTED'      // Pre-validation rejection
  | 'ROLLED_BACK'   // Applied but rolled back

/**
 * Proposal outcome for conformance checking
 */
export type ProposalOutcome = {
  proposal_id: string
  status: TerminalStatus
  evidence_ids: string[]
  applied_at?: string
  failed_at?: string
  rolled_back_at?: string
}

/**
 * Required evidence by terminal status
 */
export const REQUIRED_EVIDENCE_BY_STATUS: Record<TerminalStatus, EvidenceKind[]> = {
  COMPLETED: ['gate_result', 'file_manifest', 'exit_code'],
  FAILED: ['gate_result'],
  REJECTED: [],
  ROLLED_BACK: ['gate_result', 'file_manifest', 'code_diff']
}

/**
 * Optional/recommended evidence by status
 */
export const RECOMMENDED_EVIDENCE_BY_STATUS: Record<TerminalStatus, EvidenceKind[]> = {
  COMPLETED: ['test_result', 'stdout_log'],
  FAILED: ['stderr_log', 'exit_code'],
  REJECTED: ['gate_result'],
  ROLLED_BACK: ['stderr_log', 'test_result']
}

/**
 * Outcome conformance validation result
 */
export type ConformanceResult = {
  ok: boolean
  missing_required: EvidenceKind[]
  missing_recommended: EvidenceKind[]
  extra_evidence: EvidenceKind[]
  details?: string
}

/**
 * Validate outcome has required evidence
 */
export function validateOutcomeConformance(
  outcome: ProposalOutcome,
  evidenceArtifacts: Map<string, EvidenceArtifact>
): ConformanceResult {
  const required = REQUIRED_EVIDENCE_BY_STATUS[outcome.status]
  const recommended = RECOMMENDED_EVIDENCE_BY_STATUS[outcome.status]

  // Collect evidence kinds present
  const presentKinds = new Set<EvidenceKind>()
  for (const evidenceId of outcome.evidence_ids) {
    const artifact = evidenceArtifacts.get(evidenceId)
    if (artifact) {
      presentKinds.add(artifact.evidence_kind)
    }
  }

  // Check for missing required evidence
  const missingRequired: EvidenceKind[] = []
  for (const kind of required) {
    if (!presentKinds.has(kind)) {
      missingRequired.push(kind)
    }
  }

  // Check for missing recommended evidence
  const missingRecommended: EvidenceKind[] = []
  for (const kind of recommended) {
    if (!presentKinds.has(kind)) {
      missingRecommended.push(kind)
    }
  }

  // Find extra evidence (not required or recommended)
  const expectedKinds = new Set([...required, ...recommended])
  const extraEvidence: EvidenceKind[] = []
  for (const kind of presentKinds) {
    if (!expectedKinds.has(kind)) {
      extraEvidence.push(kind)
    }
  }

  const ok = missingRequired.length === 0

  return {
    ok,
    missing_required: missingRequired,
    missing_recommended: missingRecommended,
    extra_evidence: extraEvidence,
    details: ok
      ? undefined
      : `Missing required evidence: ${missingRequired.join(', ')}`
  }
}

/**
 * Create outcome from proposal state
 */
export function createProposalOutcome(
  proposalId: string,
  status: TerminalStatus,
  evidenceIds: string[]
): ProposalOutcome {
  const now = new Date().toISOString()

  const outcome: ProposalOutcome = {
    proposal_id: proposalId,
    status,
    evidence_ids: evidenceIds
  }

  switch (status) {
    case 'COMPLETED':
      outcome.applied_at = now
      break
    case 'FAILED':
    case 'REJECTED':
      outcome.failed_at = now
      break
    case 'ROLLED_BACK':
      outcome.rolled_back_at = now
      break
  }

  return outcome
}

/**
 * Format conformance result for display
 */
export function formatConformanceResult(result: ConformanceResult): string {
  const lines: string[] = []

  lines.push(result.ok ? '✓ Outcome conformance PASSED' : '✗ Outcome conformance FAILED')

  if (result.missing_required.length > 0) {
    lines.push(`  Missing required: ${result.missing_required.join(', ')}`)
  }

  if (result.missing_recommended.length > 0) {
    lines.push(`  Missing recommended: ${result.missing_recommended.join(', ')}`)
  }

  if (result.extra_evidence.length > 0) {
    lines.push(`  Extra evidence: ${result.extra_evidence.join(', ')}`)
  }

  return lines.join('\n')
}

/**
 * Check if status is terminal (no further transitions allowed)
 */
export function isTerminalStatus(status: TerminalStatus): boolean {
  return ['COMPLETED', 'FAILED', 'REJECTED', 'ROLLED_BACK'].includes(status)
}

/**
 * Valid status transitions
 */
export const STATUS_TRANSITIONS: Record<string, TerminalStatus[]> = {
  'pending': ['COMPLETED', 'FAILED', 'REJECTED'],
  'in_progress': ['COMPLETED', 'FAILED', 'ROLLED_BACK'],
  'applying': ['COMPLETED', 'ROLLED_BACK'],
  'COMPLETED': [],  // Terminal
  'FAILED': [],     // Terminal
  'REJECTED': [],   // Terminal
  'ROLLED_BACK': [] // Terminal
}

/**
 * Check if status transition is valid
 */
export function isValidTransition(from: string, to: TerminalStatus): boolean {
  const allowed = STATUS_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}
