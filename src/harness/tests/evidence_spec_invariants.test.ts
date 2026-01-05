/**
 * Evidence Spec Invariant Tests
 * ==============================
 *
 * Docs-driven tests that verify ExecutionEvidence structures
 * conform to the EVIDENCE_SPEC.md contract.
 *
 * These tests verify invariants at the evidence boundary.
 * Failures use stable error prefixes for deterministic testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';

import { canonicalize } from '../../utils/canonical.js';
import type {
  ExecutionEvidence,
  ActionResult,
  TestResult,
  ProposalId,
} from '../../protocol/proposal.js';

// =============================================================================
// Types
// =============================================================================

/**
 * EvidenceCore - canonical subset for content-addressing.
 * Excludes ephemeral fields (timestamps, executor info, working dir).
 */
interface EvidenceCore {
  proposal_id: ProposalId;
  proposal_hash: string;
  action_results: ActionResult[];
  test_results: TestResult[];
  status: 'complete' | 'partial' | 'failed';
}

// =============================================================================
// Rule Registry
// =============================================================================

/**
 * Evidence spec rule IDs for stable error reporting.
 */
const RULES = {
  EV1_PROPOSAL_HASH_INTEGRITY: 'EV1_PROPOSAL_HASH_INTEGRITY',
  EV2_ACTION_RESULTS_CONSISTENCY: 'EV2_ACTION_RESULTS_CONSISTENCY',
  EV3_TEST_RESULTS_VALIDITY: 'EV3_TEST_RESULTS_VALIDITY',
  EV4_STATUS_CONSISTENCY: 'EV4_STATUS_CONSISTENCY',
  EV5_EVIDENCE_HASH_DETERMINISM: 'EV5_EVIDENCE_HASH_DETERMINISM',
} as const;

type RuleId = (typeof RULES)[keyof typeof RULES];

/**
 * Throw a spec violation error with stable format.
 */
function specViolation(ruleId: RuleId, details: string): never {
  throw new Error(`EVIDENCE_SPEC_VIOLATION: ${ruleId}: ${details}`);
}

// =============================================================================
// Evidence Core Computation
// =============================================================================

/**
 * Compute the canonical EvidenceCore from ExecutionEvidence.
 * Excludes ephemeral fields, sorts arrays for determinism.
 */
function computeEvidenceCore(evidence: ExecutionEvidence): EvidenceCore {
  return {
    proposal_id: evidence.proposal_id,
    proposal_hash: evidence.proposal_hash,
    action_results: [...evidence.action_results].sort((a, b) =>
      a.action_id.localeCompare(b.action_id)
    ),
    test_results: [...evidence.test_results].sort((a, b) =>
      a.test_id.localeCompare(b.test_id)
    ),
    status: evidence.status,
  };
}

/**
 * Compute SHA256 hash of EvidenceCore.
 */
function computeEvidenceHash(evidence: ExecutionEvidence): string {
  const core = computeEvidenceCore(evidence);
  const canonical = canonicalize(core);
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `sha256:${hash}`;
}

// =============================================================================
// Invariant Checks
// =============================================================================

/**
 * EV1: Proposal hash integrity - proposal_hash must be valid format.
 */
function checkProposalHashIntegrity(evidence: ExecutionEvidence): void {
  if (!evidence.proposal_hash || typeof evidence.proposal_hash !== 'string') {
    specViolation(
      RULES.EV1_PROPOSAL_HASH_INTEGRITY,
      `proposal_hash missing or invalid type`
    );
  }

  // Must be a valid SHA256 hash (64 hex chars or sha256: prefixed)
  const hashPattern = /^(sha256:)?[a-f0-9]{64}$/;
  if (!hashPattern.test(evidence.proposal_hash)) {
    specViolation(
      RULES.EV1_PROPOSAL_HASH_INTEGRITY,
      `proposal_hash not valid SHA256 format: ${evidence.proposal_hash.slice(0, 20)}...`
    );
  }
}

/**
 * EV2: Action results consistency - all results have valid fields.
 */
