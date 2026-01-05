/**
 * Policy Spec Invariant Tests
 * ============================
 *
 * Docs-driven tests that verify PolicyProfile structures and policy enforcement
 * conform to the POLICY_SPEC.md contract.
 *
 * These tests verify invariants at the policy boundary.
 * Failures use stable error prefixes for deterministic testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from '../../utils/canonical.js';
import {
  loadPolicy,
  listPolicies,
  isModelModeAllowed,
  isCommandAllowed,
  isWritePathAllowed,
  validateModelMode,
} from '../policy.js';
import { runHarness } from '../run_intent.js';
import type { PolicyProfile, PolicyProfileName, ModelMode, HarnessRunInput } from '../types.js';

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
 * Policy spec rule IDs for stable error reporting.
 */
const RULES = {
  PL1_PROFILE_ENUM: 'PL1_PROFILE_ENUM',
  PL2_RESOLVED_COMPLETE: 'PL2_RESOLVED_COMPLETE',
  PL3_LIMITS_WITHIN_BOUNDS: 'PL3_LIMITS_WITHIN_BOUNDS',
  PL4_MODEL_MODE_STRICT_DEFAULT: 'PL4_MODEL_MODE_STRICT_DEFAULT',
  PL5_MODEL_MODE_DEV: 'PL5_MODEL_MODE_DEV',
  PL6_SANDBOX_CONSTRAINTS: 'PL6_SANDBOX_CONSTRAINTS',
  PL7_EVIDENCE_POLICY_BINDING: 'PL7_EVIDENCE_POLICY_BINDING',
} as const;

type RuleId = (typeof RULES)[keyof typeof RULES];

/**
 * Throw a spec violation error with stable format.
 */
function specViolation(ruleId: RuleId, details: string): never {
  throw new Error(`POLICY_SPEC_VIOLATION: ${ruleId}: ${details}`);
}

// =============================================================================
// Limit Bounds (from POLICY_SPEC.md)
// =============================================================================

const LIMIT_BOUNDS = {
  timeout_ms: { min: 1000, max: 600000 },
  max_output_files: { min: 1, max: 10000 },
  max_total_output_bytes: { min: 1024, max: 1073741824 },
} as const;

// =============================================================================
// Expected Profile Values (from POLICY_SPEC.md)
// =============================================================================

const EXPECTED_PROFILES: Record<PolicyProfileName, PolicyProfile> = {
  strict: {
    name: 'strict',
    allow_network: false,
    timeout_ms: 30000,
    max_output_files: 200,
    max_total_output_bytes: 10 * 1024 * 1024, // 10 MB
    allowed_commands: ['node', 'npm'],
    allowed_write_roots: ['out', 'dist', 'build'],
  },
  default: {
    name: 'default',
    allow_network: false,
    timeout_ms: 60000,
    max_output_files: 500,
    max_total_output_bytes: 50 * 1024 * 1024, // 50 MB
    allowed_commands: ['node', 'npm', 'npx'],
    allowed_write_roots: ['out', 'dist', 'build', 'tmp'],
  },
  dev: {
    name: 'dev',
    allow_network: false,
    timeout_ms: 300000,
    max_output_files: 1000,
    max_total_output_bytes: 100 * 1024 * 1024, // 100 MB
    allowed_commands: [],
    allowed_write_roots: [],
  },
};

// =============================================================================
// Invariant Checks
// =============================================================================

/**
 * PL1: Verify profile name is in valid enum.
 */
function checkProfileEnum(policy: PolicyProfile): void {
  const validNames: PolicyProfileName[] = ['strict', 'default', 'dev'];
  if (!validNames.includes(policy.name)) {
    specViolation(RULES.PL1_PROFILE_ENUM, `Invalid profile name: ${policy.name}`);
  }
}

/**
 * PL2: Verify all required fields are present.
 */
