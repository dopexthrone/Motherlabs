/**
 * Kernel-Agent Bridge
 * ===================
 *
 * Connects the deterministic kernel (decomposition, entropy, bundling)
 * with the AI agent system (generation, RAG, eval, improve).
 *
 * This bridge enables:
 * - Using AI to generate code from decomposed intents
 * - Using RAG to find context for proposals
 * - Using eval to validate generated code
 * - Using improve to auto-enhance capabilities
 */

import type { ModelAdapter } from '../adapters/model.js';
import type { Bundle, ContextNode } from '../types/artifacts.js';
import type { Proposal, ProposedAction } from '../protocol/proposal.js';
import { CodingAgent, createCodingAgent, type AgentConfig, type GenerationResult } from '../agent/index.js';
import { evaluate, type EvalReport } from '../eval/index.js';
import { createImprovementProtocol, type ImprovementConfig, type ImprovementCycle } from '../improve/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Bridge configuration.
 */
export interface BridgeConfig {
  /**
   * Model adapter for AI operations.
   */
  adapter: ModelAdapter;

  /**
   * Agent configuration overrides.
   */
  agent?: Partial<AgentConfig>;

  /**
   * Improvement protocol configuration.
   */
  improve?: Partial<ImprovementConfig>;

  /**
   * Workspace directory for RAG indexing.
   */
  workspace?: string;

  /**
   * Enable automatic RAG indexing on init.
   */
  auto_index?: boolean;
}

/**
 * Result of generating code from a decomposition.
 */
export interface DecompositionCodeResult {
  /**
   * Generated code per node.
   */
  code: Map<string, GenerationResult>;

  /**
   * Combined code (if applicable).
   */
  combined?: string;

  /**
   * Evaluation results.
   */
  eval?: EvalReport;

  /**
   * Total generation time.
   */
  duration_ms: number;
}

/**
 * Result of generating code for a proposal action.
 */
export interface ActionCodeResult {
  /**
   * The action this code is for.
   */
  action: ProposedAction;

  /**
   * Generated code.
   */
  generation: GenerationResult;

  /**
   * Evaluation result.
   */
  eval?: EvalReport;
}

// =============================================================================
// Bridge
// =============================================================================

/**
 * Bridge connecting kernel operations to AI agent capabilities.
 */
export class KernelAgentBridge {
  private readonly adapter: ModelAdapter;
  private readonly config: BridgeConfig;
  private agent: CodingAgent | null = null;
  private initialized = false;

  constructor(config: BridgeConfig) {
    this.adapter = config.adapter;
    this.config = config;
  }

  /**
   * Initialize the bridge (starts agent, indexes workspace).
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Create and start agent
    this.agent = createCodingAgent(this.adapter, {
      enable_rag: true,
      auto_eval: true,
      ...this.config.agent,
    });

    // Start with optional workspace indexing
    if (this.config.auto_index && this.config.workspace) {
      await this.agent.start(this.config.workspace);
    } else {
      await this.agent.start();
    }

    this.initialized = true;
  }

  /**
   * Ensure bridge is initialized.
   */
  private ensureInit(): void {
    if (!this.initialized || !this.agent) {
      throw new Error('Bridge not initialized. Call init() first.');
    }
  }

  /**
   * Index a directory for RAG context.
   */
  async indexDirectory(dir: string): Promise<number> {
    this.ensureInit();
    return this.agent!.indexWorkspace(dir);
  }

  // ===========================================================================
  // Decomposition → Code
  // ===========================================================================

  /**
   * Generate code from terminal nodes in a decomposition.
   */
  async generateFromNodes(
    nodes: ContextNode[],
    language: string = 'python'
  ): Promise<DecompositionCodeResult> {
    this.ensureInit();
    const startTime = performance.now();
    const codeMap = new Map<string, GenerationResult>();

    // Filter to terminal nodes
    const terminalNodes = nodes.filter((n) => n.status === 'terminal');

    // Generate code for each node
    for (const node of terminalNodes) {
      const prompt = this.buildPromptFromNode(node);
      const result = await this.agent!.generate({
        prompt,
        language,
      });
      codeMap.set(node.id, result);
    }

    // Combine successful generations
    const successfulCode = Array.from(codeMap.values())
      .filter((r) => r.success && r.code)
      .map((r) => r.code!)
      .join('\n\n');

    // Build result
    const result: DecompositionCodeResult = {
      code: codeMap,
      duration_ms: Math.round(performance.now() - startTime),
    };

    // Add combined code if we have any
    if (successfulCode) {
      result.combined = successfulCode;
      result.eval = await evaluate(successfulCode, 'main', { num_tests: 10 });
    }

    return result;
  }

