#!/usr/bin/env npx tsx
/**
 * Explore Missing Capabilities
 * ============================
 *
 * Uses deep exploration to discover what capabilities are missing
 * from the context-engine-kernel.
 */

import { ExplorationEngine } from '../src/generators/exploration.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';
import type { GeneratorContext } from '../src/generators/types.js';
import { randomBytes } from 'node:crypto';

const API_KEY = process.env.GEMINI_API_KEY;

async function main() {
  console.log('\n🔍 Exploring Missing Capabilities');
  console.log('==================================\n');

  if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }

  const adapter = new GeminiAdapter({
    api_key: API_KEY,
    model: 'gemini-2.0-flash',
  });

  const exploration = new ExplorationEngine({
    max_depth: 5,
    breadth: 6,
    max_survivors: 10,
    prune_threshold: 0.25,
    adaptive_beam: true,
    min_beam: 4,
    max_beam: 12,
    early_stopping: false, // Disable to get more options
    improvement_threshold: 0.02,
    min_depth_for_early_stop: 4,
    diversity_penalty: true,
    diversity_weight: 0.2, // Higher diversity
  });

  const goal = `Identify MISSING CAPABILITIES in a code generation system. The system currently has:

EXISTING COMPONENTS:
1. Model Adapters (Gemini, Claude, OpenAI, Ollama) - for LLM calls
2. RAG System - vector embeddings, semantic search, code-aware chunking
3. Code Generator - generates code from prompts
4. Code Verifier - syntax checking
5. Internal Eval - differential testing, property testing, self-consistency, round-trip
6. Deep Exploration - beam search with adaptive width, early stopping
7. Self-Improvement Protocol - discover → select → implement → validate → integrate

WHAT'S MISSING? Explore capabilities that would make this system:
- More autonomous (less human intervention needed)
- More reliable (fewer errors, better validation)
- More capable (new things it can do)
- More efficient (faster, cheaper)

Focus on CONCRETE, IMPLEMENTABLE capabilities - not vague ideas.
Each capability should be buildable in 1-3 days.`;

  const context: GeneratorContext = {
    run_id: `run_${randomBytes(4).toString('hex')}`,
    intent_id: 'missing_capabilities',
    mode: 'execute',
    constraints: [
      'Must be implementable',
      'Must integrate with existing components',
      'Prefer capabilities that compound',
    ],
    working_dir: process.cwd(),
    metadata: {
      exploration_type: 'missing_capabilities',
    },
  };

  console.log('Starting exploration...\n');
  const startTime = Date.now();

  const result = await exploration.explore(goal, adapter, context);

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n⏱️  Exploration completed in ${duration} minutes`);
  console.log(`📊 Total nodes: ${result.nodes.size}`);
  console.log(`🎯 Selected: ${result.selected_ids.length}\n`);

  // Get all unpruned nodes sorted by score (not just selected)
  const allNodes = Array.from(result.nodes.values())
    .filter((n) => !n.pruned && n.score > 0.4)
    .sort((a, b) => b.score - a.score);

  const selected = allNodes.slice(0, 10); // Top 10

  console.log('=' .repeat(60));
  console.log('TOP MISSING CAPABILITIES');
  console.log('=' .repeat(60));

  for (let i = 0; i < selected.length; i++) {
    const node = selected[i];
    if (!node) continue;

    console.log(`\n#${i + 1}: ${node.variant.title}`);
    console.log(`    Score: ${(node.score * 100).toFixed(0)}%`);
    console.log(`    Approach: ${node.variant.approach.slice(0, 150)}...`);
    console.log(`    Technologies: ${node.variant.technologies.join(', ')}`);
    console.log(`    Key Decisions:`);
    for (const decision of node.variant.decisions.slice(0, 3)) {
      console.log(`      - ${decision.slice(0, 80)}`);
    }
  }

  // Save full results
  const output = {
    timestamp: new Date().toISOString(),
    duration_minutes: parseFloat(duration),
    total_nodes: result.nodes.size,
    selected_count: result.selected_ids.length,
    capabilities: selected.map((n) => ({
      rank: selected.indexOf(n) + 1,
      title: n.variant.title,
      score: n.score,
      approach: n.variant.approach,
      technologies: n.variant.technologies,
      decisions: n.variant.decisions,
      challenges: n.variant.challenges,
    })),
  };

  const fs = await import('node:fs/promises');
  await fs.writeFile(
    '/home/motherlabs/Desktop/missing_capabilities.json',
    JSON.stringify(output, null, 2)
  );
  console.log('\n📁 Full results saved to: ~/Desktop/missing_capabilities.json');
}

main().catch(console.error);