function checkResolvedComplete(policy: PolicyProfile): void {
  const requiredFields = [
    'name',
    'allow_network',
    'timeout_ms',
    'max_output_files',
    'max_total_output_bytes',
    'allowed_commands',
    'allowed_write_roots',
  ];

  for (const field of requiredFields) {
    const value = (policy as unknown as Record<string, unknown>)[field];
    if (value === undefined) {
      specViolation(RULES.PL2_RESOLVED_COMPLETE, `Missing field: ${field}`);
    }
  }

  // Verify array fields are arrays
  if (!Array.isArray(policy.allowed_commands)) {
    specViolation(RULES.PL2_RESOLVED_COMPLETE, 'allowed_commands must be array');
  }
  if (!Array.isArray(policy.allowed_write_roots)) {
    specViolation(RULES.PL2_RESOLVED_COMPLETE, 'allowed_write_roots must be array');
  }
}

/**
 * PL3: Verify numeric limits are within documented bounds.
 */
function checkLimitsWithinBounds(policy: PolicyProfile): void {
  // timeout_ms
  if (policy.timeout_ms < LIMIT_BOUNDS.timeout_ms.min) {
    specViolation(
      RULES.PL3_LIMITS_WITHIN_BOUNDS,
      `timeout_ms ${policy.timeout_ms} below min ${LIMIT_BOUNDS.timeout_ms.min}`
    );
  }
  if (policy.timeout_ms > LIMIT_BOUNDS.timeout_ms.max) {
    specViolation(
      RULES.PL3_LIMITS_WITHIN_BOUNDS,
      `timeout_ms ${policy.timeout_ms} above max ${LIMIT_BOUNDS.timeout_ms.max}`
    );
  }

  // max_output_files
  if (policy.max_output_files < LIMIT_BOUNDS.max_output_files.min) {
    specViolation(
      RULES.PL3_LIMITS_WITHIN_BOUNDS,
      `max_output_files ${policy.max_output_files} below min ${LIMIT_BOUNDS.max_output_files.min}`
    );
  }
  if (policy.max_output_files > LIMIT_BOUNDS.max_output_files.max) {
    specViolation(
      RULES.PL3_LIMITS_WITHIN_BOUNDS,
      `max_output_files ${policy.max_output_files} above max ${LIMIT_BOUNDS.max_output_files.max}`
    );
  }

  // max_total_output_bytes
  if (policy.max_total_output_bytes < LIMIT_BOUNDS.max_total_output_bytes.min) {
    specViolation(
      RULES.PL3_LIMITS_WITHIN_BOUNDS,
      `max_total_output_bytes ${policy.max_total_output_bytes} below min ${LIMIT_BOUNDS.max_total_output_bytes.min}`
    );
  }
  if (policy.max_total_output_bytes > LIMIT_BOUNDS.max_total_output_bytes.max) {
    specViolation(
      RULES.PL3_LIMITS_WITHIN_BOUNDS,
      `max_total_output_bytes ${policy.max_total_output_bytes} above max ${LIMIT_BOUNDS.max_total_output_bytes.max}`
    );
  }
}

/**
 * Run all policy invariant checks.
 */
function checkAllInvariants(policy: PolicyProfile): void {
  checkProfileEnum(policy);
  checkResolvedComplete(policy);
  checkLimitsWithinBounds(policy);
}

// =============================================================================
// Tests
// =============================================================================

