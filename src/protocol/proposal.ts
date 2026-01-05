/**
 * Proposal Protocol
 * =================
 *
 * Defines the interface between the kernel (authoritative) and executors (untrusted).
 *
 * Key principles:
 * - Kernel proposes, never auto-applies
 * - Executor runs in sandbox, returns evidence
 * - Kernel validates evidence, decides accept/refuse
 * - All I/O is logged for audit/replay
 *
 * The proposal protocol enforces authority/execution separation.
 */

import { deriveId, canonicalHash } from '../utils/canonical.js';
import type { Bundle, BundleId, Output, Score } from '../types/artifacts.js';
import { SCHEMA_VERSION } from '../types/artifacts.js';

// =============================================================================
// Proposal Types
// =============================================================================

/**
 * Unique identifier for a proposal.
 * Format: `prop_{hash16}`
 */
export type ProposalId = string;

/**
 * Unique identifier for an action within a proposal.
 * Format: `act_{hash16}`
 */
export type ActionId = string;

/**
 * Type of action proposed by the kernel.
 */
export type ActionType =
  | 'create_file'      // Create a new file
  | 'modify_file'      // Modify an existing file
  | 'delete_file'      // Delete a file
  | 'execute_command'  // Run a shell command
  | 'validate'         // Run validation check
  | 'test';            // Run acceptance test

/**
 * A single action within a proposal.
 */
export interface ProposedAction {
  /**
   * Unique identifier derived from content.
   */
  id: ActionId;

  /**
   * Type of action.
   */
  type: ActionType;

  /**
   * Target path (for file operations) or command (for execute).
   */
  target: string;

  /**
   * Content to write (for create/modify operations).
   */
  content?: string;

  /**
   * Expected hash of result (for verification).
   */
  expected_hash?: string;

  /**
   * Whether this action is required or optional.
   */
  required: boolean;

  /**
   * Description of what this action does.
   */
  description: string;

  /**
   * Ordering priority (lower = earlier).
   */
  order: number;
}

/**
 * An acceptance test that must pass for proposal to be accepted.
 */
export interface AcceptanceTest {
  /**
   * Unique identifier.
   */
  id: string;

  /**
   * Test name.
   */
  name: string;

  /**
   * Type of test.
   */
  type: 'hash_match' | 'command_success' | 'file_exists' | 'content_match';

  /**
   * Target to test.
   */
  target: string;

  /**
   * Expected value (hash, exit code, etc.).
   */
  expected: string;

  /**
   * Whether this test is required.
   */
  required: boolean;
}

/**
 * A complete proposal from kernel to executor.
 */
export interface Proposal {
  /**
   * Unique identifier derived from content.
   */
  id: ProposalId;

  /**
   * Schema version for compatibility.
   */
  schema_version: string;

  /**
   * Source bundle that generated this proposal.
   */
  source_bundle_id: BundleId;

  /**
   * Hash of the source bundle.
   */
  source_bundle_hash: string;

  /**
   * Proposed actions to execute.
   * ORDERING: Sorted by order ascending, then id ascending.
   */
  actions: ProposedAction[];

  /**
   * Acceptance tests that must pass.
   * ORDERING: Sorted by id ascending.
   */
  acceptance_tests: AcceptanceTest[];

  /**
   * Human-readable summary.
   */
  summary: string;

  /**
   * Whether this proposal requires explicit human approval.
   */
  requires_approval: boolean;

  /**
   * Confidence score for this proposal.
   * Integer 0-100.
   */
  confidence: Score;
}

// =============================================================================
// Evidence Types
// =============================================================================

/**
 * Result status for an executed action.
 */
export type ActionResultStatus =
  | 'success'    // Action completed successfully
  | 'failure'    // Action failed
  | 'skipped'    // Action was skipped
  | 'timeout';   // Action timed out

/**
 * Result of executing a single action.
 */
export interface ActionResult {
  /**
   * ID of the action that was executed.
   */
  action_id: ActionId;

  /**
   * Result status.
   */
  status: ActionResultStatus;

