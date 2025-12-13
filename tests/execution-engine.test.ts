// Execution Engine Tests - TDD (Tests first, then implementation)

import { ExecutionEngine } from '../src/execution/engine'
import { contentAddress } from '../src/core/contentAddress'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

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

async function runTests() {

console.log('=== EXECUTION ENGINE TESTS (TDD) ===\n')
console.log('Writing tests BEFORE implementation...\n')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-test-'))
const engine = new ExecutionEngine({ sandboxDir: tmpDir })

// ============================================================================
// TEST 1: Execute Valid TypeScript (Success Case)
// ============================================================================
console.log('TEST 1: Execute Valid TypeScript\n')

const plan1 = {
  id: contentAddress({ code: 'console.log("test")' }),
  type: 'typescript' as const,
  code: 'console.log("test")',
  timeout: 5000,
  sandbox: true
}

const result1 = await engine.execute(plan1)

assert(result1.ok, 'Executes valid TypeScript')
assert(result1.ok && result1.value.success, 'Execution succeeds')
assert(result1.ok && result1.value.exitCode === 0, 'Exit code is 0')

console.log('')

// ============================================================================
// TEST 2: Timeout Enforcement (Failure Case)
// ============================================================================
console.log('TEST 2: Timeout Enforcement\n')

const plan2 = {
  id: contentAddress({ code: 'while(true) {}' }),
  type: 'typescript' as const,
  code: 'while(true) { }',
  timeout: 1000,  // 1 second
  sandbox: true
}

const result2 = await engine.execute(plan2)

assert(result2.ok, 'Returns result for timeout')
assert(result2.ok && !result2.value.success, 'Timeout marks as failure')
assert(
  result2.ok && (result2.value.error?.includes('timeout') || result2.value.error?.includes('TIMEOUT')),
  'Error message indicates timeout'
)

console.log('')

// ============================================================================
// TEST 3: Sandbox Isolation (Security)
// ============================================================================
console.log('TEST 3: Sandbox Isolation\n')

const plan3 = {
  id: contentAddress({ code: 'process.exit(1)' }),
  type: 'typescript' as const,
  code: 'process.exit(1)',  // Should not kill main process
  timeout: 5000,
  sandbox: true
}

const result3 = await engine.execute(plan3)

// If we get here, sandbox worked (didn't kill main process)
assert(true, 'Sandbox prevents process.exit from killing main process')
assert(result3.ok, 'Returns result even if code tries to exit')

console.log('')

// ============================================================================
// TEST 4: Evidence Generation
// ============================================================================
console.log('TEST 4: Evidence Generation\n')

const plan4 = {
  id: contentAddress({ code: 'const x = 1 + 1' }),
  type: 'typescript' as const,
  code: 'const x = 1 + 1',
  timeout: 5000,
  sandbox: true
}

const result4 = await engine.execute(plan4)

assert(result4.ok, 'Execution completes')
assert(result4.ok && result4.value.evidence !== undefined, 'Evidence object exists')
assert(result4.ok && typeof result4.value.startTime === 'number', 'Start time recorded')
assert(result4.ok && typeof result4.value.endTime === 'number', 'End time recorded')

console.log('')

// ============================================================================
// TEST 5: Invalid Code (Failure Case)
// ============================================================================
console.log('TEST 5: Invalid Code Handling\n')

const plan5 = {
  id: contentAddress({ code: 'this is not valid typescript;;;' }),
  type: 'typescript' as const,
  code: 'this is not valid typescript;;;',
  timeout: 5000,
  sandbox: true
}

const result5 = await engine.execute(plan5)

assert(result5.ok, 'Returns result for invalid code')
assert(result5.ok && !result5.value.success, 'Invalid code marks as failure')
assert(result5.ok && result5.value.exitCode !== 0, 'Non-zero exit code')

console.log('')

// ============================================================================
// TEST 6: Edge Case - Empty Code
// ============================================================================
console.log('TEST 6: Edge Case - Empty Code\n')

const plan6 = {
  id: contentAddress({ code: '' }),
  type: 'typescript' as const,
  code: '',
  timeout: 5000,
  sandbox: true
}

const result6 = await engine.execute(plan6)

assert(!result6.ok || !result6.value.success, 'Empty code rejected or fails')

console.log('')

// ============================================================================
// TEST 7: Deterministic Execution
// ============================================================================
console.log('TEST 7: Deterministic Execution\n')

const plan7 = {
  id: contentAddress({ code: 'console.log(1 + 1)' }),
  type: 'typescript' as const,
  code: 'console.log(1 + 1)',
  timeout: 5000,
  sandbox: true
}

const result7a = await engine.execute(plan7)
const result7b = await engine.execute(plan7)

assert(
  result7a.ok && result7b.ok && result7a.value.stdout === result7b.value.stdout,
  'Same code produces same output (deterministic)'
)

console.log('')

// Cleanup
fs.rmSync(tmpDir, { recursive: true })

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)

console.log('\n✓ Tests written (TDD approach)')
console.log('✓ Covering: success, failure, timeout, security, edge cases')

if (failCount > 0) {
  console.error('\n✗ Tests failing (expected - implementation not done yet)')
  console.error('Next: Implement ExecutionEngine to make tests pass')
} else {
  console.log('\n✓ All tests passing (implementation complete)')
}

}

runTests().catch(err => {
  console.error('Test setup failed:', err)
  process.exit(1)
})
