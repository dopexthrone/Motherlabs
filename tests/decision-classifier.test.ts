// Decision Classifier Tests - Verifies decision classification logic
// Tests Step 1 of ROADMAP_NEXT_10.md: Decision Classification Gate

import {
  classifyDecision,
  isTCBPath,
  getTCBClassification,
  getRequiredGates,
  DecisionType,
  DecisionClassification
} from '../src/core/decisionClassifier'
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

console.log('=== DECISION CLASSIFIER TESTS ===\n')

// ============================================================================
// TEST 1: TCB Path Detection
// ============================================================================
console.log('TEST 1: TCB Path Detection\n')

assert(isTCBPath('src/validation/sixGates.ts'), 'Validation path is TCB')
assert(isTCBPath('src/sandbox/runner.ts'), 'Sandbox path is TCB')
assert(isTCBPath('src/persistence/jsonlLedger.ts'), 'Persistence path is TCB')
assert(isTCBPath('src/core/result.ts'), 'Core path is TCB')
assert(isTCBPath('src/selfbuild/proposer.ts'), 'Selfbuild path is TCB (governed)')
assert(isTCBPath('docs/MOTHERLABS_CONSTITUTION.md'), 'Constitution is TCB')
assert(isTCBPath('schemas/action.schema.json'), 'Schema path is TCB')
assert(!isTCBPath('src/example/randomFile.ts'), 'Non-TCB path correctly identified')
assert(!isTCBPath('tests/some.test.ts'), 'Test file is not TCB')

console.log('')

// ============================================================================
// TEST 2: TCB Classification Categories
// ============================================================================
console.log('TEST 2: TCB Classification Categories\n')

assert(getTCBClassification('src/validation/sixGates.ts') === 'authority', 'Validation is authority')
assert(getTCBClassification('src/sandbox/runner.ts') === 'authority', 'Sandbox is authority')
assert(getTCBClassification('src/selfbuild/proposer.ts') === 'governed', 'Selfbuild is governed')
assert(getTCBClassification('docs/MOTHERLABS_CONSTITUTION.md') === 'constitutional', 'Constitution is constitutional')
assert(getTCBClassification('schemas/result.schema.json') === 'schema', 'Schema path classified as schema')
assert(getTCBClassification('src/cli.ts') === 'non-tcb', 'CLI is non-TCB')

console.log('')

// ============================================================================
// TEST 3: Reversible Classification - Test Files
// ============================================================================
console.log('TEST 3: Reversible Classification - Test Files\n')

const testFileProposal = createMockProposal({
  targetFile: 'tests/example.test.ts',
  proposedChange: {
    type: 'add_test',
    code: 'describe("test", () => { it("works", () => {}) })'
  }
})

const testResult = classifyDecision(testFileProposal)
assert(testResult.ok, 'Classification succeeded for test file')
if (testResult.ok) {
  assert(testResult.value.type === 'reversible', 'Test file changes are reversible')
  assert(testResult.value.requiredEvidence.length > 0, 'Has required evidence')
}

console.log('')

// ============================================================================
// TEST 4: Irreversible Classification - TCB Authority
// ============================================================================
console.log('TEST 4: Irreversible Classification - TCB Authority\n')

const tcbProposal = createMockProposal({
  targetFile: 'src/validation/sixGates.ts',
  issue: { type: 'HIGH_COMPLEXITY', severity: 'high', message: 'Complex', line: 1 },
  proposedChange: {
    type: 'refactor',
    code: `// CONSTITUTIONAL AUTHORITY
export type GateResult = { gateName: string; passed: boolean }
export function validateCode(code: string): GateResult[] {
  // Refactored gate logic
  return []
}`
  }
})

const tcbResult = classifyDecision(tcbProposal)
assert(tcbResult.ok, 'Classification succeeded for TCB file')
if (tcbResult.ok) {
  assert(tcbResult.value.type === 'irreversible', 'TCB authority changes are irreversible')
  assert(tcbResult.value.signals.some(s => s.weight === 'strong'), 'Has strong irreversibility signal')
  assert(tcbResult.value.requiredEvidence.includes('Human approval for TCB changes'), 'Requires human approval')
}

console.log('')

// ============================================================================
// TEST 5: Irreversible Classification - Constitutional Documents
// ============================================================================
console.log('TEST 5: Irreversible Classification - Constitutional Documents\n')

const constitutionalProposal = createMockProposal({
  targetFile: 'docs/MOTHERLABS_CONSTITUTION.md',
  proposedChange: {
    type: 'modify_function',
    code: '## AXIOM 13: New Axiom\nThis is a new axiom.'
  }
})

