// TCB Boundary - AUTHORITATIVE declaration of Trusted Computing Base membership
// TCB Component: This file is part of the Trusted Computing Base
//
// INVARIANT: This file is the SINGLE SOURCE OF TRUTH for TCB membership
// INVARIANT: Any file in TCB_AUTHORITY_PATHS is automatically protected
// INVARIANT: TCB membership is STATIC and DETERMINISTIC (no runtime registration)
//
// CONSTITUTIONAL AUTHORITY: Changes to this file require human approval
// See docs/MOTHERLABS_CONSTITUTION.md

/**
 * TCB Classification Types
 *
 * authority:      Core kernel components - verification, persistence, types
 * governed:       Self-modification components - under TCB's control
 * constitutional: Foundational documents - define the system's rules
 * schema:         Schema definitions - structure of ledger records
 * non-tcb:        Application code - not part of trusted base
 */
export type TCBClassification =
  | 'authority'
  | 'governed'
  | 'constitutional'
  | 'schema'
  | 'non-tcb'

/**
 * TCB AUTHORITY PATHS (Ring 1)
 *
 * These paths contain the kernel's core authority:
 * - Verification logic (gates)
 * - Content addressing
 * - Evidence persistence
 * - Authorization
 *
 * Autonomous modification of these paths is BLOCKED.
 * Human approval required for all changes.
 */
export const TCB_AUTHORITY_PATHS: readonly string[] = [
  'src/validation/',      // Gate implementations - the verifiers
  'src/sandbox/',         // Execution isolation
  'src/persistence/',     // Evidence storage (ledger)
  'src/core/',            // Fundamental types and functions
  'src/authorization/',   // Authorization router
  'src/schema/',          // Schema registry
  'src/verification/',    // Ledger verification
] as const

/**
 * TCB GOVERNED PATHS (Ring 2)
 *
 * These paths are under the TCB's governance:
 * - Self-modification machinery
 * - Proposers and appliers
 *
 * Changes go through gates but can be autonomous (with ALLOW token).
 */
export const TCB_GOVERNED_PATHS: readonly string[] = [
  'src/selfbuild/',       // Self-improvement machinery
] as const

/**
 * CONSTITUTIONAL PATHS
 *
 * These paths define the system's rules and philosophy.
 * Changes require constitutional amendment process.
 */
export const CONSTITUTIONAL_PATHS: readonly string[] = [
  'docs/MOTHERLABS_CONSTITUTION.md',
  'docs/DECISION_PHILOSOPHY.md',
  'docs/KERNEL_FREEZE_PROTOCOL.md',
  'docs/ARTIFACT_MODEL.md',
  'docs/SELF_SCALING_RULESET.md',
] as const

/**
 * SCHEMA PATHS
 *
 * Schema definitions for ledger records.
 * Changes require careful migration planning.
 */
export const SCHEMA_PATHS: readonly string[] = [
  'schemas/',
] as const

/**
 * Check if a path is within the TCB
 *
 * @param filepath - Relative or absolute path to check
 * @returns true if the path is part of the TCB
 *
 * This is the AUTHORITATIVE check for TCB membership.
 * All protection decisions should use this function.
 */
export function isTCBPath(filepath: string): boolean {
  return TCB_AUTHORITY_PATHS.some(p => filepath.includes(p)) ||
         TCB_GOVERNED_PATHS.some(p => filepath.includes(p)) ||
         CONSTITUTIONAL_PATHS.some(p => filepath.includes(p)) ||
         SCHEMA_PATHS.some(p => filepath.includes(p))
}

/**
 * Check if a path is in TCB AUTHORITY (Ring 1 - highest protection)
 *
 * @param filepath - Path to check
 * @returns true if the path is in TCB authority
 *
 * Authority paths are BLOCKED from autonomous modification.
 */
export function isTCBAuthorityPath(filepath: string): boolean {
  return TCB_AUTHORITY_PATHS.some(p => filepath.includes(p))
}

/**
 * Get TCB classification for a path
 *
 * @param filepath - Path to classify
 * @returns The TCB classification tier
 *
 * Classification determines protection level and allowed operations.
 */
export function getTCBClassification(filepath: string): TCBClassification {
  // Check in order of highest to lowest protection
  if (CONSTITUTIONAL_PATHS.some(p => filepath.includes(p))) {
    return 'constitutional'
  }
  if (TCB_AUTHORITY_PATHS.some(p => filepath.includes(p))) {
    return 'authority'
  }
  if (TCB_GOVERNED_PATHS.some(p => filepath.includes(p))) {
    return 'governed'
  }
  if (SCHEMA_PATHS.some(p => filepath.includes(p))) {
    return 'schema'
  }
  return 'non-tcb'
}

/**
 * Check if autonomous modification is allowed for a path
 *
 * @param filepath - Path to check
 * @returns true if autonomous modification is permitted
 *
 * Authority and Constitutional paths require human approval.
 * Governed and Schema paths can be modified with proper authorization.
 * Non-TCB paths have no special restrictions.
 */
export function isAutonomousModificationAllowed(filepath: string): boolean {
  const classification = getTCBClassification(filepath)
  // Authority and Constitutional require human approval
  return classification !== 'authority' && classification !== 'constitutional'
}

/**
 * Get human-readable description of TCB classification
 */
export function describeTCBClassification(classification: TCBClassification): string {
  switch (classification) {
    case 'authority':
      return 'TCB Authority (Ring 1) - Core kernel, autonomous modification BLOCKED'
    case 'governed':
      return 'TCB Governed (Ring 2) - Self-modification machinery, gated but autonomous'
    case 'constitutional':
      return 'Constitutional - Foundational documents, amendment process required'
    case 'schema':
      return 'Schema - Ledger schema definitions, careful migration required'
    case 'non-tcb':
      return 'Non-TCB - Application code, no special protection'
  }
}

/**
 * List all TCB paths (for audit/introspection)
 */
export function listAllTCBPaths(): {
  authority: readonly string[]
  governed: readonly string[]
  constitutional: readonly string[]
  schema: readonly string[]
} {
  return {
    authority: TCB_AUTHORITY_PATHS,
    governed: TCB_GOVERNED_PATHS,
    constitutional: CONSTITUTIONAL_PATHS,
    schema: SCHEMA_PATHS
  }
}
