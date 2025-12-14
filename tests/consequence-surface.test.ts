// Consequence Surface Tests - Verifies consequence analysis logic
// Tests Step 2 of ROADMAP_NEXT_10.md: Consequence Surface Generator

import {
  generateConsequenceSurface,
  formatConsequenceSurface,
  ConsequenceSurface,
  ConsequenceAnalysis
} from '../src/analysis/consequenceSurface'
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

console.log('=== CONSEQUENCE SURFACE TESTS ===\n')

// ============================================================================
// TEST 1: Basic Consequence Generation
// ============================================================================
console.log('TEST 1: Basic Consequence Generation\n')

const basicProposal = createMockProposal({})
const basicResult = generateConsequenceSurface(basicProposal)

assert(basicResult.ok, 'Basic consequence generation succeeds')
if (basicResult.ok) {
  assert(Array.isArray(basicResult.value.surface.enables), 'Has enables array')
  assert(Array.isArray(basicResult.value.surface.forbids), 'Has forbids array')
  assert(Array.isArray(basicResult.value.surface.assumptions), 'Has assumptions array')
  assert(Array.isArray(basicResult.value.surface.validationCriteria), 'Has validationCriteria array')
}

console.log('')

// ============================================================================
// TEST 2: TCB Validation Path Consequences
// ============================================================================
console.log('TEST 2: TCB Validation Path Consequences\n')

const validationProposal = createMockProposal({
  targetFile: 'src/validation/sixGates.ts',
  proposedChange: {
    type: 'refactor',
    code: 'export function validateCode() { /* refactored */ }'
  }
})

const validationResult = generateConsequenceSurface(validationProposal)
assert(validationResult.ok, 'Validation path consequence generation succeeds')
if (validationResult.ok) {
  assert(validationResult.value.surface.enables.some(e => e.includes('admission')),
         'Mentions admission criteria in enables')
  assert(validationResult.value.surface.forbids.some(f => f.includes('gate') || f.includes('rollback')),
         'Mentions gate behavior or rollback in forbids')
  assert(validationResult.value.riskLevel === 'high' || validationResult.value.riskLevel === 'critical',
         'Risk level is high or critical for validation changes')
}

console.log('')

// ============================================================================
// TEST 3: TCB Sandbox Path Consequences
// ============================================================================
console.log('TEST 3: TCB Sandbox Path Consequences\n')

const sandboxProposal = createMockProposal({
  targetFile: 'src/sandbox/runner.ts',
  issue: { type: 'HIGH_COMPLEXITY', severity: 'high', message: 'Complex', line: 1 },
  proposedChange: {
    type: 'modify_function',
    code: 'export function runSandboxed() { /* modified */ }'
  }
})

const sandboxResult = generateConsequenceSurface(sandboxProposal)
assert(sandboxResult.ok, 'Sandbox path consequence generation succeeds')
if (sandboxResult.ok) {
  assert(sandboxResult.value.surface.enables.some(e => e.includes('isolation') || e.includes('execution')),
         'Mentions isolation or execution in enables')
  assert(sandboxResult.value.surface.assumptions.some(a => a.includes('isolation') || a.includes('Sandbox')),
         'Has isolation assumption')
}

console.log('')

// ============================================================================
// TEST 4: TCB Persistence Path Consequences
// ============================================================================
console.log('TEST 4: TCB Persistence Path Consequences\n')

const persistenceProposal = createMockProposal({
  targetFile: 'src/persistence/jsonlLedger.ts',
  proposedChange: {
    type: 'modify_function',
    code: 'export function append() { /* modified */ }'
  }
})

const persistenceResult = generateConsequenceSurface(persistenceProposal)
assert(persistenceResult.ok, 'Persistence path consequence generation succeeds')
if (persistenceResult.ok) {
  assert(persistenceResult.value.surface.assumptions.some(a => a.includes('Append-only') || a.includes('immutable')),
         'Has append-only or immutability assumption')
  assert(persistenceResult.value.surface.validationCriteria.some(v => v.includes('AXIOM 8')),
         'References AXIOM 8 in validation criteria')
}

console.log('')

