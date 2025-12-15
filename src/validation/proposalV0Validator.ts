// Proposal Schema v0 Validator - Pure, deterministic validation
// See docs/PROPOSAL_SCHEMA_v0.md for specification
//
// INVARIANTS:
// - Pure function: no I/O, no wall-clock, no randomness
// - Fail-closed: unknown fields rejected (except metadata)
// - Deterministic: same input always produces same output
// - Error ordering is stable (schema-defined order)

import { Result, Ok, Err } from '../core/result'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valid requested_action values
 */
export const REQUESTED_ACTIONS = ['create', 'update', 'delete', 'analyze', 'verify', 'plan'] as const
export type RequestedAction = typeof REQUESTED_ACTIONS[number]

/**
 * Valid target kind values
 */
export const TARGET_KINDS = ['file', 'directory', 'module', 'function', 'document', 'system'] as const
export type TargetKind = typeof TARGET_KINDS[number]

/**
 * Valid provenance source values
 */
export const PROVENANCE_SOURCES = ['cli', 'api', 'human', 'automated'] as const
export type ProvenanceSource = typeof PROVENANCE_SOURCES[number]

/**
 * Target object within a proposal
 */
export type ProposalTarget = {
  readonly kind: TargetKind
  readonly identifier: string
}

/**
 * Provenance object within a proposal
 */
export type ProposalProvenance = {
  readonly source: ProvenanceSource
  readonly timestamp_utc: string
}

/**
 * ProposalV0 - validated proposal conforming to schema v0
 */
export type ProposalV0 = {
  readonly version: 'v0'
  readonly proposal_id: string
  readonly intent: string
  readonly requested_action: RequestedAction
  readonly targets: readonly ProposalTarget[]
  readonly constraints: Readonly<Record<string, unknown>>
  readonly evidence_plan: Readonly<Record<string, unknown>>
  readonly provenance: ProposalProvenance
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * Validation error with stable code
 */
export type ValidationError = {
  readonly code: string
  readonly message: string
  readonly field?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CODES (stable enum)
// ═══════════════════════════════════════════════════════════════════════════

export const ERROR_CODES = {
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_VERSION: 'INVALID_VERSION',
  EMPTY_PROPOSAL_ID: 'EMPTY_PROPOSAL_ID',
  EMPTY_INTENT: 'EMPTY_INTENT',
  INVALID_REQUESTED_ACTION: 'INVALID_REQUESTED_ACTION',
  TARGETS_NOT_ARRAY: 'TARGETS_NOT_ARRAY',
  TARGETS_EMPTY: 'TARGETS_EMPTY',
  INVALID_TARGET_KIND: 'INVALID_TARGET_KIND',
  EMPTY_TARGET_IDENTIFIER: 'EMPTY_TARGET_IDENTIFIER',
  TARGET_NOT_OBJECT: 'TARGET_NOT_OBJECT',
  CONSTRAINTS_NOT_OBJECT: 'CONSTRAINTS_NOT_OBJECT',
  EVIDENCE_PLAN_NOT_OBJECT: 'EVIDENCE_PLAN_NOT_OBJECT',
  PROVENANCE_NOT_OBJECT: 'PROVENANCE_NOT_OBJECT',
  INVALID_PROVENANCE_SOURCE: 'INVALID_PROVENANCE_SOURCE',
  MISSING_PROVENANCE_TIMESTAMP: 'MISSING_PROVENANCE_TIMESTAMP',
  METADATA_NOT_OBJECT: 'METADATA_NOT_OBJECT',
} as const

// ═══════════════════════════════════════════════════════════════════════════
// ALLOWED FIELDS (for unknown field rejection)
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'version',
  'proposal_id',
  'intent',
  'requested_action',
  'targets',
  'constraints',
  'evidence_plan',
  'provenance',
  'metadata', // Optional forward-compat field
])

