// Proposal Admission Service - Gate-controlled ledger admission
//
// FLOW:
// 1. Validate proposal with validateProposalV0()
// 2. Record GATE_DECISION (ALLOW or DENY)
// 3. If ALLOW, admit proposal to ledger
//
// INVARIANTS:
// - No proposal admitted without prior GATE_DECISION
// - Validation failures produce DENY decision (recorded for audit)
// - All decisions are recorded to ledger before admission

import { Result, Ok, Err } from '../core/result'
import { contentAddress } from '../core/contentAddress'
import {
  createGateDecision,
  logGateDecision,
  type GateDecision,
} from '../core/gateDecision'
import {
  validateProposalV0,
  type ProposalV0,
  type ValidationError,
} from '../validation/proposalV0Validator'
import type { JSONLLedger, JSONLRecord } from '../persistence/jsonlLedger'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of proposal admission attempt
 */
export type AdmissionResult = {
  /** Whether the proposal was admitted */
  admitted: boolean
  /** The validated proposal (if validation passed) */
  proposal?: ProposalV0
  /** The gate decision that was recorded */
  gateDecision: GateDecision
  /** The ledger record for the gate decision */
  gateDecisionRecord: JSONLRecord
  /** The ledger record for the proposal (if admitted) */
  proposalRecord?: JSONLRecord
  /** Validation errors (if validation failed) */
  validationErrors?: ValidationError[]
}

/**
 * Admission service configuration
 */
export type AdmissionServiceConfig = {
  /** Authorizer identifier for gate decisions */
  authorizer: string
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMISSION SERVICE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Proposal Admission Service
 *
 * Provides gate-controlled admission of proposals to the ledger.
 * All admission attempts (success or failure) are recorded as gate decisions.
 */
export class ProposalAdmissionService {
  private ledger: JSONLLedger
  private config: AdmissionServiceConfig

  constructor(ledger: JSONLLedger, config: AdmissionServiceConfig) {
    this.ledger = ledger
    this.config = config
  }

  /**
   * Attempt to admit a proposal to the ledger
   *
   * FLOW:
   * 1. Validate the input against ProposalV0 schema
   * 2. Record GATE_DECISION (ALLOW if valid, DENY if invalid)
   * 3. If ALLOW, admit the proposal to ledger
   *
   * INVARIANT: Gate decision is ALWAYS recorded, even on validation failure
   */
  async admitProposal(input: unknown): Promise<Result<AdmissionResult, Error>> {
    // Step 1: Validate
    const validationResult = validateProposalV0(input)

    if (!validationResult.ok) {
      // Validation failed - record DENY decision
      return this.recordDenyAndReturn(input, validationResult.error)
    }

    const proposal = validationResult.value

    // Step 2: Record ALLOW gate decision
    const proposalId = contentAddress(proposal)

    const gateDecision = createGateDecision(
      'proposal_admission',
      'ALLOW',
      {
        target_type: 'proposal',
        target_id: proposalId,
        granted_effects: ['LEDGER_APPEND'],
      },
      this.config.authorizer,
      `Proposal ${proposal.proposal_id} passed schema validation`,
      {
        proposal_id: proposal.proposal_id,
        requested_action: proposal.requested_action,
        target_count: proposal.targets.length,
      }
    )

    const gateRecordResult = await this.ledger.appendGateDecision(gateDecision)
    if (!gateRecordResult.ok) {
      return Err(new Error(`Failed to record gate decision: ${gateRecordResult.error.message}`))
    }

    // Step 3: Admit proposal to ledger
    const proposalRecordResult = await this.ledger.append('PROPOSAL_V0', {
      ...proposal,
      admission_gate_decision_id: contentAddress(gateDecision),
    })

    if (!proposalRecordResult.ok) {
      return Err(new Error(`Failed to admit proposal: ${proposalRecordResult.error.message}`))
    }

    return Ok({
      admitted: true,
      proposal,
      gateDecision,
      gateDecisionRecord: gateRecordResult.value,
      proposalRecord: proposalRecordResult.value,
    })
  }

  /**
   * Record a DENY decision and return the result
   */
  private async recordDenyAndReturn(
    input: unknown,
    errors: ValidationError[]
  ): Promise<Result<AdmissionResult, Error>> {
    const inputId = contentAddress(input)
    const errorSummary = errors.map(e => e.code).join(', ')

    const gateDecision = createGateDecision(
      'proposal_admission',
      'DENY',
      {
        target_type: 'proposal',
        target_id: inputId,
      },
      this.config.authorizer,
      `Proposal validation failed: ${errorSummary}`,
      {
        error_count: errors.length,
        error_codes: errors.map(e => e.code),
      }
    )

    const gateRecordResult = await this.ledger.appendGateDecision(gateDecision)
    if (!gateRecordResult.ok) {
      return Err(new Error(`Failed to record gate decision: ${gateRecordResult.error.message}`))
    }

    return Ok({
      admitted: false,
      gateDecision,
      gateDecisionRecord: gateRecordResult.value,
      validationErrors: errors,
    })
  }

  /**
   * Admit a pre-validated proposal (skip validation)
   *
   * USE ONLY when proposal has already been validated externally.
   * Records ALLOW gate decision and admits to ledger.
   */
  async admitValidatedProposal(proposal: ProposalV0): Promise<Result<AdmissionResult, Error>> {
    const proposalId = contentAddress(proposal)

    const gateDecision = createGateDecision(
      'proposal_admission',
      'ALLOW',
      {
        target_type: 'proposal',
        target_id: proposalId,
        granted_effects: ['LEDGER_APPEND'],
      },
      this.config.authorizer,
      `Pre-validated proposal ${proposal.proposal_id} admitted`,
      {
        proposal_id: proposal.proposal_id,
        requested_action: proposal.requested_action,
        target_count: proposal.targets.length,
      }
    )

    const gateRecordResult = await this.ledger.appendGateDecision(gateDecision)
    if (!gateRecordResult.ok) {
      return Err(new Error(`Failed to record gate decision: ${gateRecordResult.error.message}`))
    }

    const proposalRecordResult = await this.ledger.append('PROPOSAL_V0', {
      ...proposal,
      admission_gate_decision_id: contentAddress(gateDecision),
    })

    if (!proposalRecordResult.ok) {
      return Err(new Error(`Failed to admit proposal: ${proposalRecordResult.error.message}`))
    }

    return Ok({
      admitted: true,
      proposal,
      gateDecision,
      gateDecisionRecord: gateRecordResult.value,
      proposalRecord: proposalRecordResult.value,
    })
  }
}

/**
 * Create a proposal admission service
 */
export function createAdmissionService(
  ledger: JSONLLedger,
  authorizer: string = 'proposal_admission_service'
): ProposalAdmissionService {
  return new ProposalAdmissionService(ledger, { authorizer })
}
