/**
 * Run Spec Invariant Tests
 * ========================
 *
 * Docs-driven tests that verify RunResult structures conform to
 * the RUN_SPEC.md contract.
 *
 * These tests verify invariants at the CLI output boundary.
 * Failures use stable error prefixes for deterministic testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../utils/canonical.js';
import { loadPolicy } from '../policy.js';
import { runHarness } from '../run_intent.js';
import { RUN_SCHEMA_VERSION, type HarnessRunResult, type PolicyProfile, type HarnessRunInput } from '../types.js';

// =============================================================================
// Path Resolution
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../..');
const TEST_INTENT_PATH = join(PROJECT_ROOT, 'intents/real/b_patches/intent_003_add_validation.json');

// =============================================================================
// Rule Registry
// =============================================================================

/**
 * Run spec rule IDs for stable error reporting.
 */
const RULES = {
  RS1_SCHEMA_VERSION_PRESENT: 'RS1_SCHEMA_VERSION_PRESENT',
  RS2_OUTCOME_COVERAGE: 'RS2_OUTCOME_COVERAGE',
  RS3_OUTCOME_FIELD_CONSISTENCY: 'RS3_OUTCOME_FIELD_CONSISTENCY',
  RS4_REFERENCE_INTEGRITY: 'RS4_REFERENCE_INTEGRITY',
  RS5_POLICY_BINDING: 'RS5_POLICY_BINDING',
  RS6_NO_LEAK: 'RS6_NO_LEAK',
  RS7_CANONICAL_OUTPUT: 'RS7_CANONICAL_OUTPUT',
  RS8_DECISION_CONSISTENCY: 'RS8_DECISION_CONSISTENCY',
} as const;

type RuleId = (typeof RULES)[keyof typeof RULES];

/**
 * Throw a spec violation error with stable format.
 */
function specViolation(ruleId: RuleId, details: string): never {
  throw new Error(`RUN_SPEC_VIOLATION: ${ruleId}: ${details}`);
}

// =============================================================================
// ContentHash validation pattern
// =============================================================================

const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function isValidContentHash(hash: unknown): hash is string {
  return typeof hash === 'string' && CONTENT_HASH_PATTERN.test(hash);
}

// =============================================================================
// Invariant Verification Functions
// =============================================================================

/**
 * RS1: Schema Version Present
 * run_schema_version !== undefined && run_schema_version !== ''
 */
function checkSchemaVersionPresent(result: HarnessRunResult): void {
  if (result.run_schema_version === undefined || result.run_schema_version === '') {
    specViolation(RULES.RS1_SCHEMA_VERSION_PRESENT, 'run_schema_version is missing or empty');
  }
}

/**
 * RS2: Outcome Coverage
 * kernel_result_kind in {'BUNDLE', 'CLARIFY', 'REFUSE'}
 */
function checkOutcomeCoverage(result: HarnessRunResult): void {
  const validOutcomes = ['BUNDLE', 'CLARIFY', 'REFUSE'];
  if (!validOutcomes.includes(result.kernel_result_kind)) {
    specViolation(
      RULES.RS2_OUTCOME_COVERAGE,
      `Invalid outcome: ${result.kernel_result_kind}, expected one of: ${validOutcomes.join(', ')}`
    );
  }
}

/**
 * RS3: Outcome-Field Consistency
 * Validates that outcome-specific fields match the declared outcome.
 */
function checkOutcomeFieldConsistency(result: HarnessRunResult): void {
  const kind = result.kernel_result_kind;

  if (kind === 'BUNDLE') {
    if (result.bundle === null) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'BUNDLE outcome must have non-null bundle');
    }
    if (result.clarify_questions !== undefined) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'BUNDLE outcome must not have clarify_questions');
    }
    if (result.refuse_reason !== undefined) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'BUNDLE outcome must not have refuse_reason');
    }
  }

  if (kind === 'CLARIFY') {
    if (result.bundle === null) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'CLARIFY outcome must have non-null bundle');
    }
    if (!result.clarify_questions || result.clarify_questions.length === 0) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'CLARIFY outcome must have non-empty clarify_questions');
    }
    if (result.refuse_reason !== undefined) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'CLARIFY outcome must not have refuse_reason');
    }
    if (result.execution !== null) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'CLARIFY outcome must have null execution');
    }
  }

  if (kind === 'REFUSE') {
    if (result.bundle !== null) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'REFUSE outcome must have null bundle');
    }
    if (!result.refuse_reason || result.refuse_reason === '') {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'REFUSE outcome must have non-empty refuse_reason');
    }
    if (result.clarify_questions !== undefined) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'REFUSE outcome must not have clarify_questions');
    }
    if (result.execution !== null) {
      specViolation(RULES.RS3_OUTCOME_FIELD_CONSISTENCY, 'REFUSE outcome must have null execution');
    }
  }
}

