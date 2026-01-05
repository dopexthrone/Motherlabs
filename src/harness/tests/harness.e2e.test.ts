/**
 * Harness E2E Tests
 * =================
 *
 * End-to-end tests for the harness orchestration layer.
 *
 * Tests verify:
 * - Plan-only path works
 * - Execute-sandbox path works
 * - Evidence is properly captured
 * - Kernel validation is called
 * - Decision is based on kernel recommendation
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runHarness } from '../run_intent.js';
import { loadPolicy } from '../policy.js';
import type { HarnessRunInput, HarnessRunResult } from '../types.js';

// =============================================================================
// Test Setup
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixtures are in src/harness/fixtures (relative to dist/harness/tests)
const fixturesDir = path.resolve(__dirname, '../../../src/harness/fixtures');

// Cleanup artifacts after tests
const artifactsDir = path.resolve(__dirname, '../../../artifacts/harness');

// =============================================================================
// Plan-Only Tests
// =============================================================================

describe('Harness: Plan-Only Mode', () => {
  it('processes simple intent without execution', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
      mode: 'plan-only',
      policy: 'default',
    };

    const result = await runHarness(input);

    // Verify structure
    assert.ok(result.run_id.startsWith('hr_'), 'Run ID should have hr_ prefix');
    assert.ok(result.started_at, 'Should have started_at');
    assert.ok(result.completed_at, 'Should have completed_at');
    assert.strictEqual(result.kernel_version, '0.1.0', 'Should use kernel version');

    // Verify intent was processed
    assert.ok(result.intent.path, 'Should have intent path');
    assert.ok(result.intent.sha256.startsWith('sha256:'), 'Intent should have sha256');

    // Verify bundle was produced (goal is specific enough)
    assert.ok(result.bundle, 'Should produce bundle');
    assert.ok(result.bundle.bundle_id.startsWith('bundle_'), 'Bundle ID should have prefix');
    assert.ok(result.bundle.sha256.startsWith('sha256:'), 'Bundle should have sha256');

    // Verify no execution (plan-only)
    assert.strictEqual(result.execution, null, 'Should not execute in plan-only mode');

    // Verify decision
    assert.ok(result.decision.validated_by_kernel, 'Decision should be validated by kernel');
    assert.ok(result.decision.reasons.length > 0, 'Should have decision reasons');
  });

  it('handles clarify result for vague intent', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_003_clarify.json'),
      mode: 'plan-only',
      policy: 'default',
    };

    const result = await runHarness(input);

    // Even vague intents should produce a bundle
    assert.ok(result.bundle, 'Should produce bundle even for vague intent');

    // Should indicate clarification needed if entropy is high
    assert.ok(result.decision, 'Should have decision');
    assert.ok(result.decision.validated_by_kernel, 'Decision validated by kernel');
  });

  it('produces deterministic results for same intent', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
      mode: 'plan-only',
      policy: 'default',
    };

    const result1 = await runHarness(input);
    const result2 = await runHarness(input);

    // Bundle hashes should be identical
    assert.strictEqual(
      result1.bundle?.sha256,
      result2.bundle?.sha256,
      'Bundle hash should be deterministic'
    );

    // Intent hashes should be identical
    assert.strictEqual(
      result1.intent.sha256,
      result2.intent.sha256,
      'Intent hash should be deterministic'
    );
  });
});

// =============================================================================
// Execute-Sandbox Tests
// =============================================================================

describe('Harness: Execute-Sandbox Mode', () => {
  it('executes proposal in sandbox and captures evidence', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_002_execute.json'),
      mode: 'execute-sandbox',
      policy: 'dev',
    };

    const result = await runHarness(input);

    // Verify execution happened
    assert.ok(result.execution, 'Should have execution in execute-sandbox mode');
    assert.ok(result.execution.sandbox_id.startsWith('sandbox_'), 'Sandbox ID should have prefix');
    assert.ok(Array.isArray(result.execution.outputs), 'Should have outputs array');
    assert.ok(result.execution.stdout_sha256.startsWith('sha256:'), 'Should hash stdout');
    assert.ok(result.execution.stderr_sha256.startsWith('sha256:'), 'Should hash stderr');

    // Verify decision based on kernel validation
    assert.ok(result.decision.validated_by_kernel, 'Decision should be validated by kernel');
    assert.ok(result.decision.reasons.includes('Kernel recommendation: accept') ||
              result.decision.reasons.includes('Kernel recommendation: review') ||
              result.decision.reasons.includes('Kernel recommendation: reject'),
              'Should include kernel recommendation');
  });

  it('sandbox never writes outside sandbox dir', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_002_execute.json'),
      mode: 'execute-sandbox',
      policy: 'strict',
    };

    const result = await runHarness(input);

    // All output paths should be relative (no absolute paths)
    if (result.execution) {
      for (const output of result.execution.outputs) {
        assert.ok(!output.path.startsWith('/'), `Output path should be relative: ${output.path}`);
        assert.ok(!output.path.includes('..'), `Output path should not contain ..: ${output.path}`);
      }
    }
  });

  it('respects policy timeout', async () => {
    const policy = loadPolicy('strict');
    assert.strictEqual(policy.timeout_ms, 30000, 'Strict policy should have 30s timeout');

    const devPolicy = loadPolicy('dev');
    assert.strictEqual(devPolicy.timeout_ms, 300000, 'Dev policy should have 5m timeout');
  });
});

// =============================================================================
// Policy Tests
// =============================================================================

describe('Harness: Policy Profiles', () => {
  it('strict policy has most restrictive settings', () => {
    const policy = loadPolicy('strict');

    assert.strictEqual(policy.allow_network, false, 'Should not allow network');
    assert.strictEqual(policy.timeout_ms, 30000, 'Should have 30s timeout');
    assert.ok(policy.max_output_files <= 200, 'Should limit output files');
    assert.ok(policy.max_total_output_bytes <= 10 * 1024 * 1024, 'Should limit output bytes');
  });

  it('default policy is balanced', () => {
    const policy = loadPolicy('default');

    assert.strictEqual(policy.allow_network, false, 'Should not allow network');
    assert.strictEqual(policy.timeout_ms, 60000, 'Should have 60s timeout');
    assert.ok(policy.max_output_files >= 200, 'Should allow more output files');
  });

  it('dev policy is relaxed', () => {
    const policy = loadPolicy('dev');

    assert.strictEqual(policy.allow_network, false, 'Should still not allow network by default');
    assert.strictEqual(policy.timeout_ms, 300000, 'Should have 5m timeout');
    assert.deepStrictEqual(policy.allowed_commands, [], 'Empty = all allowed in dev');
  });

  it('policy is included in result', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
      mode: 'plan-only',
      policy: 'strict',
    };

    const result = await runHarness(input);

    assert.strictEqual(result.policy.name, 'strict', 'Result should include policy');
    assert.strictEqual(result.policy.allow_network, false, 'Policy details should be included');
  });
});

// =============================================================================
// Kernel Authority Tests
// =============================================================================

describe('Harness: Kernel Authority', () => {
  it('kernel generates bundle (harness does not)', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
      mode: 'plan-only',
      policy: 'default',
    };

    const result = await runHarness(input);

    // Bundle ID format proves it came from kernel (deriveId format)
    assert.ok(
      result.bundle?.bundle_id.match(/^bundle_[a-f0-9]{16}$/),
      'Bundle ID should be kernel-derived'
    );
  });

  it('kernel validates evidence (harness does not decide)', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_002_execute.json'),
      mode: 'execute-sandbox',
      policy: 'dev',
    };

    const result = await runHarness(input);

    // Decision must be validated by kernel
    assert.ok(result.decision.validated_by_kernel, 'Decision must be validated by kernel');

    // Reasons should include kernel recommendation
    const hasKernelReason = result.decision.reasons.some((r) => r.includes('Kernel recommendation'));
    assert.ok(hasKernelReason, 'Should include kernel recommendation in reasons');
  });
});

// =============================================================================
// Result Structure Tests
// =============================================================================

describe('Harness: Result Structure', () => {
  it('result has all required fields', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
      mode: 'plan-only',
      policy: 'default',
    };

    const result = await runHarness(input);

    // Required fields
    assert.ok(result.run_id, 'Must have run_id');
    assert.ok(result.started_at, 'Must have started_at');
    assert.ok(result.completed_at, 'Must have completed_at');
    assert.ok(result.kernel_version, 'Must have kernel_version');
    assert.ok(result.policy, 'Must have policy');
    assert.ok(result.intent, 'Must have intent');
    assert.ok(result.kernel_result_kind, 'Must have kernel_result_kind');
    assert.ok(result.decision, 'Must have decision');
  });

  it('timestamps are valid ISO 8601 UTC', async () => {
    const input: HarnessRunInput = {
      intent_path: path.join(fixturesDir, 'intent_harness_001_plan_only.json'),
      mode: 'plan-only',
      policy: 'default',
    };

    const result = await runHarness(input);

    // Parse timestamps
    const started = new Date(result.started_at);
    const completed = new Date(result.completed_at);

    assert.ok(!isNaN(started.getTime()), 'started_at should be valid date');
    assert.ok(!isNaN(completed.getTime()), 'completed_at should be valid date');
    assert.ok(completed >= started, 'completed_at should be >= started_at');
  });
});
