// Authorization Checks - Gate-based authorization verification
// Ported from manual kernel verifier governance patterns

import { JSONLRecord } from '../persistence/jsonlLedger'
import { GateDecision, GateType, findPriorAuthorization } from '../core/gateDecision'
import { EffectType, checkEffectBounds } from '../core/effects'
import { contentAddress } from '../core/contentAddress'

/**
 * Authorization check result
 */
export type AuthorizationCheckResult = {
  authorized: boolean
  gateDecision?: GateDecision
  error?: string
}

/**
 * Extract gate decisions from ledger records
 */
export function extractGateDecisions(records: JSONLRecord[]): GateDecision[] {
  const decisions: GateDecision[] = []

  for (const record of records) {
    if (record.record_type === 'GATE_DECISION') {
      decisions.push(record.record as GateDecision)
    }
  }

  return decisions
}

/**
 * Check if a proposal has admission authorization
 */
export function checkProposalAdmissionAuthorization(
  proposalId: string,
  priorRecords: JSONLRecord[]
): AuthorizationCheckResult {
  const decisions = extractGateDecisions(priorRecords)
  const authorization = findPriorAuthorization(decisions, proposalId, 'proposal_admission')

  if (!authorization) {
    return {
      authorized: false,
      error: `No proposal_admission ALLOW found for proposal ${proposalId}`
    }
  }

  return {
    authorized: true,
    gateDecision: authorization
  }
}

/**
 * Check if a change application has authorization
 */
export function checkChangeApplicationAuthorization(
  proposalId: string,
  priorRecords: JSONLRecord[]
): AuthorizationCheckResult {
  const decisions = extractGateDecisions(priorRecords)
  const authorization = findPriorAuthorization(decisions, proposalId, 'change_application')

  if (!authorization) {
    return {
      authorized: false,
      error: `No change_application ALLOW found for proposal ${proposalId}`
    }
  }

  return {
    authorized: true,
    gateDecision: authorization
  }
}

/**
 * Check if LLM generation has authorization
 */
export function checkLLMGenerationAuthorization(
  promptHash: string,
  priorRecords: JSONLRecord[]
): AuthorizationCheckResult {
  const decisions = extractGateDecisions(priorRecords)
  const authorization = findPriorAuthorization(decisions, promptHash, 'llm_generation')

  if (!authorization) {
    return {
      authorized: false,
      error: `No llm_generation ALLOW found for prompt ${promptHash}`
    }
  }

  return {
    authorized: true,
    gateDecision: authorization
  }
}

/**
 * Check if human approval exists
 */
export function checkHumanApprovalAuthorization(
  proposalId: string,
  priorRecords: JSONLRecord[]
): AuthorizationCheckResult {
  const decisions = extractGateDecisions(priorRecords)
  const authorization = findPriorAuthorization(decisions, proposalId, 'human_approval')

  if (!authorization) {
    return {
      authorized: false,
      error: `No human_approval ALLOW found for proposal ${proposalId}`
    }
  }

  return {
    authorized: true,
    gateDecision: authorization
  }
}

/**
 * Check if an effect is authorized by a gate decision
 */
export function checkEffectAuthorization(
  effect: EffectType,
  targetId: string,
  priorRecords: JSONLRecord[]
): AuthorizationCheckResult {
  const decisions = extractGateDecisions(priorRecords)

  // Find any ALLOW decision that grants this effect
  for (let i = decisions.length - 1; i >= 0; i--) {
    const decision = decisions[i]
    if (
      decision.scope.target_id === targetId &&
      decision.decision === 'ALLOW' &&
      decision.scope.granted_effects?.includes(effect)
    ) {
      return {
        authorized: true,
        gateDecision: decision
      }
    }
  }

  return {
    authorized: false,
    error: `No gate decision grants ${effect} for ${targetId}`
  }
}

/**
 * Verify all effects are authorized
 */
export function verifyAllEffectsAuthorized(
  exercisedEffects: EffectType[],
  targetId: string,
  priorRecords: JSONLRecord[]
): AuthorizationCheckResult {
  for (const effect of exercisedEffects) {
    if (effect === 'NONE') continue

    const check = checkEffectAuthorization(effect, targetId, priorRecords)
    if (!check.authorized) {
      return check
    }
  }

  return { authorized: true }
}

/**
 * Create authorization gate decision
 */
export function createAuthorizationGateDecision(
  gateType: GateType,
  decision: 'ALLOW' | 'DENY',
  targetId: string,
  authorizer: string,
  reason: string,
  grantedEffects?: EffectType[]
): GateDecision {
  return {
    gate_type: gateType,
    decision,
    scope: {
      target_type: gateType === 'llm_generation' ? 'code' : 'proposal',
      target_id: targetId,
      granted_effects: grantedEffects
    },
    authorizer,
    issued_at_utc: new Date().toISOString(),
    reason
  }
}

/**
 * Check authorization chain for a workflow
 */
export type WorkflowStep = {
  step: string
  gateType: GateType
  targetId: string
}

export function checkWorkflowAuthorization(
  steps: WorkflowStep[],
  priorRecords: JSONLRecord[]
): { authorized: boolean; failedStep?: string; error?: string } {
  const decisions = extractGateDecisions(priorRecords)

  for (const step of steps) {
    const authorization = findPriorAuthorization(decisions, step.targetId, step.gateType)

    if (!authorization) {
      return {
        authorized: false,
        failedStep: step.step,
        error: `Step "${step.step}" requires ${step.gateType} ALLOW for ${step.targetId}`
      }
    }
  }

  return { authorized: true }
}

/**
 * Standard workflow for self-improvement
 */
export function getSelfImprovementWorkflow(proposalId: string, codeId: string): WorkflowStep[] {
  return [
    { step: 'admit_proposal', gateType: 'proposal_admission', targetId: proposalId },
    { step: 'generate_code', gateType: 'llm_generation', targetId: codeId },
    { step: 'apply_change', gateType: 'change_application', targetId: proposalId }
  ]
}

/**
 * Standard workflow with human approval
 */
export function getSelfImprovementWorkflowWithApproval(proposalId: string, codeId: string): WorkflowStep[] {
  return [
    { step: 'admit_proposal', gateType: 'proposal_admission', targetId: proposalId },
    { step: 'generate_code', gateType: 'llm_generation', targetId: codeId },
    { step: 'human_approve', gateType: 'human_approval', targetId: proposalId },
    { step: 'apply_change', gateType: 'change_application', targetId: proposalId }
  ]
}
