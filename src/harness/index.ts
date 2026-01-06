/**
 * Harness Module
 * ==============
 *
 * Non-authoritative orchestration layer for kernel execution.
 */

// Types
export type {
  ExecutionMode,
  PolicyProfileName,
  HarnessRunInput,
  HarnessRunResult,
  PolicyProfile,
  SandboxExecution,
  OutputFile,
  ContentHash,
  KernelResultKind,
  DecisionRecord,
  LedgerEntry,
} from './types.js';

// Policy
export { loadPolicy, getDefaultPolicy, isCommandAllowed, isWritePathAllowed, listPolicies } from './policy.js';

// Sandbox
export { createSandbox, cleanupSandbox, runInSandbox, collectOutputs, buildSandboxExecution } from './sandbox.js';
export type { Sandbox, SandboxRunResult } from './sandbox.js';

// Evidence
export { buildKernelEvidence, hashFile, hashContent } from './evidence.js';

// Ledger
export { createLedgerEntry, serializeLedgerEntry, appendToLedger, appendHarnessResult, getDefaultLedgerPath } from './ledger.js';

// Main runner
export { runHarness } from './run_intent.js';

// Pack export
export { exportPack } from './pack_export.js';
export type { ExportPackArgs, ExportPackResult, PackExportMode } from './pack_export.js';
