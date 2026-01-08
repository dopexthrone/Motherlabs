#!/usr/bin/env npx tsx
/**
 * Generator Test Harness
 * ======================
 *
 * CLI tool for testing LLM-powered generators.
 * Defaults to local Ollama for cost-free testing.
 *
 * Usage:
 *   npx tsx tools/test_generators.ts --goal "Add a login form"
 *   npx tsx tools/test_generators.ts --goal "Add a login form" --provider google
 *   npx tsx tools/test_generators.ts --goal "Add a login form" --provider openai --model gpt-4o-mini
 *
 * Environment Variables:
 *   GOOGLE_API_KEY or GEMINI_API_KEY - For Google Gemini
 *   OPENAI_API_KEY - For OpenAI
 *   ANTHROPIC_API_KEY - For Claude
 *   OLLAMA_BASE_URL - For local Ollama (default: http://localhost:11434)
 */

import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import {
  createAdapter,
  createAutoAdapter,
  isOllamaAvailable,
  listOllamaModels,
  type AdapterProvider,
} from '../src/adapters/index.js';
import {
  createOrchestrator,
  type GeneratorContext,
} from '../src/generators/index.js';

// =============================================================================
// CLI Argument Parsing
// =============================================================================

const { values } = parseArgs({
  options: {
    goal: {
      type: 'string',
      short: 'g',
      description: 'The intent goal to process',
    },
    provider: {
      type: 'string',
      short: 'p',
      description: 'Provider: ollama, google, openai, anthropic, mock',
    },
    model: {
      type: 'string',
      short: 'm',
      description: 'Model name (provider-specific)',
    },
    'skip-clarify': {
      type: 'boolean',
      description: 'Skip clarification step',
      default: false,
    },
    'auto-clarify': {
      type: 'boolean',
      description: 'Auto-answer clarification questions',
      default: false,
    },
    verbose: {
      type: 'boolean',
      short: 'v',
      description: 'Verbose output',
      default: false,
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
// Main
// =============================================================================

async function main(): Promise<void> {
  // Show help
  if (values.help) {
    console.log(`
Generator Test Harness
======================

Test LLM-powered generators with local or cloud models.

Usage:
  npx tsx tools/test_generators.ts --goal "Your intent"
  npx tsx tools/test_generators.ts -g "Your intent" -p google
  npx tsx tools/test_generators.ts -g "Your intent" -p openai -m gpt-4o-mini

Options:
  -g, --goal         The intent goal to process (required)
  -p, --provider     Provider: ollama (default), google, openai, anthropic, mock
  -m, --model        Model name (provider-specific)
  --skip-clarify     Skip clarification step
  --auto-clarify     Auto-answer clarification questions
  -v, --verbose      Verbose output
  -h, --help         Show this help

Environment:
  GOOGLE_API_KEY     For Google Gemini
  OPENAI_API_KEY     For OpenAI
  ANTHROPIC_API_KEY  For Claude (Anthropic)
  OLLAMA_BASE_URL    For local Ollama (default: http://localhost:11434)

Examples:
  # Test with local Ollama (free)
  npx tsx tools/test_generators.ts -g "Add a user authentication system"

  # Test with Gemini
  npx tsx tools/test_generators.ts -g "Create a REST API" -p google

  # Test with specific OpenAI model
  npx tsx tools/test_generators.ts -g "Build a CLI tool" -p openai -m gpt-4o-mini
`);
    process.exit(0);
  }

  // Validate goal
  const goal = values.goal;
  if (!goal) {
    console.error('Error: --goal is required');
    console.error('Run with --help for usage');
    process.exit(1);
  }

  console.log('========================================');
  console.log('Generator Test Harness');
  console.log('========================================\n');

  // Determine provider
  let provider: AdapterProvider | undefined = values.provider as AdapterProvider | undefined;

  if (!provider) {
    // Auto-detect: prefer Ollama for local testing
    if (await isOllamaAvailable()) {
      provider = 'ollama';
      const models = await listOllamaModels();
      console.log(`Found local Ollama with models: ${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}`);
    } else if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      provider = 'google';
    } else if (process.env.OPENAI_API_KEY) {
      provider = 'openai';
    } else if (process.env.ANTHROPIC_API_KEY) {
      provider = 'anthropic';
    } else {
      console.error('Error: No provider available');
      console.error('Either:');
      console.error('  1. Start Ollama locally: ollama serve');
      console.error('  2. Set GOOGLE_API_KEY or GEMINI_API_KEY');
      console.error('  3. Set OPENAI_API_KEY');
      console.error('  4. Set ANTHROPIC_API_KEY');
      process.exit(1);
    }
  }

  console.log(`Provider: ${provider}`);
  if (values.model) {
    console.log(`Model: ${values.model}`);
  }
  console.log(`Goal: "${goal}"`);
  console.log('');

  // Create adapter
  let adapter;
  try {
    if (values.model) {
      adapter = createAdapter({ provider, model: values.model });
    } else {
      adapter = createAdapter({ provider });
    }
    console.log(`Adapter created: ${adapter.model_id}`);
  } catch (error) {
    console.error(`Failed to create adapter: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Create orchestrator
  const orchestrator = createOrchestrator({
    skip_clarification: values['skip-clarify'],
    auto_clarify: values['auto-clarify'],
  });

  // Create context
  const context: GeneratorContext = {
    run_id: `test_${randomBytes(4).toString('hex')}`,
    intent_id: `intent_${randomBytes(4).toString('hex')}`,
    mode: 'plan-only',
    constraints: [],
    working_dir: process.cwd(),
    metadata: { test: true },
  };

  console.log(`Run ID: ${context.run_id}\n`);
  console.log('----------------------------------------');
  console.log('Processing...');
  console.log('----------------------------------------\n');

  // Process
  const startTime = performance.now();
  const result = await orchestrator.process(goal, adapter, context);
  const duration = Math.round(performance.now() - startTime);

  // Output results
  console.log('========================================');
  console.log('Results');
  console.log('========================================\n');

  console.log(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Stage: ${result.stage}`);
  console.log(`Duration: ${duration}ms (LLM: ${result.total_latency_ms}ms)`);
  console.log(`Tokens: ${result.total_tokens.input} in / ${result.total_tokens.output} out`);
  console.log('');

  if (result.error) {
    console.log(`Error: ${result.error}`);
    process.exit(1);
  }

  // Clarification results
  if (result.clarification) {
    console.log('----------------------------------------');
    console.log('Clarification (G0)');
    console.log('----------------------------------------');
    console.log(`Needs clarification: ${result.clarification.result.needs_clarification}`);
    console.log(`Reason: ${result.clarification.result.reason}`);

    if (result.clarification.result.questions.length > 0) {
      console.log('\nQuestions:');
      for (const q of result.clarification.result.questions) {
        console.log(`  [${q.priority}] (${q.category}) ${q.question}`);
        if (q.options) {
          console.log(`      Options: ${q.options.join(', ')}`);
        }
      }
    }

    if (values.verbose && result.clarification.raw_response) {
      console.log('\nRaw response:');
      console.log(result.clarification.raw_response);
    }
    console.log('');
  }

  // Blueprint results
  if (result.blueprint) {
    console.log('----------------------------------------');
    console.log('Blueprint (G3)');
    console.log('----------------------------------------');
    const bp = result.blueprint.result.blueprint;

    console.log(`Title: ${bp.title}`);
    console.log(`Description: ${bp.description}`);
    console.log(`Complexity: ${bp.complexity}`);
    console.log(`Confidence: ${Math.round(result.blueprint.result.confidence * 100)}%`);
    console.log(`Parsed: ${result.blueprint.parsed}`);

    if (bp.components.length > 0) {
      console.log('\nComponents:');
      for (const c of bp.components) {
        console.log(`  [${c.action}] ${c.name} (${c.type})`);
        console.log(`    Path: ${c.path || '(not specified)'}`);
        console.log(`    Purpose: ${c.purpose}`);
      }
    }

    if (bp.acceptance_criteria.length > 0) {
      console.log('\nAcceptance Criteria:');
      for (const ac of bp.acceptance_criteria) {
        console.log(`  - ${ac}`);
      }
    }

    if (bp.risks.length > 0) {
      console.log('\nRisks:');
      for (const r of bp.risks) {
        console.log(`  - ${r}`);
      }
    }

    if (result.blueprint.result.warnings?.length) {
      console.log('\nWarnings:');
      for (const w of result.blueprint.result.warnings) {
        console.log(`  - ${w}`);
      }
    }

    if (values.verbose && result.blueprint.raw_response) {
      console.log('\nRaw response:');
      console.log(result.blueprint.raw_response);
    }
  }

  console.log('\n========================================');
  console.log('Done');
  console.log('========================================');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
