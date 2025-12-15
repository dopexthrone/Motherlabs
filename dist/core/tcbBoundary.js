"use strict";
// TCB Boundary - AUTHORITATIVE declaration of Trusted Computing Base membership
// TCB Component: This file is part of the Trusted Computing Base
//
// INVARIANT: This file is the SINGLE SOURCE OF TRUTH for TCB membership
// INVARIANT: Any file in TCB_AUTHORITY_PATHS is automatically protected
// INVARIANT: TCB membership is STATIC and DETERMINISTIC (no runtime registration)
// INVARIANT: Path arrays are FROZEN at runtime (Object.freeze) - mutation throws TypeError
//
// CONSTITUTIONAL AUTHORITY: Changes to this file require human approval
// See docs/MOTHERLABS_CONSTITUTION.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEMA_PATHS = exports.CONSTITUTIONAL_PATHS = exports.TCB_GOVERNED_PATHS = exports.TCB_AUTHORITY_PATHS = void 0;
exports.isTCBPath = isTCBPath;
exports.isTCBAuthorityPath = isTCBAuthorityPath;
exports.getTCBClassification = getTCBClassification;
exports.isAutonomousModificationAllowed = isAutonomousModificationAllowed;
exports.describeTCBClassification = describeTCBClassification;
exports.listAllTCBPaths = listAllTCBPaths;
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
exports.TCB_AUTHORITY_PATHS = Object.freeze([
    'src/validation/', // Gate implementations - the verifiers
    'src/sandbox/', // Execution isolation
    'src/persistence/', // Evidence storage (ledger)
    'src/core/', // Fundamental types and functions
    'src/authorization/', // Authorization router
    'src/schema/', // Schema registry
    'src/verification/', // Ledger verification
]);
/**
 * TCB GOVERNED PATHS (Ring 2)
 *
 * These paths are under the TCB's governance:
 * - Self-modification machinery
 * - Proposers and appliers
 *
 * Changes go through gates but can be autonomous (with ALLOW token).
 */
exports.TCB_GOVERNED_PATHS = Object.freeze([
    'src/selfbuild/', // Self-improvement machinery
]);
/**
 * CONSTITUTIONAL PATHS
 *
 * These paths define the system's rules and philosophy.
 * Changes require constitutional amendment process.
 */
exports.CONSTITUTIONAL_PATHS = Object.freeze([
    'docs/MOTHERLABS_CONSTITUTION.md',
    'docs/DECISION_PHILOSOPHY.md',
    'docs/KERNEL_FREEZE_PROTOCOL.md',
    'docs/ARTIFACT_MODEL.md',
    'docs/SELF_SCALING_RULESET.md',
]);
/**
 * SCHEMA PATHS
 *
 * Schema definitions for ledger records.
 * Changes require careful migration planning.
 */
exports.SCHEMA_PATHS = Object.freeze([
    'schemas/',
]);
/**
 * Check if a path is within the TCB
 *
 * @param filepath - Relative or absolute path to check
 * @returns true if the path is part of the TCB
 *
 * This is the AUTHORITATIVE check for TCB membership.
 * All protection decisions should use this function.
 */
function isTCBPath(filepath) {
    return exports.TCB_AUTHORITY_PATHS.some(p => filepath.includes(p)) ||
        exports.TCB_GOVERNED_PATHS.some(p => filepath.includes(p)) ||
        exports.CONSTITUTIONAL_PATHS.some(p => filepath.includes(p)) ||
        exports.SCHEMA_PATHS.some(p => filepath.includes(p));
}
/**
 * Check if a path is in TCB AUTHORITY (Ring 1 - highest protection)
 *
 * @param filepath - Path to check
 * @returns true if the path is in TCB authority
 *
 * Authority paths are BLOCKED from autonomous modification.
 */
function isTCBAuthorityPath(filepath) {
    return exports.TCB_AUTHORITY_PATHS.some(p => filepath.includes(p));
}
/**
 * Get TCB classification for a path
 *
 * @param filepath - Path to classify
 * @returns The TCB classification tier
 *
 * Classification determines protection level and allowed operations.
 */
function getTCBClassification(filepath) {
    // Check in order of highest to lowest protection
    if (exports.CONSTITUTIONAL_PATHS.some(p => filepath.includes(p))) {
        return 'constitutional';
    }
    if (exports.TCB_AUTHORITY_PATHS.some(p => filepath.includes(p))) {
        return 'authority';
    }
    if (exports.TCB_GOVERNED_PATHS.some(p => filepath.includes(p))) {
        return 'governed';
    }
    if (exports.SCHEMA_PATHS.some(p => filepath.includes(p))) {
        return 'schema';
    }
    return 'non-tcb';
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
function isAutonomousModificationAllowed(filepath) {
    const classification = getTCBClassification(filepath);
    // Authority and Constitutional require human approval
    return classification !== 'authority' && classification !== 'constitutional';
}
/**
 * Get human-readable description of TCB classification
 */
function describeTCBClassification(classification) {
    switch (classification) {
        case 'authority':
            return 'TCB Authority (Ring 1) - Core kernel, autonomous modification BLOCKED';
        case 'governed':
            return 'TCB Governed (Ring 2) - Self-modification machinery, gated but autonomous';
        case 'constitutional':
            return 'Constitutional - Foundational documents, amendment process required';
        case 'schema':
            return 'Schema - Ledger schema definitions, careful migration required';
        case 'non-tcb':
            return 'Non-TCB - Application code, no special protection';
    }
}
/**
 * List all TCB paths (for audit/introspection)
 */
function listAllTCBPaths() {
    return {
        authority: exports.TCB_AUTHORITY_PATHS,
        governed: exports.TCB_GOVERNED_PATHS,
        constitutional: exports.CONSTITUTIONAL_PATHS,
        schema: exports.SCHEMA_PATHS
    };
}
