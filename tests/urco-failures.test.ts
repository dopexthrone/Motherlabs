// URCO Failure Mode Tests - Non-happy-path validation

import { extractEntities, extractActions } from '../src/urco/extractor'
import { detectMissingVars } from '../src/urco/missingVars'
import { detectContradictions } from '../src/urco/contradictions'
import { validateEvidencePlan } from '../src/urco/validator'
import { computeEntropy } from '../src/urco/entropy'
import { examineCandidates } from '../src/urco/examine'
import { removeLowScoring } from '../src/urco/remove'
import type { Candidate } from '../src/urco/types'

let failCount = 0
let passCount = 0

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`)
    failCount++
  } else {
    console.log(`✓ PASS: ${message}`)
    passCount++
  }
}

console.log('=== URCO FAILURE MODE TESTS ===\n')

// ============================================================================
// TEST 1: Invalid Inputs (Edge Cases)
// ============================================================================
console.log('TEST 1: Invalid/Edge Case Inputs\n')

// Empty string
const entities_empty = extractEntities('')
assert(Array.isArray(entities_empty) && entities_empty.length === 0, 'Empty string returns empty array (no crash)')

// Very long string (DoS protection)
const longString = 'a'.repeat(100000)
const entities_long = extractEntities(longString)
assert(Array.isArray(entities_long), 'Very long string does not crash')

// Special characters
const specialChars = '!@#$%^&*()[]{}|\\/<>?~`'
const entities_special = extractEntities(specialChars)
assert(Array.isArray(entities_special), 'Special characters do not crash')

// Unicode/emoji
const unicode = '🎯 Build [システム] with "测试"'
const entities_unicode = extractEntities(unicode)
assert(entities_unicode.length > 0, 'Unicode handled correctly')

// Malformed brackets
const malformed = '[Unclosed ['
const entities_malformed = extractEntities(malformed)
assert(Array.isArray(entities_malformed), 'Malformed brackets do not crash')

console.log('')

// ============================================================================
// TEST 2: Contradiction Detection - False Positives
// ============================================================================
console.log('TEST 2: Contradiction Detection - False Positives\n')

// Should NOT detect contradiction (legitimate use of "not")
const noFalsePos1 = "Do not use deprecated libraries. Use modern alternatives."
const contras1 = detectContradictions(noFalsePos1)
assert(contras1.length === 0, 'No false positive on "do not X, use Y"')

// Should NOT detect contradiction (different contexts)
const noFalsePos2 = "Must validate input. Optional output formatting."
const contras2 = detectContradictions(noFalsePos2)
assert(contras2.filter(c => c.type === 'modality_conflict').length === 0, 'No false positive on must/optional different subjects')

console.log('')

// ============================================================================
// TEST 3: Missing Variable Detection - False Positives
// ============================================================================
console.log('TEST 3: Missing Variable Detection - False Positives\n')

// Should NOT flag missing metric when specified
const noMissingMetric = "Optimize latency to under 100ms. Measure with Apache Bench."
const actions3 = extractActions(noMissingMetric)
const entities3 = extractEntities(noMissingMetric)
const missing3 = detectMissingVars(noMissingMetric, {}, entities3, actions3)
assert(
  !missing3.some(m => m.key === 'metric'),
  'No false positive when metric is specified'
)

// Should NOT flag missing env when specified
const noMissingEnv = "Deploy to production environment using Docker."
const actions3b = extractActions(noMissingEnv)
const entities3b = extractEntities(noMissingEnv)
const missing3b = detectMissingVars(noMissingEnv, {}, entities3b, actions3b)
assert(
  !missing3b.some(m => m.key === 'env'),
  'No false positive when env is specified'
)

console.log('')

// ============================================================================
// TEST 4: Evidence Plan Validation - Boundary Cases
// ============================================================================
console.log('TEST 4: Evidence Plan Validation - Boundary Cases\n')

// Null input
const validNull = validateEvidencePlan(null)
assert(!validNull.valid, 'Null evidence plan correctly rejected')
assert(validNull.errors.some(e => e.code === 'EVIDENCE_NOT_OBJECT'), 'Null gives correct error code')

// Empty object
const validEmpty = validateEvidencePlan({})
assert(!validEmpty.valid, 'Empty evidence plan rejected')
assert(validEmpty.errors.length >= 3, 'Empty plan fails multiple checks')

// Minimal valid plan (edge of validity)
const minimalPlan = {
  method: 'unit_test',
  procedure: 'Run npm test to verify functionality works correctly',
  artifacts: [{ kind: 'file', ref: 'tests/test.ts' }],
  acceptance: { asserts: ['Tests pass'] }
}
const validMinimal = validateEvidencePlan(minimalPlan)
assert(validMinimal.valid, 'Minimal valid plan passes')

// Invalid method
const invalidMethod = {
  method: 'made_up_method',
  procedure: 'This is long enough to pass length check but method is invalid',
  artifacts: [{ kind: 'file', ref: 'test.ts' }],
  acceptance: { asserts: ['Pass'] }
}
const validInvalidMethod = validateEvidencePlan(invalidMethod)
assert(!validInvalidMethod.valid, 'Invalid method rejected')
assert(
  validInvalidMethod.errors.some(e => e.code === 'EVIDENCE_INVALID_METHOD'),
  'Invalid method gives correct error code'
)

console.log('')

