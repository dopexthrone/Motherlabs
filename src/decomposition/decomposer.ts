/**
 * Recursive Decomposer
 * ====================
 *
 * The core decomposition engine that breaks down high-entropy contexts
 * into lower-entropy children using splitting questions.
 *
 * This is a pure, deterministic, synchronous operation.
 * All ordering is stable and content-derived.
 */

import { deriveId, canonicalHash } from '../utils/canonical.js';
import { normalizeConstraints } from '../utils/normalize.js';
import {
  measureEntropy,
  measureDensity,
  isTerminal,
  calculateInformationGain,
  type TerminationConfig,
  DEFAULT_TERMINATION_CONFIG,
} from '../entropy/measure.js';
import type {
  ContextNode,
  NodeId,
  Question,
  QuestionId,
  SplittingQuestion,
  Branch,
  EntropyMeasurement,
  DensityMeasurement,
  Score,
} from '../types/artifacts.js';
import { clampToScore } from '../types/validation.js';

// =============================================================================
// Node Construction
// =============================================================================

/**
 * Create a new context node.
 *
 * @param goal - The goal for this node
 * @param constraints - Constraints for this node
 * @param parentId - Parent node ID (null for root)
 * @returns New context node
 */
export function createNode(
  goal: string,
  constraints: string[],
  parentId: NodeId | null
): ContextNode {
  // Normalize constraints and sort
  const normalizedConstraints = normalizeConstraints(constraints);

  // Measure entropy and density
  const entropy = measureEntropy(goal, normalizedConstraints);
  const density = measureDensity(goal, normalizedConstraints);

  // Derive node ID from content
  const nodeContent = {
    parent_id: parentId,
    goal,
    constraints: normalizedConstraints,
  };
  const id = deriveId('node', nodeContent) as NodeId;

  // Determine initial status
  const terminal = isTerminal(entropy, density);
  const status = terminal ? 'terminal' : 'pending';

  return {
    id,
    parent_id: parentId,
    status,
    goal,
    constraints: normalizedConstraints,
    entropy,
    density,
    children: [],
    unresolved_questions: [],
  };
}

// =============================================================================
// Question Generation
// =============================================================================

/**
 * Question templates for common ambiguity patterns.
 * Each template targets a specific type of entropy.
 */
interface QuestionTemplate {
  pattern: RegExp;
  generator: (match: RegExpMatchArray, goal: string) => Partial<Question>;
}

const QUESTION_TEMPLATES: QuestionTemplate[] = [
  // Technology choice
  {
    pattern: /\b(build|create|implement|develop)\b.*\b(system|application|service|tool|platform)\b/i,
    generator: (_match, goal) => ({
      text: 'What technology stack should be used?',
      expected_answer_type: 'choice',
      why_needed: 'Technology choice affects architecture, performance, and maintainability',
      options: ['JavaScript/Node.js', 'Python', 'Go', 'Rust', 'Other'],
    }),
  },
  // User type
  {
    pattern: /\b(user|customer|client|actor)\b/i,
    generator: (_match, _goal) => ({
      text: 'Who are the primary users of this system?',
      expected_answer_type: 'list',
      why_needed: 'User types determine access patterns, permissions, and UI requirements',
    }),
  },
  // Data storage
  {
    pattern: /\b(store|save|persist|database|data)\b/i,
    generator: (_match, _goal) => ({
      text: 'What type of data storage is needed?',
      expected_answer_type: 'choice',
      why_needed: 'Data storage choice affects query patterns, scalability, and consistency',
      options: ['SQL database', 'NoSQL database', 'File storage', 'In-memory', 'Other'],
    }),
  },
  // Authentication
  {
    pattern: /\b(auth|login|user|account|permission|access)\b/i,
    generator: (_match, _goal) => ({
      text: 'What authentication method is required?',
      expected_answer_type: 'choice',
      why_needed: 'Authentication affects security model and integration requirements',
      options: ['JWT tokens', 'Session-based', 'OAuth', 'API keys', 'None'],
    }),
  },
  // Scale/performance
  {
    pattern: /\b(scale|performance|load|concurrent|traffic)\b/i,
    generator: (_match, _goal) => ({
      text: 'What are the expected scale requirements?',
      expected_answer_type: 'structured',
      why_needed: 'Scale requirements affect architecture, caching, and infrastructure',
    }),
  },
  // API type
  {
    pattern: /\b(api|endpoint|interface|integration)\b/i,
    generator: (_match, _goal) => ({
      text: 'What API style should be used?',
      expected_answer_type: 'choice',
      why_needed: 'API style affects client integration and versioning strategy',
      options: ['REST', 'GraphQL', 'gRPC', 'WebSocket', 'Other'],
    }),
  },
  // Error handling
  {
    pattern: /\b(error|fail|exception|invalid|retry)\b/i,
    generator: (_match, _goal) => ({
      text: 'How should errors be handled?',
      expected_answer_type: 'choice',
      why_needed: 'Error handling strategy affects reliability and user experience',
      options: ['Retry with backoff', 'Fail fast', 'Graceful degradation', 'Circuit breaker'],
    }),
  },
];

