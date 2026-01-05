/**
 * Ledger Spec Invariant Tests
 * ============================
 *
 * Docs-driven tests that verify LedgerEntry structures and ledger files
 * conform to the LEDGER_SPEC.md contract.
 *
 * These tests verify invariants at the ledger boundary.
 * Failures use stable error prefixes for deterministic testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { canonicalize } from '../../utils/canonical.js';
import { serializeLedgerEntry, createLedgerEntry } from '../ledger.js';
import type {
  LedgerEntry,
  ContentHash,
  KernelResultKind,
  ExecutionMode,
  PolicyProfileName,
  HarnessRunResult,
  PolicyProfile,
} from '../types.js';

// =============================================================================
// Rule Registry
// =============================================================================

/**
 * Ledger spec rule IDs for stable error reporting.
 */
const RULES = {
  LD1_ONE_ENTRY_PER_LINE: 'LD1_ONE_ENTRY_PER_LINE',
  LD2_MONOTONIC_TIMESTAMPS: 'LD2_MONOTONIC_TIMESTAMPS',
  LD3_UNIQUE_RUN_IDS: 'LD3_UNIQUE_RUN_IDS',
  LD4_VALID_CONTENT_HASHES: 'LD4_VALID_CONTENT_HASHES',
} as const;

type RuleId = (typeof RULES)[keyof typeof RULES];

/**
 * Throw a spec violation error with stable format.
 */
function specViolation(ruleId: RuleId, details: string): never {
  throw new Error(`LEDGER_SPEC_VIOLATION: ${ruleId}: ${details}`);
}

// =============================================================================
// Content Hash Validation
// =============================================================================

/**
 * Validate that a string is a valid ContentHash.
 * Format: "sha256:{64 hex chars}"
 */
function isValidContentHash(hash: string | null): boolean {
  if (hash === null) return true; // null is valid for optional hashes
  if (typeof hash !== 'string') return false;

  // Must be sha256:{64 hex chars}
  const pattern = /^sha256:[a-f0-9]{64}$/;
  return pattern.test(hash);
}

// =============================================================================
// Invariant Checks
// =============================================================================

/**
 * LD1: Each line must be a valid JSON object conforming to LedgerEntry schema.
 */
