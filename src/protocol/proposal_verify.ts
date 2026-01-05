/**
 * Proposal Verifier (Internal)
 * ============================
 *
 * Internal verification of Proposal objects against PR1-PR12 invariants.
 * This is for kernel self-consistency checks, not consumer verification.
 *
 * See PROPOSAL_INTERNAL_SPEC.md for the internal contract.
 */

import { canonicalize } from '../utils/canonical.js';
import type { Proposal, ProposedAction, AcceptanceTest, ActionType } from './proposal.js';

// =============================================================================
// Verification Types (Internal)
// =============================================================================

/**
 * Valid action types for verification.
 */
const ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'create_file',
  'modify_file',
  'delete_file',
  'execute_command',
  'validate',
  'test',
]);

/**
 * Valid test types.
 */
type TestType = 'hash_match' | 'command_success' | 'file_exists' | 'content_match';

const TEST_TYPES: ReadonlySet<TestType> = new Set([
  'hash_match',
  'command_success',
  'file_exists',
  'content_match',
]);

/**
 * A single violation of the proposal spec.
 */
export interface ProposalViolation {
  rule_id: string;
  path?: string;
  message: string;
}

/**
 * Result of proposal verification.
 */
export type ProposalVerifyResult =
  | { ok: true }
  | { ok: false; violations: ProposalViolation[] };

/**
 * Options for proposal verification.
 */
export interface ProposalVerifyOptions {
  strictActionIds?: boolean;
  strictProposalId?: boolean;
}

// =============================================================================
// Regex Patterns
// =============================================================================

const PROPOSAL_ID_PATTERN = /^prop_[a-f0-9]{16}$/;
const ACTION_ID_PATTERN = /^act_[a-f0-9]{16}$/;

// =============================================================================
// Schema Validation
// =============================================================================

function hasProposalStructure(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return false;
  }
  return true;
}

// =============================================================================
// Invariant Checks
// =============================================================================

function checkSchemaVersion(proposal: Record<string, unknown>): ProposalViolation[] {
  const violations: ProposalViolation[] = [];
  const version = proposal.schema_version;

  if (version === undefined || version === null) {
    violations.push({ rule_id: 'PR1', message: 'Missing schema_version field' });
  } else if (typeof version !== 'string') {
    violations.push({ rule_id: 'PR1', message: `schema_version must be string, got ${typeof version}` });
  } else if (version.trim() === '') {
    violations.push({ rule_id: 'PR1', message: 'schema_version must be non-empty' });
  }

  return violations;
}

function checkSourceReferences(proposal: Record<string, unknown>): ProposalViolation[] {
  const violations: ProposalViolation[] = [];

  const bundleId = proposal.source_bundle_id;
  if (bundleId === undefined || bundleId === null) {
    violations.push({ rule_id: 'PR2', message: 'Missing source_bundle_id field' });
  } else if (typeof bundleId !== 'string') {
    violations.push({ rule_id: 'PR2', message: `source_bundle_id must be string, got ${typeof bundleId}` });
  } else if (bundleId.trim() === '') {
    violations.push({ rule_id: 'PR2', message: 'source_bundle_id must be non-empty' });
  }

  const bundleHash = proposal.source_bundle_hash;
  if (bundleHash === undefined || bundleHash === null) {
    violations.push({ rule_id: 'PR2', message: 'Missing source_bundle_hash field' });
  } else if (typeof bundleHash !== 'string') {
    violations.push({ rule_id: 'PR2', message: `source_bundle_hash must be string, got ${typeof bundleHash}` });
  } else if (!bundleHash.startsWith('sha256:')) {
    violations.push({ rule_id: 'PR2', message: 'source_bundle_hash must start with "sha256:"' });
  }

  return violations;
}

function checkActionsPresent(proposal: Record<string, unknown>): ProposalViolation[] {
  const violations: ProposalViolation[] = [];
  const actions = proposal.actions;

  if (actions === undefined || actions === null) {
    violations.push({ rule_id: 'PR3', message: 'Missing actions field' });
  } else if (!Array.isArray(actions)) {
    violations.push({ rule_id: 'PR3', message: `actions must be array, got ${typeof actions}` });
  }

  return violations;
}

function checkActionIdsUnique(actions: ProposedAction[]): ProposalViolation[] {
  const violations: ProposalViolation[] = [];
  const seen = new Set<string>();

  for (const action of actions) {
    if (action.id && seen.has(action.id)) {
      violations.push({ rule_id: 'PR4', path: action.id, message: `Duplicate action ID: ${action.id}` });
    }
    if (action.id) seen.add(action.id);
  }

  return violations;
}

