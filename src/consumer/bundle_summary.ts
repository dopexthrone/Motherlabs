/**
 * Bundle Summary
 * ==============
 *
 * Produces a deterministic summary of a bundle.
 * All outputs are JSON-serializable and stable.
 *
 * NOTE: No timestamps, host info, or nondeterministic data in output.
 */

import type { Bundle } from '../types/artifacts.js';
import type { BundleSummary, ResultKind } from './bundle_types.js';
import { canonicalHash } from '../utils/canonical.js';

/**
 * Determine the outcome type from bundle status.
 *
 * Mapping:
 * - status 'complete' -> BUNDLE
 * - status 'incomplete' -> CLARIFY
 * - status 'error' -> REFUSE
 */
function determineOutcome(bundle: Bundle): ResultKind {
  switch (bundle.status) {
    case 'complete':
      return 'BUNDLE';
    case 'incomplete':
      return 'CLARIFY';
    case 'error':
      return 'REFUSE';
    default:
      // Fallback for unknown status
      return 'REFUSE';
  }
}

/**
 * Extract artifact paths, sorted lexicographically.
 * Creates a copy to avoid mutating input.
 */
function extractArtifactPaths(bundle: Bundle): string[] {
  if (!Array.isArray(bundle.outputs)) {
    return [];
  }
  // Copy and sort to ensure deterministic order
  return bundle.outputs.map((o) => o.path).slice().sort();
}

/**
 * Extract question IDs in spec order (priority desc, id asc).
 * The bundle should already have them sorted, but we ensure it.
 */
function extractQuestionIds(bundle: Bundle): string[] {
  if (!Array.isArray(bundle.unresolved_questions)) {
    return [];
  }
  // Copy and sort by priority desc, id asc
  return bundle.unresolved_questions
    .slice()
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // desc
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // asc
    })
    .map((q) => q.id);
}

/**
 * Extract terminal node IDs, sorted lexicographically.
 * Creates a copy to avoid mutating input.
 */
function extractTerminalNodeIds(bundle: Bundle): string[] {
  if (!Array.isArray(bundle.terminal_nodes)) {
    return [];
  }
  // Copy and sort by id
  return bundle.terminal_nodes.map((n) => n.id).slice().sort();
}

/**
 * Compute bundle hash if possible.
 * Returns null if bundle cannot be hashed.
 */
function computeBundleHash(bundle: Bundle): string | null {
  try {
    return canonicalHash(bundle);
  } catch {
    return null;
  }
}

/**
 * Summarize a bundle into a deterministic, JSON-serializable structure.
 *
 * @param bundle - The bundle to summarize (must be validated first)
 * @returns Deterministic summary with counts and sorted lists
 */
export function summarizeBundle(bundle: Bundle): BundleSummary {
  const artifactPaths = extractArtifactPaths(bundle);
  const questionIds = extractQuestionIds(bundle);
  const terminalNodeIds = extractTerminalNodeIds(bundle);

  return {
    schema_version: bundle.schema_version,
    outcome: determineOutcome(bundle),
    bundle_hash: computeBundleHash(bundle),
    artifact_count: artifactPaths.length,
    artifact_paths: artifactPaths,
    unresolved_questions_count: questionIds.length,
    question_ids: questionIds,
    terminal_nodes_count: terminalNodeIds.length,
    terminal_node_ids: terminalNodeIds,
  };
}
