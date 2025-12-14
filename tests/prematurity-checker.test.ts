// Prematurity Checker Tests - Verifies prematurity detection logic
// Tests Step 5 of ROADMAP_NEXT_10.md: Prematurity Detection

import {
  checkPrematurity,
  formatPrematurityCheck,
  PrematurityCheck
} from '../src/validation/prematurityChecker'
import { generateAlternatives } from '../src/core/proposal'
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
    rationale: 'Test rationale because it fixes the issue',
    timestamp: Date.now(),
    source: 'llm',
    gateValidation: { valid: true, gateResults: [] },
    ...overrides
  }
}

async function runTests() {

console.log('=== PREMATURITY CHECKER TESTS ===\n')

// ============================================================================
// TEST 1: Critical Severity is Never Premature
// ============================================================================
console.log('TEST 1: Critical Severity is Never Premature\n')

const criticalProposal = createMockProposal({
  issue: { type: 'NO_ERROR_HANDLING', severity: 'critical', message: 'Critical security issue', line: 1 }
})

const criticalResult = checkPrematurity(criticalProposal)
assert(criticalResult.ok, 'Critical prematurity check succeeds')
if (criticalResult.ok) {
  assert(!criticalResult.value.premature, 'Critical severity is NOT premature')
  assert(criticalResult.value.signals.some(s => s.weight < 0),
         'Has negative weight signal (not premature)')
}

console.log('')

// ============================================================================
// TEST 2: Low Severity with Weak Justification is Premature
// ============================================================================
console.log('TEST 2: Low Severity with Weak Justification is Premature\n')

const weakProposal = createMockProposal({
  issue: { type: 'MISSING_TYPES', severity: 'low', message: 'Missing types', line: 1 },
  targetFile: 'tests/example.test.ts',
  rationale: 'Fix it',  // Very short rationale
  gateValidation: undefined  // No gate validation
})

const weakResult = checkPrematurity(weakProposal)
assert(weakResult.ok, 'Weak proposal prematurity check succeeds')
if (weakResult.ok) {
  assert(weakResult.value.premature, 'Low severity + weak justification is premature')
  assert(weakResult.value.signals.some(s => s.category === 'justification'),
         'Has justification signal')
}

console.log('')

// ============================================================================
// TEST 3: Test File Changes are Rarely Premature
// ============================================================================
console.log('TEST 3: Test File Changes are Rarely Premature\n')

const testProposal = createMockProposal({
  targetFile: 'tests/example.test.ts',
  issue: { type: 'NO_TESTS', severity: 'medium', message: 'No tests', line: 1 },
  proposedChange: { type: 'add_test', code: 'describe("test", () => {})' },
  rationale: 'Adding tests improves reliability and enables safe refactoring'
})

const testResult = checkPrematurity(testProposal)
assert(testResult.ok, 'Test file prematurity check succeeds')
if (testResult.ok) {
  assert(testResult.value.signals.some(s => s.signal.includes('tests') && s.weight < 0),
         'Test files have not-premature signal')
}

console.log('')

// ============================================================================
// TEST 4: TODO/FIXME in Code Signals Prematurity
// ============================================================================
console.log('TEST 4: TODO/FIXME in Code Signals Prematurity\n')

const todoProposal = createMockProposal({
  proposedChange: {
    type: 'modify_function',
    code: `export function incomplete() {
  // TODO: implement proper error handling
  return null
}`
  }
})

const todoResult = checkPrematurity(todoProposal)
assert(todoResult.ok, 'TODO prematurity check succeeds')
if (todoResult.ok) {
  assert(todoResult.value.signals.some(s => s.signal.includes('TODO')),
         'Detects TODO in code')
  assert(todoResult.value.signals.some(s => s.category === 'assumptions'),
         'TODO is assumptions signal')
}

console.log('')

// ============================================================================
// TEST 5: Placeholder Code Signals Prematurity
// ============================================================================
console.log('TEST 5: Placeholder Code Signals Prematurity\n')

const placeholderProposal = createMockProposal({
  proposedChange: {
    type: 'add_function',
    code: `export function stub() {
  // placeholder implementation
  throw new Error('Not implemented')
}`
  }
})

const placeholderResult = checkPrematurity(placeholderProposal)
assert(placeholderResult.ok, 'Placeholder prematurity check succeeds')
if (placeholderResult.ok) {
  assert(placeholderResult.value.signals.some(s => s.signal.includes('placeholder')),
         'Detects placeholder in code')
}

console.log('')

// ============================================================================
// TEST 6: Uncertain Rationale Language
// ============================================================================
console.log('TEST 6: Uncertain Rationale Language\n')

const uncertainProposal = createMockProposal({
  rationale: 'This might fix the issue and could possibly improve performance'
})

const uncertainResult = checkPrematurity(uncertainProposal)
assert(uncertainResult.ok, 'Uncertain language prematurity check succeeds')
if (uncertainResult.ok) {
  assert(uncertainResult.value.signals.some(s => s.signal.includes('uncertain')),
         'Detects uncertain language in rationale')
}

console.log('')

// ============================================================================
// TEST 7: Many Alternatives Signal Prematurity
// ============================================================================
console.log('TEST 7: Many Alternatives Signal Prematurity\n')

const manyAltProposal = createMockProposal({
  issue: { type: 'HIGH_COMPLEXITY', severity: 'medium', message: 'Complex', line: 1 }
})

const altAnalysis = generateAlternatives(manyAltProposal)
assert(altAnalysis.ok, 'Alternative analysis succeeds')

if (altAnalysis.ok) {
  const manyAltResult = checkPrematurity(manyAltProposal, altAnalysis.value)
  assert(manyAltResult.ok, 'Many alternatives prematurity check succeeds')
  if (manyAltResult.ok && altAnalysis.value.alternatives.length >= 4) {
    assert(manyAltResult.value.signals.some(s => s.category === 'alternatives'),
           'Many alternatives triggers alternatives signal')
  }
}

console.log('')

// ============================================================================
// TEST 8: Constitutional Changes Require Exceptional Justification
// ============================================================================
console.log('TEST 8: Constitutional Changes Require Exceptional Justification\n')

const constitutionalProposal = createMockProposal({
  targetFile: 'docs/MOTHERLABS_CONSTITUTION.md',
  issue: { type: 'MISSING_TYPES', severity: 'medium', message: 'Update', line: 1 },
  rationale: 'Minor update to constitution'
})

const constitutionalResult = checkPrematurity(constitutionalProposal)
assert(constitutionalResult.ok, 'Constitutional prematurity check succeeds')
if (constitutionalResult.ok) {
  assert(constitutionalResult.value.signals.some(s =>
    s.signal.includes('Constitutional') || s.signal.includes('constitutional')),
         'Constitutional changes have timing signal')
}

console.log('')

// ============================================================================
// TEST 9: High Risk for Low Severity is Premature
// ============================================================================
console.log('TEST 9: High Risk for Low Severity is Premature\n')

const riskMismatchProposal = createMockProposal({
  issue: { type: 'MISSING_TYPES', severity: 'low', message: 'Types', line: 1 },
  consequenceAnalysis: {
    proposal: { id: 'x', targetFile: 'x', changeType: 'x' },
    surface: { enables: [], forbids: [], assumptions: [], validationCriteria: [] },
    riskLevel: 'high',
    reversibilityAssessment: { canRevert: true, revertCost: 'moderate' }
  }
})

const riskMismatchResult = checkPrematurity(riskMismatchProposal)
assert(riskMismatchResult.ok, 'Risk mismatch prematurity check succeeds')
if (riskMismatchResult.ok) {
  assert(riskMismatchResult.value.signals.some(s =>
    s.signal.includes('risk') && s.category === 'justification'),
         'Risk/severity mismatch triggers justification signal')
}

console.log('')

// ============================================================================
// TEST 10: Prematurity Check Structure
// ============================================================================
console.log('TEST 10: Prematurity Check Structure\n')

const structureProposal = createMockProposal({})
const structureResult = checkPrematurity(structureProposal)

assert(structureResult.ok, 'Structure prematurity check succeeds')
if (structureResult.ok) {
  assert(typeof structureResult.value.premature === 'boolean', 'Has premature boolean')
  assert(['high', 'medium', 'low'].includes(structureResult.value.confidence), 'Has valid confidence')
  assert(Array.isArray(structureResult.value.signals), 'Has signals array')
  for (const signal of structureResult.value.signals) {
    assert(typeof signal.signal === 'string', 'Signal has string')
    assert(typeof signal.weight === 'number', 'Signal has weight')
    assert(['blocking', 'alternatives', 'assumptions', 'justification', 'timing'].includes(signal.category),
           'Signal has valid category')
  }
}

console.log('')

// ============================================================================
// TEST 11: Format Output
// ============================================================================
console.log('TEST 11: Format Output\n')

const formatProposal = createMockProposal({
  issue: { type: 'MISSING_TYPES', severity: 'low', message: 'Types', line: 1 },
  rationale: 'Fix',
  gateValidation: undefined
})

const formatResult = checkPrematurity(formatProposal)
assert(formatResult.ok, 'Format prematurity check succeeds')
if (formatResult.ok) {
  const formatted = formatPrematurityCheck(formatResult.value)
  assert(formatted.includes('PREMATURITY ANALYSIS'), 'Format includes header')
  assert(formatted.includes('Status:'), 'Format includes status')
  assert(formatted.includes('Confidence:'), 'Format includes confidence')
  assert(formatted.includes('SIGNALS:'), 'Format includes signals section')
}

console.log('')

// ============================================================================
// TEST 12: Deferral Recommendation Generated
// ============================================================================
console.log('TEST 12: Deferral Recommendation Generated\n')

const deferralProposal = createMockProposal({
  issue: { type: 'MISSING_TYPES', severity: 'low', message: 'Types', line: 1 },
  rationale: 'Maybe fix',
  gateValidation: undefined
})

const deferralResult = checkPrematurity(deferralProposal)
assert(deferralResult.ok, 'Deferral prematurity check succeeds')
if (deferralResult.ok && deferralResult.value.premature) {
  assert(typeof deferralResult.value.deferralRecommendation === 'string',
         'Has deferral recommendation')
  assert(deferralResult.value.deferralRecommendation!.length > 10,
         'Deferral recommendation is substantive')
}

console.log('')

// ============================================================================
// TEST 13: Large Code Changes Signal Timing Concern
// ============================================================================
console.log('TEST 13: Large Code Changes Signal Timing Concern\n')

const largeCode = Array(150).fill('export const x = 1').join('\n')
const largeProposal = createMockProposal({
  proposedChange: { type: 'refactor', code: largeCode }
})

const largeResult = checkPrematurity(largeProposal)
assert(largeResult.ok, 'Large change prematurity check succeeds')
if (largeResult.ok) {
  assert(largeResult.value.signals.some(s =>
    s.signal.includes('Large') && s.category === 'timing'),
         'Large changes have timing signal')
}

console.log('')

// ============================================================================
// TEST 14: Security Issues are Blocking
// ============================================================================
console.log('TEST 14: Security Issues are Blocking\n')

const securityProposal = createMockProposal({
  issue: { type: 'NO_ERROR_HANDLING', severity: 'high', message: 'Security vulnerability in auth', line: 1 }
})

const securityResult = checkPrematurity(securityProposal)
assert(securityResult.ok, 'Security prematurity check succeeds')
if (securityResult.ok) {
  assert(securityResult.value.signals.some(s =>
    s.signal.includes('security') && s.weight < 0),
         'Security issues are blocking (negative weight)')
}

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('PREMATURITY CHECKER TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL PREMATURITY CHECKER TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