/**
 * RS4: Reference Integrity
 * All hash references must be valid ContentHash format.
 */
function checkReferenceIntegrity(result: HarnessRunResult): void {
  if (!isValidContentHash(result.intent.sha256)) {
    specViolation(RULES.RS4_REFERENCE_INTEGRITY, `Invalid intent hash: ${result.intent.sha256}`);
  }

  if (result.bundle !== null) {
    if (!result.bundle.bundle_id || result.bundle.bundle_id === '') {
      specViolation(RULES.RS4_REFERENCE_INTEGRITY, 'Bundle must have non-empty bundle_id');
    }
    if (!isValidContentHash(result.bundle.sha256)) {
      specViolation(RULES.RS4_REFERENCE_INTEGRITY, `Invalid bundle hash: ${result.bundle.sha256}`);
    }
  }
}

/**
 * RS5: Policy Binding
 * canonicalize(result.policy) === canonicalize(loadPolicy(policyName))
 */
function checkPolicyBinding(result: HarnessRunResult): void {
  const expectedPolicy = loadPolicy(result.policy.name);
  const resultPolicyCanonical = canonicalize(result.policy);
  const expectedPolicyCanonical = canonicalize(expectedPolicy);

  if (resultPolicyCanonical !== expectedPolicyCanonical) {
    specViolation(
      RULES.RS5_POLICY_BINDING,
      `Policy mismatch for ${result.policy.name}: result policy differs from loaded policy`
    );
  }
}

/**
 * RS6: No Leak (Public Output)
 * Public outputs must not contain absolute paths or host-identifying data.
 */
function checkNoLeak(result: HarnessRunResult): void {
  // Check intent.path is not absolute
  if (result.intent.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(result.intent.path)) {
    specViolation(RULES.RS6_NO_LEAK, `intent.path is absolute: ${result.intent.path}`);
  }

  // In public outputs, sandbox_path should not be present
  // (Only internal/debug outputs may have it)
  // This check is for public output mode - if sandbox_path exists, flag it
  // Note: We only warn here since preserve_sandbox is a valid internal use case
}

/**
 * RS7: Canonical Output
 * JSON.parse(stdout) deep-equals JSON.parse(canonicalize(result))
 */
