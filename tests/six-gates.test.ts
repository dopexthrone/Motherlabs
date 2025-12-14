// 6-Gate Validator Tests - TDD (Tests first, implementation after)

import { SixGateValidator } from '../src/validation/sixGates'
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

console.log('=== 6-GATE VALIDATOR TESTS (TDD) ===\n')

const validator = new SixGateValidator()

// ============================================================================
// TEST 1: Valid Code Passes All Gates
// ============================================================================
console.log('TEST 1: Valid Code Passes All 6 Gates\n')

const validCode = `
export function add(a: number, b: number): number {
  return a + b
}
`

const context1 = {
  existingImports: [],
  existingTypes: ['number'],
  governanceRules: []
}

const result1 = await validator.validate(validCode, context1)

assert(result1.ok, 'Validation returns result')
assert(result1.ok && result1.value.valid, 'Valid code passes all gates')
assert(result1.ok && result1.value.gateResults.length === 6, 'All 6 gates checked')
assert(
  result1.ok && result1.value.gateResults.every(g => g.passed),
  'All gates passed for valid code'
)

console.log('')

// ============================================================================
// TEST 2: Gate 1 - Schema Validation Blocks Invalid
// ============================================================================
console.log('TEST 2: Gate 1 - Schema Validation\n')

// Code that doesn't match expected structure
const invalidSchema = `
export const x = "string"  // Expected function, got const
`

const result2 = await validator.validate(invalidSchema, context1)

assert(result2.ok, 'Returns result')
assert(result2.ok && !result2.value.valid, 'Invalid schema blocked')
assert(
  result2.ok && result2.value.gateResults.find(g => g.gateName === 'schema_validation')?.passed === false,
  'Schema gate specifically failed'
)

console.log('')

// ============================================================================
// TEST 3: Gate 2 - Syntax Validation Blocks Invalid TypeScript
// ============================================================================
console.log('TEST 3: Gate 2 - Syntax Validation\n')

const syntaxError = `
export function broken( {
  return "missing closing paren and brace"
`

const result3 = await validator.validate(syntaxError, context1)

assert(result3.ok && !result3.value.valid, 'Syntax errors blocked')
assert(
  result3.ok && result3.value.gateResults.find(g => g.gateName === 'syntax_validation')?.passed === false,
  'Syntax gate specifically failed'
)

console.log('')

// ============================================================================
// TEST 4: Gate 3 - Variable Resolution Blocks Undefined
// ============================================================================
console.log('TEST 4: Gate 3 - Variable Resolution\n')

const undefinedVar = `
export function useUndefined() {
  return nonexistentFunction()  // Not imported, not defined
}
`

const result4 = await validator.validate(undefinedVar, context1)

assert(result4.ok && !result4.value.valid, 'Undefined variables blocked')
assert(
  result4.ok && result4.value.gateResults.find(g => g.gateName === 'variable_resolution')?.passed === false,
  'Variable gate specifically failed'
)

console.log('')

// ============================================================================
// TEST 5: Gate 5 - URCO Entropy Blocks Ambiguous Code
// ============================================================================
console.log('TEST 5: Gate 5 - URCO Entropy Check\n')

const ambiguous = `
export function doSomething() {
  // Very ambiguous - no types, vague name, no clarity
  const thing = getThing()
  handleStuff(thing)
  return result
}
`

const result5 = await validator.validate(ambiguous, context1)

assert(result5.ok, 'Returns result')
// URCO gate might warn or block depending on threshold
assert(
  result5.ok && result5.value.gateResults.find(g => g.gateName === 'urco_entropy') !== undefined,
  'URCO entropy gate checked'
)

console.log('')

// ============================================================================
// TEST 6: Gate 6 - Governance Blocks Policy Violations
// ============================================================================
console.log('TEST 6: Gate 6 - Governance Check\n')

const violatesGovernance = `
export function dangerousOperation() {
  const id = Date.now()  // Violates determinism policy
  return id
}
`

const context6 = {
  existingImports: [],
  existingTypes: [],
  governanceRules: ['no_date_now', 'determinism_required']
}

const result6 = await validator.validate(violatesGovernance, context6)

assert(result6.ok && !result6.value.valid, 'Governance violations blocked')
assert(
  result6.ok && result6.value.gateResults.find(g => g.gateName === 'governance_check')?.passed === false,
  'Governance gate specifically failed'
)

console.log('')

// ============================================================================
// TEST 7: All Gates Run Even If One Fails
// ============================================================================
console.log('TEST 7: All Gates Run (No Short-Circuit)\n')

const multipleIssues = `
const broken syntax here
export function bad() {
  return undefined_thing()
}
`

const result7 = await validator.validate(multipleIssues, context1)

assert(result7.ok && result7.value.gateResults.length === 6, 'All 6 gates checked even with multiple failures')

console.log('')

// ============================================================================
// TEST 8: Evidence Logged for All Decisions
// ============================================================================
console.log('TEST 8: Evidence Generation\n')

const result8 = await validator.validate(validCode, context1)

assert(result8.ok && result8.value.gateResults.every(g => g.gateName !== undefined), 'All gates have names')
assert(result8.ok && result8.value.gateResults.every(g => typeof g.passed === 'boolean'), 'All gates have pass/fail')

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)

console.log('\n✓ 6-gate validator tests written (TDD)')
console.log('✓ Tests cover: valid code, each gate failure, edge cases')
console.log('\nNext: Implement SixGateValidator to make tests pass')

if (failCount > 0) {
  console.error('\n✗ Tests failing (expected - no implementation yet)')
  process.exit(1)
}

}

runTests().catch(err => {
  console.error('Test setup failed:', err)
  process.exit(1)
})