/**
 * Generate candidate questions from goal and constraints.
 *
 * @param goal - The goal text
 * @param constraints - The constraints
 * @param entropy - Entropy measurement
 * @returns Array of candidate questions
 */
export function generateQuestions(
  goal: string,
  constraints: string[],
  entropy: EntropyMeasurement
): Question[] {
  const combinedText = goal + ' ' + constraints.join(' ');
  const questions: Question[] = [];

  // Generate questions from templates
  for (const template of QUESTION_TEMPLATES) {
    const match = combinedText.match(template.pattern);
    if (match) {
      const partial = template.generator(match, goal);

      // Derive question ID
      const questionContent = {
        text: partial.text!,
        expected_answer_type: partial.expected_answer_type!,
        why_needed: partial.why_needed!,
      };
      const id = deriveId('q', questionContent) as QuestionId;

      // Calculate information gain based on entropy
      const information_gain = calculateInformationGain(entropy, {
        concrete_constraints: 0,
        specified_outputs: 0,
        constraint_depth: 0,
        density_score: 0,
      });

      // Priority based on information gain and pattern position
      const priority = clampToScore(information_gain);

      // Build question object - conditionally add options
      const question: Question = {
        id,
        text: partial.text!,
        expected_answer_type: partial.expected_answer_type!,
        why_needed: partial.why_needed!,
        information_gain,
        priority,
        ...(partial.options && {
          options: [...partial.options].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        }),
      };

      questions.push(question);
    }
  }

  // Sort by priority desc, then id asc
  questions.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority; // Descending
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // Ascending
  });

  return questions;
}

// =============================================================================
// Splitting Question Selection
// =============================================================================

/**
 * Minimum information gain to consider a question worth asking.
 */
const MIN_INFORMATION_GAIN: Score = 20;

/**
 * Select the best splitting question from candidates.
 *
 * @param questions - Candidate questions
 * @returns Best splitting question with branches, or null if none
 */
export function selectSplittingQuestion(
  questions: Question[]
): SplittingQuestion | null {
  if (questions.length === 0) {
    return null;
  }

  // Filter to questions with sufficient information gain
  const viable = questions.filter((q) => q.information_gain >= MIN_INFORMATION_GAIN);
  if (viable.length === 0) {
    return null;
  }

  // Select highest priority question
  const best = viable[0]!;

  // Generate branches based on question type
  const branches = generateBranches(best);

  return {
    question: best,
    branches,
  };
}

/**
 * Generate branches for a question.
 *
 * @param question - The splitting question
 * @returns Array of branches
 */
function generateBranches(question: Question): Branch[] {
  const branches: Branch[] = [];

  if (question.options && question.options.length > 0) {
    // Choice question: one branch per option
    for (const option of question.options) {
      const branchId = canonicalHash({ question_id: question.id, answer: option }).slice(0, 8);
      branches.push({
        branch_id: branchId,
        answer: option,
        added_constraints: [`Selected ${question.text.replace('?', '')}: ${option}`],
      });
    }
  } else if (question.expected_answer_type === 'boolean') {
    // Boolean question: yes/no branches
    branches.push({
      branch_id: canonicalHash({ question_id: question.id, answer: 'yes' }).slice(0, 8),
      answer: 'Yes',
      added_constraints: [`${question.text.replace('?', '')}: Yes`],
    });
    branches.push({
      branch_id: canonicalHash({ question_id: question.id, answer: 'no' }).slice(0, 8),
      answer: 'No',
      added_constraints: [`${question.text.replace('?', '')}: No`],
    });
  } else {
    // Other question types: generic "answered" branch
    branches.push({
      branch_id: canonicalHash({ question_id: question.id, answer: 'answered' }).slice(0, 8),
      answer: '[To be specified]',
      added_constraints: [`${question.text.replace('?', '')}: [Answer to be provided]`],
    });
  }

  // Sort branches by branch_id for determinism
  branches.sort((a, b) => (a.branch_id < b.branch_id ? -1 : a.branch_id > b.branch_id ? 1 : 0));

  return branches;
}

// =============================================================================
// Decomposition
// =============================================================================

/**
 * Result of a decomposition step.
 */
export interface DecompositionResult {
  /**
   * The updated node after decomposition.
   */
  node: ContextNode;

  /**
   * Child nodes created (empty if terminal).
   */
  children: ContextNode[];

  /**
   * Whether decomposition should continue.
   */
  should_continue: boolean;
}

/**
 * Perform one step of decomposition on a node.
 *
 * @param node - Node to decompose
 * @param config - Termination configuration
 * @returns Decomposition result
 */