  /**
   * Actual hash of result (for verification).
   */
  actual_hash?: string;

  /**
   * Exit code (for command execution).
   */
  exit_code?: number;

  /**
   * Standard output (truncated if too long).
   */
  stdout?: string;

  /**
   * Standard error (truncated if too long).
   */
  stderr?: string;

  /**
   * Error message if failed.
   */
  error?: string;

  /**
   * Duration in milliseconds.
   */
  duration_ms: number;
}

/**
 * Result of an acceptance test.
 */
export interface TestResult {
  /**
   * ID of the test.
   */
  test_id: string;

  /**
   * Whether the test passed.
   */
  passed: boolean;

  /**
   * Actual value observed.
   */
  actual: string;

  /**
   * Error message if failed.
   */
  error?: string;
}

/**
 * Complete evidence returned by executor.
 */
export interface ExecutionEvidence {
  /**
   * ID of the proposal that was executed.
   */
  proposal_id: ProposalId;

  /**
   * Hash of the proposal (for verification).
   */
  proposal_hash: string;

  /**
   * Results for each action.
   * ORDERING: Same order as proposal actions.
   */
  action_results: ActionResult[];

  /**
   * Results for each acceptance test.
   * ORDERING: Same order as proposal tests.
   */
  test_results: TestResult[];

  /**
   * Overall execution status.
   */
  status: 'complete' | 'partial' | 'failed';

  /**
   * Timestamp when execution started (ISO 8601).
   * Note: This is for audit only, not part of deterministic output.
   */
  started_at: string;

  /**
   * Timestamp when execution completed (ISO 8601).
   */
  completed_at: string;

  /**
   * Total duration in milliseconds.
   */
  total_duration_ms: number;

  /**
   * Executor identifier (for audit).
   */
  executor_id: string;

  /**
   * Working directory used.
   */
  working_dir: string;
}

// =============================================================================
// Proposal Generation
// =============================================================================

/**
 * Generate a proposal from a bundle.
 *
 * @param bundle - Source bundle
 * @returns Proposal for executor
 */
export function generateProposal(bundle: Bundle): Proposal {
  const actions: ProposedAction[] = [];
  const tests: AcceptanceTest[] = [];

  // Generate file creation actions from outputs
  for (let i = 0; i < bundle.outputs.length; i++) {
    const output = bundle.outputs[i]!;

    const actionContent = {
      type: 'create_file' as const,
      target: output.path,
      content: output.content,
    };
    const actionId = deriveId('act', actionContent) as ActionId;

    actions.push({
      id: actionId,
      type: 'create_file',
      target: output.path,
      content: output.content,
      expected_hash: output.content_hash,
      required: true,
      description: `Create file: ${output.path}`,
      order: i,
    });

    // Add hash verification test
    tests.push({
      id: `test_hash_${actionId}`,
      name: `Verify hash of ${output.path}`,
      type: 'hash_match',
      target: output.path,
      expected: output.content_hash,
      required: true,
    });
  }

  // Sort actions by order, then id
  actions.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Sort tests by id
  tests.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Calculate proposal confidence from bundle
  const confidence = bundle.stats.avg_terminal_density;

  // Compute bundle hash
  const bundleHash = canonicalHash(bundle);

  // Build proposal content (without ID)
  const proposalContent = {
    schema_version: SCHEMA_VERSION,
    source_bundle_id: bundle.id,
    source_bundle_hash: bundleHash,
    actions,
    acceptance_tests: tests,
    summary: generateProposalSummary(bundle, actions),
    requires_approval: bundle.status === 'incomplete' || confidence < 70,
    confidence,
  };

  // Derive proposal ID
  const id = deriveId('prop', proposalContent) as ProposalId;

  return {
    id,
    ...proposalContent,
  };
}

/**
 * Generate human-readable summary of proposal.
 */
