/**
 * Deep Exploration Engine
 * =======================
 *
 * Implements deep exploration of the solution space through:
 * - N5 Expander: Generate multiple variant candidates
 * - N6 GovernorPruner: Remove invalid/low-quality variants
 * - N7 Selector: Score and select best variants
 *
 * The exploration forms a DAG (Directed Acyclic Graph) where:
 * - Each node is a solution variant
 * - Edges represent refinement/expansion relationships
 * - Depth = levels of refinement
 * - Breadth = variants per level
 *
 * Metrics tracked:
 * - depth: Maximum depth reached
 * - breadth: Maximum variants at any level
 * - total_nodes: Total variants generated
 * - pruned_nodes: Variants eliminated
 * - selected_nodes: Final selected variants
 * - exploration_paths: Complete traversal paths
 */

import type { ModelAdapter } from '../adapters/model.js';
import type {
  GeneratorContext,
  BlueprintSpec,
  BlueprintComponent,
} from './types.js';
import { BaseGenerator, parseJSON, buildStructuredPrompt } from './base.js';

// =============================================================================
// Exploration Types
// =============================================================================

/**
 * A node in the exploration DAG.
 */
export interface ExplorationNode {
  /**
   * Unique node identifier.
   */
  id: string;

  /**
   * Parent node ID (null for root).
   */
  parent_id: string | null;

  /**
   * Depth in the DAG (0 = root).
   */
  depth: number;

  /**
   * The variant content at this node.
   */
  variant: VariantSpec;

  /**
   * Quality score (0-1).
   */
  score: number;

  /**
   * Whether this node was pruned.
   */
  pruned: boolean;

  /**
   * Reason for pruning (if pruned).
   */
  prune_reason?: string;

  /**
   * Whether this node was selected as final.
   */
  selected: boolean;

  /**
   * Child node IDs.
   */
  children: string[];

  /**
   * Metadata about generation.
   */
  metadata: {
    generator: string;
    tokens_used: number;
    latency_ms: number;
  };
}

/**
 * A solution variant.
 */
export interface VariantSpec {
  /**
   * Variant title.
   */
  title: string;

  /**
   * Approach description.
   */
  approach: string;

  /**
   * Key design decisions.
   */
  decisions: string[];

  /**
   * Specific technologies/libraries/tools (not vague categories).
   * e.g., "CodeT5+ 770M", "Z3 SMT solver", "Neo4j graph database"
   */
  technologies: string[];

  /**
   * Key technical challenges and how they're addressed.
   * The HARD parts that could fail.
   */
  challenges: Array<{
    problem: string;
    solution: string;
  }>;

  /**
   * Core components with responsibilities.
   */
  components?: BlueprintComponent[];

  /**
   * Data flow between components.
   */
  data_flow?: string;

  /**
   * Trade-offs of this approach.
   */
  tradeoffs: {
    pros: string[];
    cons: string[];
  };

  /**
   * Scope limitations - what this approach CAN'T do.
   */
  limitations: string[];

  /**
   * Estimated complexity.
   */
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';

  /**
   * Confidence in this variant.
   */
  confidence: number;
}

/**
 * Exploration metrics.
 */
export interface ExplorationMetrics {
  /**
   * Maximum depth reached.
   */
  max_depth: number;

  /**
   * Maximum breadth at any level.
   */
  max_breadth: number;

  /**
   * Total nodes generated.
   */
  total_nodes: number;

  /**
   * Nodes pruned.
   */
  pruned_nodes: number;

  /**
   * Nodes selected as final.
   */
  selected_nodes: number;

  /**
   * Nodes at each depth level.
   */
  nodes_per_depth: number[];

  /**
   * Total tokens used.
   */
  total_tokens: {
    input: number;
    output: number;
  };

  /**
   * Total latency.
   */
  total_latency_ms: number;

  /**
   * Exploration paths (root to selected).
   */
  paths: string[][];
}

/**
 * Configuration for exploration.
 */
export interface ExplorationConfig {
  /**
   * Maximum depth to explore.
   * @default 3
   */
  max_depth: number;

  /**
   * Variants to generate per node.
   * @default 3
   */
  breadth: number;

  /**
   * Minimum score to avoid pruning.
   * @default 0.4
   */
  prune_threshold: number;

  /**
   * Maximum nodes to keep after pruning per level.
   * @default 5
   */
  max_survivors: number;