  /**
   * Build a generation prompt from a context node.
   */
  private buildPromptFromNode(node: ContextNode): string {
    const parts: string[] = [];

    // Add main goal
    parts.push(`Task: ${node.goal}`);

    // Add constraints
    if (node.constraints.length > 0) {
      parts.push('\nConstraints:');
      for (const c of node.constraints) {
        parts.push(`- ${c}`);
      }
    }

    // Add entropy context (use unresolved_refs as proxy for complexity)
    parts.push(`\nComplexity: ${node.entropy.unresolved_refs} unresolved refs, ${node.entropy.schema_gaps} schema gaps`);

    return parts.join('\n');
  }

  // ===========================================================================
  // Proposal → Code
  // ===========================================================================

  /**
   * Generate code for proposal actions.
   */
  async generateForProposal(
    proposal: Proposal,
    language: string = 'python'
  ): Promise<ActionCodeResult[]> {
    this.ensureInit();
    const results: ActionCodeResult[] = [];

    // Filter to code-related actions
    const codeActions = proposal.actions.filter(
      (a) => a.type === 'create_file' || a.type === 'modify_file'
    );

    for (const action of codeActions) {
      const prompt = this.buildPromptFromAction(action, proposal);
      const generation = await this.agent!.generate({
        prompt,
        language,
      });

      const actionResult: ActionCodeResult = {
        action,
        generation,
      };

      // Add eval if generation succeeded
      if (generation.success && generation.code) {
        actionResult.eval = await evaluate(generation.code, 'main', { num_tests: 5 });
      }

      results.push(actionResult);
    }

    return results;
  }

  /**
   * Build a prompt from a proposal action.
   */
  private buildPromptFromAction(action: ProposedAction, proposal: Proposal): string {
    const parts: string[] = [];

    parts.push(`Action: ${action.description}`);
    parts.push(`Type: ${action.type}`);

    if (action.target) {
      parts.push(`Target: ${action.target}`);
    }

    // Add acceptance tests as requirements
    if (proposal.acceptance_tests.length > 0) {
      parts.push('\nRequirements (must pass these tests):');
      for (const test of proposal.acceptance_tests) {
        parts.push(`- ${test.name}`);
      }
    }

    return parts.join('\n');
  }

  // ===========================================================================
  // Bundle → Improvement
  // ===========================================================================

  /**
   * Analyze a bundle and suggest improvements.
   */
  async analyzeBundle(bundle: Bundle): Promise<{
    suggestions: string[];
    canAutoImprove: boolean;
  }> {
    this.ensureInit();

    // Analyze bundle stats
    const suggestions: string[] = [];

    if (bundle.stats.total_nodes > 50) {
      suggestions.push('Bundle is large - consider breaking into smaller bundles');
    }

    // Check terminal ratio
    const terminalRatio = bundle.stats.terminal_nodes / bundle.stats.total_nodes;
    if (terminalRatio < 0.5) {
      suggestions.push('Low terminal ratio - decomposition may be incomplete');
    }

    if (bundle.stats.max_depth > 10) {
      suggestions.push('Deep decomposition tree - consider flattening');
    }

    return {
      suggestions,
      canAutoImprove: suggestions.length > 0,
    };
  }

  // ===========================================================================
  // Self-Improvement
  // ===========================================================================

  /**
   * Run a self-improvement cycle on a target component.
   */
  async improve(target: string): Promise<ImprovementCycle> {
    const protocol = createImprovementProtocol(this.adapter, {
      dry_run: false,
      require_human_approval: false,
      ...this.config.improve,
    });

    return protocol.runCycle(target);
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Get the underlying agent.
   */
  getAgent(): CodingAgent | null {
    return this.agent;
  }

  /**
   * Shutdown the bridge.
   */
  async shutdown(): Promise<void> {
    if (this.agent) {
      await this.agent.stop();
      this.agent = null;
    }
    this.initialized = false;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a kernel-agent bridge.
 */
export function createBridge(config: BridgeConfig): KernelAgentBridge {
  return new KernelAgentBridge(config);
}