function generateProposalSummary(bundle: Bundle, actions: ProposedAction[]): string {
  const lines: string[] = [];

  lines.push(`Proposal for: ${bundle.root_node.goal}`);
  lines.push('');
  lines.push(`Actions: ${actions.length}`);
  lines.push(`- File creations: ${actions.filter((a) => a.type === 'create_file').length}`);
  lines.push(`- Commands: ${actions.filter((a) => a.type === 'execute_command').length}`);
  lines.push('');

  if (bundle.unresolved_questions.length > 0) {
    lines.push(`WARNING: ${bundle.unresolved_questions.length} unresolved questions`);
    for (const q of bundle.unresolved_questions.slice(0, 3)) {
      lines.push(`  - ${q.text}`);
    }
    if (bundle.unresolved_questions.length > 3) {
      lines.push(`  ... and ${bundle.unresolved_questions.length - 3} more`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Evidence Validation
// =============================================================================

/**
 * Result of validating execution evidence.
 */
export interface EvidenceValidation {
  /**
   * Whether the evidence is valid.
   */
  valid: boolean;

  /**
   * Whether all required actions succeeded.
   */
  actions_passed: boolean;

  /**
   * Whether all required tests passed.
   */
  tests_passed: boolean;

  /**
   * Errors encountered.
   */
  errors: string[];

  /**
   * Warnings (non-blocking issues).
   */
  warnings: string[];

  /**
   * Recommendation: accept, reject, or review.
   */
  recommendation: 'accept' | 'reject' | 'review';
}

/**
 * Validate execution evidence against a proposal.
 *
 * @param proposal - Original proposal
 * @param evidence - Execution evidence from executor
 * @returns Validation result
 */
export function validateEvidence(
  proposal: Proposal,
  evidence: ExecutionEvidence
): EvidenceValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Verify proposal ID matches
  if (evidence.proposal_id !== proposal.id) {
    errors.push(
      `Proposal ID mismatch: expected ${proposal.id}, got ${evidence.proposal_id}`
    );
  }

  // Verify proposal hash matches
  const expectedHash = canonicalHash(proposal);
  if (evidence.proposal_hash !== expectedHash) {
    errors.push(
      `Proposal hash mismatch: expected ${expectedHash}, got ${evidence.proposal_hash}`
    );
  }

  // Check all required actions succeeded
  let actionsPass = true;
  for (const action of proposal.actions) {
    if (!action.required) continue;

    const result = evidence.action_results.find((r) => r.action_id === action.id);
    if (!result) {
      errors.push(`Missing result for required action: ${action.id}`);
      actionsPass = false;
    } else if (result.status !== 'success') {
      errors.push(`Required action failed: ${action.id} (${result.status})`);
      actionsPass = false;
    } else if (action.expected_hash && result.actual_hash !== action.expected_hash) {
      errors.push(
        `Hash mismatch for action ${action.id}: expected ${action.expected_hash}, got ${result.actual_hash}`
      );
      actionsPass = false;
    }
  }

  // Check all required tests passed
  let testsPass = true;
  for (const test of proposal.acceptance_tests) {
    if (!test.required) continue;

    const result = evidence.test_results.find((r) => r.test_id === test.id);
    if (!result) {
      errors.push(`Missing result for required test: ${test.id}`);
      testsPass = false;
    } else if (!result.passed) {
      errors.push(`Required test failed: ${test.name}`);
      testsPass = false;
    }
  }

  // Check for optional failures (warnings)
  for (const action of proposal.actions) {
    if (action.required) continue;
    const result = evidence.action_results.find((r) => r.action_id === action.id);
    if (result && result.status !== 'success') {
      warnings.push(`Optional action failed: ${action.id}`);
    }
  }

  // Determine recommendation
  let recommendation: 'accept' | 'reject' | 'review';
  if (errors.length > 0) {
    recommendation = 'reject';
  } else if (warnings.length > 0 || proposal.requires_approval) {
    recommendation = 'review';
  } else {
    recommendation = 'accept';
  }

  return {
    valid: errors.length === 0,
    actions_passed: actionsPass,
    tests_passed: testsPass,
    errors,
    warnings,
    recommendation,
  };
}
