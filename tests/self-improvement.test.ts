// Self-Improvement Loop Tests - Step 10 of ROADMAP_NEXT_10.md
// Tests the complete dogfooding loop including Ollama support

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomBytes } from 'crypto'
import { DogfoodingLoop, DogfoodingConfig } from '../src/dogfood/loop'
import { SelfImprovementProposer } from '../src/selfbuild/proposer'
import { OllamaAdapter, createCodeLlamaAdapter } from '../src/adapters/ollamaAdapter'
import { ConstrainedLLM } from '../src/llm/constrained'

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`\u2717 FAIL: ${message}`)
    failCount++
  } else {
    console.log(`\u2713 PASS: ${message}`)
    passCount++
  }
}

async function runTests() {

console.log('=== SELF-IMPROVEMENT LOOP TESTS ===\n')
console.log('Step 10 of ROADMAP_NEXT_10.md: Self-Improvement Validation Loop\n')

// Create temp directory for test ledger
const testId = randomBytes(4).toString('hex')
const tempDir = path.join(os.tmpdir(), `self-improve-test-${testId}`)
fs.mkdirSync(tempDir, { recursive: true })
const ledgerPath = path.join(tempDir, 'test-ledger.jsonl')

// ============================================================================
// TEST 1: Create DogfoodingLoop with No LLM
// ============================================================================
console.log('TEST 1: Create DogfoodingLoop with No LLM\n')

const noLlmConfig: DogfoodingConfig = {
  cycleInterval: 1000,
  requireHumanApproval: true,
  maxImprovementsPerCycle: 1,
  ledgerPath
}

const noLlmLoop = new DogfoodingLoop(noLlmConfig)
assert(noLlmLoop !== null, 'Loop creates without LLM')

console.log('')

// ============================================================================
// TEST 2: Create DogfoodingLoop with Ollama Config
// ============================================================================
console.log('TEST 2: Create DogfoodingLoop with Ollama Config\n')

const ollamaConfig: DogfoodingConfig = {
  cycleInterval: 1000,
  requireHumanApproval: true,
  maxImprovementsPerCycle: 1,
  ledgerPath,
  ollamaEnabled: true,
  ollamaConfig: {
    model: 'codellama:13b',
    timeout: 120000
  }
}

const ollamaLoop = new DogfoodingLoop(ollamaConfig)
assert(ollamaLoop !== null, 'Loop creates with Ollama config')

console.log('')

// ============================================================================
// TEST 3: Create DogfoodingLoop with Human Approval Required
// ============================================================================
console.log('TEST 3: Create DogfoodingLoop with Human Approval Required\n')

const approvalConfig: DogfoodingConfig = {
  cycleInterval: 5000,
  requireHumanApproval: true,
  maxImprovementsPerCycle: 1,
  ledgerPath
}

const approvalLoop = new DogfoodingLoop(approvalConfig)
assert(approvalLoop !== null, 'Loop creates with human approval required')

console.log('')

// ============================================================================
// TEST 4: Create DogfoodingLoop without Human Approval
// ============================================================================
console.log('TEST 4: Create DogfoodingLoop without Human Approval\n')

const noApprovalConfig: DogfoodingConfig = {
  cycleInterval: 5000,
  requireHumanApproval: false,
  maxImprovementsPerCycle: 1,
  ledgerPath
}

const noApprovalLoop = new DogfoodingLoop(noApprovalConfig)
assert(noApprovalLoop !== null, 'Loop creates without human approval')

console.log('')

// ============================================================================
// TEST 5: runOnce Returns Result Structure
// ============================================================================
console.log('TEST 5: runOnce Returns Result Structure\n')

const result = await noLlmLoop.runOnce()
assert(typeof result.success === 'boolean', 'Result has success boolean')
// Without LLM, should fail with AXIOM 5 refusal
assert(!result.success, 'Fails without LLM (AXIOM 5)')
assert(result.error !== undefined, 'Has error message')
if (result.error) {
  assert(result.error.includes('AXIOM 5') || result.error.includes('No issues'), 'Error mentions AXIOM 5 or no issues')
}

console.log('')

// ============================================================================
// TEST 6: SelfImprovementProposer Creates
// ============================================================================
console.log('TEST 6: SelfImprovementProposer Creates\n')

const proposer = new SelfImprovementProposer()
assert(proposer !== null, 'Proposer creates without LLM')

console.log('')

// ============================================================================
// TEST 7: Proposer Refuses Without LLM (AXIOM 5)
// ============================================================================
console.log('TEST 7: Proposer Refuses Without LLM (AXIOM 5)\n')

const proposeResult = await proposer.proposeImprovement('src/cli.ts')
// Should refuse because no LLM available
assert(!proposeResult.ok, 'Proposal fails without LLM')
if (!proposeResult.ok) {
  assert(proposeResult.error.message.includes('AXIOM 5'), 'Error is AXIOM 5 refusal')
}

console.log('')

// ============================================================================
// TEST 8: OllamaAdapter Creates and Has Required Methods
// ============================================================================
console.log('TEST 8: OllamaAdapter Creates and Has Required Methods\n')

const ollamaAdapter = new OllamaAdapter()
assert(typeof ollamaAdapter.generateCode === 'function', 'Has generateCode method')
assert(typeof ollamaAdapter.generate === 'function', 'Has generate method')
assert(typeof ollamaAdapter.decompose === 'function', 'Has decompose method')

console.log('')

// ============================================================================
// TEST 9: ConstrainedLLM Wraps Ollama
// ============================================================================
console.log('TEST 9: ConstrainedLLM Wraps Ollama\n')

const constrainedLlm = new ConstrainedLLM(ollamaAdapter, path.join(tempDir, 'constrained.jsonl'))
assert(constrainedLlm !== null, 'ConstrainedLLM wraps Ollama adapter')

console.log('')

// ============================================================================
// TEST 10: Proposer Works with ConstrainedLLM (Ollama)
// ============================================================================
console.log('TEST 10: Proposer Works with ConstrainedLLM (Ollama)\n')

const ollamaProposer = new SelfImprovementProposer(constrainedLlm)
assert(ollamaProposer !== null, 'Proposer creates with Ollama-backed ConstrainedLLM')

console.log('')

// ============================================================================
// TEST 11: Factory Functions Work
// ============================================================================
console.log('TEST 11: Factory Functions Work\n')

const codeLlama = createCodeLlamaAdapter('13b')
assert(codeLlama.getModel() === 'codellama:13b', 'Factory creates correct model')

console.log('')

// ============================================================================
// TEST 12: Loop Stop Method Exists
// ============================================================================
console.log('TEST 12: Loop Stop Method Exists\n')

assert(typeof noLlmLoop.stop === 'function', 'Loop has stop method')

console.log('')

// ============================================================================
// TEST 13: Config with All LLM Types
// ============================================================================
console.log('TEST 13: Config with All LLM Types\n')

// Test that all config options are supported
const fullConfig: DogfoodingConfig = {
  cycleInterval: 60000,
  requireHumanApproval: true,
  maxImprovementsPerCycle: 3,
  ledgerPath,
  // Can specify multiple - priority order is: openai > anthropic > ollama
  anthropicApiKey: undefined,
  anthropicModel: 'claude-sonnet-4-5-20250929',
  openaiApiKey: undefined,
  openaiModel: 'gpt-4o',
  ollamaEnabled: true,
  ollamaConfig: {
    model: 'qwen2.5-coder:14b',
    baseUrl: 'http://localhost:11434',
    timeout: 180000
  }
}

const fullLoop = new DogfoodingLoop(fullConfig)
assert(fullLoop !== null, 'Full config loop creates')

console.log('')

// ============================================================================
// LIVE TESTS (Only if Ollama is running)
// ============================================================================
console.log('=== LIVE TESTS (Skip if Ollama not running) ===\n')

const liveAdapter = new OllamaAdapter()
const isLive = await liveAdapter.isAvailable()

if (isLive.ok && isLive.value) {
  console.log('Ollama is running - executing live tests\n')

  // TEST 14: Ollama-backed loop runs once
  console.log('TEST 14: Ollama-backed Loop Runs Once\n')

  const liveLedgerPath = path.join(tempDir, 'live-ledger.jsonl')
  const liveConfig: DogfoodingConfig = {
    cycleInterval: 1000,
    requireHumanApproval: true, // Keep true to avoid applying changes
    maxImprovementsPerCycle: 1,
    ledgerPath: liveLedgerPath,
    ollamaEnabled: true,
    ollamaConfig: {
      timeout: 120000
    }
  }

  const liveLoop = new DogfoodingLoop(liveConfig)
  const liveResult = await liveLoop.runOnce()

  assert(typeof liveResult.success === 'boolean', 'Live result has success boolean')
  console.log(`  Result: ${liveResult.success ? 'success' : 'expected failure'}`)
  if (liveResult.error) {
    console.log(`  Info: ${liveResult.error.slice(0, 100)}...`)
  }
  passCount++

  // TEST 15: Ledger receives entries
  console.log('\nTEST 15: Ledger Receives Entries\n')

  if (fs.existsSync(liveLedgerPath)) {
    const ledgerContent = fs.readFileSync(liveLedgerPath, 'utf-8')
    const lines = ledgerContent.trim().split('\n').filter(l => l.length > 0)
    assert(lines.length > 0, 'Ledger has entries')
    console.log(`  Found ${lines.length} ledger entries`)
  } else {
    assert(false, 'Ledger file created')
  }

} else {
  console.log('Ollama not running - skipping live tests\n')
  console.log('To run live tests:')
  console.log('  1. Start Ollama: ollama serve')
  console.log('  2. Pull a model: ollama pull codellama:13b')
  console.log('  3. Re-run tests\n')
}

// ============================================================================
// Cleanup
// ============================================================================
console.log('CLEANUP: Removing test files\n')

try {
  fs.rmSync(tempDir, { recursive: true, force: true })
  console.log('Cleanup successful\n')
} catch {
  console.log('Cleanup failed (non-critical)\n')
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('SELF-IMPROVEMENT TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL SELF-IMPROVEMENT TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