  /**
   * Number of final variants to select.
   * @default 1
   */
  select_count: number;

  /**
   * Whether to expand leaf nodes.
   * @default true
   */
  expand_leaves: boolean;

  /**
   * Enable adaptive beam width based on score variance.
   * @default true
   */
  adaptive_beam: boolean;

  /**
   * Minimum beam width when adaptive.
   * @default 3
   */
  min_beam: number;

  /**
   * Maximum beam width when adaptive.
   * @default 20
   */
  max_beam: number;

  /**
   * Enable early stopping when improvement < threshold.
   * @default true
   */
  early_stopping: boolean;

  /**
   * Minimum improvement to continue (0-1).
   * @default 0.05
   */
  improvement_threshold: number;

  /**
   * Minimum depth before early stopping kicks in.
   * @default 3
   */
  min_depth_for_early_stop: number;

  /**
   * Enable diversity penalty for similar variants.
   * @default true
   */
  diversity_penalty: boolean;

  /**
   * Diversity penalty weight (0-1).
   * @default 0.2
   */
  diversity_weight: number;
}

/**
 * Result of deep exploration.
 */
export interface ExplorationResult {
  /**
   * Whether exploration completed successfully.
   */
  success: boolean;

  /**
   * All nodes in the exploration DAG.
   */
  nodes: Map<string, ExplorationNode>;

  /**
   * Root node ID.
   */
  root_id: string;

  /**
   * Selected final node IDs.
   */
  selected_ids: string[];

  /**
   * Exploration metrics.
   */
  metrics: ExplorationMetrics;

  /**
   * Error message if failed.
   */
  error?: string;
}

// =============================================================================
// G1: Expander Generator
// =============================================================================

/**
 * Input for the expander generator.
 */
export interface ExpanderInput {
  /**
   * The goal to expand.
   */
  goal: string;

  /**
   * Parent variant (if refining).
   */
  parent?: VariantSpec;

  /**
   * Number of variants to generate.
   */
  count: number;

  /**
   * Constraints to apply.
   */
  constraints: string[];

  /**
   * Context information.
   */
  context: Record<string, unknown>;
}

/**
 * Output from the expander generator.
 */
export interface ExpanderOutput {
  /**
   * Generated variants.
   */
  variants: VariantSpec[];
}

/**
 * G1: Expander Generator
 *
 * Generates multiple solution variants from a goal or parent variant.
 */
export class ExpanderGenerator extends BaseGenerator<ExpanderInput, ExpanderOutput> {
  readonly id = 'G1' as const;
  readonly name = 'ExpanderGenerator';
  readonly description = 'Generates multiple solution variants for exploration';

  protected getSystemPrompt(): string {
    return `You are a SENIOR software architect generating CONCRETE, REALISTIC solution architectures.

CRITICAL REQUIREMENTS:
1. Be SPECIFIC - name exact technologies, versions, libraries
2. Be HONEST about limitations - what CAN'T this approach do?
3. Identify the HARD parts - what could fail? How to mitigate?
4. No buzzword soup - vague terms like "AI-powered" or "intelligent" are banned
5. Estimate complexity REALISTICALLY (most real systems are "complex" or "very_complex")

BANNED PHRASES (instant rejection):
- "ensures 100% accuracy" (impossible for Turing-complete languages)
- "unlimited context" (all systems have limits)
- "any programming language" (always specify which)
- "AI-powered" without specifics
- "intelligent" without explaining how

Each variant must specify:
- EXACT technologies (not "a database" but "PostgreSQL 16 with pgvector extension")
- KEY CHALLENGES and how they're solved (the hard parts that could fail)
- LIMITATIONS (what this approach cannot do)
- DATA FLOW (how information moves between components)

Output Format:
{
  "variants": [
    {
      "title": "short descriptive name",
      "approach": "2-3 sentence concrete description",
      "decisions": ["specific architectural decision 1", "decision 2"],
      "technologies": ["Python 3.11", "CodeT5+ 770M", "Z3 4.12 SMT solver", "PostgreSQL 16"],
      "challenges": [
        {"problem": "the hard part", "solution": "how to solve it"}
      ],
      "limitations": ["what this approach CANNOT do"],
      "data_flow": "Input -> Component A -> Component B -> Output",
      "tradeoffs": {
        "pros": ["concrete advantage"],
        "cons": ["concrete disadvantage"]
      },
      "complexity": "trivial|simple|moderate|complex|very_complex",
      "confidence": 0.0-1.0
    }
  ]
}`;
  }

