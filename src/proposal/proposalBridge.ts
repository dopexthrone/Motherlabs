// Proposal Bridge - Connects ImprovementProposal to ProposalV0 admission system
//
// PURPOSE:
// The dogfooding loop generates ImprovementProposals (internal format).
// The governance system requires ProposalV0 (canonical format).
// This bridge converts and admits proposals through proper channels.
//
// FLOW:
// ImprovementProposal → ProposalV0 → AdmissionService → Ledger
//
// INVARIANTS:
// - All dogfood improvements go through proposal admission
// - Gate decisions are recorded for every attempt
// - Admitted proposals are trackable via proposal_id

import { Result, Ok, Err } from '../core/result'
import { contentAddress } from '../core/contentAddress'
import { globalTimeProvider } from '../core/ids'
import type { ImprovementProposal } from '../selfbuild/proposer'
import type { ProposalV0, RequestedAction, TargetKind } from '../validation/proposalV0Validator'
import {
  ProposalAdmissionService,
  createAdmissionService,
  type AdmissionResult,
} from './admissionService'
import type { JSONLLedger } from '../persistence/jsonlLedger'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of bridging an ImprovementProposal to the governance system
 */
export type BridgeResult = {
  /** The original improvement proposal */
  improvementProposal: ImprovementProposal
  /** The converted ProposalV0 */
  proposalV0: ProposalV0
  /** The admission result from the governance system */
  admissionResult: AdmissionResult
  /** The generated proposal_id for tracking */
  proposalId: string
}

/**
 * Bridge configuration
 */
export type BridgeConfig = {
  /** Source identifier for provenance */
  source: 'cli' | 'api' | 'automated'
  /** Authorizer identifier */
  authorizer: string
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map ImprovementProposal change type to ProposalV0 requested_action
 */
function mapChangeTypeToAction(changeType: ImprovementProposal['proposedChange']['type']): RequestedAction {
  switch (changeType) {
    case 'add_function':
    case 'add_test':
      return 'create'
    case 'modify_function':
    case 'refactor':
      return 'update'
    default:
      return 'update'
  }
}

/**
 * Convert ImprovementProposal to ProposalV0 format
 *
 * DETERMINISTIC: Same input produces same output (except timestamp)
 */
export function convertToProposalV0(
  improvement: ImprovementProposal,
  source: 'cli' | 'api' | 'automated' = 'automated'
): ProposalV0 {
  // Generate stable proposal_id from content
  const proposalId = `prop_dogfood_${improvement.id}`

  return {
    version: 'v0',
    proposal_id: proposalId,
    intent: improvement.rationale,
    requested_action: mapChangeTypeToAction(improvement.proposedChange.type),
    targets: [
      {
        kind: 'file' as TargetKind,
        identifier: improvement.targetFile,
      }
    ],
    constraints: {
      change_type: improvement.proposedChange.type,
      issue_type: improvement.issue.type,
      issue_severity: improvement.issue.severity,
      code_length: improvement.proposedChange.code.length,
    },
    evidence_plan: {
      required_gates: improvement.gateRequirements?.gates || ['schema', 'syntax', 'types', 'exports', 'tests', 'entropy'],
      human_approval_required: improvement.gateRequirements?.humanApprovalRequired || false,
      gate_validation_status: improvement.gateValidation?.valid ? 'passed' : 'pending',
    },
    provenance: {
      source,
      timestamp_utc: new Date(improvement.timestamp).toISOString(),
    },
    metadata: {
      original_improvement_id: improvement.id,
      source_type: improvement.source,
      classification: improvement.classification,
      consequence_analysis: improvement.consequenceAnalysis ? {
        risk_level: improvement.consequenceAnalysis.riskLevel,
        can_revert: improvement.consequenceAnalysis.reversibilityAssessment?.canRevert,
        enables_count: improvement.consequenceAnalysis.surface?.enables?.length || 0,
        forbids_count: improvement.consequenceAnalysis.surface?.forbids?.length || 0,
      } : undefined,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROPOSAL BRIDGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Proposal Bridge
 *
 * Connects the dogfooding loop's ImprovementProposal system
 * to the governance system's ProposalV0 admission flow.
 */
export class ProposalBridge {
  private admissionService: ProposalAdmissionService
  private config: BridgeConfig

  constructor(ledger: JSONLLedger, config: BridgeConfig) {
    this.admissionService = createAdmissionService(ledger, config.authorizer)
    this.config = config
  }

  /**
   * Bridge an ImprovementProposal to the governance system
   *
   * FLOW:
   * 1. Convert ImprovementProposal → ProposalV0
   * 2. Submit to admission service
   * 3. Record gate decision (ALLOW or DENY)
   * 4. If ALLOW, proposal is admitted to ledger
   *
   * @returns BridgeResult with admission status
   */
  async bridge(improvement: ImprovementProposal): Promise<Result<BridgeResult, Error>> {
    // Step 1: Convert to ProposalV0
    const proposalV0 = convertToProposalV0(improvement, this.config.source)

    // Step 2: Submit to admission service
    const admissionResult = await this.admissionService.admitProposal(proposalV0)

    if (!admissionResult.ok) {
      return Err(new Error(`Admission failed: ${admissionResult.error.message}`))
    }

    // Step 3: Return bridge result
    return Ok({
      improvementProposal: improvement,
      proposalV0: admissionResult.value.proposal || proposalV0,
      admissionResult: admissionResult.value,
      proposalId: proposalV0.proposal_id,
    })
  }

  /**
   * Bridge a pre-validated ImprovementProposal
   *
   * Use this when the ImprovementProposal has already passed gate validation.
   * Skips ProposalV0 schema validation (already done in proposer).
   */
  async bridgeValidated(improvement: ImprovementProposal): Promise<Result<BridgeResult, Error>> {
    // Verify gate validation passed
    if (!improvement.gateValidation?.valid) {
      return Err(new Error('Cannot bridge unvalidated proposal - gate validation required'))
    }

    // Convert to ProposalV0
    const proposalV0 = convertToProposalV0(improvement, this.config.source)

    // Use admitValidatedProposal to skip re-validation
    const admissionResult = await this.admissionService.admitValidatedProposal(proposalV0)

    if (!admissionResult.ok) {
      return Err(new Error(`Admission failed: ${admissionResult.error.message}`))
    }

    return Ok({
      improvementProposal: improvement,
      proposalV0,
      admissionResult: admissionResult.value,
      proposalId: proposalV0.proposal_id,
    })
  }

  /**
   * Check if an improvement would be admitted (dry run)
   *
   * Validates without actually admitting to ledger.
   */
  validateOnly(improvement: ImprovementProposal): Result<ProposalV0, Error> {
    const proposalV0 = convertToProposalV0(improvement, this.config.source)

    // Import validator directly to avoid circular dependency
    const { validateProposalV0 } = require('../validation/proposalV0Validator')
    const validationResult = validateProposalV0(proposalV0)

    if (!validationResult.ok) {
      const errors = validationResult.error as Array<{ code: string }>
      const errorSummary = errors.map(e => e.code).join(', ')
      return Err(new Error(`Validation failed: ${errorSummary}`))
    }

    return Ok(validationResult.value)
  }
}

/**
 * Create a proposal bridge instance
 */
export function createProposalBridge(
  ledger: JSONLLedger,
  authorizer: string = 'dogfood_loop'
): ProposalBridge {
  return new ProposalBridge(ledger, {
    source: 'automated',
    authorizer,
  })
}