const REQUIRED_TOP_LEVEL_FIELDS = [
  'version',
  'proposal_id',
  'intent',
  'requested_action',
  'targets',
  'constraints',
  'evidence_plan',
  'provenance',
] as const

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATOR (pure function)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate input against Proposal Schema v0
 *
 * PURE FUNCTION: No I/O, no wall-clock, no randomness
 * FAIL-CLOSED: Unknown fields rejected (except metadata)
 * DETERMINISTIC: Same input always produces same error list in same order
 *
 * Error ordering follows schema-defined field order for determinism.
 */
export function validateProposalV0(input: unknown): Result<ProposalV0, ValidationError[]> {
  const errors: ValidationError[] = []

  // Check input is object
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return Err([{
      code: ERROR_CODES.NOT_AN_OBJECT,
      message: 'Input must be a non-null object',
    }])
  }

  const obj = input as Record<string, unknown>

  // Check for unknown fields (must come first for determinism)
  const unknownFields = Object.keys(obj)
    .filter(key => !ALLOWED_TOP_LEVEL_FIELDS.has(key))
    .sort() // Alphabetical for determinism

  for (const field of unknownFields) {
    errors.push({
      code: ERROR_CODES.UNKNOWN_FIELD,
      message: `Unknown top-level field: '${field}'`,
      field,
    })
  }

  // Check required fields in schema-defined order
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in obj)) {
      errors.push({
        code: ERROR_CODES.MISSING_REQUIRED_FIELD,
        message: `Missing required field: '${field}'`,
        field,
      })
    }
  }

  // If we have structural errors, return early
  if (errors.length > 0) {
    return Err(errors)
  }

  // Validate version
  if (obj.version !== 'v0') {
    errors.push({
      code: ERROR_CODES.INVALID_VERSION,
      message: `Invalid version: expected 'v0', got '${String(obj.version)}'`,
      field: 'version',
    })
  }

  // Validate proposal_id (non-empty string)
  if (typeof obj.proposal_id !== 'string' || obj.proposal_id.trim() === '') {
    errors.push({
      code: ERROR_CODES.EMPTY_PROPOSAL_ID,
      message: 'proposal_id must be a non-empty string',
      field: 'proposal_id',
    })
  }

  // Validate intent (non-empty string)
  if (typeof obj.intent !== 'string' || obj.intent.trim() === '') {
    errors.push({
      code: ERROR_CODES.EMPTY_INTENT,
      message: 'intent must be a non-empty string',
      field: 'intent',
    })
  }

  // Validate requested_action (enum)
  if (!REQUESTED_ACTIONS.includes(obj.requested_action as RequestedAction)) {
    errors.push({
      code: ERROR_CODES.INVALID_REQUESTED_ACTION,
      message: `Invalid requested_action: '${String(obj.requested_action)}'. Must be one of: ${REQUESTED_ACTIONS.join(', ')}`,
      field: 'requested_action',
    })
  }

  // Validate targets
  if (!Array.isArray(obj.targets)) {
    errors.push({
      code: ERROR_CODES.TARGETS_NOT_ARRAY,
      message: 'targets must be an array',
      field: 'targets',
    })
  } else if (obj.targets.length === 0) {
    errors.push({
      code: ERROR_CODES.TARGETS_EMPTY,
      message: 'targets array must have at least one element',
      field: 'targets',
    })
  } else {
    // Validate each target in order
    for (let i = 0; i < obj.targets.length; i++) {
      const target = obj.targets[i]
      const fieldPrefix = `targets[${i}]`

      if (typeof target !== 'object' || target === null || Array.isArray(target)) {
        errors.push({
          code: ERROR_CODES.TARGET_NOT_OBJECT,
          message: `${fieldPrefix} must be an object`,
          field: fieldPrefix,
        })
        continue
      }

      const targetObj = target as Record<string, unknown>

      // Validate target.kind
      if (!TARGET_KINDS.includes(targetObj.kind as TargetKind)) {
        errors.push({
          code: ERROR_CODES.INVALID_TARGET_KIND,
          message: `${fieldPrefix}.kind: '${String(targetObj.kind)}' is not valid. Must be one of: ${TARGET_KINDS.join(', ')}`,
          field: `${fieldPrefix}.kind`,
        })
      }

      // Validate target.identifier
      if (typeof targetObj.identifier !== 'string' || targetObj.identifier.trim() === '') {
        errors.push({
          code: ERROR_CODES.EMPTY_TARGET_IDENTIFIER,
          message: `${fieldPrefix}.identifier must be a non-empty string`,
          field: `${fieldPrefix}.identifier`,
        })
      }
    }
  }

  // Validate constraints (must be object)
  if (typeof obj.constraints !== 'object' || obj.constraints === null || Array.isArray(obj.constraints)) {
    errors.push({
      code: ERROR_CODES.CONSTRAINTS_NOT_OBJECT,
      message: 'constraints must be an object',
      field: 'constraints',
    })
  }

  // Validate evidence_plan (must be object)
  if (typeof obj.evidence_plan !== 'object' || obj.evidence_plan === null || Array.isArray(obj.evidence_plan)) {
    errors.push({
      code: ERROR_CODES.EVIDENCE_PLAN_NOT_OBJECT,
      message: 'evidence_plan must be an object',
      field: 'evidence_plan',
    })
  }

  // Validate provenance
  if (typeof obj.provenance !== 'object' || obj.provenance === null || Array.isArray(obj.provenance)) {
    errors.push({
      code: ERROR_CODES.PROVENANCE_NOT_OBJECT,
      message: 'provenance must be an object',
      field: 'provenance',
    })
  } else {
    const prov = obj.provenance as Record<string, unknown>

    // Validate provenance.source
    if (!PROVENANCE_SOURCES.includes(prov.source as ProvenanceSource)) {
      errors.push({
        code: ERROR_CODES.INVALID_PROVENANCE_SOURCE,
        message: `provenance.source: '${String(prov.source)}' is not valid. Must be one of: ${PROVENANCE_SOURCES.join(', ')}`,
        field: 'provenance.source',
      })
    }

    // Validate provenance.timestamp_utc
    if (typeof prov.timestamp_utc !== 'string' || prov.timestamp_utc.trim() === '') {
      errors.push({
        code: ERROR_CODES.MISSING_PROVENANCE_TIMESTAMP,
        message: 'provenance.timestamp_utc must be a non-empty string',
        field: 'provenance.timestamp_utc',
      })
    }
  }

  // Validate metadata (optional, but if present must be object)
  if ('metadata' in obj && obj.metadata !== undefined) {
    if (typeof obj.metadata !== 'object' || obj.metadata === null || Array.isArray(obj.metadata)) {
      errors.push({
        code: ERROR_CODES.METADATA_NOT_OBJECT,
        message: 'metadata must be an object if present',
        field: 'metadata',
      })
    }
  }

  // Return errors or success
  if (errors.length > 0) {
    return Err(errors)
  }

  // Construct validated ProposalV0
  const validated: ProposalV0 = {
    version: 'v0',
    proposal_id: obj.proposal_id as string,
    intent: obj.intent as string,
    requested_action: obj.requested_action as RequestedAction,
    targets: (obj.targets as Array<{ kind: TargetKind; identifier: string }>).map(t => ({
      kind: t.kind,
      identifier: t.identifier,
    })),
    constraints: obj.constraints as Record<string, unknown>,
    evidence_plan: obj.evidence_plan as Record<string, unknown>,
    provenance: {
      source: (obj.provenance as Record<string, unknown>).source as ProvenanceSource,
      timestamp_utc: (obj.provenance as Record<string, unknown>).timestamp_utc as string,
    },
    ...(obj.metadata !== undefined ? { metadata: obj.metadata as Record<string, unknown> } : {}),
  }

  return Ok(validated)
}