function checkOneEntryPerLine(ledgerContent: string): LedgerEntry[] {
  const lines = ledgerContent.split('\n').filter((line) => line.trim());
  const entries: LedgerEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    try {
      const parsed = JSON.parse(line);

      // Validate required fields exist
      const requiredFields = [
        'run_id',
        'timestamp',
        'intent_sha256',
        'result_kind',
        'accepted',
        'mode',
        'policy',
      ];
      for (const field of requiredFields) {
        if (!(field in parsed)) {
          specViolation(
            RULES.LD1_ONE_ENTRY_PER_LINE,
            `Line ${i + 1}: missing required field '${field}'`
          );
        }
      }

      // Validate field types
      if (typeof parsed.run_id !== 'string') {
        specViolation(
          RULES.LD1_ONE_ENTRY_PER_LINE,
          `Line ${i + 1}: run_id must be string`
        );
      }
      if (typeof parsed.timestamp !== 'string') {
        specViolation(
          RULES.LD1_ONE_ENTRY_PER_LINE,
          `Line ${i + 1}: timestamp must be string`
        );
      }
      if (typeof parsed.accepted !== 'boolean') {
        specViolation(
          RULES.LD1_ONE_ENTRY_PER_LINE,
          `Line ${i + 1}: accepted must be boolean`
        );
      }

      // Validate enum values
      const validResultKinds: KernelResultKind[] = ['CLARIFY', 'REFUSE', 'BUNDLE'];
      if (!validResultKinds.includes(parsed.result_kind)) {
        specViolation(
          RULES.LD1_ONE_ENTRY_PER_LINE,
          `Line ${i + 1}: invalid result_kind '${parsed.result_kind}'`
        );
      }

      const validModes: ExecutionMode[] = ['plan-only', 'execute-sandbox'];
      if (!validModes.includes(parsed.mode)) {
        specViolation(
          RULES.LD1_ONE_ENTRY_PER_LINE,
          `Line ${i + 1}: invalid mode '${parsed.mode}'`
        );
      }

      const validPolicies: PolicyProfileName[] = ['strict', 'default', 'dev'];
      if (!validPolicies.includes(parsed.policy)) {
        specViolation(
          RULES.LD1_ONE_ENTRY_PER_LINE,
          `Line ${i + 1}: invalid policy '${parsed.policy}'`
        );
      }

      entries.push(parsed as LedgerEntry);
    } catch (err) {
      if (err instanceof Error && err.message.includes('LEDGER_SPEC_VIOLATION')) {
        throw err;
      }
      specViolation(
        RULES.LD1_ONE_ENTRY_PER_LINE,
        `Line ${i + 1}: invalid JSON - ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return entries;
}

/**
 * LD2: Timestamps must be monotonically non-decreasing.
 */
function checkMonotonicTimestamps(entries: LedgerEntry[]): void {
  for (let i = 1; i < entries.length; i++) {
    const prev = new Date(entries[i - 1]!.timestamp).getTime();
    const curr = new Date(entries[i]!.timestamp).getTime();

    if (curr < prev) {
      specViolation(
        RULES.LD2_MONOTONIC_TIMESTAMPS,
        `Entry ${i + 1}: timestamp ${entries[i]!.timestamp} is before entry ${i} timestamp ${entries[i - 1]!.timestamp}`
      );
    }
  }
}

/**
 * LD3: Run IDs must be unique within the ledger.
 */
function checkUniqueRunIds(entries: LedgerEntry[]): void {
  const seen = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const runId = entries[i]!.run_id;
    if (seen.has(runId)) {
      specViolation(
        RULES.LD3_UNIQUE_RUN_IDS,
        `Entry ${i + 1}: duplicate run_id '${runId}'`
      );
    }
    seen.add(runId);
  }
}

/**
 * LD4: Content hashes must be valid format.
 */
function checkValidContentHashes(entries: LedgerEntry[]): void {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    // intent_sha256 must be valid
    if (!isValidContentHash(entry.intent_sha256)) {
      specViolation(
        RULES.LD4_VALID_CONTENT_HASHES,
        `Entry ${i + 1}: invalid intent_sha256 format`
      );
    }

    // bundle_sha256 must be valid (or null)
    if (entry.bundle_sha256 !== null && !isValidContentHash(entry.bundle_sha256)) {
      specViolation(
        RULES.LD4_VALID_CONTENT_HASHES,
        `Entry ${i + 1}: invalid bundle_sha256 format`
      );
    }
  }
}

/**
 * Run all ledger invariant checks on entries.
 */
function checkAllEntryInvariants(entries: LedgerEntry[]): void {
  checkMonotonicTimestamps(entries);
  checkUniqueRunIds(entries);
  checkValidContentHashes(entries);
}

/**
 * Run all ledger invariant checks on ledger content.
 */
function checkAllInvariants(ledgerContent: string): LedgerEntry[] {
  const entries = checkOneEntryPerLine(ledgerContent);
  checkAllEntryInvariants(entries);
  return entries;
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createValidEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    run_id: 'hr_20260105T100000Z_abc123',
    timestamp: '2026-01-05T10:00:00.000Z',
    intent_sha256: 'sha256:' + 'a'.repeat(64),
    bundle_sha256: 'sha256:' + 'b'.repeat(64),
    result_kind: 'BUNDLE',
    accepted: true,
    mode: 'execute-sandbox',
    policy: 'strict',
    ...overrides,
  };
}

function createValidLedger(entries: LedgerEntry[]): string {
  return entries.map((e) => canonicalize(e)).join('\n');
}

function createMockHarnessResult(
  overrides: Partial<HarnessRunResult> = {}
): HarnessRunResult {
  const policy: PolicyProfile = {
    name: 'strict',
    allow_network: false,
    timeout_ms: 30000,
    max_output_files: 100,
    max_total_output_bytes: 10485760,
    allowed_commands: [],
    allowed_write_roots: ['.'],
  };

  return {
    run_id: 'hr_20260105T100000Z_xyz789',
    started_at: '2026-01-05T10:00:00.000Z',
    completed_at: '2026-01-05T10:00:05.000Z',
    kernel_version: '0.3.3',
    policy,
    intent: {
      path: 'intents/test.json',
      sha256: 'sha256:' + 'c'.repeat(64),
    },
    bundle: {
      bundle_id: 'bdl_abc123',
      sha256: 'sha256:' + 'd'.repeat(64),
    },
    kernel_result_kind: 'BUNDLE',
    execution: null,
    decision: {
      accepted: true,
      reasons: ['All tests passed'],
      validated_by_kernel: true,
    },
    model_mode: 'none',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Ledger Spec Invariants', () => {
  describe('LD1: One Entry Per Line', () => {
    it('valid single entry parses correctly', () => {
      const entry = createValidEntry();
      const ledger = canonicalize(entry);
      const entries = checkOneEntryPerLine(ledger);
      assert.strictEqual(entries.length, 1);
    });

    it('valid multiple entries parse correctly', () => {
      const entries = [
        createValidEntry({ run_id: 'hr_001', timestamp: '2026-01-05T10:00:00.000Z' }),
        createValidEntry({ run_id: 'hr_002', timestamp: '2026-01-05T10:01:00.000Z' }),
        createValidEntry({ run_id: 'hr_003', timestamp: '2026-01-05T10:02:00.000Z' }),
      ];
      const ledger = createValidLedger(entries);
      const parsed = checkOneEntryPerLine(ledger);
      assert.strictEqual(parsed.length, 3);
    });

    it('rejects invalid JSON', () => {
      const ledger = 'not valid json';
      assert.throws(
        () => checkOneEntryPerLine(ledger),
        /LD1_ONE_ENTRY_PER_LINE.*invalid JSON/
      );
    });

    it('rejects missing required fields', () => {
      const ledger = '{"run_id":"hr_001"}';
      assert.throws(
        () => checkOneEntryPerLine(ledger),
        /LD1_ONE_ENTRY_PER_LINE.*missing required field/
      );
    });

    it('rejects invalid result_kind', () => {
      const entry = createValidEntry({ result_kind: 'INVALID' as any });
      const ledger = JSON.stringify(entry);
      assert.throws(
        () => checkOneEntryPerLine(ledger),
        /LD1_ONE_ENTRY_PER_LINE.*invalid result_kind/
      );
    });

    it('rejects invalid mode', () => {
      const entry = createValidEntry({ mode: 'invalid-mode' as any });
      const ledger = JSON.stringify(entry);
      assert.throws(
        () => checkOneEntryPerLine(ledger),
        /LD1_ONE_ENTRY_PER_LINE.*invalid mode/
      );
    });

    it('rejects invalid policy', () => {
      const entry = createValidEntry({ policy: 'invalid-policy' as any });
      const ledger = JSON.stringify(entry);
      assert.throws(
        () => checkOneEntryPerLine(ledger),
        /LD1_ONE_ENTRY_PER_LINE.*invalid policy/
      );
    });

    it('accepts all valid result_kind values', () => {
      const resultKinds: KernelResultKind[] = ['CLARIFY', 'REFUSE', 'BUNDLE'];
      for (const kind of resultKinds) {
        const entry = createValidEntry({
          result_kind: kind,
          bundle_sha256: kind === 'BUNDLE' ? 'sha256:' + 'b'.repeat(64) : null,
        });
        const ledger = canonicalize(entry);
        const entries = checkOneEntryPerLine(ledger);
        assert.strictEqual(entries.length, 1);
      }
    });

    it('accepts all valid mode values', () => {
      const modes: ExecutionMode[] = ['plan-only', 'execute-sandbox'];
      for (const mode of modes) {
        const entry = createValidEntry({ mode });
        const ledger = canonicalize(entry);
        const entries = checkOneEntryPerLine(ledger);
        assert.strictEqual(entries.length, 1);
      }
    });

    it('accepts all valid policy values', () => {
      const policies: PolicyProfileName[] = ['strict', 'default', 'dev'];
      for (const policy of policies) {
        const entry = createValidEntry({ policy });
        const ledger = canonicalize(entry);
        const entries = checkOneEntryPerLine(ledger);
        assert.strictEqual(entries.length, 1);
      }
    });
  });

  describe('LD2: Monotonic Timestamps', () => {
    it('ascending timestamps pass', () => {
      const entries = [
        createValidEntry({ run_id: 'hr_001', timestamp: '2026-01-05T10:00:00.000Z' }),
        createValidEntry({ run_id: 'hr_002', timestamp: '2026-01-05T10:01:00.000Z' }),
        createValidEntry({ run_id: 'hr_003', timestamp: '2026-01-05T10:02:00.000Z' }),
      ];
      checkMonotonicTimestamps(entries);
    });

    it('equal timestamps pass', () => {
      const entries = [
        createValidEntry({ run_id: 'hr_001', timestamp: '2026-01-05T10:00:00.000Z' }),
        createValidEntry({ run_id: 'hr_002', timestamp: '2026-01-05T10:00:00.000Z' }),
      ];
      checkMonotonicTimestamps(entries);
    });

    it('descending timestamps fail', () => {
      const entries = [
        createValidEntry({ run_id: 'hr_001', timestamp: '2026-01-05T10:01:00.000Z' }),
        createValidEntry({ run_id: 'hr_002', timestamp: '2026-01-05T10:00:00.000Z' }),
      ];
      assert.throws(
        () => checkMonotonicTimestamps(entries),
        /LD2_MONOTONIC_TIMESTAMPS/
      );
    });

    it('single entry passes', () => {
      const entries = [createValidEntry()];
      checkMonotonicTimestamps(entries);
    });

    it('empty array passes', () => {
      checkMonotonicTimestamps([]);
    });
  });

  describe('LD3: Unique Run IDs', () => {
    it('unique run_ids pass', () => {
      const entries = [
        createValidEntry({ run_id: 'hr_001' }),
        createValidEntry({ run_id: 'hr_002' }),
        createValidEntry({ run_id: 'hr_003' }),
      ];
      checkUniqueRunIds(entries);
    });

    it('duplicate run_ids fail', () => {
      const entries = [
        createValidEntry({ run_id: 'hr_001' }),
        createValidEntry({ run_id: 'hr_002' }),
        createValidEntry({ run_id: 'hr_001' }), // duplicate
      ];
      assert.throws(
        () => checkUniqueRunIds(entries),
        /LD3_UNIQUE_RUN_IDS.*duplicate run_id 'hr_001'/
      );
    });

    it('single entry passes', () => {
      const entries = [createValidEntry()];
      checkUniqueRunIds(entries);
    });

    it('empty array passes', () => {
      checkUniqueRunIds([]);
    });
  });

  describe('LD4: Valid Content Hashes', () => {
    it('valid hashes pass', () => {
      const entries = [createValidEntry()];
      checkValidContentHashes(entries);
    });

    it('null bundle_sha256 passes', () => {
      const entries = [
        createValidEntry({
          result_kind: 'CLARIFY',
          bundle_sha256: null,
        }),
      ];
      checkValidContentHashes(entries);
    });

    it('invalid intent_sha256 fails', () => {
      const entries = [
        createValidEntry({ intent_sha256: 'not-a-hash' as ContentHash }),
      ];
      assert.throws(
        () => checkValidContentHashes(entries),
        /LD4_VALID_CONTENT_HASHES.*invalid intent_sha256/
      );
    });

    it('invalid bundle_sha256 fails', () => {
      const entries = [
        createValidEntry({ bundle_sha256: 'not-a-hash' as ContentHash }),
      ];
      assert.throws(
        () => checkValidContentHashes(entries),
        /LD4_VALID_CONTENT_HASHES.*invalid bundle_sha256/
      );
    });

    it('hash without sha256 prefix fails', () => {
      const entries = [
        createValidEntry({ intent_sha256: 'a'.repeat(64) as ContentHash }),
      ];
      assert.throws(
        () => checkValidContentHashes(entries),
        /LD4_VALID_CONTENT_HASHES/
      );
    });

    it('hash with wrong length fails', () => {
      const entries = [
        createValidEntry({ intent_sha256: 'sha256:abcd' as ContentHash }),
      ];
      assert.throws(
        () => checkValidContentHashes(entries),
        /LD4_VALID_CONTENT_HASHES/
      );
    });
  });

  describe('All Invariants Combined', () => {
    it('valid ledger passes all checks', () => {
      const entries = [
        createValidEntry({ run_id: 'hr_001', timestamp: '2026-01-05T10:00:00.000Z' }),
        createValidEntry({ run_id: 'hr_002', timestamp: '2026-01-05T10:01:00.000Z' }),
      ];
      const ledger = createValidLedger(entries);
      const parsed = checkAllInvariants(ledger);
      assert.strictEqual(parsed.length, 2);
    });

    it('empty ledger passes', () => {
      const parsed = checkAllInvariants('');
      assert.strictEqual(parsed.length, 0);
    });

    it('single valid entry passes', () => {
      const entry = createValidEntry();
      const ledger = canonicalize(entry);
      const parsed = checkAllInvariants(ledger);
      assert.strictEqual(parsed.length, 1);
    });
  });

  describe('serializeLedgerEntry', () => {
    it('produces canonical JSON', () => {
      const entry = createValidEntry();
      const serialized1 = serializeLedgerEntry(entry);
      const serialized2 = serializeLedgerEntry(entry);
      assert.strictEqual(serialized1, serialized2);
    });

    it('produces valid JSON', () => {
      const entry = createValidEntry();
      const serialized = serializeLedgerEntry(entry);
      const parsed = JSON.parse(serialized);
      assert.strictEqual(parsed.run_id, entry.run_id);
    });

    it('serialized entry passes invariant checks', () => {
      const entry = createValidEntry();
      const serialized = serializeLedgerEntry(entry);
      const parsed = checkOneEntryPerLine(serialized);
      assert.strictEqual(parsed.length, 1);
      checkValidContentHashes(parsed);
    });
  });

  describe('createLedgerEntry', () => {
    it('creates valid entry from HarnessRunResult', () => {
      const result = createMockHarnessResult();
      const entry = createLedgerEntry(result);

      assert.strictEqual(entry.run_id, result.run_id);
      assert.strictEqual(entry.timestamp, result.completed_at);
      assert.strictEqual(entry.intent_sha256, result.intent.sha256);
      assert.strictEqual(entry.bundle_sha256, result.bundle?.sha256);
      assert.strictEqual(entry.result_kind, result.kernel_result_kind);
      assert.strictEqual(entry.accepted, result.decision.accepted);
    });

    it('created entry passes invariant checks', () => {
      const result = createMockHarnessResult();
      const entry = createLedgerEntry(result);
      const serialized = serializeLedgerEntry(entry);
      const parsed = checkOneEntryPerLine(serialized);
      checkValidContentHashes(parsed);
    });

    it('handles null bundle correctly', () => {
      const result = createMockHarnessResult({
        bundle: null,
        kernel_result_kind: 'CLARIFY',
      });
      const entry = createLedgerEntry(result);
      assert.strictEqual(entry.bundle_sha256, null);
    });
  });

  describe('Content Hash Validation', () => {
    it('isValidContentHash accepts valid hashes', () => {
      assert.ok(isValidContentHash('sha256:' + 'a'.repeat(64)));
      assert.ok(isValidContentHash('sha256:' + 'f'.repeat(64)));
      assert.ok(isValidContentHash('sha256:' + '0'.repeat(64)));
      assert.ok(isValidContentHash(null));
    });

    it('isValidContentHash rejects invalid hashes', () => {
      assert.ok(!isValidContentHash(''));
      assert.ok(!isValidContentHash('not-a-hash'));
      assert.ok(!isValidContentHash('a'.repeat(64))); // missing prefix
      assert.ok(!isValidContentHash('sha256:abc')); // too short
      assert.ok(!isValidContentHash('sha256:' + 'g'.repeat(64))); // invalid hex
      assert.ok(!isValidContentHash('SHA256:' + 'a'.repeat(64))); // wrong case
    });
  });
});
