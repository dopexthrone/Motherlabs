// Alternative Tracking Tests - Verifies alternative generation logic
// Tests Step 3 of ROADMAP_NEXT_10.md: Alternative Tracking

import {
  generateAlternatives,
  formatAlternatives,
  hasAdequateAlternatives,
  Alternative,
  ProposalWithAlternatives
} from '../src/core/proposal'
import type { ImprovementProposal } from '../src/selfbuild/proposer'

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

function createMockProposal(overrides: Partial<ImprovementProposal>): ImprovementProposal {
  return {
    id: 'test-proposal-001',
    targetFile: 'src/example/file.ts',
    issue: {
      type: 'NO_ERROR_HANDLING',
      severity: 'medium',
      message: 'Test issue',
      line: 1
    },
    proposedChange: {
      type: 'modify_function',
      code: 'export function test() { return 42 }'
    },
    rationale: 'Test rationale',
    timestamp: Date.now(),
    source: 'llm',
    ...overrides
  }
}

async function runTests() {

console.log('=== ALTERNATIVE TRACKING TESTS ===\n')

// ============================================================================
// TEST 1: Basic Alternative Generation
// ============================================================================
console.log('TEST 1: Basic Alternative Generation\n')

const basicProposal = createMockProposal({})
const basicResult = generateAlternatives(basicProposal)

assert(basicResult.ok, 'Basic alternative generation succeeds')
if (basicResult.ok) {
  assert(Array.isArray(basicResult.value.alternatives), 'Has alternatives array')
  assert(basicResult.value.alternatives.length >= 2, 'Has at least 2 alternatives')
  assert(typeof basicResult.value.chosenRationale === 'string', 'Has chosen rationale')
  assert(typeof basicResult.value.comparisonSummary === 'string', 'Has comparison summary')
}

console.log('')

// ============================================================================
// TEST 2: Error Handling Alternatives
// ============================================================================
console.log('TEST 2: Error Handling Alternatives\n')

const errorHandlingProposal = createMockProposal({
  issue: { type: 'NO_ERROR_HANDLING', severity: 'high', message: 'Missing error handling', line: 1 }
})

const errorResult = generateAlternatives(errorHandlingProposal)
assert(errorResult.ok, 'Error handling alternative generation succeeds')
if (errorResult.ok) {
  assert(errorResult.value.alternatives.some(a => a.description.includes('try-catch')),
         'Includes try-catch alternative')
  assert(errorResult.value.alternatives.some(a => a.description.includes('Result')),
         'Includes Result pattern alternative')
}

console.log('')

// ============================================================================
// TEST 3: Complexity Alternatives
// ============================================================================
console.log('TEST 3: Complexity Alternatives\n')

const complexityProposal = createMockProposal({
  issue: { type: 'HIGH_COMPLEXITY', severity: 'medium', message: 'High complexity', line: 1 },
  proposedChange: { type: 'refactor', code: 'export function refactored() {}' }
})

const complexityResult = generateAlternatives(complexityProposal)
assert(complexityResult.ok, 'Complexity alternative generation succeeds')
if (complexityResult.ok) {
  assert(complexityResult.value.alternatives.some(a => a.description.includes('helper')),
         'Includes extract helper alternative')
  assert(complexityResult.value.alternatives.some(a => a.description.includes('early returns')),
         'Includes early returns alternative')
}

console.log('')

// ============================================================================
// TEST 4: Test Alternatives
// ============================================================================
console.log('TEST 4: Test Alternatives\n')

const testProposal = createMockProposal({
  issue: { type: 'NO_TESTS', severity: 'high', message: 'No tests', line: 1 },
  proposedChange: { type: 'add_test', code: 'describe("test", () => {})' }
})

const testResult = generateAlternatives(testProposal)
assert(testResult.ok, 'Test alternative generation succeeds')
if (testResult.ok) {
  assert(testResult.value.alternatives.some(a => a.description.includes('unit')),
         'Includes unit test alternative')
  assert(testResult.value.alternatives.some(a => a.description.includes('integration')),
         'Includes integration test alternative')
}

console.log('')

// ============================================================================
// TEST 5: Alternative Structure
// ============================================================================
console.log('TEST 5: Alternative Structure\n')

const structureProposal = createMockProposal({})
const structureResult = generateAlternatives(structureProposal)

assert(structureResult.ok, 'Structure test generation succeeds')
if (structureResult.ok) {
  const firstAlt = structureResult.value.alternatives[0]
  assert(typeof firstAlt.id === 'string', 'Alternative has id')
  assert(typeof firstAlt.description === 'string', 'Alternative has description')
  assert(typeof firstAlt.approach === 'string', 'Alternative has approach')
  assert(typeof firstAlt.rejectionReason === 'string', 'Alternative has rejection reason')
  assert(firstAlt.consequenceSurface !== undefined, 'Alternative has consequence surface')
  assert(Array.isArray(firstAlt.tradeoffs.pros), 'Alternative has pros')
  assert(Array.isArray(firstAlt.tradeoffs.cons), 'Alternative has cons')
}

console.log('')

// ============================================================================
// TEST 6: Defer Alternative for Non-Critical
// ============================================================================
console.log('TEST 6: Defer Alternative for Non-Critical\n')

const nonCriticalProposal = createMockProposal({
  issue: { type: 'MISSING_TYPES', severity: 'low', message: 'Missing types', line: 1 }
})

const deferResult = generateAlternatives(nonCriticalProposal)
assert(deferResult.ok, 'Defer alternative generation succeeds')
if (deferResult.ok) {
  assert(deferResult.value.alternatives.some(a => a.description.includes('Defer')),
         'Includes defer action alternative for non-critical')
}

const criticalProposal = createMockProposal({
  issue: { type: 'NO_ERROR_HANDLING', severity: 'critical', message: 'Critical', line: 1 }
})

const noDeferResult = generateAlternatives(criticalProposal)
assert(noDeferResult.ok, 'Critical alternative generation succeeds')
if (noDeferResult.ok) {
  // Check for "Defer action" specifically (not "Defer error handling to caller")
  assert(!noDeferResult.value.alternatives.some(a => a.description === 'Defer action'),
         'No "Defer action" alternative for critical issues')
}

console.log('')

// ============================================================================
// TEST 7: TCB-Specific Rejection Reasons
// ============================================================================
console.log('TEST 7: TCB-Specific Rejection Reasons\n')

const tcbProposal = createMockProposal({
  targetFile: 'src/validation/sixGates.ts',
  issue: { type: 'NO_ERROR_HANDLING', severity: 'high', message: 'Missing handling', line: 1 }
})

const tcbResult = generateAlternatives(tcbProposal)
assert(tcbResult.ok, 'TCB alternative generation succeeds')
if (tcbResult.ok) {
  // Check that "defer to caller" alternative mentions TCB in rejection
  const deferAlt = tcbResult.value.alternatives.find(a => a.description.includes('Defer') && a.description.includes('caller'))
  if (deferAlt) {
    assert(deferAlt.rejectionReason.includes('TCB'),
           'TCB rejection reason mentions TCB requirements')
  }
}

console.log('')

// ============================================================================
// TEST 8: Has Adequate Alternatives Check
// ============================================================================
console.log('TEST 8: Has Adequate Alternatives Check\n')

const adequateProposal = createMockProposal({})
const adequateResult = generateAlternatives(adequateProposal)

assert(adequateResult.ok, 'Adequate check generation succeeds')
if (adequateResult.ok) {
  assert(hasAdequateAlternatives(adequateResult.value),
         'Valid result passes adequate check')
}

// Test inadequate alternatives
const inadequateResult: ProposalWithAlternatives = {
  proposal: createMockProposal({}),
  alternatives: [{ // Only 1 alternative - not adequate
    id: 'alt-0',
    description: 'Single alt',
    approach: 'Only one',
    rejectionReason: 'Test',
    consequenceSurface: { enables: [], forbids: [], assumptions: [], validationCriteria: [] },
    tradeoffs: { pros: [], cons: [] }
  }],
  chosenRationale: 'Test',
  comparisonSummary: 'Test'
}

assert(!hasAdequateAlternatives(inadequateResult),
       'Single alternative fails adequate check')

console.log('')

// ============================================================================
// TEST 9: Format Output
// ============================================================================
console.log('TEST 9: Format Output\n')

const formatProposal = createMockProposal({})
const formatResult = generateAlternatives(formatProposal)

assert(formatResult.ok, 'Format source generation succeeds')
if (formatResult.ok) {
  const formatted = formatAlternatives(formatResult.value)
  assert(formatted.includes('ALTERNATIVE ANALYSIS'), 'Format includes header')
  assert(formatted.includes('CHOSEN APPROACH'), 'Format includes chosen approach')
  assert(formatted.includes('ALTERNATIVES CONSIDERED'), 'Format includes alternatives section')
  assert(formatted.includes('COMPARISON SUMMARY'), 'Format includes comparison summary')
  assert(formatted.includes('Pros:'), 'Format includes pros')
  assert(formatted.includes('Cons:'), 'Format includes cons')
  assert(formatted.includes('Rejected:'), 'Format includes rejection reasons')
}

console.log('')

// ============================================================================
// TEST 10: Consequence Surface Per Alternative
// ============================================================================
console.log('TEST 10: Consequence Surface Per Alternative\n')

const csProposal = createMockProposal({
  targetFile: 'src/validation/axiomChecker.ts',
  issue: { type: 'HIGH_COMPLEXITY', severity: 'high', message: 'Complex', line: 1 }
})

const csResult = generateAlternatives(csProposal)
assert(csResult.ok, 'Consequence surface alternative generation succeeds')
if (csResult.ok) {
  for (const alt of csResult.value.alternatives) {
    assert(alt.consequenceSurface !== undefined,
           `Alternative "${alt.description}" has consequence surface`)
    assert(Array.isArray(alt.consequenceSurface.enables),
           `Alternative "${alt.description}" has enables array`)
  }
}

console.log('')

// ============================================================================
// TEST 11: Missing Types Alternatives
// ============================================================================
console.log('TEST 11: Missing Types Alternatives\n')

const typesProposal = createMockProposal({
  issue: { type: 'MISSING_TYPES', severity: 'medium', message: 'Missing types', line: 1 }
})

const typesResult = generateAlternatives(typesProposal)
assert(typesResult.ok, 'Types alternative generation succeeds')
if (typesResult.ok) {
  assert(typesResult.value.alternatives.some(a => a.description.includes('annotation')),
         'Includes type annotation alternative')
  assert(typesResult.value.alternatives.some(a => a.description.includes('JSDoc')),
         'Includes JSDoc alternative')
}

console.log('')

// ============================================================================
// TEST 12: Duplicate Code Alternatives
// ============================================================================
console.log('TEST 12: Duplicate Code Alternatives\n')

const duplicateProposal = createMockProposal({
  issue: { type: 'DUPLICATE_CODE', severity: 'medium', message: 'Duplicate code', line: 1 }
})

const duplicateResult = generateAlternatives(duplicateProposal)
assert(duplicateResult.ok, 'Duplicate alternative generation succeeds')
if (duplicateResult.ok) {
  assert(duplicateResult.value.alternatives.some(a => a.description.includes('Extract')),
         'Includes extract function alternative')
  assert(duplicateResult.value.alternatives.some(a => a.description.includes('Accept')),
         'Includes accept duplication alternative')
}

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('ALTERNATIVE TRACKING TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL ALTERNATIVE TRACKING TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