// ============================================================================
// TEST 5: Entropy - Boundary Values
// ============================================================================
console.log('TEST 5: Entropy Calculation - Boundary Values\n')

// Perfect node (all fields, no issues)
const perfectNode = {
  text: "Implement function add(a: number, b: number): number that returns sum. Test with Jest. Threshold: error rate < 1%. Use semver@^7.0.0.",
  vars: { a: 'number', b: 'number' },
  inputs: ['a', 'b'],
  outputs: ['sum'],
  constraints: ['error rate < 1%'],
  acceptanceCriteria: ['Jest tests pass'],
  invariants: ['pure function'],
  evidencePlan: {
    method: 'unit_test',
    procedure: 'Run npm test',
    artifacts: [{ kind: 'file', ref: 'tests/add.test.ts' }],
    acceptance: { asserts: ['All tests pass'] }
  }
}

const entropy_perfect = computeEntropy(perfectNode, [], [])
assert(entropy_perfect.value < 0.3, 'Well-specified node has low entropy')
assert(entropy_perfect.value >= 0, 'Entropy never negative')
assert(entropy_perfect.value <= 1, 'Entropy never exceeds 1')

// Terrible node (nothing specified)
const terribleNode = {
  text: "Do the thing.",
  vars: {},
  inputs: [],
  outputs: [],
  constraints: [],
  acceptanceCriteria: [],
  invariants: []
}

const entropy_terrible = computeEntropy(terribleNode, [], [])
assert(entropy_terrible.value >= 0.4, 'Underspecified node has high entropy (>=0.4)')
assert(entropy_terrible.breakdown.unknowns > 0.5, 'High unknowns detected')
assert(entropy_terrible.breakdown.ambiguity > 0.3, 'Vague terms detected (short text penalty)')

console.log('')

// ============================================================================
// TEST 6: Candidate Scoring - Edge Cases
// ============================================================================
console.log('TEST 6: Candidate Scoring - Edge Cases\n')

// Empty candidate list
const scored_empty = examineCandidates([], [])
assert(scored_empty.length === 0, 'Empty candidate list returns empty scores')

// Single candidate (no comparison needed)
const singleCandidate: Candidate = {
  id: 'c1',
  type: 'AND_SPLIT',
  parentId: 'root',
  statement: 'Build API with Express.js@^4.18.0',
  requiredInputs: ['Node.js'],
  expectedOutputs: ['REST API'],
  invariants: ['no breaking changes']
}

const scored_single = examineCandidates([singleCandidate], [])
assert(scored_single.length === 1, 'Single candidate scored')
assert(scored_single[0].score >= 0 && scored_single[0].score <= 1, 'Score in valid range')

// Duplicate candidates (novelty should be low)
const duplicate1: Candidate = {
  id: 'c1',
  type: 'AND_SPLIT',
  parentId: 'root',
  statement: 'Build authentication system',
  requiredInputs: [],
  expectedOutputs: [],
  invariants: []
}

const duplicate2: Candidate = {
  id: 'c2',
  type: 'AND_SPLIT',
  parentId: 'root',
  statement: 'Build authentication system',  // Exact duplicate
  requiredInputs: [],
  expectedOutputs: [],
  invariants: []
}

const scored_dupes = examineCandidates([duplicate1, duplicate2], [])
assert(scored_dupes[1].breakdown.novelty < 0.1, 'Duplicate has very low novelty score')

console.log('')

// ============================================================================
// TEST 7: Remove - Edge Cases
// ============================================================================
console.log('TEST 7: Remove/Prune - Edge Cases\n')

// No candidates above threshold - should keep best 2
const lowScored = examineCandidates([
  { id: 'c1', type: 'AND_SPLIT', parentId: 'root', statement: 'x', requiredInputs: [], expectedOutputs: [], invariants: [] },
  { id: 'c2', type: 'AND_SPLIT', parentId: 'root', statement: 'y', requiredInputs: [], expectedOutputs: [], invariants: [] },
  { id: 'c3', type: 'AND_SPLIT', parentId: 'root', statement: 'z', requiredInputs: [], expectedOutputs: [], invariants: [] }
], [])

const removed_low = removeLowScoring(lowScored)
assert(removed_low.kept.length >= 2, 'Always keeps at least 2 candidates')
assert(removed_low.kept.length <= 5, 'Never keeps more than 5 candidates')

console.log('')

// ============================================================================
// TEST 8: Malformed Data Handling
// ============================================================================
console.log('TEST 8: Malformed Data Handling\n')

// Missing required fields in evidence plan
const malformed1 = {
  method: 'unit_test'
  // Missing procedure, artifacts, acceptance
}

const valid_malformed1 = validateEvidencePlan(malformed1)
assert(!valid_malformed1.valid, 'Missing fields rejected')
assert(valid_malformed1.errors.length >= 2, 'Multiple errors for missing fields')

// Wrong types
const malformed2 = {
  method: 123,  // Should be string
  procedure: 'Valid procedure text here',
  artifacts: 'not-an-array',  // Should be array
  acceptance: { asserts: ['Pass'] }
}

const valid_malformed2 = validateEvidencePlan(malformed2)
assert(!valid_malformed2.valid, 'Wrong types rejected')

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)
console.log(`Total: ${passCount + failCount}`)

if (failCount > 0) {
  console.error(`\n✗ ${failCount} tests failed`)
  process.exit(1)
} else {
  console.log(`\n✓ All failure mode tests passed`)
  process.exit(0)
}