  protected buildPrompt(input: ExpanderInput, _context: GeneratorContext): string {
    const sections = [
      {
        title: 'Goal',
        content: input.goal,
      },
      {
        title: 'Parent Variant (to refine)',
        content: input.parent
          ? `Title: ${input.parent.title}\nApproach: ${input.parent.approach}\nDecisions: ${input.parent.decisions.join(', ')}`
          : 'None - generate initial variants',
      },
      {
        title: 'Constraints',
        content: input.constraints.length
          ? input.constraints.map((c) => `- ${c}`).join('\n')
          : 'None specified',
      },
      {
        title: 'Task',
        content: `Generate exactly ${input.count} DIVERSE solution variants.
Each variant must be meaningfully different from the others.
Consider different technologies, patterns, and trade-offs.

Respond with JSON only.`,
      },
    ];

    return buildStructuredPrompt(sections);
  }

  protected parseResponse(response: string): ExpanderOutput {
    const parsed = parseJSON<{ variants?: RawVariant[] }>(response);

    const variants: VariantSpec[] = (parsed.variants || []).map((v) => {
      const variant: VariantSpec = {
        title: String(v.title || 'Untitled'),
        approach: String(v.approach || ''),
        decisions: Array.isArray(v.decisions) ? v.decisions.map(String) : [],
        technologies: Array.isArray(v.technologies) ? v.technologies.map(String) : [],
        challenges: Array.isArray(v.challenges)
          ? v.challenges.map((c: { problem?: string; solution?: string }) => ({
              problem: String(c?.problem || ''),
              solution: String(c?.solution || ''),
            }))
          : [],
        limitations: Array.isArray(v.limitations) ? v.limitations.map(String) : [],
        tradeoffs: {
          pros: Array.isArray(v.tradeoffs?.pros) ? v.tradeoffs.pros.map(String) : [],
          cons: Array.isArray(v.tradeoffs?.cons) ? v.tradeoffs.cons.map(String) : [],
        },
        complexity: validateComplexity(v.complexity),
        confidence: typeof v.confidence === 'number' ? Math.max(0, Math.min(1, v.confidence)) : 0.5,
      };
      if (typeof v.data_flow === 'string') {
        variant.data_flow = v.data_flow;
      }
      return variant;
    });

    return { variants };
  }

  protected getDefaultOutput(): ExpanderOutput {
    return { variants: [] };
  }
}

// =============================================================================
// G2: Pruner Generator
// =============================================================================

/**
 * Input for the pruner generator.
 */
export interface PrunerInput {
  /**
   * The original goal.
   */
  goal: string;

  /**
   * Variants to evaluate.
   */
  variants: VariantSpec[];

  /**
   * Constraints to check against.
   */
  constraints: string[];

  /**
   * Scoring criteria.
   */
  criteria: string[];
}

/**
 * Output from the pruner generator.
 */
export interface PrunerOutput {
  /**
   * Scored variants with pruning decisions.
   */
  evaluations: VariantEvaluation[];
}

/**
 * Evaluation of a single variant.
 */
export interface VariantEvaluation {
  /**
   * Variant title (for matching).
   */
  title: string;

  /**
   * Quality score (0-1).
   */
  score: number;

  /**
   * Whether to prune this variant.
   */
  prune: boolean;

  /**
   * Reason for the score/decision.
   */
  reason: string;

  /**
   * Breakdown of scores by criteria.
   */
  criteria_scores: Record<string, number>;
}

/**
 * G2: Pruner Generator
 *
 * Evaluates and scores variants, deciding which to prune.
 */
export class PrunerGenerator extends BaseGenerator<PrunerInput, PrunerOutput> {
  readonly id = 'G2' as const;
  readonly name = 'PrunerGenerator';
  readonly description = 'Evaluates variants and prunes low-quality options';

