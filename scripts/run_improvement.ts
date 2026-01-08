#!/usr/bin/env npx ts-node
/**
 * Self-Improvement Runner
 * =======================
 *
 * Runs the self-improvement protocol on a target component.
 *
 * Usage:
 *   npx ts-node scripts/run_improvement.ts [target] [--dry-run]
 *
 * Examples:
 *   npx ts-node scripts/run_improvement.ts eval --dry-run
 *   npx ts-node scripts/run_improvement.ts agent
 */

import { createImprovementProtocol, type ImprovementEvent } from '../src/improve/index.js';
import { GeminiAdapter } from '../src/adapters/gemini.js';

// =============================================================================
// Configuration
// =============================================================================

const API_KEY = process.env.GEMINI_API_KEY;
const TARGET = process.argv[2] || 'eval';
const DRY_RUN = process.argv.includes('--dry-run');

// =============================================================================
// Event Logger
// =============================================================================

function logEvent(event: ImprovementEvent): void {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const prefix = `[${time}] [${event.cycle_id.slice(0, 12)}]`;

  switch (event.type) {
    case 'cycle_started':
      console.log(`\n${'='.repeat(60)}`);
      console.log(`${prefix} 🚀 CYCLE STARTED`);
      console.log(`  Target: ${event.data.target}`);
      console.log(`  Iteration: ${event.data.iteration}`);
      console.log(`${'='.repeat(60)}\n`);
      break;

    case 'phase_entered':
      console.log(`${prefix} 📍 Phase: ${String(event.data.phase).toUpperCase()}`);
      break;

    case 'gate_checked':
      const gate = event.data.gate as { passed: boolean; reason: string };
      const icon = gate.passed ? '✅' : '❌';
      console.log(`${prefix} ${icon} Gate [${event.data.phase}]: ${gate.reason}`);
      break;

    case 'candidate_found':
      const candidate = event.data.candidate as { name: string; score: number };
      console.log(`${prefix}   📋 Candidate: ${candidate.name} (${(candidate.score * 100).toFixed(0)}%)`);
      break;

    case 'candidate_selected':
      const selected = event.data.candidate as { name: string; score: number };
      console.log(`${prefix} 🎯 Selected: ${selected.name}`);
      break;

    case 'implementation_started':
      if (event.data.dry_run) {
        console.log(`${prefix} 🔧 Implementation: DRY RUN (no changes)`);
      } else {
        console.log(`${prefix} 🔧 Implementation: Starting...`);
      }
      break;

    case 'implementation_step':
      const step = event.data.step as { description: string; file: string };
      console.log(`${prefix}   📝 Step: ${step.description}`);
      break;

    case 'validation_started':
      if (event.data.fix_attempt) {
        console.log(`${prefix} 🔧 Fix attempt ${event.data.fix_attempt}/3`);
        if (event.data.errors) {
          console.log(`${prefix}   Errors: ${String(event.data.errors).slice(0, 200)}...`);
        }
      } else {
        console.log(`${prefix} 🧪 Validation: Running...`);
      }
      break;

    case 'validation_complete':
      const validation = event.data.validation as {
        passed: boolean;
        score_before: number;
        score_after: number;
        delta: number;
      };
      const vIcon = validation.passed ? '✅' : '❌';
      console.log(`${prefix} ${vIcon} Validation: ${validation.passed ? 'PASSED' : 'FAILED'}`);
      console.log(`${prefix}   Score: ${(validation.score_before * 100).toFixed(0)}% → ${(validation.score_after * 100).toFixed(0)}% (Δ${(validation.delta * 100).toFixed(1)}%)`);
      break;

    case 'integration_complete':
      if (event.data.dry_run) {
        console.log(`${prefix} 📦 Integration: DRY RUN (no commit)`);
      } else {
        console.log(`${prefix} 📦 Integration: Complete`);
      }
      break;

    case 'cycle_complete':
      console.log(`\n${'='.repeat(60)}`);
      console.log(`${prefix} ✅ CYCLE COMPLETE`);
      console.log(`${'='.repeat(60)}\n`);
      break;

    case 'cycle_failed':
      console.log(`\n${'='.repeat(60)}`);
      console.log(`${prefix} ❌ CYCLE FAILED: ${event.data.error}`);
      console.log(`${'='.repeat(60)}\n`);
      break;

    case 'rollback_started':
      console.log(`${prefix} ⏪ Rollback: Starting...`);
      break;

    case 'rollback_complete':
      console.log(`${prefix} ⏪ Rollback: Complete`);
      break;

    default:
      console.log(`${prefix} ${event.type}: ${JSON.stringify(event.data).slice(0, 100)}`);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('\n🔄 Self-Improvement Protocol');
  console.log('============================\n');
  console.log(`Target:   ${TARGET}`);
  console.log(`Dry Run:  ${DRY_RUN}`);
  console.log(`API Key:  ${API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log('');

  if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }

  // Create adapter
  const adapter = new GeminiAdapter({
    api_key: API_KEY,
    model: 'gemini-2.0-flash',
  });

  // Create protocol
  const protocol = createImprovementProtocol(adapter, {
    dry_run: DRY_RUN,
    require_human_approval: false, // For testing
    min_candidate_score: 0.2, // Very low threshold for testing
    max_iterations: 3,
    exploration: {
      max_depth: 3, // Shallow for speed
      max_survivors: 5,
      early_stopping: true,
    },
  });

  // Register event handler
  protocol.onEvent(logEvent);

  // Run cycle
  console.log(`\n🎬 Starting improvement cycle for: ${TARGET}\n`);
  const startTime = Date.now();

  try {
    const cycle = await protocol.runCycle(TARGET);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  Duration: ${duration}s`);

    // Summary
    console.log('\n📊 Cycle Summary');
    console.log('----------------');
    console.log(`  ID:        ${cycle.id}`);
    console.log(`  Target:    ${cycle.target}`);
    console.log(`  Phase:     ${cycle.phase}`);
    console.log(`  Iteration: ${cycle.iteration}`);

    if (cycle.candidates) {
      console.log(`  Candidates Found: ${cycle.candidates.length}`);
    }
    if (cycle.selected) {
      console.log(`  Selected: ${cycle.selected.name} (${(cycle.selected.score * 100).toFixed(0)}%)`);
    }
    if (cycle.validation) {
      console.log(`  Validation: ${cycle.validation.passed ? 'PASSED' : 'FAILED'}`);
      console.log(`  Score Delta: ${(cycle.validation.delta * 100).toFixed(1)}%`);
    }
    if (cycle.error) {
      console.log(`  Error: ${cycle.error}`);
    }

    // Exit code based on success
    process.exit(cycle.phase === 'complete' ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
