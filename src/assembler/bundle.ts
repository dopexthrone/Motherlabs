/**
 * Bundle Assembler
 * ================
 *
 * Assembles decomposition results into a complete, deterministic bundle.
 * This is the final stage of the kernel pipeline.
 *
 * All operations are deterministic and produce byte-identical output.
 */

import { canonicalize, deriveId, canonicalHash } from '../utils/canonical.js';
import { normalizeIntent, type NormalizedIntent } from '../utils/normalize.js';
import {
  decompose,
  type DecompositionConfig,
  DEFAULT_DECOMPOSITION_CONFIG,
  type FullDecompositionResult,
} from '../decomposition/decomposer.js';
import {
  SCHEMA_VERSION,
  type Bundle,
  type BundleId,
  type BundleStatus,
  type BundleStats,
  type ContextNode,
  type Output,
  type OutputId,
  type Question,
  type Score,
} from '../types/artifacts.js';
import { clampToScore } from '../types/validation.js';

// =============================================================================
// Kernel Version
// =============================================================================

/**
 * Current kernel version.
 * This is embedded in every bundle for reproducibility.
 */
export const KERNEL_VERSION = '0.1.0';

// =============================================================================
// Output Generation
// =============================================================================

/**
 * Generate outputs from terminal nodes.
 * In the minimal kernel, this generates constraint summaries.
 *
 * @param terminalNodes - Terminal nodes from decomposition
 * @returns Generated outputs
 */
export function generateOutputs(terminalNodes: ContextNode[]): Output[] {
  const outputs: Output[] = [];

  for (const node of terminalNodes) {
    // Generate a constraint summary output for each terminal node
    const content = formatConstraintSummary(node);
    const contentHash = canonicalHash(content);

    const outputContent = {
      type: 'instruction',
      path: `context/${node.id}.md`,
      content,
    };
    const id = deriveId('out', outputContent) as OutputId;

    const output: Output = {
      id,
      type: 'instruction',
      path: `context/${node.id}.md`,
      content,
      content_hash: contentHash,
      source_constraints: [...node.constraints], // Already sorted
      confidence: calculateOutputConfidence(node),
    };

    outputs.push(output);
  }

  // Sort outputs by path for deterministic ordering
  outputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return outputs;
}

/**
 * Format a constraint summary for a terminal node.
 *
 * @param node - Terminal node
 * @returns Formatted markdown content
 */
function formatConstraintSummary(node: ContextNode): string {
  const lines: string[] = [];

  lines.push(`# Context: ${node.goal}`);
  lines.push('');
  lines.push('## Constraints');
  lines.push('');

  for (const constraint of node.constraints) {
    lines.push(`- ${constraint}`);
  }

  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push(`- Entropy Score: ${node.entropy.entropy_score}/100`);
  lines.push(`- Density Score: ${node.density.density_score}/100`);
  lines.push(`- Unresolved References: ${node.entropy.unresolved_refs}`);
  lines.push(`- Schema Gaps: ${node.entropy.schema_gaps}`);
  lines.push(`- Contradictions: ${node.entropy.contradiction_count}`);

  if (node.unresolved_questions.length > 0) {
    lines.push('');
    lines.push('## Unresolved Questions');
    lines.push('');
    for (const q of node.unresolved_questions) {
      lines.push(`- ${q.text} (priority: ${q.priority})`);
    }
  }

  return lines.join('\n');
}

/**
 * Calculate output confidence based on node metrics.
 *
 * @param node - Terminal node
 * @returns Confidence score (0-100)
 */
function calculateOutputConfidence(node: ContextNode): Score {
  // High density + low entropy = high confidence
  const densityContribution = node.density.density_score * 0.6;
  const entropyContribution = (100 - node.entropy.entropy_score) * 0.4;

  return clampToScore(densityContribution + entropyContribution);
}

// =============================================================================
// Statistics Calculation
// =============================================================================

/**
 * Calculate bundle statistics.
 *
 * @param decomposition - Decomposition result
 * @param outputs - Generated outputs
 * @param unresolvedQuestions - Unresolved questions
 * @returns Bundle statistics
 */