  protected getSystemPrompt(): string {
    return `You are a STRICT AI evaluator that critically scores and filters solution variants.

Your role is to:
1. Critically evaluate each variant against the goal
2. Assign quality scores using the FULL range (0-1)
3. PRUNE at least 40-60% of variants - be ruthless
4. Only the best ideas should survive

CRITICAL SCORING REQUIREMENTS:
- You MUST use the full range of scores from 0.0 to 1.0
- Average score across all variants should be around 0.4-0.5
- At least 40% of variants MUST be pruned (score < 0.5)
- Only truly exceptional variants (top 20%) should score > 0.7
- Generic or vague approaches should score 0.2-0.4

Scoring guidelines:
- 0.0-0.2: Terrible - fundamentally flawed, prune immediately
- 0.2-0.4: Poor - weak approach, missing key aspects, PRUNE
- 0.4-0.5: Mediocre - has issues but could work, borderline
- 0.5-0.6: Acceptable - reasonable approach, keep for exploration
- 0.6-0.7: Good - solid approach with clear merits
- 0.7-0.8: Very Good - promising, addresses key challenges
- 0.8-0.9: Excellent - strong candidate, innovative
- 0.9-1.0: Outstanding - exceptional, rare (max 1 per batch)

RED FLAGS that warrant low scores:
- Vague or hand-wavy descriptions
- Missing critical implementation details
- Ignoring stated constraints
- Unrealistic assumptions
- Just combining buzzwords without substance
- Duplicating other variants with minor changes

Output Format:
You MUST respond with valid JSON:
{
  "evaluations": [
    {
      "title": "variant title",
      "score": 0.0-1.0,
      "prune": true/false,
      "reason": "explanation",
      "criteria_scores": {
        "criterion1": 0.0-1.0,
        "criterion2": 0.0-1.0
      }
    }
  ]
}`;
  }

  protected buildPrompt(input: PrunerInput, _context: GeneratorContext): string {
    const variantsList = input.variants
      .map((v, i) => `${i + 1}. "${v.title}"\n   Approach: ${v.approach}\n   Pros: ${v.tradeoffs.pros.join(', ')}\n   Cons: ${v.tradeoffs.cons.join(', ')}`)
      .join('\n\n');

    const sections = [
      {
        title: 'Goal',
        content: input.goal,
      },
      {
        title: 'Variants to Evaluate',
        content: variantsList,
      },
      {
        title: 'Constraints',
        content: input.constraints.length
          ? input.constraints.map((c) => `- ${c}`).join('\n')
          : 'None',
      },
      {
        title: 'Scoring Criteria',
        content: input.criteria.length
          ? input.criteria.map((c) => `- ${c}`).join('\n')
          : '- Feasibility\n- Simplicity\n- Maintainability\n- Performance',
      },
      {
        title: 'Task',
        content: `Critically evaluate each variant. Be HARSH.

REQUIREMENTS:
- Use the FULL score range (0.0 to 1.0)
- PRUNE at least 40% of variants (score < 0.5)
- Average score should be around 0.4-0.5
- Only 1-2 variants per batch should exceed 0.7
- Flag vague, buzzword-heavy, or derivative variants

Prune variants with score < 0.5.

Respond with JSON only.`,
      },
    ];

    return buildStructuredPrompt(sections);
  }

  protected parseResponse(response: string): PrunerOutput {
    const parsed = parseJSON<{ evaluations?: RawEvaluation[] }>(response);

    const evaluations: VariantEvaluation[] = (parsed.evaluations || []).map((e) => ({
      title: String(e.title || ''),
      score: typeof e.score === 'number' ? Math.max(0, Math.min(1, e.score)) : 0,
      prune: Boolean(e.prune),
      reason: String(e.reason || ''),
      criteria_scores: e.criteria_scores && typeof e.criteria_scores === 'object'
        ? Object.fromEntries(
            Object.entries(e.criteria_scores).map(([k, v]) => [k, typeof v === 'number' ? v : 0])
          )
        : {},
    }));

    return { evaluations };
  }

  protected getDefaultOutput(): PrunerOutput {
    return { evaluations: [] };
  }
}

// =============================================================================
// N7: Selector
// =============================================================================

/**
 * N7 Selector - Selects best variants based on scores.
 */
export class VariantSelector {
  /**
   * Select top variants from a list.
   */
  select(
    nodes: ExplorationNode[],
    count: number,
    _criteria?: string[]
  ): ExplorationNode[] {
    // Sort by score descending
    const sorted = [...nodes]
      .filter((n) => !n.pruned)
      .sort((a, b) => b.score - a.score);

    return sorted.slice(0, count);
  }

  /**
   * Calculate aggregate score for a path.
   */
  pathScore(path: ExplorationNode[]): number {
    if (path.length === 0) return 0;
    // Average score along the path, weighted by depth
    let totalWeight = 0;
    let weightedSum = 0;
    for (const [i, node] of path.entries()) {
      const weight = i + 1; // Later nodes weighted more
      weightedSum += node.score * weight;
      totalWeight += weight;
    }
    return weightedSum / totalWeight;
  }
}