const constResult = classifyDecision(constitutionalProposal)
assert(constResult.ok, 'Classification succeeded for constitutional document')
if (constResult.ok) {
  assert(constResult.value.type === 'irreversible', 'Constitutional changes are irreversible')
  assert(constResult.value.signals.some(s => s.signal.includes('constitutional')),
         'Identifies constitutional document')
}

console.log('')

// ============================================================================
// TEST 6: Premature Classification - Low Severity
// ============================================================================
console.log('TEST 6: Premature Classification Signals\n')

const prematureProposal = createMockProposal({
  targetFile: 'src/example/util.ts',
  issue: { type: 'MISSING_TYPES', severity: 'low', message: 'Missing types', line: 1 },
  proposedChange: {
    type: 'modify_function',
    code: 'function util() { console.log("debug") }'
  },
  gateValidation: undefined // No validation yet
})

const prematureResult = classifyDecision(prematureProposal)
assert(prematureResult.ok, 'Classification succeeded for premature candidate')
if (prematureResult.ok) {
  // Low severity should add a premature signal
  assert(prematureResult.value.signals.some(s => s.direction === 'premature'),
         'Low severity adds premature signal')
}

console.log('')

// ============================================================================
// TEST 7: Gate Elevation by Decision Type
// ============================================================================
console.log('TEST 7: Gate Elevation by Decision Type\n')

const reversibleClass: DecisionClassification = {
  type: 'reversible',
  reason: 'Test',
  requiredEvidence: [],
  signals: []
}

const irreversibleClass: DecisionClassification = {
  type: 'irreversible',
  reason: 'Test',
  requiredEvidence: [],
  signals: []
}

const prematureClass: DecisionClassification = {
  type: 'premature',
  reason: 'Test',
  requiredEvidence: [],
  signals: []
}

const reversibleGates = getRequiredGates(reversibleClass)
const irreversibleGates = getRequiredGates(irreversibleClass)
const prematureGates = getRequiredGates(prematureClass)

assert(reversibleGates.gates.length === 4, 'Reversible requires 4 gates')
assert(!reversibleGates.humanApprovalRequired, 'Reversible does not require human approval')
assert(irreversibleGates.gates.length === 6, 'Irreversible requires all 6 gates')
assert(irreversibleGates.humanApprovalRequired, 'Irreversible requires human approval')
assert(prematureGates.humanApprovalRequired, 'Premature requires human approval (to refuse)')

console.log('')

// ============================================================================
// TEST 8: Small Code Changes
// ============================================================================
console.log('TEST 8: Code Size Classification\n')

const smallChangeProposal = createMockProposal({
  targetFile: 'src/example/helper.ts',
  proposedChange: {
    type: 'add_function',
    code: 'export function add(a: number, b: number): number { return a + b }'
  }
})

const smallResult = classifyDecision(smallChangeProposal)
assert(smallResult.ok, 'Classification succeeded for small change')
if (smallResult.ok) {
  assert(smallResult.value.signals.some(s => s.signal.includes('Small code change')),
         'Identifies small code change')
}

console.log('')

// ============================================================================
// TEST 9: Large Code Changes
// ============================================================================
console.log('TEST 9: Large Code Change Classification\n')

const largeCode = Array(150).fill('export const line = "code"').join('\n')
const largeChangeProposal = createMockProposal({
  targetFile: 'src/example/bigModule.ts',
  issue: { type: 'HIGH_COMPLEXITY', severity: 'high', message: 'Complex', line: 1 },
  proposedChange: {
    type: 'refactor',
    code: largeCode
  }
})

const largeResult = classifyDecision(largeChangeProposal)
assert(largeResult.ok, 'Classification succeeded for large change')
if (largeResult.ok) {
  assert(largeResult.value.signals.some(s => s.signal.includes('Large code change')),
         'Identifies large code change')
}

console.log('')

// ============================================================================
// TEST 10: Critical Severity Forces Action
// ============================================================================
console.log('TEST 10: Critical Severity Classification\n')

const criticalProposal = createMockProposal({
  targetFile: 'src/security/auth.ts',
  issue: { type: 'NO_ERROR_HANDLING', severity: 'critical', message: 'Critical security issue', line: 1 },
  proposedChange: {
    type: 'modify_function',
    code: 'export function auth() { try { validate() } catch(e) { throw e } }'
  }
})

const criticalResult = classifyDecision(criticalProposal)
assert(criticalResult.ok, 'Classification succeeded for critical issue')
if (criticalResult.ok) {
  // Critical issues are not premature - they require action
  assert(criticalResult.value.signals.some(s =>
    s.signal.includes('critical') && s.direction !== 'premature'
  ), 'Critical severity does not indicate prematurity')
}

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('DECISION CLASSIFIER TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL DECISION CLASSIFIER TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