// ============================================================================
// TEST 5: Constitutional Document Consequences
// ============================================================================
console.log('TEST 5: Constitutional Document Consequences\n')

const constitutionalProposal = createMockProposal({
  targetFile: 'docs/MOTHERLABS_CONSTITUTION.md',
  proposedChange: {
    type: 'modify_function',
    code: '## New section'
  }
})

const constitutionalResult = generateConsequenceSurface(constitutionalProposal)
assert(constitutionalResult.ok, 'Constitutional consequence generation succeeds')
if (constitutionalResult.ok) {
  assert(constitutionalResult.value.riskLevel === 'critical',
         'Constitutional changes are critical risk')
  assert(constitutionalResult.value.reversibilityAssessment.revertCost === 'impossible',
         'Constitutional changes are impossible to simply revert')
}

console.log('')

// ============================================================================
// TEST 6: Risk Level Assessment
// ============================================================================
console.log('TEST 6: Risk Level Assessment\n')

const lowRiskProposal = createMockProposal({
  targetFile: 'src/example/util.ts',
  issue: { type: 'MISSING_TYPES', severity: 'low', message: 'Types', line: 1 },
  proposedChange: {
    type: 'add_function',
    code: 'export function helper() { return 1 }'
  }
})

const lowRiskResult = generateConsequenceSurface(lowRiskProposal)
assert(lowRiskResult.ok, 'Low risk consequence generation succeeds')
if (lowRiskResult.ok) {
  assert(lowRiskResult.value.riskLevel === 'low' || lowRiskResult.value.riskLevel === 'medium',
         'Non-TCB add_function is low/medium risk')
}

const highRiskProposal = createMockProposal({
  targetFile: 'src/core/result.ts',
  issue: { type: 'HIGH_COMPLEXITY', severity: 'critical', message: 'Critical', line: 1 },
  proposedChange: {
    type: 'refactor',
    code: 'export type Result<T> = { ok: true; value: T } | { ok: false; error: Error }'
  }
})

const highRiskResult = generateConsequenceSurface(highRiskProposal)
assert(highRiskResult.ok, 'High risk consequence generation succeeds')
if (highRiskResult.ok) {
  assert(highRiskResult.value.riskLevel === 'high' || highRiskResult.value.riskLevel === 'critical',
         'Core type refactor with critical severity is high/critical risk')
}

console.log('')

// ============================================================================
// TEST 7: Reversibility Assessment
// ============================================================================
console.log('TEST 7: Reversibility Assessment\n')

const testFileProposal = createMockProposal({
  targetFile: 'tests/example.test.ts',
  proposedChange: {
    type: 'add_test',
    code: 'describe("test", () => {})'
  }
})

const testFileResult = generateConsequenceSurface(testFileProposal)
assert(testFileResult.ok, 'Test file consequence generation succeeds')
if (testFileResult.ok) {
  assert(testFileResult.value.reversibilityAssessment.canRevert === true,
         'Test additions are revertible')
  assert(testFileResult.value.reversibilityAssessment.revertCost === 'trivial',
         'Test additions have trivial revert cost')
}

const authorityProposal = createMockProposal({
  targetFile: 'src/validation/axiomChecker.ts',
  proposedChange: {
    type: 'refactor',
    code: 'export function check() {}'
  }
})

const authorityResult = generateConsequenceSurface(authorityProposal)
assert(authorityResult.ok, 'Authority path consequence generation succeeds')
if (authorityResult.ok) {
  assert(authorityResult.value.reversibilityAssessment.revertCost === 'expensive',
         'Authority changes have expensive revert cost')
}

console.log('')

// ============================================================================
// TEST 8: Code Pattern Detection - Axiom References
// ============================================================================
console.log('TEST 8: Code Pattern Detection - Axiom References\n')

const axiomCodeProposal = createMockProposal({
  targetFile: 'src/example/checker.ts',
  proposedChange: {
    type: 'add_function',
    code: `// Enforces AXIOM 5
export function checkRefusal() { return true }`
  }
})

