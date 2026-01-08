#!/usr/bin/env npx tsx
/**
 * Deep Exploration CLI
 * ====================
 *
 * Runs deep exploration of solution space with metrics.
 *
 * Usage:
 *   npx tsx tools/deep_explore.ts --goal "Build a REST API"
 *   npx tsx tools/deep_explore.ts --goal "Build a REST API" --depth 3 --breadth 3
 *   npx tsx tools/deep_explore.ts --goal "Build a REST API" --provider google
 */

import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import {
  createAdapter,
  isOllamaAvailable,
  listOllamaModels,
  type AdapterProvider,
} from '../src/adapters/index.js';
import {
  createExplorationEngine,
  type GeneratorContext,
  type ExplorationNode,
} from '../src/generators/index.js';

// =============================================================================
// CLI Argument Parsing
// =============================================================================

const { values } = parseArgs({
  options: {
    goal: {
      type: 'string',
      short: 'g',
      description: 'The goal to explore',
    },
    provider: {
      type: 'string',
      short: 'p',
      description: 'Provider: ollama, google, openai, anthropic',
    },
    model: {
      type: 'string',
      short: 'm',
      description: 'Model name',
    },
    depth: {
      type: 'string',
      short: 'd',
      description: 'Maximum exploration depth (default: 3)',
    },
    breadth: {
      type: 'string',
      short: 'b',
      description: 'Variants per node (default: 3)',
    },
    select: {
      type: 'string',
      short: 's',
      description: 'Number of final variants to select (default: 1)',
    },
    survivors: {
      type: 'string',
      description: 'Max survivors per level (default: 5, increase for more nodes)',
    },
    verbose: {
      type: 'boolean',
      short: 'v',
      description: 'Verbose output',
    },
    help: {
      type: 'boolean',
      short: 'h',
      description: 'Show help',
    },
  },
  allowPositionals: true,
});

// =============================================================================
// Visualization Helpers
// =============================================================================

