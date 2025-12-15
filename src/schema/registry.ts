// Schema Registry - Deny-by-default schema governance
// TCB Component: This file is part of the Trusted Computing Base
//
// INVARIANT: No record admitted without registered schema
// INVARIANT: Unknown schema_id = DENY (fail-closed)
// INVARIANT: Registry is deterministic (hardcoded, no external deps)

import { Result, Ok, Err } from '../core/result'

/**
 * Schema definition - minimal structure for validation
 */
export type SchemaDef = {
  /** Unique schema identifier */
  readonly schema_id: string
  /** Schema version (semantic versioning) */
  readonly version: string
  /** Human-readable description */
  readonly description: string
  /** Required fields (field name -> type hint) */
  readonly required_fields: readonly string[]
  /** Whether this is a governance-critical record type */
  readonly governance_critical: boolean
}

/**
 * Schema registry key
 */
type SchemaKey = `${string}@${string}`

function makeKey(schema_id: string, version: string): SchemaKey {
  return `${schema_id}@${version}`
}

/**
 * DETERMINISTIC SCHEMA REGISTRY
 *
 * All allowed schemas are defined here. This is the authoritative source.
 * No external configuration. No runtime registration.
 *
 * To add a new schema:
 * 1. Define it in SCHEMAS below
 * 2. Rebuild
 * 3. Deploy
 *
 * This ensures schema changes are auditable through git history.
 */
const SCHEMAS: readonly SchemaDef[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // GOVERNANCE-CRITICAL SCHEMAS (Ring 0/1)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    schema_id: 'GENESIS',
    version: '1.0.0',
    description: 'Ledger genesis record - first entry in hash chain',
    required_fields: ['kernel_version', 'purpose'],
    governance_critical: true
  },

  {
    schema_id: 'GATE_DECISION',
    version: '1.0.0',
    description: 'Authorization gate decision record',
    required_fields: ['gate_type', 'decision', 'scope', 'authorizer', 'issued_at_utc', 'reason'],
    governance_critical: true
  },

  {
    schema_id: 'EVIDENCE_ARTIFACT',
    version: '1.0.0',
    description: 'Evidence artifact with content-addressed payload',
    required_fields: ['artifact_id', 'artifact_kind', 'evidence_kind', 'content_hash', 'payload_encoding', 'payload'],
    governance_critical: true
  },

  {
    schema_id: 'TCB_PROTECTION_EVENT',
    version: '1.0.0',
    description: 'TCB protection triggered - blocked autonomous modification',
    required_fields: ['targetFile', 'attemptedBy', 'action', 'reason'],
    governance_critical: true
  },

  {
    schema_id: 'LEDGER_FREEZE',
    version: '1.0.0',
    description: 'Ledger freeze event - marks ledger as immutable',
    required_fields: ['reason', 'frozen_at_seq'],
    governance_critical: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROPOSAL LIFECYCLE SCHEMAS (Ring 2)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    schema_id: 'PROPOSAL_ADMITTED',
    version: '1.0.0',
    description: 'Proposal admitted to ledger after gate approval',
    required_fields: ['proposal_id', 'target_file', 'issue_type'],
    governance_critical: false
  },

  {
    schema_id: 'CHANGE_APPLIED',
    version: '1.0.0',
    description: 'Code change successfully applied',
    required_fields: ['proposal_id', 'target_file', 'commit_hash'],
    governance_critical: false
  },

  {
    schema_id: 'CHANGE_ROLLED_BACK',
    version: '1.0.0',
    description: 'Code change rolled back after test failure',
    required_fields: ['proposal_id', 'target_file', 'reason'],
    governance_critical: false
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DOGFOODING LOOP SCHEMAS (Ring 3)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    schema_id: 'loop_started',
    version: '1.0.0',
    description: 'Dogfooding loop started',
    required_fields: ['config'],
    governance_critical: false
  },

  {
    schema_id: 'dogfood_event',
    version: '1.0.0',
    description: 'Generic dogfooding event',
    required_fields: ['event'],
    governance_critical: false
  },

  {
    schema_id: 'improvement_applied',
    version: '1.0.0',
    description: 'Self-improvement successfully applied',
    required_fields: ['proposalId', 'issue', 'source'],
    governance_critical: false
  },

  {
    schema_id: 'proposal_rejected',
    version: '1.0.0',
    description: 'Proposal rejected by gates',
    required_fields: ['proposalId', 'reason'],
    governance_critical: false
  },

  {
    schema_id: 'improvement_rolled_back',
    version: '1.0.0',
    description: 'Self-improvement rolled back after failure',
    required_fields: ['proposalId', 'reason'],
    governance_critical: false
  },

  {
    schema_id: 'cycle_failure',
    version: '1.0.0',
    description: 'Dogfooding cycle failed',
    required_fields: ['type', 'message'],
    governance_critical: false
  },

  {
    schema_id: 'proposal_outcome',
    version: '1.0.0',
    description: 'Final outcome of a proposal',
    required_fields: ['proposal_id', 'status', 'evidence_ids'],
    governance_critical: false
  },

  {
    schema_id: 'tcb_integrity_failed',
    version: '1.0.0',
    description: 'TCB integrity check failed at startup',
    required_fields: ['result'],
    governance_critical: true
  },

  {
    schema_id: 'cycle_blocked_by_safety',
    version: '1.0.0',
    description: 'Cycle blocked by safety guard',
    required_fields: ['reason', 'stats'],
    governance_critical: false
  }
] as const