const axiomCodeResult = generateConsequenceSurface(axiomCodeProposal)
assert(axiomCodeResult.ok, 'Axiom code consequence generation succeeds')
if (axiomCodeResult.ok) {
  assert(axiomCodeResult.value.surface.enables.some(e => e.includes('Axiom enforcement')),
         'Detects axiom enforcement in code')
  assert(axiomCodeResult.value.surface.assumptions.some(a => a.includes('Axiom interpretation')),
         'Has axiom interpretation assumption')
}

console.log('')

// ============================================================================
// TEST 9: Code Pattern Detection - Result Type
// ============================================================================
console.log('TEST 9: Code Pattern Detection - Result Type\n')

const resultCodeProposal = createMockProposal({
  targetFile: 'src/example/service.ts',
  proposedChange: {
    type: 'add_function',
    code: `export function process(): Result<string, Error> {
  return Ok("done")
}`
  }
})

const resultCodeResult = generateConsequenceSurface(resultCodeProposal)
assert(resultCodeResult.ok, 'Result pattern consequence generation succeeds')
if (resultCodeResult.ok) {
  assert(resultCodeResult.value.surface.enables.some(e => e.includes('Result')),
         'Detects Result pattern in code')
  assert(resultCodeResult.value.surface.validationCriteria.some(v => v.includes('exception')),
         'Has exception validation criteria')
}

console.log('')

// ============================================================================
// TEST 10: Format Output
// ============================================================================
console.log('TEST 10: Format Output\n')

const formatProposal = createMockProposal({
  targetFile: 'src/validation/sixGates.ts',
  proposedChange: {
    type: 'refactor',
    code: 'export function validate() {}'
  }
})

const formatResult = generateConsequenceSurface(formatProposal)
assert(formatResult.ok, 'Format source consequence generation succeeds')
if (formatResult.ok) {
  const formatted = formatConsequenceSurface(formatResult.value)
  assert(formatted.includes('CONSEQUENCE SURFACE ANALYSIS'), 'Format includes header')
  assert(formatted.includes('ENABLES:'), 'Format includes enables section')
  assert(formatted.includes('FORBIDS:'), 'Format includes forbids section')
  assert(formatted.includes('ASSUMPTIONS:'), 'Format includes assumptions section')
  assert(formatted.includes('VALIDATION CRITERIA:'), 'Format includes validation section')
  assert(formatted.includes('REVERSIBILITY:'), 'Format includes reversibility section')
}

console.log('')

// ============================================================================
// TEST 11: Schema Path Consequences
// ============================================================================
console.log('TEST 11: Schema Path Consequences\n')

const schemaProposal = createMockProposal({
  targetFile: 'schemas/action.schema.json',
  proposedChange: {
    type: 'modify_function',
    code: '{ "type": "object" }'
  }
})

const schemaResult = generateConsequenceSurface(schemaProposal)
assert(schemaResult.ok, 'Schema path consequence generation succeeds')
if (schemaResult.ok) {
  assert(schemaResult.value.surface.forbids.some(f => f.includes('schema') || f.includes('old')),
         'Mentions schema or old format in forbids')
  assert(schemaResult.value.reversibilityAssessment.revertCost === 'expensive',
         'Schema changes have expensive revert cost')
}

console.log('')

// ============================================================================
// TEST 12: Selfbuild (Governed) Path Consequences
// ============================================================================
console.log('TEST 12: Selfbuild (Governed) Path Consequences\n')

const selfbuildProposal = createMockProposal({
  targetFile: 'src/selfbuild/proposer.ts',
  proposedChange: {
    type: 'modify_function',
    code: 'export function propose() {}'
  }
})

const selfbuildResult = generateConsequenceSurface(selfbuildProposal)
assert(selfbuildResult.ok, 'Selfbuild path consequence generation succeeds')
if (selfbuildResult.ok) {
  assert(selfbuildResult.value.surface.assumptions.some(a => a.includes('governed') || a.includes('AXIOM 5')),
         'Has governance or AXIOM 5 assumption')
  assert(selfbuildResult.value.reversibilityAssessment.revertCost === 'moderate',
         'Governed changes have moderate revert cost')
}

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('CONSEQUENCE SURFACE TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL CONSEQUENCE SURFACE TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