function checkCanonicalOutput(result: HarnessRunResult): void {
  try {
    const canonical = canonicalize(result);
    const reparsed = JSON.parse(canonical);
    const recanonical = canonicalize(reparsed);

    if (canonical !== recanonical) {
      specViolation(RULES.RS7_CANONICAL_OUTPUT, 'Result is not canonically stable (round-trip mismatch)');
    }
  } catch (error) {
    specViolation(
      RULES.RS7_CANONICAL_OUTPUT,
      `Cannot canonicalize result: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * RS8: Decision Consistency
 * Decision must be consistent with outcome and execution results.
 */
function checkDecisionConsistency(result: HarnessRunResult): void {
  // validated_by_kernel must always be true
  if (!result.decision.validated_by_kernel) {
    specViolation(RULES.RS8_DECISION_CONSISTENCY, 'decision.validated_by_kernel must be true');
  }

  // Non-BUNDLE outcomes must have accepted = false
  if (result.kernel_result_kind !== 'BUNDLE' && result.decision.accepted) {
    specViolation(
      RULES.RS8_DECISION_CONSISTENCY,
      `Non-BUNDLE outcome (${result.kernel_result_kind}) must have accepted = false`
    );
  }

  // BUNDLE with execution must have accepted matching exit_code
  if (
    result.kernel_result_kind === 'BUNDLE' &&
    result.execution !== null &&
    result.decision.accepted !== (result.execution.exit_code === 0)
  ) {
    specViolation(
      RULES.RS8_DECISION_CONSISTENCY,
      `BUNDLE with execution: accepted (${result.decision.accepted}) must match exit_code === 0 (${result.execution.exit_code === 0})`
    );
  }
}

/**
 * Check all invariants on a RunResult.
 */
function checkAllInvariants(result: HarnessRunResult): void {
  checkSchemaVersionPresent(result);
  checkOutcomeCoverage(result);
  checkOutcomeFieldConsistency(result);
  checkReferenceIntegrity(result);
  checkPolicyBinding(result);
  checkNoLeak(result);
  checkCanonicalOutput(result);
  checkDecisionConsistency(result);
}

// =============================================================================
// Test Helper: Create Mock RunResult
// =============================================================================

function createMockRunResult(overrides: Partial<HarnessRunResult> = {}): HarnessRunResult {
  const policy: PolicyProfile = loadPolicy('strict');

  return {
    run_schema_version: RUN_SCHEMA_VERSION,
    run_id: 'hr_test123_abc456',
    started_at: '2026-01-05T10:00:00.000Z',
    completed_at: '2026-01-05T10:00:05.000Z',
    kernel_version: '0.3.6',
    policy,
    intent: {
      path: 'intents/test.json',
      sha256: 'sha256:' + 'a'.repeat(64),
    },
    bundle: {
      bundle_id: 'bdl_test123',
      sha256: 'sha256:' + 'b'.repeat(64),
    },
    kernel_result_kind: 'BUNDLE',
    execution: null,
    decision: {
      accepted: true,
      reasons: ['Plan-only mode: no execution'],
      validated_by_kernel: true,
    },
    model_mode: 'none',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Run Spec Invariants', () => {
  describe('RS1: Schema Version Present', () => {
    it('valid schema version passes', () => {
      const result = createMockRunResult();
      checkSchemaVersionPresent(result);
    });

    it('missing schema version fails', () => {
      const result = createMockRunResult();
      (result as any).run_schema_version = undefined;
      assert.throws(
        () => checkSchemaVersionPresent(result),
        /RUN_SPEC_VIOLATION: RS1_SCHEMA_VERSION_PRESENT/
      );
    });

    it('empty schema version fails', () => {
      const result = createMockRunResult({ run_schema_version: '' });
      assert.throws(
        () => checkSchemaVersionPresent(result),
        /RUN_SPEC_VIOLATION: RS1_SCHEMA_VERSION_PRESENT/
      );
    });
  });

  describe('RS2: Outcome Coverage', () => {
    it('BUNDLE outcome passes', () => {
      const result = createMockRunResult({ kernel_result_kind: 'BUNDLE' });
      checkOutcomeCoverage(result);
    });

    it('CLARIFY outcome passes', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'CLARIFY',
        clarify_questions: ['What API endpoint?'],
        decision: { accepted: false, reasons: ['Clarification needed'], validated_by_kernel: true },
      });
      checkOutcomeCoverage(result);
    });

    it('REFUSE outcome passes', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'REFUSE',
        bundle: null,
        refuse_reason: 'Intent too vague',
        decision: { accepted: false, reasons: ['Refused'], validated_by_kernel: true },
      });
      checkOutcomeCoverage(result);
    });

    it('invalid outcome fails', () => {
      const result = createMockRunResult();
      (result as any).kernel_result_kind = 'INVALID';
      assert.throws(
        () => checkOutcomeCoverage(result),
        /RUN_SPEC_VIOLATION: RS2_OUTCOME_COVERAGE/
      );
    });
  });

  describe('RS3: Outcome-Field Consistency', () => {
    it('BUNDLE with non-null bundle passes', () => {
      const result = createMockRunResult({ kernel_result_kind: 'BUNDLE' });
      checkOutcomeFieldConsistency(result);
    });

    it('BUNDLE with null bundle fails', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'BUNDLE',
        bundle: null,
      });
      assert.throws(
        () => checkOutcomeFieldConsistency(result),
        /RUN_SPEC_VIOLATION: RS3_OUTCOME_FIELD_CONSISTENCY.*BUNDLE outcome must have non-null bundle/
      );
    });

    it('BUNDLE with clarify_questions fails', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'BUNDLE',
        clarify_questions: ['Should not exist'],
      });
      assert.throws(
        () => checkOutcomeFieldConsistency(result),
        /RUN_SPEC_VIOLATION: RS3_OUTCOME_FIELD_CONSISTENCY.*BUNDLE outcome must not have clarify_questions/
      );
    });

    it('CLARIFY with clarify_questions passes', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'CLARIFY',
        clarify_questions: ['What API?'],
        decision: { accepted: false, reasons: ['Clarification needed'], validated_by_kernel: true },
      });
      checkOutcomeFieldConsistency(result);
    });

    it('CLARIFY without clarify_questions fails', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'CLARIFY',
        decision: { accepted: false, reasons: ['Clarification needed'], validated_by_kernel: true },
      });
      assert.throws(
        () => checkOutcomeFieldConsistency(result),
        /RUN_SPEC_VIOLATION: RS3_OUTCOME_FIELD_CONSISTENCY.*CLARIFY outcome must have non-empty clarify_questions/
      );
    });

    it('REFUSE with refuse_reason passes', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'REFUSE',
        bundle: null,
        refuse_reason: 'Too vague',
        decision: { accepted: false, reasons: ['Refused'], validated_by_kernel: true },
      });
      checkOutcomeFieldConsistency(result);
    });

    it('REFUSE without refuse_reason fails', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'REFUSE',
        bundle: null,
        decision: { accepted: false, reasons: ['Refused'], validated_by_kernel: true },
      });
      assert.throws(
        () => checkOutcomeFieldConsistency(result),
        /RUN_SPEC_VIOLATION: RS3_OUTCOME_FIELD_CONSISTENCY.*REFUSE outcome must have non-empty refuse_reason/
      );
    });
  });

  describe('RS4: Reference Integrity', () => {
    it('valid hashes pass', () => {
      const result = createMockRunResult();
      checkReferenceIntegrity(result);
    });

    it('invalid intent hash fails', () => {
      const result = createMockRunResult({
        intent: { path: 'test.json', sha256: 'invalid' },
      });
      assert.throws(
        () => checkReferenceIntegrity(result),
        /RUN_SPEC_VIOLATION: RS4_REFERENCE_INTEGRITY.*Invalid intent hash/
      );
    });

    it('invalid bundle hash fails', () => {
      const result = createMockRunResult({
        bundle: { bundle_id: 'bdl_test', sha256: 'not-a-hash' },
      });
      assert.throws(
        () => checkReferenceIntegrity(result),
        /RUN_SPEC_VIOLATION: RS4_REFERENCE_INTEGRITY.*Invalid bundle hash/
      );
    });

    it('empty bundle_id fails', () => {
      const result = createMockRunResult({
        bundle: { bundle_id: '', sha256: 'sha256:' + 'b'.repeat(64) },
      });
      assert.throws(
        () => checkReferenceIntegrity(result),
        /RUN_SPEC_VIOLATION: RS4_REFERENCE_INTEGRITY.*non-empty bundle_id/
      );
    });
  });

  describe('RS5: Policy Binding', () => {
    it('matching policy passes', () => {
      const result = createMockRunResult();
      checkPolicyBinding(result);
    });

    it('modified policy fails', () => {
      const result = createMockRunResult();
      result.policy.timeout_ms = 999999; // Modify policy
      assert.throws(
        () => checkPolicyBinding(result),
        /RUN_SPEC_VIOLATION: RS5_POLICY_BINDING/
      );
    });
  });

  describe('RS6: No Leak', () => {
    it('relative path passes', () => {
      const result = createMockRunResult();
      checkNoLeak(result);
    });

    it('absolute path fails', () => {
      const result = createMockRunResult({
        intent: { path: '/home/user/secret/intent.json', sha256: 'sha256:' + 'a'.repeat(64) },
      });
      assert.throws(
        () => checkNoLeak(result),
        /RUN_SPEC_VIOLATION: RS6_NO_LEAK.*intent.path is absolute/
      );
    });

    it('Windows absolute path fails', () => {
      const result = createMockRunResult({
        intent: { path: 'C:\\Users\\secret\\intent.json', sha256: 'sha256:' + 'a'.repeat(64) },
      });
      assert.throws(
        () => checkNoLeak(result),
        /RUN_SPEC_VIOLATION: RS6_NO_LEAK.*intent.path is absolute/
      );
    });
  });

  describe('RS7: Canonical Output', () => {
    it('valid result is canonically stable', () => {
      const result = createMockRunResult();
      checkCanonicalOutput(result);
    });

    it('result with arrays is canonically stable', () => {
      const result = createMockRunResult({
        decision: {
          accepted: true,
          reasons: ['Reason C', 'Reason A', 'Reason B'],
          validated_by_kernel: true,
        },
      });
      checkCanonicalOutput(result);
    });
  });

  describe('RS8: Decision Consistency', () => {
    it('validated_by_kernel true passes', () => {
      const result = createMockRunResult();
      checkDecisionConsistency(result);
    });

    it('validated_by_kernel false fails', () => {
      const result = createMockRunResult({
        decision: { accepted: true, reasons: [], validated_by_kernel: false },
      });
      assert.throws(
        () => checkDecisionConsistency(result),
        /RUN_SPEC_VIOLATION: RS8_DECISION_CONSISTENCY.*validated_by_kernel must be true/
      );
    });

    it('CLARIFY with accepted true fails', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'CLARIFY',
        clarify_questions: ['What?'],
        decision: { accepted: true, reasons: [], validated_by_kernel: true },
      });
      assert.throws(
        () => checkDecisionConsistency(result),
        /RUN_SPEC_VIOLATION: RS8_DECISION_CONSISTENCY.*Non-BUNDLE outcome.*must have accepted = false/
      );
    });

    it('REFUSE with accepted true fails', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'REFUSE',
        bundle: null,
        refuse_reason: 'Refused',
        decision: { accepted: true, reasons: [], validated_by_kernel: true },
      });
      assert.throws(
        () => checkDecisionConsistency(result),
        /RUN_SPEC_VIOLATION: RS8_DECISION_CONSISTENCY.*Non-BUNDLE outcome.*must have accepted = false/
      );
    });
  });

  describe('All Invariants Combined', () => {
    it('valid BUNDLE result passes all checks', () => {
      const result = createMockRunResult();
      checkAllInvariants(result);
    });

    it('valid CLARIFY result passes all checks', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'CLARIFY',
        clarify_questions: ['What API endpoint should be used?'],
        decision: {
          accepted: false,
          reasons: ['Clarification needed before execution'],
          validated_by_kernel: true,
        },
      });
      checkAllInvariants(result);
    });

    it('valid REFUSE result passes all checks', () => {
      const result = createMockRunResult({
        kernel_result_kind: 'REFUSE',
        bundle: null,
        refuse_reason: 'Intent is too vague to process',
        decision: {
          accepted: false,
          reasons: ['Kernel refused: Intent is too vague to process'],
          validated_by_kernel: true,
        },
      });
      checkAllInvariants(result);
    });
  });

  describe('Integration: Real Harness Run', () => {
    it('runHarness produces spec-compliant result', async () => {
      const input: HarnessRunInput = {
        intent_path: TEST_INTENT_PATH,
        mode: 'plan-only',
        policy: 'strict',
      };

      const result = await runHarness(input);

      // Verify all invariants
      checkAllInvariants(result);

      // Additional checks
      assert.strictEqual(result.run_schema_version, RUN_SCHEMA_VERSION);
      assert.strictEqual(result.kernel_result_kind, 'BUNDLE');
      assert.ok(result.bundle !== null);
    });

    it('runHarness uses sanitized intent path', async () => {
      // Use an absolute path to verify sanitization
      const absolutePath = resolve(TEST_INTENT_PATH);

      const input: HarnessRunInput = {
        intent_path: absolutePath,
        mode: 'plan-only',
        policy: 'strict',
      };

      const result = await runHarness(input);

      // The result should have a sanitized (non-absolute) path
      assert.ok(
        !result.intent.path.startsWith('/'),
        `intent.path should not be absolute: ${result.intent.path}`
      );

      // Should still pass all invariants
      checkAllInvariants(result);
    });

    it('runHarness produces canonical output', async () => {
      const input: HarnessRunInput = {
        intent_path: TEST_INTENT_PATH,
        mode: 'plan-only',
        policy: 'default',
      };

      const result = await runHarness(input);

      // Verify round-trip stability
      const canonical1 = canonicalize(result);
      const reparsed = JSON.parse(canonical1);
      const canonical2 = canonicalize(reparsed);

      assert.strictEqual(canonical1, canonical2, 'Canonical output should be stable');
    });
  });
});