describe('Policy Spec Invariants', () => {
  describe('PL1: Profile Enum', () => {
    it('strict profile has valid name', () => {
      const policy = loadPolicy('strict');
      checkProfileEnum(policy);
      assert.strictEqual(policy.name, 'strict');
    });

    it('default profile has valid name', () => {
      const policy = loadPolicy('default');
      checkProfileEnum(policy);
      assert.strictEqual(policy.name, 'default');
    });

    it('dev profile has valid name', () => {
      const policy = loadPolicy('dev');
      checkProfileEnum(policy);
      assert.strictEqual(policy.name, 'dev');
    });

    it('listPolicies returns all three profiles', () => {
      const policies = listPolicies();
      assert.deepStrictEqual(policies.sort(), ['default', 'dev', 'strict']);
    });
  });

  describe('PL2: Resolved Complete', () => {
    it('strict profile is fully populated', () => {
      const policy = loadPolicy('strict');
      checkResolvedComplete(policy);
    });

    it('default profile is fully populated', () => {
      const policy = loadPolicy('default');
      checkResolvedComplete(policy);
    });

    it('dev profile is fully populated', () => {
      const policy = loadPolicy('dev');
      checkResolvedComplete(policy);
    });

    it('all profiles have no undefined values', () => {
      for (const name of listPolicies()) {
        const policy = loadPolicy(name);
        const json = JSON.stringify(policy);
        assert.ok(!json.includes('undefined'), `${name} has undefined values`);
      }
    });
  });

  describe('PL3: Limits Within Bounds', () => {
    it('strict profile limits are within bounds', () => {
      const policy = loadPolicy('strict');
      checkLimitsWithinBounds(policy);
    });

    it('default profile limits are within bounds', () => {
      const policy = loadPolicy('default');
      checkLimitsWithinBounds(policy);
    });

    it('dev profile limits are within bounds', () => {
      const policy = loadPolicy('dev');
      checkLimitsWithinBounds(policy);
    });

    it('strict has most restrictive timeout', () => {
      const strict = loadPolicy('strict');
      const defaultP = loadPolicy('default');
      const dev = loadPolicy('dev');

      assert.ok(strict.timeout_ms <= defaultP.timeout_ms);
      assert.ok(defaultP.timeout_ms <= dev.timeout_ms);
    });

    it('strict has most restrictive file limits', () => {
      const strict = loadPolicy('strict');
      const defaultP = loadPolicy('default');
      const dev = loadPolicy('dev');

      assert.ok(strict.max_output_files <= defaultP.max_output_files);
      assert.ok(defaultP.max_output_files <= dev.max_output_files);
    });

    it('strict has most restrictive byte limits', () => {
      const strict = loadPolicy('strict');
      const defaultP = loadPolicy('default');
      const dev = loadPolicy('dev');

      assert.ok(strict.max_total_output_bytes <= defaultP.max_total_output_bytes);
      assert.ok(defaultP.max_total_output_bytes <= dev.max_total_output_bytes);
    });
  });

  describe('PL4: Model Mode Strict/Default', () => {
    it('strict allows only none mode', () => {
      const policy = loadPolicy('strict');
      assert.ok(isModelModeAllowed('none', policy));
      assert.ok(!isModelModeAllowed('record', policy));
      assert.ok(!isModelModeAllowed('replay', policy));
    });

    it('default allows only none mode', () => {
      const policy = loadPolicy('default');
      assert.ok(isModelModeAllowed('none', policy));
      assert.ok(!isModelModeAllowed('record', policy));
      assert.ok(!isModelModeAllowed('replay', policy));
    });

    it('strict rejects record with PL4 error', () => {
      const policy = loadPolicy('strict');
      assert.throws(
        () => validateModelMode('record', policy),
        /POLICY_VIOLATION: PL4:.*record.*not allowed.*strict/
      );
    });

    it('strict rejects replay with PL4 error', () => {
      const policy = loadPolicy('strict');
      assert.throws(
        () => validateModelMode('replay', policy),
        /POLICY_VIOLATION: PL4:.*replay.*not allowed.*strict/
      );
    });

    it('default rejects record with PL4 error', () => {
      const policy = loadPolicy('default');
      assert.throws(
        () => validateModelMode('record', policy),
        /POLICY_VIOLATION: PL4:.*record.*not allowed.*default/
      );
    });

    it('default rejects replay with PL4 error', () => {
      const policy = loadPolicy('default');
      assert.throws(
        () => validateModelMode('replay', policy),
        /POLICY_VIOLATION: PL4:.*replay.*not allowed.*default/
      );
    });

    it('error message is stable and deterministic', () => {
      const policy = loadPolicy('strict');
      let error1: string | undefined;
      let error2: string | undefined;

      try {
        validateModelMode('record', policy);
      } catch (e) {
        error1 = (e as Error).message;
      }

      try {
        validateModelMode('record', policy);
      } catch (e) {
        error2 = (e as Error).message;
      }

      assert.strictEqual(error1, error2);
      assert.ok(error1?.startsWith('POLICY_VIOLATION: PL4:'));
    });
  });

  describe('PL5: Model Mode Dev', () => {
    it('dev allows all modes', () => {
      const policy = loadPolicy('dev');
      assert.ok(isModelModeAllowed('none', policy));
      assert.ok(isModelModeAllowed('record', policy));
      assert.ok(isModelModeAllowed('replay', policy));
    });

    it('dev none mode requires no recording path', () => {
      const policy = loadPolicy('dev');
      // Should not throw
      validateModelMode('none', policy);
    });

    it('dev record mode requires recording path', () => {
      const policy = loadPolicy('dev');
      assert.throws(
        () => validateModelMode('record', policy),
        /POLICY_VIOLATION: PL5:.*record.*requires recording path/
      );
    });

    it('dev replay mode requires recording path', () => {
      const policy = loadPolicy('dev');
      assert.throws(
        () => validateModelMode('replay', policy),
        /POLICY_VIOLATION: PL5:.*replay.*requires recording path/
      );
    });

    it('dev record mode with path passes', () => {
      const policy = loadPolicy('dev');
      // Should not throw when path is provided
      validateModelMode('record', policy, '/path/to/recording.jsonl');
    });

    it('dev replay mode with path passes', () => {
      const policy = loadPolicy('dev');
      // Should not throw when path is provided
      validateModelMode('replay', policy, '/path/to/recording.jsonl');
    });

    it('PL5 error message is stable', () => {
      const policy = loadPolicy('dev');
      let error1: string | undefined;
      let error2: string | undefined;

      try {
        validateModelMode('record', policy);
      } catch (e) {
        error1 = (e as Error).message;
      }

      try {
        validateModelMode('record', policy);
      } catch (e) {
        error2 = (e as Error).message;
      }

      assert.strictEqual(error1, error2);
      assert.ok(error1?.startsWith('POLICY_VIOLATION: PL5:'));
    });
  });

  describe('PL6: Sandbox Constraints', () => {
    it('strict allows only specified commands', () => {
      const policy = loadPolicy('strict');
      assert.ok(isCommandAllowed('node', policy));
      assert.ok(isCommandAllowed('npm', policy));
      assert.ok(!isCommandAllowed('npx', policy));
      assert.ok(!isCommandAllowed('bash', policy));
    });

    it('default allows specified commands', () => {
      const policy = loadPolicy('default');
      assert.ok(isCommandAllowed('node', policy));
      assert.ok(isCommandAllowed('npm', policy));
      assert.ok(isCommandAllowed('npx', policy));
      assert.ok(!isCommandAllowed('bash', policy));
    });

    it('dev allows all commands (empty list)', () => {
      const policy = loadPolicy('dev');
      assert.ok(isCommandAllowed('node', policy));
      assert.ok(isCommandAllowed('npm', policy));
      assert.ok(isCommandAllowed('npx', policy));
      assert.ok(isCommandAllowed('bash', policy));
      assert.ok(isCommandAllowed('anything', policy));
    });

    it('strict allows only specified write roots', () => {
      const policy = loadPolicy('strict');
      assert.ok(isWritePathAllowed('out/file.txt', policy));
      assert.ok(isWritePathAllowed('dist/bundle.js', policy));
      assert.ok(isWritePathAllowed('build/output.js', policy));
      assert.ok(!isWritePathAllowed('tmp/temp.txt', policy));
      assert.ok(!isWritePathAllowed('src/code.ts', policy));
    });

    it('default allows more write roots', () => {
      const policy = loadPolicy('default');
      assert.ok(isWritePathAllowed('out/file.txt', policy));
      assert.ok(isWritePathAllowed('dist/bundle.js', policy));
      assert.ok(isWritePathAllowed('build/output.js', policy));
      assert.ok(isWritePathAllowed('tmp/temp.txt', policy));
      assert.ok(!isWritePathAllowed('src/code.ts', policy));
    });

    it('dev allows all write paths (empty list)', () => {
      const policy = loadPolicy('dev');
      assert.ok(isWritePathAllowed('out/file.txt', policy));
      assert.ok(isWritePathAllowed('tmp/temp.txt', policy));
      assert.ok(isWritePathAllowed('src/code.ts', policy));
      assert.ok(isWritePathAllowed('anywhere/anything.txt', policy));
    });
  });

  describe('PL7: Evidence Policy Binding', () => {
    it('harness result includes full policy object', async () => {
      const input: HarnessRunInput = {
        intent_path: TEST_INTENT_PATH,
        mode: 'plan-only',
        policy: 'default',
      };

      const result = await runHarness(input);

      // Result should include full policy
      assert.ok(result.policy);
      assert.strictEqual(result.policy.name, 'default');
      assert.strictEqual(typeof result.policy.timeout_ms, 'number');
      assert.ok(Array.isArray(result.policy.allowed_commands));
    });

    it('policy in result matches resolved policy exactly', async () => {
      const profiles: PolicyProfileName[] = ['strict', 'default', 'dev'];

      for (const profileName of profiles) {
        const input: HarnessRunInput = {
          intent_path: TEST_INTENT_PATH,
          mode: 'plan-only',
          policy: profileName,
        };

        const result = await runHarness(input);
        const expected = loadPolicy(profileName);

        // Canonical comparison
        const resultCanonical = canonicalize(result.policy);
        const expectedCanonical = canonicalize(expected);

        assert.strictEqual(
          resultCanonical,
          expectedCanonical,
          `Policy binding mismatch for ${profileName}`
        );
      }
    });

    it('policy binding is deterministic across runs', async () => {
      const input: HarnessRunInput = {
        intent_path: TEST_INTENT_PATH,
        mode: 'plan-only',
        policy: 'strict',
      };

      const result1 = await runHarness(input);
      const result2 = await runHarness(input);

      const canonical1 = canonicalize(result1.policy);
      const canonical2 = canonicalize(result2.policy);

      assert.strictEqual(canonical1, canonical2);
    });
  });

  describe('Deterministic Resolution', () => {
    it('loadPolicy returns identical object for same profile', () => {
      const policy1 = loadPolicy('strict');
      const policy2 = loadPolicy('strict');

      const canonical1 = canonicalize(policy1);
      const canonical2 = canonicalize(policy2);

      assert.strictEqual(canonical1, canonical2);
    });

    it('loadPolicy is byte-identical across multiple calls', () => {
      for (const name of listPolicies()) {
        const policies = Array.from({ length: 5 }, () => loadPolicy(name));
        const canonicals = policies.map((p) => canonicalize(p));

        const allSame = canonicals.every((c) => c === canonicals[0]);
        assert.ok(allSame, `${name} policy not deterministic`);
      }
    });

    it('profile values match documented spec', () => {
      for (const name of listPolicies()) {
        const actual = loadPolicy(name);
        const expected = EXPECTED_PROFILES[name];

        assert.strictEqual(actual.name, expected.name);
        assert.strictEqual(actual.allow_network, expected.allow_network);
        assert.strictEqual(actual.timeout_ms, expected.timeout_ms);
        assert.strictEqual(actual.max_output_files, expected.max_output_files);
        assert.strictEqual(actual.max_total_output_bytes, expected.max_total_output_bytes);
        assert.deepStrictEqual(actual.allowed_commands, expected.allowed_commands);
        assert.deepStrictEqual(actual.allowed_write_roots, expected.allowed_write_roots);
      }
    });
  });

  describe('All Invariants Combined', () => {
    it('strict profile passes all invariants', () => {
      const policy = loadPolicy('strict');
      checkAllInvariants(policy);
    });

    it('default profile passes all invariants', () => {
      const policy = loadPolicy('default');
      checkAllInvariants(policy);
    });

    it('dev profile passes all invariants', () => {
      const policy = loadPolicy('dev');
      checkAllInvariants(policy);
    });
  });
});
