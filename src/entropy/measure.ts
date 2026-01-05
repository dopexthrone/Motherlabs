/**
 * Entropy Measurement
 * ===================
 *
 * Operational proxies for semantic entropy measurement.
 * These are deterministic measurements that quantify uncertainty
 * without requiring LLM inference.
 *
 * Entropy Proxies:
 * 1. Unresolved references (placeholders, TBDs)
 * 2. Schema gaps (missing required information)
 * 3. Contradiction count (conflicting constraints)
 * 4. Branching factor (distinct outcome classes)
 *
 * All scores are integers 0-100.
 */

import type { EntropyMeasurement, DensityMeasurement, Score } from '../types/artifacts.js';
import { clampToScore } from '../types/validation.js';

// =============================================================================
// Unresolved Reference Detection
// =============================================================================

/**
 * Patterns that indicate unresolved/placeholder content.
 * These are case-insensitive matches.
 */
const UNRESOLVED_PATTERNS: RegExp[] = [
  /\bTBD\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bXXX\b/i,
  /\bTBA\b/i,
  /\b\?\?\?\b/,
  /\[.*?\]/,                    // [placeholder] style
  /\{.*?\}/,                    // {placeholder} style (but not JSON)
  /<.*?>/,                      // <placeholder> style (but not HTML)
  /\bplaceholder\b/i,
  /\bunknown\b/i,
  /\bundefined\b/i,
  /\bTBC\b/i,                   // To Be Confirmed
  /\bTBR\b/i,                   // To Be Resolved
  /to be determined/i,
  /to be defined/i,
  /not yet decided/i,
  /will be provided/i,
  /needs clarification/i,
  /requires input/i,
];

/**
 * Count unresolved references in text.
 *
 * @param text - Text to analyze
 * @returns Number of unresolved reference matches
 */
export function countUnresolvedRefs(text: string): number {
  let count = 0;

  for (const pattern of UNRESOLVED_PATTERNS) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}

// =============================================================================
// Schema Gap Detection
// =============================================================================

/**
 * Required elements for a complete context specification.
 * Each key is a category, each value is an array of patterns.
 */
const REQUIRED_ELEMENTS: Record<string, RegExp[]> = {
  // Technology choices
  technology: [
    /\b(language|framework|library|database|platform)\b/i,
    /\b(using|built with|implemented in)\b/i,
  ],
  // User/actor definition
  actors: [
    /\b(user|admin|system|service|client|customer)\b/i,
    /\b(who|actor|role)\b/i,
  ],
  // Action/behavior definition
  actions: [
    /\b(should|must|will|can|shall)\b/i,
    /\b(create|read|update|delete|get|set|send|receive)\b/i,
  ],
  // Data/structure definition
  data: [
    /\b(data|field|property|attribute|column|table)\b/i,
    /\b(type|schema|structure|format)\b/i,
  ],
  // Error/edge case handling
  errors: [
    /\b(error|exception|failure|invalid|missing)\b/i,
    /\b(if|when|unless|otherwise)\b/i,
  ],
};

/**
 * Detect schema gaps (missing required information categories).
 *
 * @param text - Text to analyze
 * @returns Number of missing categories (0-5)
 */
export function detectSchemaGaps(text: string): number {
  let gaps = 0;

  for (const [_category, patterns] of Object.entries(REQUIRED_ELEMENTS)) {
    let found = false;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        found = true;
        break;
      }
    }
    if (!found) {
      gaps++;
    }
  }

  return gaps;
}

// =============================================================================
// Contradiction Detection
// =============================================================================

/**
 * Contradiction pattern pairs.
 * Each pair represents potentially conflicting statements.
 */
const CONTRADICTION_PAIRS: Array<[RegExp, RegExp]> = [
  // Requirement conflicts
  [/\bmust\b.*\bnot\b/i, /\bmust\b(?!.*\bnot\b)/i],
  [/\brequired\b/i, /\boptional\b/i],
  [/\balways\b/i, /\bnever\b/i],
  [/\ball\b/i, /\bnone\b/i],

  // Technology conflicts (simple heuristic)
  [/\bsynchronous\b/i, /\basynchronous\b/i],
  [/\bblocking\b/i, /\bnon-blocking\b/i],
  [/\bstateful\b/i, /\bstateless\b/i],
  [/\bmutable\b/i, /\bimmutable\b/i],

  // Access conflicts
  [/\bpublic\b/i, /\bprivate\b/i],
  [/\bread-only\b/i, /\bwritable\b/i],
];

/**
 * Detect potential contradictions in constraints.
 *
 * @param constraints - Array of constraint strings
 * @returns Number of detected contradictions
 */
export function detectContradictions(constraints: string[]): number {
  let contradictions = 0;
  const combinedText = constraints.join(' ');

  for (const [pattern1, pattern2] of CONTRADICTION_PAIRS) {
    const match1 = pattern1.test(combinedText);
    const match2 = pattern2.test(combinedText);

    // Both patterns found = potential contradiction
    if (match1 && match2) {
      contradictions++;
    }
  }

  return contradictions;
}