// =============================================================================
// Exploration Engine
// =============================================================================

/**
 * Deep exploration engine.
 */
export class ExplorationEngine {
  private readonly expander: ExpanderGenerator;
  private readonly pruner: PrunerGenerator;
  private readonly selector: VariantSelector;
  private readonly config: ExplorationConfig;

  constructor(config: Partial<ExplorationConfig> = {}) {
    this.expander = new ExpanderGenerator();
    this.pruner = new PrunerGenerator();
    this.selector = new VariantSelector();
    this.config = {
      max_depth: config.max_depth ?? 3,
      breadth: config.breadth ?? 3,
      prune_threshold: config.prune_threshold ?? 0.4,
      max_survivors: config.max_survivors ?? 5,
      select_count: config.select_count ?? 1,
      expand_leaves: config.expand_leaves ?? true,
      // New adaptive options
      adaptive_beam: config.adaptive_beam ?? true,
      min_beam: config.min_beam ?? 3,
      max_beam: config.max_beam ?? 20,
      early_stopping: config.early_stopping ?? true,
      improvement_threshold: config.improvement_threshold ?? 0.05,
      min_depth_for_early_stop: config.min_depth_for_early_stop ?? 3,
      diversity_penalty: config.diversity_penalty ?? true,
      diversity_weight: config.diversity_weight ?? 0.2,
    };
  }

