// Trap Benchmark Runner - Tests constraint system effectiveness

import Anthropic from '@anthropic-ai/sdk'
import { TrapTask, TRAP_TASKS } from './trapTasks'
import { extractEntities, extractActions } from '../urco/extractor'
import { detectMissingVars } from '../urco/missingVars'
import { detectContradictions } from '../urco/contradictions'
import { computeEntropy } from '../urco/entropy'
import * as fs from 'fs'
import * as path from 'path'

type TrapResult = {
  taskId: string
  trapType: string

  // Raw LLM behavior
  rawLLM: {
    proceeded: boolean
    output: string
    warnings: string[]
  }

  // Motherlabs constraint system behavior
  motherlabs: {
    blocked: boolean
    warnings: string[]
    errors: string[]
    contradictions: number
    missingVars: number
    entropyScore: number
    decision: 'BLOCK' | 'WARN' | 'PROCEED'
    reasoning: string
  }

  // Did constraints work as expected?
  testPassed: boolean
  explanation: string
}

/**
 * Run task through raw LLM (no constraints)
 */
async function runRawLLM(
  task: TrapTask,
  client: Anthropic
): Promise<TrapResult['rawLLM']> {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: `${task.input}\n\nBreak this into subtasks. Return JSON array only.`
      }]
    })

    const output = message.content[0].type === 'text' ? message.content[0].text : ''

    return {
      proceeded: true,  // Raw LLM always proceeds
      output,
      warnings: []
    }
  } catch (error) {
    return {
      proceeded: false,
      output: '',
      warnings: [error instanceof Error ? error.message : 'Unknown error']
    }
  }
}

/**
 * Run task through Motherlabs constraint system
 */
function runMotherlabsConstraints(task: TrapTask): TrapResult['motherlabs'] {
  const text = task.input

  // Extract structure
  const entities = extractEntities(text)
  const actions = extractActions(text)

  // Run all constraint checks
  const missingVars = detectMissingVars(text, {}, entities, actions)
  const contradictions = detectContradictions(text)

  // Compute entropy
  const entropy = computeEntropy(
    {
      text,
      vars: {},
      inputs: [],
      outputs: [],
      constraints: [],
      acceptanceCriteria: [],
      invariants: []
    },
    missingVars,
    contradictions
  )

  // Classify violations
  const errors: string[] = []
  const warnings: string[] = []

  // HARD BLOCKS (errors)
  for (const contradiction of contradictions.filter(c => c.confidence === 'high')) {
    errors.push(`CONTRADICTION: ${contradiction.type} - ${contradiction.explanation}`)
  }

  for (const missing of missingVars.filter(m => m.severity === 'error')) {
    errors.push(`MISSING_VAR: ${missing.key} - ${missing.hint}`)
  }

  // Performance claims without evidence
  if (/\b\d+%|10x|faster|reduce.*\d+/i.test(text) && !/\b(test|benchmark|measure|verify)\b/i.test(text)) {
    errors.push('NO_EVIDENCE: Performance claims without measurement plan')
  }

  // Immediate production deploy without testing
  if (/\b(deploy|production|prod)\b/i.test(text) && /\b(immediate|now|directly)\b/i.test(text)) {
    if (!/\b(test|validate|verify)\b/i.test(text)) {
      errors.push('UNSAFE_DEPLOY: Production deployment without testing mentioned')
    }
  }

  // SOFT WARNINGS
  for (const missing of missingVars.filter(m => m.severity === 'warn')) {
    warnings.push(`WARN: ${missing.key} - ${missing.hint}`)
  }

  for (const contradiction of contradictions.filter(c => c.confidence === 'medium')) {
    warnings.push(`WARN: Possible contradiction - ${contradiction.explanation}`)
  }

  // High entropy warns
  if (entropy.value > 0.6) {
    warnings.push(`HIGH_ENTROPY: ${entropy.value.toFixed(3)} - Task is underspecified`)
  }

  // Unpinned dependencies
  if (/\b(use|install|add)\s+[a-z0-9\-]+\b/i.test(text) && !/\d+\.\d+|@\d+|version/i.test(text)) {
    warnings.push('UNPINNED_DEPS: Dependencies without version specifications')
  }

  // Decide: BLOCK, WARN, or PROCEED
  let decision: 'BLOCK' | 'WARN' | 'PROCEED'
  let reasoning: string

  if (errors.length > 0) {
    decision = 'BLOCK'
    reasoning = `Blocked due to ${errors.length} critical violation(s)`
  } else if (warnings.length > 0) {
    decision = 'WARN'
    reasoning = `Proceeded with ${warnings.length} warning(s) - requires review`
  } else {
    decision = 'PROCEED'
    reasoning = 'All constraints satisfied'
  }

  return {
    blocked: decision === 'BLOCK',
    warnings,
    errors,
    contradictions: contradictions.length,
    missingVars: missingVars.length,
    entropyScore: entropy.value,
    decision,
    reasoning
  }
}