export function decomposeNode(
  node: ContextNode,
  config: TerminationConfig = DEFAULT_TERMINATION_CONFIG
): DecompositionResult {
  // Check if already terminal
  if (node.status === 'terminal') {
    return {
      node,
      children: [],
      should_continue: false,
    };
  }

  // Check termination condition
  if (isTerminal(node.entropy, node.density, config)) {
    const terminalNode: ContextNode = {
      ...node,
      status: 'terminal',
    };
    return {
      node: terminalNode,
      children: [],
      should_continue: false,
    };
  }

  // Generate questions
  const questions = generateQuestions(node.goal, node.constraints, node.entropy);

  // Select splitting question
  const splittingQuestion = selectSplittingQuestion(questions);

  if (!splittingQuestion) {
    // No viable splitting questions - mark as terminal anyway
    const terminalNode: ContextNode = {
      ...node,
      status: 'terminal',
      unresolved_questions: questions,
    };
    return {
      node: terminalNode,
      children: [],
      should_continue: false,
    };
  }

  // Create child nodes for each branch
  const children: ContextNode[] = [];
  const childIds: NodeId[] = [];

  for (const branch of splittingQuestion.branches) {
    // Combine parent constraints with branch constraints
    const childConstraints = [...node.constraints, ...branch.added_constraints];

    // Create child node
    const child = createNode(node.goal, childConstraints, node.id);
    children.push(child);
    childIds.push(child.id);
  }

  // Sort child IDs for deterministic ordering
  childIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Update node with splitting question and children
  const expandedNode: ContextNode = {
    ...node,
    status: 'expanding',
    splitting_question: splittingQuestion,
    children: childIds,
    unresolved_questions: questions.filter((q) => q.id !== splittingQuestion.question.id),
  };

  return {
    node: expandedNode,
    children: children.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    should_continue: true,
  };
}

// =============================================================================
// Full Decomposition Tree
// =============================================================================

/**
 * Configuration for full decomposition.
 */
export interface DecompositionConfig extends TerminationConfig {
  /**
   * Maximum depth of decomposition tree.
   * Default: 10
   */
  max_depth: number;

  /**
   * Maximum total nodes to create.
   * Default: 100
   */
  max_nodes: number;
}

/**
 * Default decomposition configuration.
 */
export const DEFAULT_DECOMPOSITION_CONFIG: DecompositionConfig = {
  ...DEFAULT_TERMINATION_CONFIG,
  max_depth: 10,
  max_nodes: 100,
};

/**
 * Result of full decomposition.
 */
export interface FullDecompositionResult {
  /**
   * Root node of the tree.
   */
  root: ContextNode;

  /**
   * All nodes indexed by ID.
   */
  nodes: Map<NodeId, ContextNode>;

  /**
   * Terminal nodes.
   */
  terminal_nodes: ContextNode[];

  /**
   * All unresolved questions.
   */
  unresolved_questions: Question[];

  /**
   * Statistics.
   */
  stats: {
    total_nodes: number;
    max_depth: number;
    terminal_count: number;
  };
}

/**
 * Perform full recursive decomposition from a root.
 *
 * @param goal - Root goal
 * @param constraints - Root constraints
 * @param config - Decomposition configuration
 * @returns Full decomposition result
 */
export function decompose(
  goal: string,
  constraints: string[],
  config: DecompositionConfig = DEFAULT_DECOMPOSITION_CONFIG
): FullDecompositionResult {
  // Create root node
  const root = createNode(goal, constraints, null);

  // Track all nodes
  const nodes = new Map<NodeId, ContextNode>();
  nodes.set(root.id, root);

  // Process queue: [node, depth]
  const queue: Array<[ContextNode, number]> = [[root, 0]];

  // Track terminal nodes
  const terminalNodes: ContextNode[] = [];

  // Track max depth seen
  let maxDepth = 0;

  // Process until queue empty or limits reached
  while (queue.length > 0 && nodes.size < config.max_nodes) {
    const [currentNode, depth] = queue.shift()!;
    maxDepth = Math.max(maxDepth, depth);

    // Skip if already at max depth
    if (depth >= config.max_depth) {
      const terminalNode: ContextNode = {
        ...currentNode,
        status: 'terminal',
      };
      nodes.set(terminalNode.id, terminalNode);
      terminalNodes.push(terminalNode);
      continue;
    }

    // Decompose the node
    const result = decomposeNode(currentNode, config);

    // Update node in map
    nodes.set(result.node.id, result.node);

    if (result.node.status === 'terminal') {
      terminalNodes.push(result.node);
    } else {
      // Add children to queue
      for (const child of result.children) {
        nodes.set(child.id, child);
        queue.push([child, depth + 1]);
      }
    }
  }

  // Collect all unresolved questions
  const allQuestions: Question[] = [];
  for (const node of nodes.values()) {
    allQuestions.push(...node.unresolved_questions);
  }

  // Deduplicate and sort questions
  const questionMap = new Map<QuestionId, Question>();
  for (const q of allQuestions) {
    if (!questionMap.has(q.id)) {
      questionMap.set(q.id, q);
    }
  }
  const unresolvedQuestions = [...questionMap.values()];
  unresolvedQuestions.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Sort terminal nodes by ID
  terminalNodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Get updated root (might have changed)
  const finalRoot = nodes.get(root.id)!;

  return {
    root: finalRoot,
    nodes,
    terminal_nodes: terminalNodes,
    unresolved_questions: unresolvedQuestions,
    stats: {
      total_nodes: nodes.size,
      max_depth: maxDepth,
      terminal_count: terminalNodes.length,
    },
  };
}