// =============================================================================
// Branching Factor Estimation
// =============================================================================

/**
 * Keywords that indicate decision points (branching).
 */
const BRANCHING_KEYWORDS: RegExp[] = [
  /\bor\b/i,
  /\beither\b/i,
  /\balternatively\b/i,
  /\boption\b/i,
  /\bchoice\b/i,
  /\bcould\b/i,
  /\bmight\b/i,
  /\bmaybe\b/i,
  /\bpossibly\b/i,
  /\bdepends\b/i,
  /\bif\b.*\bthen\b/i,
  /\bwhen\b.*\bthen\b/i,
];

/**
 * Estimate branching factor (number of distinct outcome classes).
 *
 * @param text - Text to analyze
 * @returns Estimated branching factor (1-10)
 */
export function estimateBranchingFactor(text: string): number {
  let branches = 1; // Base case: one path

  for (const pattern of BRANCHING_KEYWORDS) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    if (matches) {
      branches += matches.length;
    }
  }

  // Cap at 10 for practical purposes
  return Math.min(branches, 10);
}

// =============================================================================
// Composite Entropy Calculation
// =============================================================================

/**
 * Weights for entropy components.
 * These sum to 100 for easy percentage calculation.
 */
const ENTROPY_WEIGHTS = {
  unresolved_refs: 30,    // Unresolved references are most concerning
  schema_gaps: 25,        // Missing information categories
  contradictions: 25,     // Conflicting constraints
  branching: 20,          // Decision point density
};

/**
 * Measure entropy of a goal with constraints.
 *
 * @param goal - The goal text
 * @param constraints - Array of constraint strings
 * @returns Complete entropy measurement
 */
export function measureEntropy(goal: string, constraints: string[]): EntropyMeasurement {
  const combinedText = goal + ' ' + constraints.join(' ');

  // Measure each component
  const unresolved_refs = countUnresolvedRefs(combinedText);
  const schema_gaps = detectSchemaGaps(combinedText);
  const contradiction_count = detectContradictions(constraints);
  const branching_factor = estimateBranchingFactor(combinedText);

  // Normalize to 0-100 scale
  // Unresolved: 0 = 0, 10+ = 100
  const unresolvedNorm = clampToScore((unresolved_refs / 10) * 100);

  // Schema gaps: 0 = 0, 5 = 100 (all categories missing)
  const schemaGapNorm = clampToScore((schema_gaps / 5) * 100);

  // Contradictions: 0 = 0, 5+ = 100
  const contradictionNorm = clampToScore((contradiction_count / 5) * 100);

  // Branching: 1 = 0 (single path), 10 = 100
  const branchingNorm = clampToScore(((branching_factor - 1) / 9) * 100);

  // Weighted composite score
  const entropy_score = clampToScore(
    (unresolvedNorm * ENTROPY_WEIGHTS.unresolved_refs +
      schemaGapNorm * ENTROPY_WEIGHTS.schema_gaps +
      contradictionNorm * ENTROPY_WEIGHTS.contradictions +
      branchingNorm * ENTROPY_WEIGHTS.branching) / 100
  );

  return {
    unresolved_refs,
    schema_gaps,
    contradiction_count,
    branching_factor,
    entropy_score,
  };
}

// =============================================================================
// Density Measurement
// =============================================================================

/**
 * Patterns indicating concrete, actionable constraints.
 */
const CONCRETE_PATTERNS: RegExp[] = [
  /\bmust\b/i,
  /\bshall\b/i,
  /\bwill\b/i,
  /\brequires?\b/i,
  /\bneeds?\b/i,
  /\buse\b/i,
  /\bimplement\b/i,
  /\bcreate\b/i,
  /\breturn\b/i,
  /\baccept\b/i,
  /\breject\b/i,
  /\bvalidate\b/i,
  /\bformat\b/i,
  /\blimit\b/i,
  /\bmax(imum)?\b/i,
  /\bmin(imum)?\b/i,
  /\bexactly\b/i,
  /\bat least\b/i,
  /\bat most\b/i,
  /\bno more than\b/i,
  /\bno less than\b/i,
];

/**
 * Count concrete constraints.
 *
 * @param constraints - Array of constraint strings
 * @returns Number of concrete constraints
 */
export function countConcreteConstraints(constraints: string[]): number {
  let count = 0;

  for (const constraint of constraints) {
    for (const pattern of CONCRETE_PATTERNS) {
      if (pattern.test(constraint)) {
        count++;
        break; // Count each constraint once
      }
    }
  }

  return count;
}

/**
 * Patterns indicating output specification.
 */
const OUTPUT_PATTERNS: RegExp[] = [
  /\bfile\b.*\bnamed?\b/i,
  /\boutput\b/i,
  /\bgenerate\b/i,
  /\bproduce\b/i,
  /\bwrite\b.*\bto\b/i,
  /\bcreate\b.*\b(file|class|function|component)\b/i,
  /\breturn\b.*\b(json|string|number|array|object)\b/i,
  /\bformat\b.*\b(as|in)\b/i,
];

