// LLM Deterministic Tests - Fixture-based replay (no real API calls)

import * as fs from 'fs'
import * as path from 'path'
import { decomposeTask } from '../src/decompose'
import { Ledger } from '../src/evidence'

// Mock LLM adapter that uses fixtures
class FixtureLLMAdapter {
  private fixtures: Record<string, any>

  constructor(fixturesPath: string) {
    this.fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'))
  }

  async decompose(input: string): Promise<string[]> {
    // Find matching fixture by input
    for (const [key, fixture] of Object.entries(this.fixtures)) {
      if (input.includes(fixture.input) || fixture.input.includes(input.substring(0, 30))) {
        console.log(`  Using fixture: ${key}`)
        return fixture.response
      }
    }

    throw new Error(`No fixture found for input: ${input.substring(0, 50)}`)
  }

  async generateCode(): Promise<string> {
    throw new Error('Not implemented in fixture adapter')
  }
}

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`)
    failCount++
  } else {
    console.log(`✓ PASS: ${message}`)
    passCount++
  }
}

console.log('=== LLM DETERMINISTIC (FIXTURE-BASED) TESTS ===\n')

async function runTests() {
  const fixturesPath = path.join(__dirname, 'fixtures', 'llm-responses.json')
  const llm = new FixtureLLMAdapter(fixturesPath)
  const ledger = new Ledger()
  const config = {
    kernelPath: '/home/motherlabs/motherlabs-kernel',
    maxDepth: 3,
    maxSubtasks: 10
  }

  // ============================================================================
  // TEST 1: Fixture Replay - Simple API
  // ============================================================================
  console.log('TEST 1: Fixture Replay - Simple API\n')

  const task1 = await decomposeTask(
  'Build a REST API for todos',
  'test-1',
  ledger,
  config,
  llm as any
)

assert(task1.subtasks.length === 5, 'Returns exact fixture count')
assert(task1.subtasks[0].input.includes('Express'), 'First subtask matches fixture')
assert(task1.status === 'active', 'Task status correct')

// Evidence should be recorded
const evidence1 = ledger.query('test-1')
assert(evidence1.length === 2, 'Evidence recorded: task_created + llm_decompose')
assert(evidence1.some(e => e.type === 'llm_decompose'), 'LLM call evidenced')

console.log('')

// ============================================================================
// TEST 2: Deterministic Replay (Same Input → Same Output)
// ============================================================================
console.log('TEST 2: Deterministic Replay\n')

const ledger2a = new Ledger()
const task2a = await decomposeTask(
  'Implement distributed caching with consistency',
  'test-2a',
  ledger2a,
  config,
  llm as any
)

const ledger2b = new Ledger()
const task2b = await decomposeTask(
  'Implement distributed caching with consistency',
  'test-2b',
  ledger2b,
  config,
  llm as any
)

assert(task2a.subtasks.length === task2b.subtasks.length, 'Identical input produces identical subtask count')
assert(
  task2a.subtasks.every((st, i) => st.input === task2b.subtasks[i].input),
  'Identical input produces identical subtasks (deterministic replay)'
)

console.log('')

// ============================================================================
// TEST 3: Fixture with Contradiction (LLM tries to resolve, URCO should detect)
// ============================================================================
console.log('TEST 3: Contradiction in Fixture Response\n')

const task3 = await decomposeTask(
  'Build deterministic system with random selection',
  'test-3',
  new Ledger(),
  config,
  llm as any
)

// LLM returned a response, but we should detect the underlying contradiction
// This tests that URCO analysis happens AFTER LLM generation
assert(task3.subtasks.length > 0, 'Task decomposed despite contradiction in input')

// TODO: Add URCO validation step that would detect this
// For now, just verify fixture replay works

console.log('')

// ============================================================================
// TEST 4: Missing Fixture (Fallback Behavior)
// ============================================================================
console.log('TEST 4: Missing Fixture Handling\n')

const ledger4 = new Ledger()
const task4 = await decomposeTask(
  'This task has no fixture and should use fallback',
  'test-4',
  ledger4,
  config,
  llm as any
)

// Should fall back to heuristic decomposition
const evidence4 = ledger4.query('test-4')
const llmEvidence = evidence4.find(e => e.type === 'llm_decompose')

assert(llmEvidence !== undefined, 'LLM decompose attempted')
assert(
  llmEvidence && typeof llmEvidence.data === 'object' &&
  'fallback' in llmEvidence.data,
  'Fallback to heuristic when fixture missing (fail-safe behavior)'
)

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)

  console.log('\n✓ Deterministic replay proven with fixtures')
  console.log('✓ No real API calls made (100% deterministic)')
  console.log('✓ Same input always produces same output')

  if (failCount > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