/**
 * Build the registry map (computed once at module load)
 */
const REGISTRY_MAP: ReadonlyMap<SchemaKey, SchemaDef> = new Map(
  SCHEMAS.map(schema => [makeKey(schema.schema_id, schema.version), schema])
)

/**
 * Default version for schemas (when version not specified)
 */
const DEFAULT_VERSION = '1.0.0'

/**
 * Schema Registry - Deterministic, fail-closed
 */
export class SchemaRegistry {
  /**
   * Resolve a schema by ID and version
   *
   * FAIL-CLOSED: Unknown schema returns Err
   */
  resolve(schema_id: string, version: string = DEFAULT_VERSION): Result<SchemaDef, Error> {
    const key = makeKey(schema_id, version)
    const schema = REGISTRY_MAP.get(key)

    if (!schema) {
      return Err(new Error(
        `SCHEMA DENIED: Unknown schema '${schema_id}@${version}'. ` +
        `Schema Registry enforces deny-by-default. ` +
        `Register schema in src/schema/registry.ts to allow.`
      ))
    }

    return Ok(schema)
  }

  /**
   * Check if a schema is registered (without returning it)
   */
  isRegistered(schema_id: string, version: string = DEFAULT_VERSION): boolean {
    return REGISTRY_MAP.has(makeKey(schema_id, version))
  }

  /**
   * Validate a record against its schema
   *
   * FAIL-CLOSED: Missing required fields returns Err
   */
  validate(schema_id: string, record: unknown, version: string = DEFAULT_VERSION): Result<void, Error> {
    const schemaResult = this.resolve(schema_id, version)
    if (!schemaResult.ok) {
      return Err(schemaResult.error)
    }

    const schema = schemaResult.value

    // Check required fields
    if (typeof record !== 'object' || record === null) {
      return Err(new Error(
        `SCHEMA VALIDATION FAILED: Record must be an object for schema '${schema_id}'`
      ))
    }

    const recordObj = record as Record<string, unknown>
    const missingFields: string[] = []

    for (const field of schema.required_fields) {
      if (!(field in recordObj)) {
        missingFields.push(field)
      }
    }

    if (missingFields.length > 0) {
      return Err(new Error(
        `SCHEMA VALIDATION FAILED: Missing required fields [${missingFields.join(', ')}] ` +
        `for schema '${schema_id}@${version}'`
      ))
    }

    return Ok(void 0)
  }

  /**
   * Get all registered schemas (for introspection/debugging)
   */
  listSchemas(): readonly SchemaDef[] {
    return SCHEMAS
  }

  /**
   * Get count of registered schemas
   */
  count(): number {
    return SCHEMAS.length
  }
}

/**
 * Global schema registry instance (singleton)
 */
let globalRegistry: SchemaRegistry | null = null

export function getSchemaRegistry(): SchemaRegistry {
  if (!globalRegistry) {
    globalRegistry = new SchemaRegistry()
  }
  return globalRegistry
}

/**
 * Validate schema before admission (convenience function)
 *
 * FAIL-CLOSED: Returns Err if schema unknown or validation fails
 */
export function validateSchemaForAdmission(
  schema_id: string,
  record: unknown,
  version: string = DEFAULT_VERSION
): Result<SchemaDef, Error> {
  const registry = getSchemaRegistry()

  // First resolve the schema
  const schemaResult = registry.resolve(schema_id, version)
  if (!schemaResult.ok) {
    return Err(schemaResult.error)
  }

  // Then validate the record
  const validationResult = registry.validate(schema_id, record, version)
  if (!validationResult.ok) {
    return Err(validationResult.error)
  }

  return schemaResult
}
