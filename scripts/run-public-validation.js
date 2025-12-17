#!/usr/bin/env node

/**
 * Public Validation Runner
 *
 * Runs the hardened pipeline on public benchmark tasks and produces
 * externally verifiable evidence artifacts.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/run-public-validation.js
 *   ANTHROPIC_API_KEY=... node scripts/run-public-validation.js --tasks 5
 *   ANTHROPIC_API_KEY=... node scripts/run-public-validation.js --output evidence/results.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load compiled modules
const { SixGateValidator } = require('../dist/validation/sixGates');
const { AnthropicAdapter } = require('../dist/adapters/anthropicAdapter');
const { ConstrainedLLM } = require('../dist/llm/constrained');
const { JSONLLedger } = require('../dist/persistence/jsonlLedger');

// Content addressing for evidence
function contentAddress(obj) {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

// Validate expected properties
function validateProperties(result, expected) {
  const checks = {
    subtask_count_valid: true,
    keywords_present: [],
    keywords_missing: []
  };

  if (result.subtasks) {
    const count = result.subtasks.length;
    checks.subtask_count_valid = count >= expected.min_subtasks && count <= expected.max_subtasks;
    checks.actual_subtask_count = count;
  }

  const outputText = JSON.stringify(result).toLowerCase();
  for (const keyword of expected.required_keywords) {
    if (outputText.includes(keyword.toLowerCase())) {
      checks.keywords_present.push(keyword);
    } else {
      checks.keywords_missing.push(keyword);
    }
  }

  checks.keywords_score = checks.keywords_present.length / expected.required_keywords.length;
  checks.passed = checks.subtask_count_valid && checks.keywords_score >= 0.5;

  return checks;
}

async function runValidation(options = {}) {
  const {
    maxTasks = 20,
    outputPath = 'evidence/public-validation-results.json',
    ledgerPath = 'evidence/public-validation.jsonl'
  } = options;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PUBLIC VALIDATION RUNNER');
  console.log('  Externally Verifiable Evidence Generation');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY environment variable required');
    process.exit(1);
  }

  // Load tasks
  const tasksFile = path.join(__dirname, '../evidence/public-tasks.json');
  if (!fs.existsSync(tasksFile)) {
    console.error('ERROR: public-tasks.json not found');
    process.exit(1);
  }

  const tasksData = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
  const tasks = tasksData.tasks.slice(0, maxTasks);

  console.log(`Tasks: ${tasks.length}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Ledger: ${ledgerPath}`);
  console.log('');

  // Initialize components
  const validator = new SixGateValidator();
  const adapter = new AnthropicAdapter(apiKey, 'claude-sonnet-4-20250514');
  const ledger = new JSONLLedger(ledgerPath);
  const constrainedLLM = new ConstrainedLLM(adapter, ledgerPath);

  // Results collection
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`\n[${i + 1}/${tasks.length}] ${task.id}: ${task.category}`);
    console.log(`  Input: ${task.input.substring(0, 60)}...`);

    const taskStart = Date.now();

    try {
      // Generate code for this task using constrained LLM
      const request = {
        issue: {
          type: 'MISSING_FUNCTION',
          severity: 'medium',
          line: 1,
          message: task.input,
          fixable: true
        },
        filepath: `src/generated/${task.id}.ts`,
        existingCode: '',
        context: { existingImports: [], existingTypes: [] }
      };

      const genResult = await constrainedLLM.generateCode(request);

      const taskEnd = Date.now();
      const duration = taskEnd - taskStart;

      if (genResult.ok) {
        const validation = genResult.value.validation;
        const gatesSummary = validation.gateResults.map(g => ({
          gate: g.gateName,
          passed: g.passed
        }));

        // Check expected properties
        const propertiesCheck = validateProperties(
          { subtasks: genResult.value.code.split('\n').filter(l => l.includes('export')) },
          task.expected_properties
        );

        const resultEntry = {
          task_id: task.id,
          category: task.category,
          input: task.input,
          success: true,
          attempts: genResult.value.attempts,
          provider: genResult.value.provider,
          gates: gatesSummary,
          all_gates_passed: validation.valid,
          code_length: genResult.value.code.length,
          properties_check: propertiesCheck,
          evidence_hash: contentAddress({
            task_id: task.id,
            code: genResult.value.code,
            gates: gatesSummary
          }),
          duration_ms: duration
        };

        results.push(resultEntry);

        console.log(`  ✓ SUCCESS (${duration}ms, ${genResult.value.attempts} attempt(s))`);
        console.log(`    Gates: ${gatesSummary.filter(g => g.passed).length}/6 passed`);
        console.log(`    Code: ${genResult.value.code.length} chars`);
      } else {
        const resultEntry = {
          task_id: task.id,
          category: task.category,
          input: task.input,
          success: false,
          error: genResult.error.message,
          duration_ms: taskEnd - taskStart
        };

        results.push(resultEntry);
        console.log(`  ✗ FAILED: ${genResult.error.message.substring(0, 60)}`);
      }

      // Record to ledger
      await ledger.append('public_validation_task', {
        task_id: task.id,
        success: genResult.ok,
        duration_ms: duration
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({
        task_id: task.id,
        category: task.category,
        input: task.input,
        success: false,
        error: errorMsg,
        duration_ms: Date.now() - taskStart
      });
      console.log(`  ✗ ERROR: ${errorMsg.substring(0, 60)}`);
    }
  }

  const totalDuration = Date.now() - startTime;

  // Compute summary statistics
  const summary = {
    total_tasks: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    success_rate: results.filter(r => r.success).length / results.length,
    avg_duration_ms: results.reduce((a, r) => a + (r.duration_ms || 0), 0) / results.length,
    total_duration_ms: totalDuration,
    gates_summary: {
      all_passed: results.filter(r => r.all_gates_passed).length,
      partial: results.filter(r => r.success && !r.all_gates_passed).length
    },
    by_category: {}
  };

  // Group by category
  for (const result of results) {
    if (!summary.by_category[result.category]) {
      summary.by_category[result.category] = { total: 0, success: 0 };
    }
    summary.by_category[result.category].total++;
    if (result.success) {
      summary.by_category[result.category].success++;
    }
  }

  // Build final report
  const report = {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    config: {
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      max_tasks: maxTasks
    },
    summary,
    results,
    evidence: {
      report_hash: contentAddress({ summary, results }),
      ledger_path: ledgerPath
    }
  };

  // Write results
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Total tasks:     ${summary.total_tasks}`);
  console.log(`  Successful:      ${summary.successful} (${(summary.success_rate * 100).toFixed(1)}%)`);
  console.log(`  Failed:          ${summary.failed}`);
  console.log(`  Avg duration:    ${summary.avg_duration_ms.toFixed(0)}ms`);
  console.log(`  Total time:      ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('');
  console.log('  By category:');
  for (const [cat, stats] of Object.entries(summary.by_category)) {
    console.log(`    ${cat}: ${stats.success}/${stats.total}`);
  }
  console.log('');
  console.log(`  Report: ${outputPath}`);
  console.log(`  Ledger: ${ledgerPath}`);
  console.log(`  Hash:   ${report.evidence.report_hash}`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');

  return report;
}

// Parse CLI arguments
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tasks' && args[i + 1]) {
    options.maxTasks = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--output' && args[i + 1]) {
    options.outputPath = args[i + 1];
    i++;
  } else if (args[i] === '--ledger' && args[i + 1]) {
    options.ledgerPath = args[i + 1];
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Public Validation Runner

Usage:
  ANTHROPIC_API_KEY=... node scripts/run-public-validation.js [options]

Options:
  --tasks N      Run first N tasks (default: 20)
  --output PATH  Output JSON path (default: evidence/public-validation-results.json)
  --ledger PATH  Evidence ledger path (default: evidence/public-validation.jsonl)
  --help, -h     Show this help
`);
    process.exit(0);
  }
}

// Run
runValidation(options).catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