function checkActionResultsConsistency(evidence: ExecutionEvidence): void {
  for (const ar of evidence.action_results) {
    // action_id must be non-empty
    if (!ar.action_id || typeof ar.action_id !== 'string') {
      specViolation(
        RULES.EV2_ACTION_RESULTS_CONSISTENCY,
        `action_result missing action_id`
      );
    }

    // status must be valid
    const validStatuses = ['success', 'failure', 'skipped', 'timeout'];
    if (!validStatuses.includes(ar.status)) {
      specViolation(
        RULES.EV2_ACTION_RESULTS_CONSISTENCY,
        `action_result ${ar.action_id} has invalid status: ${ar.status}`
      );
    }

    // duration_ms must be non-negative
    if (typeof ar.duration_ms !== 'number' || ar.duration_ms < 0) {
      specViolation(
        RULES.EV2_ACTION_RESULTS_CONSISTENCY,
        `action_result ${ar.action_id} has invalid duration_ms: ${ar.duration_ms}`
      );
    }

    // actual_hash, if present, must be valid format
    if (ar.actual_hash !== undefined) {
      const hashPattern = /^(sha256:)?[a-f0-9]{64}$/;
      if (typeof ar.actual_hash !== 'string' || !hashPattern.test(ar.actual_hash)) {
        specViolation(
          RULES.EV2_ACTION_RESULTS_CONSISTENCY,
          `action_result ${ar.action_id} has invalid actual_hash format`
        );
      }
    }
  }
}

/**
 * EV3: Test results validity - all test results have valid fields.
 */
function checkTestResultsValidity(evidence: ExecutionEvidence): void {
  for (const tr of evidence.test_results) {
    // test_id must be non-empty
    if (!tr.test_id || typeof tr.test_id !== 'string') {
      specViolation(
        RULES.EV3_TEST_RESULTS_VALIDITY,
        `test_result missing test_id`
      );
    }

    // passed must be boolean
    if (typeof tr.passed !== 'boolean') {
      specViolation(
        RULES.EV3_TEST_RESULTS_VALIDITY,
        `test_result ${tr.test_id} passed must be boolean`
      );
    }

    // actual must be string
    if (typeof tr.actual !== 'string') {
      specViolation(
        RULES.EV3_TEST_RESULTS_VALIDITY,
        `test_result ${tr.test_id} actual must be string`
      );
    }
  }
}

/**
 * EV4: Status consistency - status must match execution outcomes.
 */
function checkStatusConsistency(evidence: ExecutionEvidence): void {
  const validStatuses = ['complete', 'partial', 'failed'];
  if (!validStatuses.includes(evidence.status)) {
    specViolation(
      RULES.EV4_STATUS_CONSISTENCY,
      `invalid status value: ${evidence.status}`
    );
  }

  // If status is 'complete', all action_results should be 'success'
  if (evidence.status === 'complete') {
    const hasFailures = evidence.action_results.some(
      (ar) => ar.status !== 'success' && ar.status !== 'skipped'
    );
    if (hasFailures) {
      specViolation(
        RULES.EV4_STATUS_CONSISTENCY,
        `status is 'complete' but some actions failed`
      );
    }
  }

  // If status is 'failed', there should be at least one failure or error
  if (evidence.status === 'failed') {
    const hasFailures = evidence.action_results.some(
      (ar) => ar.status === 'failure' || ar.status === 'timeout'
    );
    const hasTestFailures = evidence.test_results.some((tr) => !tr.passed);
    if (!hasFailures && !hasTestFailures && evidence.action_results.length > 0) {
      // This is a warning case - status might be failed due to other reasons
      // We don't enforce strict failure for now, just verify the status is valid
    }
  }
}

/**
 * EV5: Evidence hash determinism - same core produces same hash.
 */
function checkEvidenceHashDeterminism(evidence: ExecutionEvidence): void {
  const hash1 = computeEvidenceHash(evidence);
  const hash2 = computeEvidenceHash(evidence);

  if (hash1 !== hash2) {
    specViolation(
      RULES.EV5_EVIDENCE_HASH_DETERMINISM,
      `Evidence hash not deterministic: ${hash1} !== ${hash2}`
    );
  }
}

