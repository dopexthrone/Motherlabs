/**
 * Context Artifact Types
 * ======================
 *
 * Typed IR (Intermediate Representation) for all context artifacts.
 * These types define the structure of inputs, outputs, and internal state.
 *
 * Design Principles:
 * - All numeric scores are integers 0-100
 * - All lists have defined ordering rules (documented in comments)
 * - All IDs are content-derived (deterministic)
 * - No optional fields that could cause ordering instability
 */

// =============================================================================
// Schema Version
// =============================================================================

/**
 * Current schema version for all artifacts.
 *
 * IMPORTANT: Changing this is a BREAKING CHANGE.
 * - All golden hashes will change
 * - Old bundles may not validate against new schema
 * - Migrations must be written for schema changes
 *
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR: Breaking changes to structure
 * - MINOR: Additive changes (new optional fields)
 * - PATCH: Documentation/comment changes only
 */
export const SCHEMA_VERSION = '0.1.0';

// =============================================================================
// Primitive Types
// =============================================================================

/**
 * Integer score in range [0, 100].
 * Used for: ambiguity, confidence, entropy, information gain.
 */
export type Score = number; // Runtime validation ensures 0-100 integer

/**
 * Content-derived identifier.
 * Format: `{prefix}_{hash16}` where hash16 is first 16 hex chars of SHA-256.
 */
export type ContentId = string;

/**
 * Bundle identifier. Format: `bundle_{hash16}`
 */
export type BundleId = ContentId;

/**
 * Node identifier. Format: `node_{hash16}`
 */
export type NodeId = ContentId;

/**
 * Question identifier. Format: `q_{hash16}`
 */
export type QuestionId = ContentId;

/**
 * Output identifier. Format: `out_{hash16}`
 */
export type OutputId = ContentId;

// =============================================================================
// Input Types
// =============================================================================

/**
 * The canonical input to the kernel.
 * Represents a goal to be decomposed into actionable context.
 */
export interface Intent {
  /**
   * The high-level goal or objective.
   * Must be non-empty after normalization.
   */
  goal: string;

  /**
   * Explicit constraints on the solution.
   * ORDERING: Sorted lexicographically after normalization.
   */
  constraints: string[];

  /**
   * Additional context provided by the user.
   * Arbitrary key-value pairs, canonicalized during serialization.
   */
  context: Record<string, unknown>;
}

// =============================================================================
// Entropy and Measurement Types
// =============================================================================

/**
 * Entropy measurement for a context node.
 * All scores are integers 0-100.
 */
export interface EntropyMeasurement {
  /**
   * Number of unresolved references (placeholders, TBDs, etc.)
   * Higher = more entropy.
   */
  unresolved_refs: number;

  /**
   * Number of schema gaps (missing required fields, incomplete structures).
   * Higher = more entropy.
   */
  schema_gaps: number;

  /**
   * Number of detected contradictions in constraints.
   * Higher = more entropy.
   */
  contradiction_count: number;

  /**
   * Estimated branching factor (number of distinct outcome classes).
   * Higher = more entropy.
   */
  branching_factor: number;

  /**
   * Composite entropy score derived from above metrics.
   * Integer 0-100. Higher = more uncertain.
   */
  entropy_score: Score;
}

/**
 * Density measurement for a context node.
 * Measures how much useful information is present.
 */
export interface DensityMeasurement {
  /**
   * Number of concrete, actionable constraints.
   */
  concrete_constraints: number;

  /**
   * Number of fully specified outputs.
   */
  specified_outputs: number;

  /**
   * Depth of constraint chain (specificity).
   */
  constraint_depth: number;

  /**
   * Composite density score.
   * Integer 0-100. Higher = more information.
   */
  density_score: Score;
}

// =============================================================================
// Decomposition Types
// =============================================================================

/**
 * Answer type for questions.
 * Defines what kind of answer is expected.
 */
export type AnswerType =
  | 'boolean'      // Yes/No
  | 'choice'       // Select from options
  | 'text'         // Free-form text
  | 'number'       // Numeric value
  | 'list'         // Multiple items
  | 'structured';  // Complex object

/**
 * A question that needs to be resolved to reduce entropy.
 */
export interface Question {
  /**
   * Unique identifier derived from content.
   */
  id: QuestionId;

  /**
   * The question text.
   */
  text: string;

  /**
   * What type of answer is expected.
   */
  expected_answer_type: AnswerType;

  /**
   * Why this question matters for reducing entropy.
   */
  why_needed: string;

  /**
   * Estimated information gain if answered.
   * Integer 0-100. Higher = more valuable.
   */
  information_gain: Score;

  /**
   * Priority for asking this question.
   * Integer 0-100. Higher = ask first.
   */
  priority: Score;

  /**
   * Possible answer options (for 'choice' type).
   * ORDERING: Sorted lexicographically.
   */
  options?: string[];
}

/**
 * A splitting question that creates child branches in decomposition.
 */
export interface SplittingQuestion {
  /**
   * The question that splits the context.
   */
  question: Question;

  /**
   * The possible branches created by different answers.
   * ORDERING: Sorted by branch_id ascending.
   */
  branches: Branch[];
}

/**
 * A branch in the decomposition tree.
 */
export interface Branch {
  /**
   * Identifier for this branch (derived from answer).
   */
  branch_id: string;

  /**
   * The answer that leads to this branch.
   */
  answer: string;

