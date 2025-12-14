// Gate Elevation Tests - Verifies gate elevation protocol
// Tests Step 9 of ROADMAP_NEXT_10.md: Gate Elevation Protocol

import {
  determineGateRequirements,
  checkGatesSatisfied,
  checkAdditionalRequirementsSatisfied,
  formatGateElevation,
  getElevationSummary,
  GateElevation
} from '../src/validation/gateElevation'
import type { ImprovementProposal } from '../src/selfbuild/proposer'
import type { DecisionType } from '../src/core/decisionClassifier'

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
    rationale: 'Test rationale because it fixes the issue and improves code quality significantly',
    timestamp: Date.now(),
    source: 'llm',
    gateValidation: { valid: true, gateResults: [] },
    ...overrides
  }
}

async function runTests() {

console.log('=== GATE ELEVATION TESTS ===\n')

// ============================================================================
// TEST 1: Reversible Changes Get Standard Level
// ============================================================================
console.log('TEST 1: Reversible Changes Get Standard Level\n')

const reversibleProposal = createMockProposal({
  targetFile: 'src/example/helper.ts'
})

const reversibleResult = determineGateRequirements(reversibleProposal, 'reversible')
assert(reversibleResult.ok, 'Reversible elevation succeeds')
if (reversibleResult.ok) {
  assert(reversibleResult.value.level === 'standard', 'Reversible gets standard level')
  assert(!reversibleResult.value.humanApprovalRequired, 'Standard level no human approval')
  const requiredGates = reversibleResult.value.gates.filter(g => g.required)
  assert(requiredGates.length === 4, 'Standard level has 4 required gates')
}

console.log('')

// ============================================================================
// TEST 2: Irreversible Changes Get Elevated Level
// ============================================================================
console.log('TEST 2: Irreversible Changes Get Elevated Level\n')

const irreversibleProposal = createMockProposal({
  targetFile: 'src/core/result.ts'
})

const irreversibleResult = determineGateRequirements(irreversibleProposal, 'irreversible')
assert(irreversibleResult.ok, 'Irreversible elevation succeeds')
if (irreversibleResult.ok) {
  assert(irreversibleResult.value.level === 'elevated', 'Irreversible gets elevated level')
  assert(irreversibleResult.value.humanApprovalRequired, 'Elevated level requires human approval')
  const requiredGates = irreversibleResult.value.gates.filter(g => g.required)
  assert(requiredGates.length === 6, 'Elevated level has all 6 gates required')
}

console.log('')

// ============================================================================
// TEST 3: Constitutional Changes Get Maximum Level
// ============================================================================
console.log('TEST 3: Constitutional Changes Get Maximum Level\n')

const constitutionalProposal = createMockProposal({
  targetFile: 'docs/MOTHERLABS_CONSTITUTION.md'
})

const constitutionalResult = determineGateRequirements(constitutionalProposal, 'irreversible')
assert(constitutionalResult.ok, 'Constitutional elevation succeeds')
if (constitutionalResult.ok) {
  assert(constitutionalResult.value.level === 'maximum', 'Constitutional gets maximum level')
  assert(constitutionalResult.value.humanApprovalRequired, 'Maximum level requires human approval')
  assert(constitutionalResult.value.humanApprovalReason?.includes('Constitutional'),
         'Reason mentions constitutional')
}

console.log('')

// ============================================================================
// TEST 4: Architectural Changes Detected
// ============================================================================
console.log('TEST 4: Architectural Changes Detected\n')

const architecturalProposal = createMockProposal({
  targetFile: 'src/core/types.ts',
  proposedChange: {
    type: 'add_function',
    code: `export type NewCoreType = {
  id: string
  value: unknown
}

export interface NewInterface {
  process(): void
}`
  }
})

const architecturalResult = determineGateRequirements(architecturalProposal, 'reversible')
assert(architecturalResult.ok, 'Architectural elevation succeeds')
if (architecturalResult.ok) {
  assert(architecturalResult.value.level === 'maximum', 'Architectural change gets maximum level')
  assert(architecturalResult.value.elevationReason.includes('Architectural'),
         'Reason mentions architectural change')
}

console.log('')

// ============================================================================
// TEST 5: TCB Authority Gets Elevated
// ============================================================================
console.log('TEST 5: TCB Authority Gets Elevated\n')

const tcbAuthorityProposal = createMockProposal({
  targetFile: 'src/validation/sixGates.ts'
})

const tcbResult = determineGateRequirements(tcbAuthorityProposal, 'reversible')
assert(tcbResult.ok, 'TCB authority elevation succeeds')
if (tcbResult.ok) {
  // TCB authority should elevate even reversible decisions
  assert(tcbResult.value.level === 'elevated' || tcbResult.value.level === 'maximum',
         'TCB authority gets elevated or maximum')
  assert(tcbResult.value.humanApprovalRequired, 'TCB authority requires human approval')
}

console.log('')

// ============================================================================
// TEST 6: Premature Decision Gets Maximum Level
// ============================================================================
console.log('TEST 6: Premature Decision Gets Maximum Level\n')

const prematureProposal = createMockProposal({})
const prematureResult = determineGateRequirements(prematureProposal, 'premature')

assert(prematureResult.ok, 'Premature elevation succeeds')
if (prematureResult.ok) {
  assert(prematureResult.value.level === 'maximum', 'Premature gets maximum level')
  assert(prematureResult.value.humanApprovalRequired, 'Premature requires human approval')
  assert(prematureResult.value.humanApprovalReason?.includes('Premature') ||
         prematureResult.value.humanApprovalReason?.includes('exceptional'),
         'Reason mentions premature or exceptional justification')
}

console.log('')

// ============================================================================
// TEST 7: Additional Requirements for Elevated Level
// ============================================================================
console.log('TEST 7: Additional Requirements for Elevated Level\n')

const elevatedProposal = createMockProposal({
  targetFile: 'src/sandbox/runner.ts',
  consequenceAnalysis: {
    proposal: { id: 'x', targetFile: 'x', changeType: 'x' },
    surface: { enables: [], forbids: [], assumptions: [], validationCriteria: [] },
    riskLevel: 'high',
    reversibilityAssessment: { canRevert: true, revertCost: 'expensive' }
  },
  alternativeAnalysis: {
    proposal: createMockProposal({}),
    alternatives: [],
    chosenRationale: 'Test',
    comparisonSummary: 'Test'
  }
})

const elevatedResult = determineGateRequirements(elevatedProposal, 'irreversible')
assert(elevatedResult.ok, 'Elevated with requirements succeeds')
if (elevatedResult.ok) {
  assert(elevatedResult.value.additionalRequirements.length > 0,
         'Has additional requirements')
  assert(elevatedResult.value.additionalRequirements.some(r => r.requirement.includes('Consequence')),
         'Includes consequence surface requirement')
  assert(elevatedResult.value.additionalRequirements.some(r => r.requirement.includes('Alternative')),
         'Includes alternative analysis requirement')
}

console.log('')

// ============================================================================
// TEST 8: Gate Satisfaction Check
// ============================================================================
console.log('TEST 8: Gate Satisfaction Check\n')

const satisfactionProposal = createMockProposal({})
const satisfactionResult = determineGateRequirements(satisfactionProposal, 'irreversible')

assert(satisfactionResult.ok, 'Satisfaction check setup succeeds')
if (satisfactionResult.ok) {
  // All gates pass
  const allPassResults = [
    { gateName: 'schema_validation', passed: true },
    { gateName: 'syntax_validation', passed: true },
    { gateName: 'variable_resolution', passed: true },
    { gateName: 'test_execution', passed: true },
    { gateName: 'urco_entropy', passed: true },
    { gateName: 'governance_check', passed: true }
  ]

  const allPass = checkGatesSatisfied(satisfactionResult.value, allPassResults)
  assert(allPass.satisfied, 'All gates passing is satisfied')
  assert(allPass.failedGates.length === 0, 'No failed gates')

  // One gate fails
  const oneFailResults = [
    { gateName: 'schema_validation', passed: true },
    { gateName: 'syntax_validation', passed: false },
    { gateName: 'variable_resolution', passed: true },
    { gateName: 'test_execution', passed: true },
    { gateName: 'urco_entropy', passed: true },
    { gateName: 'governance_check', passed: true }
  ]

  const oneFail = checkGatesSatisfied(satisfactionResult.value, oneFailResults)
  assert(!oneFail.satisfied, 'One gate failing is not satisfied')
  assert(oneFail.failedGates.includes('syntax_validation'), 'Identifies failed gate')
}

console.log('')

// ============================================================================
// TEST 9: Additional Requirements Satisfaction Check
// ============================================================================
console.log('TEST 9: Additional Requirements Satisfaction Check\n')

const addReqProposal = createMockProposal({
  targetFile: 'src/core/loop.ts',
  consequenceAnalysis: {
    proposal: { id: 'x', targetFile: 'x', changeType: 'x' },
    surface: { enables: [], forbids: [], assumptions: [], validationCriteria: [] },
    riskLevel: 'medium',
    reversibilityAssessment: { canRevert: true, revertCost: 'moderate' }
  }
  // Missing alternativeAnalysis
})

const addReqResult = determineGateRequirements(addReqProposal, 'irreversible')
assert(addReqResult.ok, 'Additional requirements check setup succeeds')
if (addReqResult.ok) {
  const addCheck = checkAdditionalRequirementsSatisfied(addReqResult.value)
  // Should have unsatisfied alternative requirement
  if (addReqResult.value.additionalRequirements.some(r => !r.satisfied)) {
    assert(!addCheck.satisfied, 'Missing requirement detected')
    assert(addCheck.unsatisfied.length > 0, 'Has unsatisfied requirements')
  }
}

console.log('')

// ============================================================================
// TEST 10: Format Output
// ============================================================================
console.log('TEST 10: Format Output\n')

const formatProposal = createMockProposal({
  targetFile: 'src/validation/axiomChecker.ts'
})

const formatResult = determineGateRequirements(formatProposal, 'irreversible')
assert(formatResult.ok, 'Format elevation succeeds')
if (formatResult.ok) {
  const formatted = formatGateElevation(formatResult.value)
  assert(formatted.includes('GATE ELEVATION PROTOCOL'), 'Format includes header')
  assert(formatted.includes('Elevation Level:'), 'Format includes level')
  assert(formatted.includes('GATE REQUIREMENTS:'), 'Format includes gates section')
  assert(formatted.includes('REQUIRED') || formatted.includes('ADVISORY'),
         'Format includes gate status')
}

console.log('')

// ============================================================================
// TEST 11: Elevation Summary
// ============================================================================
console.log('TEST 11: Elevation Summary\n')

const summaryProposal = createMockProposal({})
const summaryResult = determineGateRequirements(summaryProposal, 'irreversible')

assert(summaryResult.ok, 'Summary elevation succeeds')
if (summaryResult.ok) {
  const summary = getElevationSummary(summaryResult.value)
  assert(summary.includes('gates required'), 'Summary mentions gates')
  assert(summary.includes('additional requirements'), 'Summary mentions additional requirements')
}

console.log('')

// ============================================================================
// TEST 12: Schema Changes are Architectural
// ============================================================================
console.log('TEST 12: Schema Changes are Architectural\n')

const schemaProposal = createMockProposal({
  targetFile: 'schemas/action.schema.json'
})

const schemaResult = determineGateRequirements(schemaProposal, 'reversible')
assert(schemaResult.ok, 'Schema elevation succeeds')
if (schemaResult.ok) {
  assert(schemaResult.value.level === 'maximum', 'Schema changes get maximum level')
}

console.log('')

// ============================================================================
// TEST 13: Large Core Changes are Architectural
// ============================================================================
console.log('TEST 13: Large Core Changes are Architectural\n')

const largeCode = Array(60).fill('export const x = 1').join('\n')
const largeCoreProposal = createMockProposal({
  targetFile: 'src/core/bigModule.ts',
  proposedChange: { type: 'refactor', code: largeCode }
})

const largeCoreResult = determineGateRequirements(largeCoreProposal, 'reversible')
assert(largeCoreResult.ok, 'Large core elevation succeeds')
if (largeCoreResult.ok) {
  assert(largeCoreResult.value.level === 'maximum', 'Large core changes get maximum level')
}

console.log('')

// ============================================================================
// TEST 14: Test Files Get Standard Level
// ============================================================================
console.log('TEST 14: Test Files Get Standard Level\n')

const testFileProposal = createMockProposal({
  targetFile: 'tests/example.test.ts',
  proposedChange: { type: 'add_test', code: 'describe("test", () => {})' }
})

const testFileResult = determineGateRequirements(testFileProposal, 'reversible')
assert(testFileResult.ok, 'Test file elevation succeeds')
if (testFileResult.ok) {
  assert(testFileResult.value.level === 'standard', 'Test files get standard level')
  assert(!testFileResult.value.humanApprovalRequired, 'Test files no human approval')
}

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('GATE ELEVATION TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL GATE ELEVATION TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