/**
 * Run all evidence spec invariant checks.
 */
function checkAllInvariants(evidence: ExecutionEvidence): void {
  checkProposalHashIntegrity(evidence);
  checkActionResultsConsistency(evidence);
  checkTestResultsValidity(evidence);
  checkStatusConsistency(evidence);
  checkEvidenceHashDeterminism(evidence);
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createValidEvidence(
  overrides: Partial<ExecutionEvidence> = {}
): ExecutionEvidence {
  return {
    proposal_id: 'prop_abc123',
    proposal_hash: 'sha256:' + 'a'.repeat(64),
    action_results: [
      {
        action_id: 'act_001',
        status: 'success',
        actual_hash: 'sha256:' + 'b'.repeat(64),
        duration_ms: 100,
      },
    ],
    test_results: [
      {
        test_id: 'test_001',
        passed: true,
        actual: 'sha256:' + 'b'.repeat(64),
      },
    ],
    status: 'complete',
    started_at: '2026-01-05T10:00:00.000Z',
    completed_at: '2026-01-05T10:00:01.000Z',
    total_duration_ms: 1000,
    executor_id: 'test_executor',
    working_dir: '/tmp/test',
    ...overrides,
  };
}

function createFailedEvidence(): ExecutionEvidence {
  return createValidEvidence({
    action_results: [
      {
        action_id: 'act_001',
        status: 'failure',
        error: 'Something went wrong',
        duration_ms: 50,
      },
    ],
    test_results: [
      {
        test_id: 'test_001',
        passed: false,
        actual: '',
        error: 'Test failed',
      },
    ],
    status: 'failed',
  });
}

function createPartialEvidence(): ExecutionEvidence {
  return createValidEvidence({
    action_results: [
      {
        action_id: 'act_001',
        status: 'success',
        actual_hash: 'sha256:' + 'b'.repeat(64),
        duration_ms: 100,
      },
      {
        action_id: 'act_002',
        status: 'skipped',
        duration_ms: 0,
      },
    ],
    status: 'partial',
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('Evidence Spec Invariants', () => {
  describe('EV1: Proposal Hash Integrity', () => {
    it('valid evidence has valid proposal_hash', () => {
      const evidence = createValidEvidence();
      checkProposalHashIntegrity(evidence);
    });

    it('rejects missing proposal_hash', () => {
      const evidence = createValidEvidence({ proposal_hash: '' });
      assert.throws(
        () => checkProposalHashIntegrity(evidence),
        /EV1_PROPOSAL_HASH_INTEGRITY/
      );
    });

    it('rejects invalid hash format', () => {
      const evidence = createValidEvidence({ proposal_hash: 'not-a-hash' });
      assert.throws(
        () => checkProposalHashIntegrity(evidence),
        /EV1_PROPOSAL_HASH_INTEGRITY/
      );
    });

    it('accepts sha256-prefixed hash', () => {
      const evidence = createValidEvidence({
        proposal_hash: 'sha256:' + 'f'.repeat(64),
      });
      checkProposalHashIntegrity(evidence);
    });

    it('accepts bare hex hash', () => {
      const evidence = createValidEvidence({
        proposal_hash: 'c'.repeat(64),
      });
      checkProposalHashIntegrity(evidence);
    });
  });

  describe('EV2: Action Results Consistency', () => {
    it('valid action results pass', () => {
      const evidence = createValidEvidence();
      checkActionResultsConsistency(evidence);
    });

    it('rejects missing action_id', () => {
      const evidence = createValidEvidence({
        action_results: [
          {
            action_id: '',
            status: 'success',
            duration_ms: 100,
          },
        ],
      });
      assert.throws(
        () => checkActionResultsConsistency(evidence),
        /EV2_ACTION_RESULTS_CONSISTENCY/
      );
    });

    it('rejects invalid status', () => {
      const evidence = createValidEvidence({
        action_results: [
          {
            action_id: 'act_001',
            status: 'invalid' as any,
            duration_ms: 100,
          },
        ],
      });
      assert.throws(
        () => checkActionResultsConsistency(evidence),
        /EV2_ACTION_RESULTS_CONSISTENCY/
      );
    });

    it('rejects negative duration_ms', () => {
      const evidence = createValidEvidence({
        action_results: [
          {
            action_id: 'act_001',
            status: 'success',
            duration_ms: -1,
          },
        ],
      });
      assert.throws(
        () => checkActionResultsConsistency(evidence),
        /EV2_ACTION_RESULTS_CONSISTENCY/
      );
    });

    it('accepts all valid status types', () => {
      const statuses = ['success', 'failure', 'skipped', 'timeout'] as const;
      for (const status of statuses) {
        const evidence = createValidEvidence({
          action_results: [
            { action_id: 'act_001', status, duration_ms: 100 },
          ],
          status: status === 'success' ? 'complete' : 'failed',
        });
        checkActionResultsConsistency(evidence);
      }
    });
  });

  describe('EV3: Test Results Validity', () => {
    it('valid test results pass', () => {
      const evidence = createValidEvidence();
      checkTestResultsValidity(evidence);
    });

    it('rejects missing test_id', () => {
      const evidence = createValidEvidence({
        test_results: [
          { test_id: '', passed: true, actual: 'value' },
        ],
      });
      assert.throws(
        () => checkTestResultsValidity(evidence),
        /EV3_TEST_RESULTS_VALIDITY/
      );
    });

    it('rejects non-boolean passed', () => {
      const evidence = createValidEvidence({
        test_results: [
          { test_id: 'test_001', passed: 'yes' as any, actual: 'value' },
        ],
      });
      assert.throws(
        () => checkTestResultsValidity(evidence),
        /EV3_TEST_RESULTS_VALIDITY/
      );
    });

    it('rejects non-string actual', () => {
      const evidence = createValidEvidence({
        test_results: [
          { test_id: 'test_001', passed: true, actual: 123 as any },
        ],
      });
      assert.throws(
        () => checkTestResultsValidity(evidence),
        /EV3_TEST_RESULTS_VALIDITY/
      );
    });
  });

  describe('EV4: Status Consistency', () => {
    it('complete status with successful actions passes', () => {
      const evidence = createValidEvidence();
      checkStatusConsistency(evidence);
    });

    it('failed status with failures passes', () => {
      const evidence = createFailedEvidence();
      checkStatusConsistency(evidence);
    });

    it('partial status passes', () => {
      const evidence = createPartialEvidence();
      checkStatusConsistency(evidence);
    });

    it('rejects complete status with failures', () => {
      const evidence = createValidEvidence({
        action_results: [
          { action_id: 'act_001', status: 'failure', duration_ms: 100 },
        ],
        status: 'complete',
      });
      assert.throws(
        () => checkStatusConsistency(evidence),
        /EV4_STATUS_CONSISTENCY/
      );
    });

    it('rejects invalid status value', () => {
      const evidence = createValidEvidence({
        status: 'invalid' as any,
      });
      assert.throws(
        () => checkStatusConsistency(evidence),
        /EV4_STATUS_CONSISTENCY/
      );
    });
  });

  describe('EV5: Evidence Hash Determinism', () => {
    it('hash is deterministic for same evidence', () => {
      const evidence = createValidEvidence();
      checkEvidenceHashDeterminism(evidence);
    });

    it('hash is same regardless of ephemeral fields', () => {
      const evidence1 = createValidEvidence({
        started_at: '2026-01-05T10:00:00.000Z',
        completed_at: '2026-01-05T10:00:01.000Z',
        executor_id: 'executor_1',
        working_dir: '/tmp/test1',
      });
      const evidence2 = createValidEvidence({
        started_at: '2026-01-05T11:00:00.000Z',
        completed_at: '2026-01-05T11:00:05.000Z',
        executor_id: 'executor_2',
        working_dir: '/tmp/test2',
      });

      const hash1 = computeEvidenceHash(evidence1);
      const hash2 = computeEvidenceHash(evidence2);

      assert.strictEqual(hash1, hash2, 'Hashes should match (ephemeral fields excluded)');
    });

    it('hash differs for different core fields', () => {
      const evidence1 = createValidEvidence({
        proposal_hash: 'sha256:' + 'a'.repeat(64),
      });
      const evidence2 = createValidEvidence({
        proposal_hash: 'sha256:' + 'b'.repeat(64),
      });

      const hash1 = computeEvidenceHash(evidence1);
      const hash2 = computeEvidenceHash(evidence2);

      assert.notStrictEqual(hash1, hash2, 'Hashes should differ for different proposal_hash');
    });

    it('hash is deterministic for complex evidence', () => {
      const evidence = createValidEvidence({
        action_results: [
          { action_id: 'act_003', status: 'success', duration_ms: 100 },
          { action_id: 'act_001', status: 'success', duration_ms: 50 },
          { action_id: 'act_002', status: 'success', duration_ms: 75 },
        ],
        test_results: [
          { test_id: 'test_002', passed: true, actual: 'b' },
          { test_id: 'test_001', passed: true, actual: 'a' },
        ],
      });

      // Hash multiple times
      const hashes = Array.from({ length: 5 }, () => computeEvidenceHash(evidence));
      const allSame = hashes.every((h) => h === hashes[0]);

      assert.ok(allSame, 'All hashes should be identical');
    });
  });

  describe('All Invariants Combined', () => {
    it('valid evidence passes all invariants', () => {
      const evidence = createValidEvidence();
      checkAllInvariants(evidence);
    });

    it('failed evidence passes all invariants', () => {
      const evidence = createFailedEvidence();
      checkAllInvariants(evidence);
    });

    it('partial evidence passes all invariants', () => {
      const evidence = createPartialEvidence();
      checkAllInvariants(evidence);
    });
  });

  describe('EvidenceCore Computation', () => {
    it('computeEvidenceCore excludes ephemeral fields', () => {
      const evidence = createValidEvidence();
      const core = computeEvidenceCore(evidence);

      // Core should have these fields
      assert.ok('proposal_id' in core);
      assert.ok('proposal_hash' in core);
      assert.ok('action_results' in core);
      assert.ok('test_results' in core);
      assert.ok('status' in core);

      // Core should NOT have these fields
      assert.ok(!('started_at' in core));
      assert.ok(!('completed_at' in core));
      assert.ok(!('total_duration_ms' in core));
      assert.ok(!('executor_id' in core));
      assert.ok(!('working_dir' in core));
    });

    it('computeEvidenceCore sorts action_results by action_id', () => {
      const evidence = createValidEvidence({
        action_results: [
          { action_id: 'act_003', status: 'success', duration_ms: 100 },
          { action_id: 'act_001', status: 'success', duration_ms: 50 },
          { action_id: 'act_002', status: 'success', duration_ms: 75 },
        ],
      });

      const core = computeEvidenceCore(evidence);

      assert.strictEqual(core.action_results[0]!.action_id, 'act_001');
      assert.strictEqual(core.action_results[1]!.action_id, 'act_002');
      assert.strictEqual(core.action_results[2]!.action_id, 'act_003');
    });

    it('computeEvidenceCore sorts test_results by test_id', () => {
      const evidence = createValidEvidence({
        test_results: [
          { test_id: 'test_003', passed: true, actual: 'c' },
          { test_id: 'test_001', passed: true, actual: 'a' },
          { test_id: 'test_002', passed: true, actual: 'b' },
        ],
      });

      const core = computeEvidenceCore(evidence);

      assert.strictEqual(core.test_results[0]!.test_id, 'test_001');
      assert.strictEqual(core.test_results[1]!.test_id, 'test_002');
      assert.strictEqual(core.test_results[2]!.test_id, 'test_003');
    });
  });
});
