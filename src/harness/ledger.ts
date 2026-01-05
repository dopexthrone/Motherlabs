/**
 * Harness Ledger
 * ==============
 *
 * Append-only ledger for harness runs.
 * Each entry is one JSON line (JSONL format).
 *
 * Ledger entries reference:
 * - intent_sha256
 * - bundle_sha256 (if produced)
 * - decision (accepted/rejected)
 *
 * The ledger is separate from kernel artifacts and is for harness audit only.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { canonicalize } from '../utils/canonical.js';
import type { LedgerEntry, HarnessRunResult } from './types.js';

// =============================================================================
// Ledger Configuration
// =============================================================================

/**
 * Default ledger file path (relative to cwd).
 */
const DEFAULT_LEDGER_PATH = 'artifacts/harness/ledger.jsonl';

// =============================================================================
// Ledger Operations
// =============================================================================

/**
 * Create a ledger entry from harness run result.
 *
 * @param result - Harness run result
 * @returns Ledger entry
 */
export function createLedgerEntry(result: HarnessRunResult): LedgerEntry {
  return {
    run_id: result.run_id,
    timestamp: result.completed_at,
    intent_sha256: result.intent.sha256,
    bundle_sha256: result.bundle?.sha256 ?? null,
    result_kind: result.kernel_result_kind,
    accepted: result.decision.accepted,
    mode: result.policy.name === 'strict' ? 'execute-sandbox' : 'plan-only', // Simplified
    policy: result.policy.name,
  };
}

/**
 * Serialize ledger entry to canonical JSON line.
 * Uses canonical JSON for deterministic output.
 *
 * @param entry - Ledger entry
 * @returns JSON line (no trailing newline)
 */
export function serializeLedgerEntry(entry: LedgerEntry): string {
  return canonicalize(entry);
}

/**
 * Append entry to ledger file.
 * Creates directories if needed.
 *
 * @param entry - Ledger entry to append
 * @param ledgerPath - Path to ledger file (default: artifacts/harness/ledger.jsonl)
 */
export async function appendToLedger(
  entry: LedgerEntry,
  ledgerPath: string = DEFAULT_LEDGER_PATH
): Promise<void> {
  // Ensure directory exists
  await mkdir(dirname(ledgerPath), { recursive: true });

  // Serialize to canonical JSON
  const line = serializeLedgerEntry(entry);

  // Append with newline
  await appendFile(ledgerPath, line + '\n', 'utf-8');
}

/**
 * Append harness run result to ledger.
 * Convenience function that creates entry and appends.
 *
 * @param result - Harness run result
 * @param ledgerPath - Path to ledger file (optional)
 */
export async function appendHarnessResult(
  result: HarnessRunResult,
  ledgerPath?: string
): Promise<void> {
  const entry = createLedgerEntry(result);
  await appendToLedger(entry, ledgerPath);
}

/**
 * Get the default ledger path.
 */
export function getDefaultLedgerPath(): string {
  return DEFAULT_LEDGER_PATH;
}