  /**
   * Calculate variance of scores.
   */
  private calculateVariance(scores: number[]): number {
    if (scores.length === 0) return 0;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const squaredDiffs = scores.map((s) => Math.pow(s - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / scores.length;
  }

  /**
   * Calculate similarity between two variants (simple text-based).
   */
  private calculateSimilarity(v1: VariantSpec, v2: VariantSpec): number {
    // Simple Jaccard similarity on technologies and decisions
    const set1 = new Set([
      ...v1.technologies.map((t) => t.toLowerCase()),
      ...v1.decisions.map((d) => d.toLowerCase().slice(0, 50)),
    ]);
    const set2 = new Set([
      ...v2.technologies.map((t) => t.toLowerCase()),
      ...v2.decisions.map((d) => d.toLowerCase().slice(0, 50)),
    ]);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Apply diversity penalty to scores.
   */
  private applyDiversityPenalty(
    nodes: ExplorationNode[],
    weight: number
  ): void {
    // Sort by score descending
    const sorted = [...nodes].sort((a, b) => b.score - a.score);

    // For each node, penalize if too similar to higher-scored nodes
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      if (!current) continue;

      let maxSimilarity = 0;
      for (let j = 0; j < i; j++) {
        const higher = sorted[j];
        if (!higher) continue;
        const sim = this.calculateSimilarity(current.variant, higher.variant);
        if (sim > maxSimilarity) maxSimilarity = sim;
      }

      // Apply penalty
      current.score = current.score * (1 - maxSimilarity * weight);
    }
  }

  /**
   * Progress callback type.
   */
  private onProgress?: (msg: string) => void;

  /**
   * Set progress callback.
   */
  setProgressCallback(cb: (msg: string) => void): void {
    this.onProgress = cb;
  }

  /**
   * Log progress.
   */
  private log(msg: string): void {
    if (this.onProgress) {
      this.onProgress(msg);
    }
  }

  /**
   * Run deep exploration on a goal.
   */
  async explore(
    goal: string,
    adapter: ModelAdapter,
    context: GeneratorContext
  ): Promise<ExplorationResult> {
    const nodes = new Map<string, ExplorationNode>();
    let nodeCounter = 0;
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let totalLatency = 0;

    // Adaptive beam state
    let currentBeamWidth = this.config.max_survivors;
    let prevBestScore = 0;

    const generateId = () => `node_${++nodeCounter}`;

    try {
      // Level 0: Generate initial variants
      this.log(`[L0] Generating ${this.config.breadth} initial variants...`);
      const rootId = generateId();
      const expandStartTime = performance.now();
      const initialResult = await this.expander.generate(
        {
          goal,
          count: this.config.breadth,
          constraints: context.constraints,
          context: context.metadata,
        },
        adapter,
        context
      );

      totalTokensInput += initialResult.model_info.tokens_input;
      totalTokensOutput += initialResult.model_info.tokens_output;
      totalLatency += initialResult.model_info.latency_ms;
      const expandDuration = Math.round(performance.now() - expandStartTime);
      this.log(`[L0] Generated ${initialResult.result.variants.length} variants in ${expandDuration}ms`);

      // Create root node (virtual)
      const rootNode: ExplorationNode = {
        id: rootId,
        parent_id: null,
        depth: 0,
        variant: {
          title: 'Root',
          approach: goal,
          decisions: [],
          technologies: [],
          challenges: [],
          limitations: [],
          tradeoffs: { pros: [], cons: [] },
          complexity: 'moderate',
          confidence: 1,
        },
        score: 1,
        pruned: false,
        selected: false,
        children: [],
        metadata: {
          generator: 'root',
          tokens_used: 0,
          latency_ms: 0,
        },
      };
      nodes.set(rootId, rootNode);

      // Create child nodes from initial variants
      for (const variant of initialResult.result.variants) {
        const childId = generateId();
        const childNode: ExplorationNode = {
          id: childId,
          parent_id: rootId,
          depth: 1,
          variant,
          score: variant.confidence,
          pruned: false,
          selected: false,
          children: [],
          metadata: {
            generator: 'G1',
            tokens_used: Math.round(
              (initialResult.model_info.tokens_input + initialResult.model_info.tokens_output) /
                initialResult.result.variants.length
            ),
            latency_ms: Math.round(initialResult.model_info.latency_ms / initialResult.result.variants.length),
          },
        };
        nodes.set(childId, childNode);
        rootNode.children.push(childId);
      }

      // Prune level 1
      const level1Nodes = Array.from(nodes.values()).filter((n) => n.depth === 1);
      if (level1Nodes.length > 0) {
        this.log(`[L1] Pruning ${level1Nodes.length} variants...`);
        const pruneStartTime = performance.now();
        const pruneResult = await this.pruner.generate(
          {
            goal,
            variants: level1Nodes.map((n) => n.variant),
            constraints: context.constraints,
            criteria: ['feasibility', 'simplicity', 'maintainability', 'alignment'],
          },
          adapter,
          context
        );

        totalTokensInput += pruneResult.model_info.tokens_input;
        totalTokensOutput += pruneResult.model_info.tokens_output;
        totalLatency += pruneResult.model_info.latency_ms;
        const pruneDuration = Math.round(performance.now() - pruneStartTime);

        // Apply pruning decisions
        let prunedCount = 0;
        for (const evaluation of pruneResult.result.evaluations) {
          const node = level1Nodes.find((n) => n.variant.title === evaluation.title);
          if (node) {
            node.score = evaluation.score;
            node.pruned = evaluation.prune || evaluation.score < this.config.prune_threshold;
            if (node.pruned) {
              node.prune_reason = evaluation.reason;
              prunedCount++;
            }
          }
        }
        const survivorCount = level1Nodes.length - prunedCount;
        this.log(`[L1] Pruned ${prunedCount}, ${survivorCount} survivors (${pruneDuration}ms)`);
      }

      // Expand surviving nodes to deeper levels
      for (let depth = 2; depth <= this.config.max_depth; depth++) {
        // Get candidates sorted by score
        const candidates = Array.from(nodes.values())
          .filter((n) => n.depth === depth - 1 && !n.pruned)
          .sort((a, b) => b.score - a.score);

        if (candidates.length === 0) {
          this.log(`[L${depth}] No survivors to expand, stopping.`);
          break;
        }

        // Adaptive beam width
        if (this.config.adaptive_beam && candidates.length > 0) {
          const scores = candidates.map((n) => n.score);
          const variance = this.calculateVariance(scores);

          // Low variance = similar scores = narrow beam (focus)
          // High variance = spread scores = widen beam (explore)
          if (variance < 0.01) {
            currentBeamWidth = Math.max(this.config.min_beam, currentBeamWidth - 2);
            this.log(`[L${depth}] Low variance (${variance.toFixed(3)}), narrowing beam to ${currentBeamWidth}`);
          } else if (variance > 0.04) {
            currentBeamWidth = Math.min(this.config.max_beam, currentBeamWidth + 2);
            this.log(`[L${depth}] High variance (${variance.toFixed(3)}), widening beam to ${currentBeamWidth}`);
          }
        }

        // Early stopping check
        if (this.config.early_stopping && depth > this.config.min_depth_for_early_stop) {
          const bestScore = candidates[0]?.score ?? 0;
          const improvement = bestScore - prevBestScore;

          if (improvement < this.config.improvement_threshold && prevBestScore > 0) {
            this.log(`[L${depth}] Early stopping: improvement ${(improvement * 100).toFixed(1)}% < threshold ${(this.config.improvement_threshold * 100).toFixed(1)}%`);
            break;
          }
          prevBestScore = bestScore;
        }

        // Take top beam_width nodes
        const parentNodes = candidates.slice(0, currentBeamWidth);

        if (parentNodes.length === 0) {
          this.log(`[L${depth}] No survivors after beam selection, stopping.`);
          break;
        }

        this.log(`[L${depth}] Expanding ${parentNodes.length} survivors...`);
        let levelNodesGenerated = 0;
        const levelStartTime = performance.now();

        for (let pIdx = 0; pIdx < parentNodes.length; pIdx++) {
          const parent = parentNodes[pIdx]!;
          // Expand this node
          this.log(`[L${depth}] Expanding ${pIdx + 1}/${parentNodes.length}: "${parent.variant.title.slice(0, 30)}..."`);
          const expandResult = await this.expander.generate(
            {
              goal,
              parent: parent.variant,
              count: Math.max(2, this.config.breadth - 1), // Slightly fewer at deeper levels
              constraints: context.constraints,
              context: context.metadata,
            },
            adapter,
            context
          );

          totalTokensInput += expandResult.model_info.tokens_input;
          totalTokensOutput += expandResult.model_info.tokens_output;
          totalLatency += expandResult.model_info.latency_ms;
          levelNodesGenerated += expandResult.result.variants.length;

          // Create child nodes
          for (const variant of expandResult.result.variants) {
            const childId = generateId();
            const childNode: ExplorationNode = {
              id: childId,
              parent_id: parent.id,
              depth,
              variant,
              score: variant.confidence,
              pruned: false,
              selected: false,
              children: [],
              metadata: {
                generator: 'G1',
                tokens_used: Math.round(
                  (expandResult.model_info.tokens_input + expandResult.model_info.tokens_output) /
                    Math.max(1, expandResult.result.variants.length)
                ),
                latency_ms: Math.round(
                  expandResult.model_info.latency_ms / Math.max(1, expandResult.result.variants.length)
                ),
              },
            };
            nodes.set(childId, childNode);
            parent.children.push(childId);
          }
        }

        const levelExpandDuration = Math.round(performance.now() - levelStartTime);
        this.log(`[L${depth}] Generated ${levelNodesGenerated} variants in ${levelExpandDuration}ms`);

        // Prune current level
        const currentLevelNodes = Array.from(nodes.values()).filter(
          (n) => n.depth === depth && !n.pruned
        );
        if (currentLevelNodes.length > 0) {
          this.log(`[L${depth}] Pruning ${currentLevelNodes.length} variants...`);
          const levelPruneStartTime = performance.now();
          const pruneResult = await this.pruner.generate(
            {
              goal,
              variants: currentLevelNodes.map((n) => n.variant),
              constraints: context.constraints,
              criteria: ['feasibility', 'simplicity', 'maintainability', 'alignment'],
            },
            adapter,
            context
          );

          totalTokensInput += pruneResult.model_info.tokens_input;
          totalTokensOutput += pruneResult.model_info.tokens_output;
          totalLatency += pruneResult.model_info.latency_ms;

          let levelPrunedCount = 0;
          for (const evaluation of pruneResult.result.evaluations) {
            const node = currentLevelNodes.find((n) => n.variant.title === evaluation.title);
            if (node) {
              node.score = evaluation.score;
              node.pruned = evaluation.prune || evaluation.score < this.config.prune_threshold;
              if (node.pruned) {
                node.prune_reason = evaluation.reason;
                levelPrunedCount++;
              }
            }
          }

          // Apply diversity penalty to surviving nodes
          if (this.config.diversity_penalty) {
            const survivors = currentLevelNodes.filter((n) => !n.pruned);
            if (survivors.length > 1) {
              this.applyDiversityPenalty(survivors, this.config.diversity_weight);

              // Re-prune based on adjusted scores
              for (const node of survivors) {
                if (node.score < this.config.prune_threshold && !node.pruned) {
                  node.pruned = true;
                  node.prune_reason = 'diversity_penalty';
                  levelPrunedCount++;
                }
              }
            }
          }

          const levelPruneDuration = Math.round(performance.now() - levelPruneStartTime);
          const levelSurvivorCount = currentLevelNodes.length - levelPrunedCount;
          this.log(`[L${depth}] Pruned ${levelPrunedCount}, ${levelSurvivorCount} survivors (${levelPruneDuration}ms)`);
        }

        // Summary for this level
        const totalNodesNow = nodes.size;
        this.log(`[L${depth}] Level complete. Total nodes: ${totalNodesNow}`);
      }

      // Select final variants
      this.log(`[SELECT] Finding best from ${nodes.size} total nodes...`);
      const leafNodes = Array.from(nodes.values()).filter(
        (n) => n.children.length === 0 && !n.pruned && n.depth > 0
      );
      this.log(`[SELECT] ${leafNodes.length} leaf candidates`);
      const selected = this.selector.select(leafNodes, this.config.select_count);
      for (const node of selected) {
        node.selected = true;
      }
      this.log(`[SELECT] Selected ${selected.length} final variants`);
      const best = selected[0];
      if (best) {
        this.log(`[SELECT] Best: "${best.variant.title}" (${(best.score * 100).toFixed(0)}%)`);
      }

      // Build metrics
      const allNodes = Array.from(nodes.values());
      const nodesPerDepth: number[] = [];
      let maxDepth = 0;
      let maxBreadth = 0;

      for (const node of allNodes) {
        if (node.depth > maxDepth) maxDepth = node.depth;
        nodesPerDepth[node.depth] = (nodesPerDepth[node.depth] || 0) + 1;
      }
      for (const count of nodesPerDepth) {
        if (count > maxBreadth) maxBreadth = count;
      }

      // Build paths from root to selected
      const paths: string[][] = [];
      for (const node of selected) {
        const path: string[] = [];
        let current: ExplorationNode | undefined = node;
        while (current) {
          path.unshift(current.id);
          current = current.parent_id ? nodes.get(current.parent_id) : undefined;
        }
        paths.push(path);
      }

      const metrics: ExplorationMetrics = {
        max_depth: maxDepth,
        max_breadth: maxBreadth,
        total_nodes: allNodes.length,
        pruned_nodes: allNodes.filter((n) => n.pruned).length,
        selected_nodes: selected.length,
        nodes_per_depth: nodesPerDepth,
        total_tokens: {
          input: totalTokensInput,
          output: totalTokensOutput,
        },
        total_latency_ms: totalLatency,
        paths,
      };

      return {
        success: true,
        nodes,
        root_id: rootId,
        selected_ids: selected.map((n) => n.id),
        metrics,
      };
    } catch (error) {
      return {
        success: false,
        nodes,
        root_id: 'error',
        selected_ids: [],
        metrics: {
          max_depth: 0,
          max_breadth: 0,
          total_nodes: nodes.size,
          pruned_nodes: 0,
          selected_nodes: 0,
          nodes_per_depth: [],
          total_tokens: { input: totalTokensInput, output: totalTokensOutput },
          total_latency_ms: totalLatency,
          paths: [],
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get the full path from root to a node.
   */
  getPath(nodes: Map<string, ExplorationNode>, nodeId: string): ExplorationNode[] {
    const path: ExplorationNode[] = [];
    let current = nodes.get(nodeId);
    while (current) {
      path.unshift(current);
      current = current.parent_id ? nodes.get(current.parent_id) : undefined;
    }
    return path;
  }
}

// =============================================================================
// Helpers
// =============================================================================

interface RawVariant {
  title?: string;
  approach?: string;
  decisions?: string[];
  technologies?: string[];
  challenges?: Array<{ problem?: string; solution?: string }>;
  limitations?: string[];
  data_flow?: string;
  tradeoffs?: {
    pros?: string[];
    cons?: string[];
  };
  complexity?: string;
  confidence?: number;
}

interface RawEvaluation {
  title?: string;
  score?: number;
  prune?: boolean;
  reason?: string;
  criteria_scores?: Record<string, number>;
}

function validateComplexity(c: string | undefined): VariantSpec['complexity'] {
  const valid = ['trivial', 'simple', 'moderate', 'complex', 'very_complex'];
  if (c && valid.includes(c)) return c as VariantSpec['complexity'];
  return 'moderate';
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an exploration engine.
 */
export function createExplorationEngine(
  config?: Partial<ExplorationConfig>
): ExplorationEngine {
  return new ExplorationEngine(config);
}