  /**
   * Additional constraints added by this branch.
   */
  added_constraints: string[];
}

// =============================================================================
// Node Types
// =============================================================================

/**
 * Node status in the decomposition tree.
 */
export type NodeStatus =
  | 'pending'     // Not yet processed
  | 'expanding'   // Being decomposed
  | 'terminal'    // Decomposition complete, ready for output
  | 'blocked';    // Waiting for question resolution

/**
 * A node in the decomposition tree.
 */
export interface ContextNode {
  /**
   * Unique identifier derived from content.
   */
  id: NodeId;

  /**
   * Parent node ID (null for root).
   */
  parent_id: NodeId | null;

  /**
   * Current status.
   */
  status: NodeStatus;

  /**
   * The goal at this level (refined from parent).
   */
  goal: string;

  /**
   * Accumulated constraints (inherited + added).
   * ORDERING: Sorted lexicographically.
   */
  constraints: string[];

  /**
   * Entropy measurement at this node.
   */
  entropy: EntropyMeasurement;

  /**
   * Density measurement at this node.
   */
  density: DensityMeasurement;

  /**
   * The splitting question that created children (if any).
   */
  splitting_question?: SplittingQuestion;

  /**
   * Child node IDs.
   * ORDERING: Sorted by id ascending.
   */
  children: NodeId[];

  /**
   * Unresolved questions at this node.
   * ORDERING: Sorted by priority desc, then id asc.
   */
  unresolved_questions: Question[];
}

// =============================================================================
// Output Types
// =============================================================================

/**
 * Type of output artifact.
 */
export type OutputType =
  | 'file'        // A file to be created
  | 'command'     // A command to be executed
  | 'config'      // Configuration data
  | 'instruction' // Human-readable instruction
  | 'schema';     // Data schema/structure

/**
 * A generated output artifact.
 */
export interface Output {
  /**
   * Unique identifier derived from content.
   */
  id: OutputId;

  /**
   * Type of output.
   */
  type: OutputType;

  /**
   * Path for this output (relative, forward slashes).
   * Used for ordering.
   */
  path: string;

  /**
   * The content of the output.
   */
  content: string;

  /**
   * SHA-256 hash of the content.
   */
  content_hash: string;

  /**
   * Constraints that led to this output.
   * ORDERING: Sorted lexicographically.
   */
  source_constraints: string[];

  /**
   * Confidence in this output.
   * Integer 0-100. Higher = more confident.
   */
  confidence: Score;
}

// =============================================================================
// Bundle Types
// =============================================================================

/**
 * Bundle status.
 */
export type BundleStatus =
  | 'complete'    // All nodes terminal, all questions resolved
  | 'incomplete'  // Has unresolved questions
  | 'error';      // Processing error occurred

/**
 * The complete output bundle from a kernel run.
 * This is the artifact that gets hashed for determinism verification.
 */
export interface Bundle {
  /**
   * Unique identifier derived from content.
   */
  id: BundleId;

  /**
   * Schema version of this bundle.
   * Used for compatibility checking and migrations.
   */
  schema_version: string;

  /**
   * Kernel version that produced this bundle.
   */
  kernel_version: string;

  /**
   * SHA-256 hash of the normalized input intent.
   */
  source_intent_hash: string;

  /**
   * Current status.
   */
  status: BundleStatus;

  /**
   * Root node of the decomposition tree.
   */
  root_node: ContextNode;

  /**
   * All terminal nodes (flattened for convenience).
   * ORDERING: Sorted by id ascending.
   */
  terminal_nodes: ContextNode[];

  /**
   * Generated outputs.
   * ORDERING: Sorted by path ascending.
   */
  outputs: Output[];

  /**
   * All unresolved questions across all nodes.
   * ORDERING: Sorted by priority desc, then id asc.
   */
  unresolved_questions: Question[];

  /**
   * Summary statistics.
   */
  stats: BundleStats;
}

/**
 * Bundle statistics.
 */
export interface BundleStats {
  /**
   * Total nodes in decomposition tree.
   */
  total_nodes: number;

  /**
   * Number of terminal nodes.
   */
  terminal_nodes: number;

  /**
   * Maximum depth of decomposition tree.
   */
  max_depth: number;

  /**
   * Total outputs generated.
   */
  total_outputs: number;

  /**
   * Total unresolved questions.
   */
  unresolved_count: number;

  /**
   * Average entropy across terminal nodes.
   * Integer 0-100.
   */
  avg_terminal_entropy: Score;

  /**
   * Average density across terminal nodes.
   * Integer 0-100.
   */
  avg_terminal_density: Score;
}

// =============================================================================
// Evidence Types (Not in Bundle Hash Domain)
// =============================================================================

/**
 * Evidence entry for audit trail.
 * These are logged but NOT included in bundle hash.
 */
export interface EvidenceEntry {
  /**
   * Timestamp (ISO 8601 format).
   * NOT deterministic - for audit only.
   */
  timestamp: string;

  /**
   * Run identifier.
   * May include timestamp for audit trail.
   */
  run_id: string;

  /**
   * Type of evidence.
   */
  type: 'transform' | 'decompose' | 'measure' | 'generate' | 'validate';

  /**
   * Source hash (what was processed).
   */
  source_hash: string;

  /**
   * Result hash (what was produced).
   */
  result_hash: string;

  /**
   * Host information (for debugging only).
   */
  host?: string;

  /**
   * Additional details.
   */
  details?: Record<string, unknown>;
}