function calculateStats(
  decomposition: FullDecompositionResult,
  outputs: Output[],
  unresolvedQuestions: Question[]
): BundleStats {
  const terminalNodes = decomposition.terminal_nodes;

  // Calculate average entropy
  const totalEntropy = terminalNodes.reduce(
    (sum, n) => sum + n.entropy.entropy_score,
    0
  );
  const avgEntropy =
    terminalNodes.length > 0 ? totalEntropy / terminalNodes.length : 0;

  // Calculate average density
  const totalDensity = terminalNodes.reduce(
    (sum, n) => sum + n.density.density_score,
    0
  );
  const avgDensity =
    terminalNodes.length > 0 ? totalDensity / terminalNodes.length : 0;

  return {
    total_nodes: decomposition.stats.total_nodes,
    terminal_nodes: decomposition.stats.terminal_count,
    max_depth: decomposition.stats.max_depth,
    total_outputs: outputs.length,
    unresolved_count: unresolvedQuestions.length,
    avg_terminal_entropy: clampToScore(avgEntropy),
    avg_terminal_density: clampToScore(avgDensity),
  };
}

// =============================================================================
// Bundle Assembly
// =============================================================================

/**
 * Determine bundle status from decomposition results.
 *
 * @param unresolvedQuestions - Unresolved questions
 * @returns Bundle status
 */
function determineBundleStatus(unresolvedQuestions: Question[]): BundleStatus {
  if (unresolvedQuestions.length === 0) {
    return 'complete';
  }
  return 'incomplete';
}

/**
 * Assemble a complete bundle from decomposition results.
 *
 * @param intent - Normalized input intent
 * @param decomposition - Decomposition result
 * @returns Complete bundle
 */
export function assembleBundle(
  intent: NormalizedIntent,
  decomposition: FullDecompositionResult
): Bundle {
  // Compute intent hash
  const sourceIntentHash = canonicalHash(intent);

  // Generate outputs
  const outputs = generateOutputs(decomposition.terminal_nodes);

  // Collect unresolved questions
  const unresolvedQuestions = decomposition.unresolved_questions;

  // Calculate statistics
  const stats = calculateStats(decomposition, outputs, unresolvedQuestions);

  // Determine status
  const status = determineBundleStatus(unresolvedQuestions);

  // Create bundle content (without ID for hashing)
  const bundleContent = {
    schema_version: SCHEMA_VERSION,
    kernel_version: KERNEL_VERSION,
    source_intent_hash: sourceIntentHash,
    status,
    root_node: decomposition.root,
    terminal_nodes: decomposition.terminal_nodes,
    outputs,
    unresolved_questions: unresolvedQuestions,
    stats,
  };

  // Derive bundle ID from content
  const id = deriveId('bundle', bundleContent) as BundleId;

  return {
    id,
    ...bundleContent,
  };
}

// =============================================================================
// Full Transform Pipeline
// =============================================================================

/**
 * Transform configuration.
 */
export interface TransformConfig extends DecompositionConfig {
  // Additional transform options can be added here
}

/**
 * Default transform configuration.
 */
export const DEFAULT_TRANSFORM_CONFIG: TransformConfig = {
  ...DEFAULT_DECOMPOSITION_CONFIG,
};

/**
 * Transform an intent into a complete bundle.
 * This is the main entry point for the kernel.
 *
 * @param rawIntent - Raw intent input
 * @param config - Transform configuration
 * @returns Complete bundle
 */
export function transform(
  rawIntent: { goal: string; constraints?: string[]; context?: Record<string, unknown> },
  config: TransformConfig = DEFAULT_TRANSFORM_CONFIG
): Bundle {
  // Normalize intent
  const intent = normalizeIntent(rawIntent);

  // Decompose
  const decomposition = decompose(intent.goal, intent.constraints, config);

  // Assemble bundle
  const bundle = assembleBundle(intent, decomposition);

  return bundle;
}

/**
 * Get the canonical bytes of a bundle.
 * This is what gets hashed for verification.
 *
 * @param bundle - Bundle to serialize
 * @returns Canonical JSON string
 */
export function getBundleCanonical(bundle: Bundle): string {
  return canonicalize(bundle);
}

/**
 * Get the SHA-256 hash of a bundle.
 *
 * @param bundle - Bundle to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function getBundleHash(bundle: Bundle): string {
  return canonicalHash(bundle);
}