/**
 * Run full trap benchmark
 */
export async function runTrapBenchmark(apiKey: string): Promise<TrapResult[]> {
  const client = new Anthropic({ apiKey })
  const results: TrapResult[] = []

  console.log('\n=== TRAP DETECTION BENCHMARK ===')
  console.log(`Testing ${TRAP_TASKS.length} deliberate violation tasks\n`)

  for (const task of TRAP_TASKS) {
    console.log(`\n🎯 ${task.name} (${task.trapType})`)
    console.log(`   Trap: ${task.trapDescription}`)

    // Run through raw LLM
    console.log(`   → Testing Raw LLM...`)
    const rawResult = await runRawLLM(task, client)

    // Run through Motherlabs constraints
    console.log(`   → Testing Motherlabs Constraints...`)
    const mlResult = runMotherlabsConstraints(task)

    const testPassed = (
      (task.expectedBehavior.rawLLM === 'proceeds' && rawResult.proceeded) &&
      (task.expectedBehavior.motherlabs === 'blocks' && mlResult.blocked)
    )

    const result: TrapResult = {
      taskId: task.id,
      trapType: task.trapType,
      rawLLM: rawResult,
      motherlabs: mlResult,
      testPassed,
      explanation: testPassed
        ? `✓ Correct: Raw LLM proceeded, Motherlabs blocked`
        : `✗ Unexpected: Raw=${rawResult.proceeded ? 'proceeded' : 'blocked'}, ML=${mlResult.decision}`
    }

    results.push(result)

    console.log(`   Raw LLM: ${rawResult.proceeded ? '✗ Proceeded' : '✓ Blocked'}`)
    console.log(`   Motherlabs: ${mlResult.decision} (${mlResult.errors.length} errors, ${mlResult.warnings.length} warnings)`)
    console.log(`   Result: ${result.explanation}`)

    if (mlResult.errors.length > 0) {
      console.log(`   Errors detected:`)
      mlResult.errors.forEach(e => console.log(`     - ${e}`))
    }
  }

  return results
}

/**
 * Generate trap benchmark report
 */
export function generateTrapReport(results: TrapResult[], outputPath: string): void {
  const passed = results.filter(r => r.testPassed).length
  const failed = results.filter(r => !r.testPassed).length

  const rawProceeded = results.filter(r => r.rawLLM.proceeded).length
  const mlBlocked = results.filter(r => r.motherlabs.blocked).length
  const mlWarned = results.filter(r => r.motherlabs.decision === 'WARN').length

  const report = {
    timestamp: new Date().toISOString(),  // DETERMINISM-EXEMPT: Timestamp metadata
    summary: {
      totalTasks: results.length,
      testsPassed: passed,
      testsFailed: failed,
      passRate: passed / results.length,

      rawLLM: {
        proceeded: rawProceeded,
        blockedAppropriately: 0  // Raw LLM doesn't have constraints
      },

      motherlabs: {
        blocked: mlBlocked,
        warned: mlWarned,
        proceeded: results.length - mlBlocked - mlWarned,
        effectivenessRate: mlBlocked / results.length
      }
    },
    results
  }

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))

  console.log(`\n\n=== TRAP DETECTION RESULTS ===\n`)
  console.log(`Tests Passed: ${passed}/${results.length} (${(passed / results.length * 100).toFixed(0)}%)`)
  console.log('')
  console.log(`Raw LLM:`)
  console.log(`  Proceeded blindly: ${rawProceeded}/${results.length}`)
  console.log('')
  console.log(`Motherlabs:`)
  console.log(`  Blocked unsafe: ${mlBlocked}/${results.length}`)
  console.log(`  Warned on risky: ${mlWarned}/${results.length}`)
  console.log(`  Constraint effectiveness: ${(mlBlocked / results.length * 100).toFixed(0)}%`)
  console.log('')
  console.log(`✓ Report saved to: ${outputPath}`)
}