/**
 * Count specified outputs.
 *
 * @param text - Text to analyze
 * @returns Number of specified outputs
 */
export function countSpecifiedOutputs(text: string): number {
  let count = 0;

  for (const pattern of OUTPUT_PATTERNS) {
    const matches = text.match(new RegExp(pattern, 'gi'));
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}

/**
 * Calculate constraint chain depth (specificity).
 * Looks for nested qualifications and refinements.
 *
 * @param constraints - Array of constraint strings
 * @returns Depth estimate (1-10)
 */
export function calculateConstraintDepth(constraints: string[]): number {
  if (constraints.length === 0) return 0;

  let maxDepth = 1;

  for (const constraint of constraints) {
    // Count qualifiers as depth indicators
    let depth = 1;

    // Additional qualifiers
    const qualifiers = [
      /\bspecifically\b/i,
      /\bin particular\b/i,
      /\bwhen\b/i,
      /\bif\b/i,
      /\bexcept\b/i,
      /\bunless\b/i,
      /\bfor\b.*\b(each|every|all)\b/i,
      /\bwhere\b/i,
      /\bsuch that\b/i,
    ];

    for (const q of qualifiers) {
      if (q.test(constraint)) {
        depth++;
      }
    }

    maxDepth = Math.max(maxDepth, depth);
  }

  return Math.min(maxDepth, 10);
}

/**
 * Weights for density components.
 */
const DENSITY_WEIGHTS = {
  concrete_constraints: 40,
  specified_outputs: 30,
  constraint_depth: 30,
};

/**
 * Measure density (information content) of a goal with constraints.
 *
 * @param goal - The goal text
 * @param constraints - Array of constraint strings
 * @returns Complete density measurement
 */
export function measureDensity(goal: string, constraints: string[]): DensityMeasurement {
  const combinedText = goal + ' ' + constraints.join(' ');

  const concrete_constraints = countConcreteConstraints(constraints);
  const specified_outputs = countSpecifiedOutputs(combinedText);
  const constraint_depth = calculateConstraintDepth(constraints);

  // Normalize to 0-100 scale
  // Concrete constraints: 0 = 0, 20+ = 100
  const concreteNorm = clampToScore((concrete_constraints / 20) * 100);

  // Specified outputs: 0 = 0, 10+ = 100
  const outputNorm = clampToScore((specified_outputs / 10) * 100);

  // Constraint depth: 0 = 0, 10 = 100
  const depthNorm = clampToScore((constraint_depth / 10) * 100);

  // Weighted composite score
  const density_score = clampToScore(
    (concreteNorm * DENSITY_WEIGHTS.concrete_constraints +
      outputNorm * DENSITY_WEIGHTS.specified_outputs +
      depthNorm * DENSITY_WEIGHTS.constraint_depth) / 100
  );

  return {
    concrete_constraints,
    specified_outputs,
    constraint_depth,
    density_score,
  };
}

// =============================================================================
// Termination Detection
// =============================================================================

/**
 * Configuration for termination detection.
 */
export interface TerminationConfig {
  /**
   * Minimum density score to be considered terminal.
   * Default: 60
   */
  min_density: Score;

  /**
   * Maximum entropy score to be considered terminal.
   * Default: 30
   */
  max_entropy: Score;

  /**
   * Minimum density/entropy ratio to be considered terminal.
   * Default: 2.0 (density must be at least 2x entropy)
   */
  min_ratio: number;
}

/**
 * Default termination configuration.
 */
export const DEFAULT_TERMINATION_CONFIG: TerminationConfig = {
  min_density: 60,
  max_entropy: 30,
  min_ratio: 2.0,
};

/**
 * Check if a node should be considered terminal.
 *
 * @param entropy - Entropy measurement
 * @param density - Density measurement
 * @param config - Termination configuration
 * @returns True if terminal, false if needs more decomposition
 */
export function isTerminal(
  entropy: EntropyMeasurement,
  density: DensityMeasurement,
  config: TerminationConfig = DEFAULT_TERMINATION_CONFIG
): boolean {
  // Must meet minimum density
  if (density.density_score < config.min_density) {
    return false;
  }

  // Must not exceed maximum entropy
  if (entropy.entropy_score > config.max_entropy) {
    return false;
  }

  // Must meet density/entropy ratio
  // Handle zero entropy case (perfect clarity)
  if (entropy.entropy_score === 0) {
    return true;
  }

  const ratio = density.density_score / entropy.entropy_score;
  return ratio >= config.min_ratio;
}

/**
 * Calculate information gain potential for decomposition.
 * Higher score = more benefit from decomposing.
 *
 * @param entropy - Entropy measurement
 * @param density - Density measurement
 * @returns Information gain score (0-100)
 */
export function calculateInformationGain(
  entropy: EntropyMeasurement,
  density: DensityMeasurement
): Score {
  // High entropy + low density = high potential gain
  // Low entropy + high density = low potential gain

  const entropyContribution = entropy.entropy_score * 0.6;
  const densityContribution = (100 - density.density_score) * 0.4;

  return clampToScore(entropyContribution + densityContribution);
}
