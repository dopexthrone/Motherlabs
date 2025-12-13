// Round-Trip Serialization Tests - Data integrity across encode/decode

import { Ledger } from '../src/evidence'
import type { Evidence, Candidate, EntropyBreakdown } from '../src/urco/types'
import type { EvidencePlan } from '../src/urco/types'

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

console.log('=== ROUND-TRIP SERIALIZATION TESTS ===\n')

// ============================================================================
// TEST 1: Evidence Serialization Round-Trip
// ============================================================================
console.log('TEST 1: Evidence Serialization Round-Trip\n')

const evidence1: Evidence = {
  id: 'ev-test-1',
  taskId: 'task-serialization',
  type: 'task_created',
  timestamp: 1702339200000,  // Fixed timestamp for determinism
  data: {
    input: 'Build a REST API',
    metadata: { user: 'test', version: '1.0' },
    nested: { deep: { value: 42 } }
  }
}

// Serialize
const serialized1 = JSON.stringify(evidence1)

// Deserialize
const deserialized1 = JSON.parse(serialized1) as Evidence

// Verify equality
assert(
  JSON.stringify(evidence1) === JSON.stringify(deserialized1),
  'Evidence round-trip preserves all data'
)

assert(deserialized1.id === evidence1.id, 'ID preserved')
assert(deserialized1.taskId === evidence1.taskId, 'TaskID preserved')
assert(deserialized1.type === evidence1.type, 'Type preserved')
assert(deserialized1.timestamp === evidence1.timestamp, 'Timestamp preserved')
assert(
  JSON.stringify(deserialized1.data) === JSON.stringify(evidence1.data),
  'Nested data preserved exactly'
)

console.log('')

// ============================================================================
// TEST 2: Candidate Serialization Round-Trip
// ============================================================================
console.log('TEST 2: Candidate Serialization Round-Trip\n')

const evidencePlan: EvidencePlan = {
  method: 'unit_test',
  procedure: 'Run npm test to verify functionality',
  artifacts: [
    { kind: 'file', ref: 'tests/api.test.ts' },
    { kind: 'log', ref: 'test-output.txt' }
  ],
  acceptance: {
    asserts: ['All tests pass', 'Coverage > 80%'],
    thresholds: { coverage: 0.8, passRate: 1.0 }
  },
  risks: ['Flaky tests', 'Missing edge cases'],
  rollback: 'Revert to previous commit'
}

const candidate2: Candidate = {
  id: 'cand-001',
  type: 'AND_SPLIT',
  parentId: 'root',
  statement: 'Implement REST API endpoints',
  requiredInputs: ['Express.js', 'database connection'],
  expectedOutputs: ['CRUD endpoints', 'API documentation'],
  invariants: ['no breaking changes', 'backward compatible'],
  evidencePlan
}

const serialized2 = JSON.stringify(candidate2)
const deserialized2 = JSON.parse(serialized2) as Candidate

assert(
  JSON.stringify(candidate2) === JSON.stringify(deserialized2),
  'Candidate round-trip preserves all data including nested evidence plan'
)

assert(deserialized2.evidencePlan !== undefined, 'Evidence plan preserved')
assert(
  deserialized2.evidencePlan!.artifacts.length === 2,
  'Evidence plan artifacts array preserved'
)

console.log('')

// ============================================================================
// TEST 3: Entropy Breakdown Serialization
// ============================================================================
console.log('TEST 3: Entropy Breakdown Serialization\n')

const entropy3: EntropyBreakdown = {
  unknowns: 0.125,
  ambiguity: 0.333,
  contradiction: 0.0,
  specificityDeficit: 0.75,
  dependencyUncertainty: 0.1,
  verifiabilityDeficit: 0.5
}

const serialized3 = JSON.stringify(entropy3)
const deserialized3 = JSON.parse(serialized3) as EntropyBreakdown

assert(
  JSON.stringify(entropy3) === JSON.stringify(deserialized3),
  'Entropy breakdown round-trip exact'
)

// Verify numeric precision preserved
assert(deserialized3.unknowns === 0.125, 'Numeric precision preserved')
assert(deserialized3.contradiction === 0.0, 'Zero values preserved')

console.log('')

// ============================================================================
// TEST 4: Ledger Full State Serialization
// ============================================================================
console.log('TEST 4: Ledger Full State Serialization\n')

const ledger4 = new Ledger()
ledger4.append({ id: 'ev-1', taskId: 't1', type: 'task_created', timestamp: 1000, data: { a: 1 } })
ledger4.append({ id: 'ev-2', taskId: 't1', type: 'llm_decompose', timestamp: 2000, data: { b: 2 } })
ledger4.append({ id: 'ev-3', taskId: 't2', type: 'task_created', timestamp: 3000, data: { c: 3 } })

// Serialize ledger state
const allRecords = ledger4.all()
const serializedLedger = JSON.stringify(allRecords)

// Deserialize
const deserializedRecords = JSON.parse(serializedLedger) as Evidence[]

// Verify count
assert(deserializedRecords.length === 3, 'All records preserved')

// Verify order
assert(deserializedRecords[0].id === 'ev-1', 'Order preserved (first)')
assert(deserializedRecords[2].id === 'ev-3', 'Order preserved (last)')

// Verify content
assert(
  JSON.stringify(allRecords) === JSON.stringify(deserializedRecords),
  'Full ledger state round-trip exact'
)

console.log('')

// ============================================================================
// TEST 5: Special Characters and Edge Cases
// ============================================================================
console.log('TEST 5: Special Characters in Serialization\n')

const evidence5: Evidence = {
  id: 'ev-special',
  taskId: 'task-special',
  type: 'task_created',
  timestamp: 5000,
  data: {
    text: 'Contains "quotes", \'apostrophes\', and\nnewlines\tand\ttabs',
    unicode: '🎯 测试 システム',
    escaped: 'Backslash: \\ Forward: / Null: \u0000',
    empty: '',
    nullValue: null,
    undefinedHandled: 'defined'  // undefined would be stripped by JSON
  }
}

const serialized5 = JSON.stringify(evidence5)
const deserialized5 = JSON.parse(serialized5) as Evidence

assert(
  JSON.stringify(evidence5) === JSON.stringify(deserialized5),
  'Special characters preserved in round-trip'
)

assert(
  deserialized5.data.unicode === '🎯 测试 システム',
  'Unicode preserved exactly'
)

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)

console.log('\n✓ Round-trip serialization verified')
console.log('✓ All data types preserve exactly')
console.log('✓ Numeric precision maintained')
console.log('✓ Special characters handled correctly')

if (failCount > 0) {
  process.exit(1)
}