function drawTree(
  nodes: Map<string, ExplorationNode>,
  rootId: string,
  selectedIds: Set<string>
): string {
  const lines: string[] = [];

  function traverse(nodeId: string, prefix: string, isLast: boolean): void {
    const node = nodes.get(nodeId);
    if (!node) return;

    const connector = isLast ? '└── ' : '├── ';
    const status = node.pruned
      ? '✗'
      : node.selected
        ? '★'
        : '○';
    const score = node.depth > 0 ? ` [${(node.score * 100).toFixed(0)}%]` : '';
    const title = node.depth === 0 ? 'ROOT' : node.variant.title;

    lines.push(`${prefix}${connector}${status} ${title}${score}`);

    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      traverse(children[i], childPrefix, i === children.length - 1);
    }
  }

  traverse(rootId, '', true);
  return lines.join('\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  if (values.help) {
    console.log(`
Deep Exploration CLI
====================

Explore solution space with depth-first traversal, pruning, and selection.

Usage:
  npx tsx tools/deep_explore.ts --goal "Your goal"
  npx tsx tools/deep_explore.ts -g "Your goal" -d 3 -b 3
  npx tsx tools/deep_explore.ts -g "Your goal" -p google

Options:
  -g, --goal       The goal to explore (required)
  -p, --provider   Provider: ollama (default), google, openai, anthropic
  -m, --model      Model name
  -d, --depth      Maximum exploration depth (default: 3)
  -b, --breadth    Variants per node (default: 3)
  -s, --select     Final variants to select (default: 1)
  --survivors      Max survivors per level (default: 5, more = more nodes)
  -v, --verbose    Verbose output
  -h, --help       Show this help

Example:
  npx tsx tools/deep_explore.ts -g "Create a coding agent" -d 5 -b 4 --survivors 20
`);
    process.exit(0);
  }

  const goal = values.goal;
  if (!goal) {
    console.error('Error: --goal is required');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                    DEEP EXPLORATION ENGINE                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // Determine provider
  let provider: AdapterProvider = (values.provider as AdapterProvider) || 'ollama';
  if (!values.provider) {
    if (await isOllamaAvailable()) {
      provider = 'ollama';
      const models = await listOllamaModels();
      console.log(`Using local Ollama: ${models[0] || 'default'}`);
    } else if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      provider = 'google';
    } else if (process.env.OPENAI_API_KEY) {
      provider = 'openai';
    } else {
      console.error('No provider available. Start Ollama or set API keys.');
      process.exit(1);
    }
  }

  // Parse config
  const depth = parseInt(values.depth || '3', 10);
  const breadth = parseInt(values.breadth || '3', 10);
  const selectCount = parseInt(values.select || '1', 10);
  const maxSurvivors = parseInt(values.survivors || '5', 10);

  console.log(`Provider:  ${provider}${values.model ? ` (${values.model})` : ''}`);
  console.log(`Depth:     ${depth}`);
  console.log(`Breadth:   ${breadth}`);
  console.log(`Survivors: ${maxSurvivors}`);
  console.log(`Select:    ${selectCount}`);
  console.log(`Goal:      "${goal.slice(0, 60)}${goal.length > 60 ? '...' : ''}"`);
  console.log('');

  // Create adapter
  let adapter;
  try {
    adapter = values.model
      ? createAdapter({ provider, model: values.model })
      : createAdapter({ provider });
    console.log(`Adapter: ${adapter.model_id}`);
  } catch (error) {
    console.error(`Failed to create adapter: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Create context
  const context: GeneratorContext = {
    run_id: `explore_${randomBytes(4).toString('hex')}`,
    intent_id: `intent_${randomBytes(4).toString('hex')}`,
    mode: 'plan-only',
    constraints: [],
    working_dir: process.cwd(),
    metadata: { deep_exploration: true },
  };

  console.log(`Run ID: ${context.run_id}\n`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                         EXPLORING...                               ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Run exploration
  const startTime = performance.now();
  const engine = createExplorationEngine({
    max_depth: depth,
    breadth,
    select_count: selectCount,
    prune_threshold: 0.5, // Aggressive pruning - only keep quality variants
    max_survivors: maxSurvivors,
  });

  // Wire up progress logging
  engine.setProgressCallback((msg) => {
    const elapsed = formatDuration(Math.round(performance.now() - startTime));
    console.log(`[${elapsed}] ${msg}`);
  });

  const result = await engine.explore(goal, adapter, context);
  const totalDuration = Math.round(performance.now() - startTime);

  // Display results
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                         EXPLORATION RESULTS                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (!result.success) {
    console.log(`Status: FAILED`);
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }

  // Metrics
  const m = result.metrics;
  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│                          METRICS                               │');
  console.log('├────────────────────────────────────────────────────────────────┤');
  console.log(`│  Depth:           ${String(m.max_depth).padEnd(10)} Breadth:        ${String(m.max_breadth).padEnd(10)}│`);
  console.log(`│  Total Nodes:     ${String(m.total_nodes).padEnd(10)} Pruned:         ${String(m.pruned_nodes).padEnd(10)}│`);
  console.log(`│  Selected:        ${String(m.selected_nodes).padEnd(10)} Paths:          ${String(m.paths.length).padEnd(10)}│`);
  console.log('├────────────────────────────────────────────────────────────────┤');
  console.log(`│  Tokens In:       ${String(m.total_tokens.input).padEnd(10)} Tokens Out:     ${String(m.total_tokens.output).padEnd(10)}│`);
  console.log(`│  LLM Latency:     ${formatDuration(m.total_latency_ms).padEnd(10)} Total Time:     ${formatDuration(totalDuration).padEnd(10)}│`);
  console.log('├────────────────────────────────────────────────────────────────┤');
  console.log(`│  Nodes per Depth: ${m.nodes_per_depth.map((n, i) => `L${i}:${n}`).join(' ').padEnd(43)}│`);
  console.log('└────────────────────────────────────────────────────────────────┘\n');

  // Tree visualization
  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│                      EXPLORATION TREE                          │');
  console.log('│   ○ = explored   ✗ = pruned   ★ = selected                     │');
  console.log('├────────────────────────────────────────────────────────────────┤');
  const tree = drawTree(result.nodes, result.root_id, new Set(result.selected_ids));
  for (const line of tree.split('\n')) {
    console.log(`│ ${line.padEnd(65)}│`);
  }
  console.log('└────────────────────────────────────────────────────────────────┘\n');

  // Selected variants
  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│                      SELECTED VARIANTS                         │');
  console.log('└────────────────────────────────────────────────────────────────┘');

  for (const nodeId of result.selected_ids) {
    const node = result.nodes.get(nodeId);
    if (!node) continue;

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`★ ${node.variant.title} [Score: ${(node.score * 100).toFixed(0)}%]`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`Approach: ${node.variant.approach}`);
    console.log(`Complexity: ${node.variant.complexity}`);

    if (node.variant.technologies && node.variant.technologies.length > 0) {
      console.log('\nTechnologies:');
      for (const t of node.variant.technologies) {
        console.log(`  • ${t}`);
      }
    }

    if (node.variant.challenges && node.variant.challenges.length > 0) {
      console.log('\nKey Challenges:');
      for (const c of node.variant.challenges) {
        console.log(`  ⚠ ${c.problem}`);
        console.log(`    → ${c.solution}`);
      }
    }

    if (node.variant.limitations && node.variant.limitations.length > 0) {
      console.log('\nLimitations:');
      for (const l of node.variant.limitations) {
        console.log(`  ✗ ${l}`);
      }
    }

    if (node.variant.data_flow) {
      console.log(`\nData Flow: ${node.variant.data_flow}`);
    }

    if (node.variant.decisions.length > 0) {
      console.log('\nDecisions:');
      for (const d of node.variant.decisions) {
        console.log(`  - ${d}`);
      }
    }

    if (node.variant.tradeoffs.pros.length > 0) {
      console.log('\nPros:');
      for (const p of node.variant.tradeoffs.pros) {
        console.log(`  + ${p}`);
      }
    }

    if (node.variant.tradeoffs.cons.length > 0) {
      console.log('\nCons:');
      for (const c of node.variant.tradeoffs.cons) {
        console.log(`  - ${c}`);
      }
    }

    // Show path
    const path = engine.getPath(result.nodes, nodeId);
    console.log(`\nPath: ${path.map((n) => n.variant.title).join(' → ')}`);
  }

  // Verbose: show all nodes
  if (values.verbose) {
    console.log('\n');
    console.log('┌────────────────────────────────────────────────────────────────┐');
    console.log('│                        ALL NODES                               │');
    console.log('└────────────────────────────────────────────────────────────────┘\n');

    for (const [id, node] of result.nodes) {
      if (node.depth === 0) continue;
      const status = node.pruned ? 'PRUNED' : node.selected ? 'SELECTED' : 'explored';
      console.log(`[${id}] D${node.depth} - ${node.variant.title}`);
      console.log(`  Status: ${status}  Score: ${(node.score * 100).toFixed(0)}%`);
      if (node.pruned && node.prune_reason) {
        console.log(`  Prune reason: ${node.prune_reason}`);
      }
      console.log('');
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                              DONE                                  ');
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