function checkActionTypesValid(actions: ProposedAction[]): ProposalViolation[] {
  const violations: ProposalViolation[] = [];

  for (const action of actions) {
    if (!action.type) {
      violations.push({ rule_id: 'PR5', path: action.id, message: 'Action missing type field' });
    } else if (!ACTION_TYPES.has(action.type as ActionType)) {
      violations.push({ rule_id: 'PR5', path: action.id, message: `Invalid action type: ${action.type}` });
    }
  }

  return violations;
}

function checkActionIdsWellFormed(actions: ProposedAction[], strict: boolean): ProposalViolation[] {
  const violations: ProposalViolation[] = [];

  for (const action of actions) {
    if (!action.id) {
      violations.push({ rule_id: 'PR6', message: 'Action missing id field' });
    } else if (strict && !ACTION_ID_PATTERN.test(action.id)) {
      violations.push({ rule_id: 'PR6', path: action.id, message: `Action ID does not match pattern act_{hash16}: ${action.id}` });
    }
  }

  return violations;
}

function checkTestIdsUnique(tests: AcceptanceTest[]): ProposalViolation[] {
  const violations: ProposalViolation[] = [];
  const seen = new Set<string>();

  for (const test of tests) {
    if (test.id && seen.has(test.id)) {
      violations.push({ rule_id: 'PR7', path: test.id, message: `Duplicate test ID: ${test.id}` });
    }
    if (test.id) seen.add(test.id);
  }

  return violations;
}

function checkTestTypesValid(tests: AcceptanceTest[]): ProposalViolation[] {
  const violations: ProposalViolation[] = [];

  for (const test of tests) {
    if (!test.type) {
      violations.push({ rule_id: 'PR8', path: test.id, message: 'Test missing type field' });
    } else if (!TEST_TYPES.has(test.type as TestType)) {
      violations.push({ rule_id: 'PR8', path: test.id, message: `Invalid test type: ${test.type}` });
    }
  }

  return violations;
}

function checkConfidenceRange(proposal: Record<string, unknown>): ProposalViolation[] {
  const violations: ProposalViolation[] = [];
  const confidence = proposal.confidence;

  if (confidence === undefined || confidence === null) {
    violations.push({ rule_id: 'PR9', message: 'Missing confidence field' });
  } else if (typeof confidence !== 'number') {
    violations.push({ rule_id: 'PR9', message: `confidence must be number, got ${typeof confidence}` });
  } else if (!Number.isInteger(confidence)) {
    violations.push({ rule_id: 'PR9', message: `confidence must be integer, got ${confidence}` });
  } else if (confidence < 0 || confidence > 100) {
    violations.push({ rule_id: 'PR9', message: `confidence must be 0-100, got ${confidence}` });
  }

  return violations;
}

function checkSummaryNonEmpty(proposal: Record<string, unknown>): ProposalViolation[] {
  const violations: ProposalViolation[] = [];
  const summary = proposal.summary;

  if (summary === undefined || summary === null) {
    violations.push({ rule_id: 'PR10', message: 'Missing summary field' });
  } else if (typeof summary !== 'string') {
    violations.push({ rule_id: 'PR10', message: `summary must be string, got ${typeof summary}` });
  } else if (summary.trim() === '') {
    violations.push({ rule_id: 'PR10', message: 'summary must be non-empty' });
  }

  return violations;
}

function checkSortingCanonical(actions: ProposedAction[], tests: AcceptanceTest[]): ProposalViolation[] {
  const violations: ProposalViolation[] = [];

  for (let i = 1; i < actions.length; i++) {
    const prev = actions[i - 1]!;
    const curr = actions[i]!;

    if (prev.order > curr.order) {
      violations.push({
        rule_id: 'PR11',
        path: curr.id,
        message: `Actions not sorted by order: ${prev.id} (order=${prev.order}) before ${curr.id} (order=${curr.order})`,
      });
      break;
    }

    if (prev.order === curr.order && prev.id > curr.id) {
      violations.push({
        rule_id: 'PR11',
        path: curr.id,
        message: `Actions with same order not sorted by id: ${prev.id} before ${curr.id}`,
      });
      break;
    }
  }

  for (let i = 1; i < tests.length; i++) {
    const prev = tests[i - 1]!;
    const curr = tests[i]!;

    if (prev.id > curr.id) {
      violations.push({
        rule_id: 'PR11',
        path: curr.id,
        message: `Tests not sorted by id: ${prev.id} before ${curr.id}`,
      });
      break;
    }
  }

  return violations;
}

function checkFileActionsHaveContent(actions: ProposedAction[]): ProposalViolation[] {
  const violations: ProposalViolation[] = [];

  for (const action of actions) {
    if (action.type === 'create_file' || action.type === 'modify_file') {
      if (action.content === undefined) {
        violations.push({ rule_id: 'PR12', path: action.id, message: `${action.type} action must have content` });
      }
    }

    if (action.type === 'delete_file') {
      if (action.content !== undefined) {
        violations.push({ rule_id: 'PR12', path: action.id, message: 'delete_file action must not have content' });
      }
    }
  }

  return violations;
}

function checkProposalIdFormat(proposal: Record<string, unknown>, strict: boolean): ProposalViolation[] {
  const violations: ProposalViolation[] = [];

  if (strict) {
    const id = proposal.id;
    if (!id) {
      violations.push({ rule_id: 'SCHEMA', message: 'Missing proposal id field' });
    } else if (typeof id !== 'string') {
      violations.push({ rule_id: 'SCHEMA', message: `Proposal id must be string, got ${typeof id}` });
    } else if (!PROPOSAL_ID_PATTERN.test(id)) {
      violations.push({ rule_id: 'SCHEMA', message: `Proposal ID does not match pattern prop_{hash16}: ${id}` });
    }
  }

  return violations;
}

function checkAcceptanceTestsPresent(proposal: Record<string, unknown>): ProposalViolation[] {
  const violations: ProposalViolation[] = [];
  const tests = proposal.acceptance_tests;

  if (tests === undefined || tests === null) {
    violations.push({ rule_id: 'SCHEMA', message: 'Missing acceptance_tests field' });
  } else if (!Array.isArray(tests)) {
    violations.push({ rule_id: 'SCHEMA', message: `acceptance_tests must be array, got ${typeof tests}` });
  }

  return violations;
}

function checkRequiresApproval(proposal: Record<string, unknown>): ProposalViolation[] {
  const violations: ProposalViolation[] = [];
  const requiresApproval = proposal.requires_approval;

  if (requiresApproval === undefined || requiresApproval === null) {
    violations.push({ rule_id: 'SCHEMA', message: 'Missing requires_approval field' });
  } else if (typeof requiresApproval !== 'boolean') {
    violations.push({ rule_id: 'SCHEMA', message: `requires_approval must be boolean, got ${typeof requiresApproval}` });
  }

  return violations;
}

function sortViolations(violations: ProposalViolation[]): ProposalViolation[] {
  return [...violations].sort((a, b) => {
    const ruleCompare = a.rule_id.localeCompare(b.rule_id);
    if (ruleCompare !== 0) return ruleCompare;
    const pathA = a.path ?? '';
    const pathB = b.path ?? '';
    return pathA.localeCompare(pathB);
  });
}

// =============================================================================
// Main Verifier (Internal)
// =============================================================================

/**
 * Verify a proposal against PROPOSAL_INTERNAL_SPEC.md invariants (PR1-PR12).
 *
 * This is for kernel self-consistency, not consumer verification.
 *
 * @param input - Proposal to verify (unknown type for safety)
 * @param options - Verification options
 * @returns Verification result
 */
export function verifyProposal(
  input: unknown,
  options: ProposalVerifyOptions = {}
): ProposalVerifyResult {
  const { strictActionIds = true, strictProposalId = true } = options;

  if (!hasProposalStructure(input)) {
    return {
      ok: false,
      violations: [{ rule_id: 'SCHEMA', message: 'Proposal must be a non-null object' }],
    };
  }

  const proposal = input as Record<string, unknown>;
  const violations: ProposalViolation[] = [];

  violations.push(...checkProposalIdFormat(proposal, strictProposalId));
  violations.push(...checkAcceptanceTestsPresent(proposal));
  violations.push(...checkRequiresApproval(proposal));
  violations.push(...checkSchemaVersion(proposal));
  violations.push(...checkSourceReferences(proposal));
  violations.push(...checkActionsPresent(proposal));

  const actions = Array.isArray(proposal.actions) ? (proposal.actions as ProposedAction[]) : [];
  const tests = Array.isArray(proposal.acceptance_tests) ? (proposal.acceptance_tests as AcceptanceTest[]) : [];

  violations.push(...checkActionIdsUnique(actions));
  violations.push(...checkActionTypesValid(actions));
  violations.push(...checkActionIdsWellFormed(actions, strictActionIds));
  violations.push(...checkTestIdsUnique(tests));
  violations.push(...checkTestTypesValid(tests));
  violations.push(...checkConfidenceRange(proposal));
  violations.push(...checkSummaryNonEmpty(proposal));
  violations.push(...checkSortingCanonical(actions, tests));
  violations.push(...checkFileActionsHaveContent(actions));

  if (violations.length === 0) {
    return { ok: true };
  }

  return { ok: false, violations: sortViolations(violations) };
}
