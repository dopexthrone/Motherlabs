// Evidence Query Tests - Verifies evidence query system
// Tests Step 6 of ROADMAP_NEXT_10.md: Build Evidence Query System

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomBytes } from 'crypto'
import {
  EvidenceQuery,
  formatEvidenceEntry,
  formatDecisionContext
} from '../src/persistence/evidenceQuery'
import { JSONLLedger } from '../src/persistence/jsonlLedger'
import { FileLedger } from '../src/persistence/fileLedger'

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

console.log('=== EVIDENCE QUERY TESTS ===\n')

// Create temp directories for testing
const testId = randomBytes(4).toString('hex')
const tempDir = path.join(os.tmpdir(), `evidence-query-test-${testId}`)
fs.mkdirSync(tempDir, { recursive: true })

const jsonlPath = path.join(tempDir, 'test-ledger.jsonl')
const fileLedgerPath = path.join(tempDir, 'file-ledger')

// ============================================================================
// Setup: Create test data in JSONL ledger
// ============================================================================
console.log('SETUP: Creating test data\n')

const jsonlLedger = new JSONLLedger(jsonlPath)

// Add test records
await jsonlLedger.append('PROPOSAL', {
  proposalId: 'prop-001',
  targetFile: 'src/core/result.ts',
  decisionType: 'reversible',
  issueType: 'NO_ERROR_HANDLING',
  severity: 'high',
  source: 'llm',
  rationale: 'Adding Result type for better error handling'
})

await jsonlLedger.append('PROPOSAL', {
  proposalId: 'prop-002',
  targetFile: 'src/validation/sixGates.ts',
  decisionType: 'irreversible',
  issueType: 'HIGH_COMPLEXITY',
  severity: 'critical',
  source: 'llm',
  rationale: 'Refactoring gate validation for clarity',
  enables: ['Better maintainability', 'Easier testing'],
  forbids: ['Old API compatibility']
})

await jsonlLedger.append('DECISION', {
  proposalId: 'prop-003',
  targetFile: 'tests/example.test.ts',
  decisionType: 'reversible',
  issueType: 'NO_TESTS',
  severity: 'low',
  source: 'deterministic',
  rationale: 'Adding tests for coverage'
})

await jsonlLedger.append('APPLIED', {
  proposalId: 'prop-001',
  targetFile: 'src/core/result.ts',
  gatesPassed: ['schema_validation', 'syntax_validation', 'variable_resolution', 'test_execution'],
  gatesFailed: []
})

console.log(`Created ${jsonlLedger.count()} test records\n`)

// ============================================================================
// TEST 1: Create EvidenceQuery for JSONL Ledger
// ============================================================================
console.log('TEST 1: Create EvidenceQuery for JSONL Ledger\n')

const query = new EvidenceQuery(jsonlPath)
assert(query.count() > 0, 'Query initializes with records')

console.log('')

// ============================================================================
// TEST 2: Query by File
// ============================================================================
console.log('TEST 2: Query by File\n')

const fileResult = query.byFile('src/core/result.ts')
assert(fileResult.ok, 'byFile query succeeds')
if (fileResult.ok) {
  assert(fileResult.value.length >= 2, 'Finds multiple entries for file')
  assert(fileResult.value.every(e => e.data.targetFile?.includes('result.ts')),
         'All entries match file')
}

console.log('')

// ============================================================================
// TEST 3: Query by Decision Type
// ============================================================================
console.log('TEST 3: Query by Decision Type\n')

const reversibleResult = query.byDecisionType('reversible')
assert(reversibleResult.ok, 'byDecisionType query succeeds')
if (reversibleResult.ok) {
  assert(reversibleResult.value.length >= 2, 'Finds reversible entries')
  assert(reversibleResult.value.every(e => e.data.decisionType === 'reversible'),
         'All entries are reversible')
}

const irreversibleResult = query.byDecisionType('irreversible')
assert(irreversibleResult.ok, 'byDecisionType for irreversible succeeds')
if (irreversibleResult.ok) {
  assert(irreversibleResult.value.length >= 1, 'Finds irreversible entries')
}

console.log('')

// ============================================================================
// TEST 4: Query by Date Range
// ============================================================================
console.log('TEST 4: Query by Date Range\n')

const now = new Date()
const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)

const dateResult = query.byDateRange(hourAgo, now)
assert(dateResult.ok, 'byDateRange query succeeds')
if (dateResult.ok) {
  assert(dateResult.value.length > 0, 'Finds entries in date range')
}

console.log('')

// ============================================================================
// TEST 5: Query by Record Type
// ============================================================================
console.log('TEST 5: Query by Record Type\n')

const proposalResult = query.byRecordType('PROPOSAL')
assert(proposalResult.ok, 'byRecordType query succeeds')
if (proposalResult.ok) {
  assert(proposalResult.value.length >= 2, 'Finds PROPOSAL entries')
  assert(proposalResult.value.every(e => e.type === 'PROPOSAL'),
         'All entries are PROPOSAL type')
}

console.log('')

// ============================================================================
// TEST 6: Combined Query Filter
// ============================================================================
console.log('TEST 6: Combined Query Filter\n')

const combinedResult = query.query({
  decisionType: 'reversible',
  recordType: 'PROPOSAL'
})
assert(combinedResult.ok, 'Combined query succeeds')
if (combinedResult.ok) {
  assert(combinedResult.value.length >= 1, 'Finds matching entries')
  assert(combinedResult.value.every(e =>
    e.data.decisionType === 'reversible' && e.type === 'PROPOSAL'),
         'All entries match filters')
}

console.log('')

// ============================================================================
// TEST 7: Query with Pagination
// ============================================================================
console.log('TEST 7: Query with Pagination\n')

const limitResult = query.query({ limit: 2 })
assert(limitResult.ok, 'Limit query succeeds')
if (limitResult.ok) {
  assert(limitResult.value.length <= 2, 'Respects limit')
}

const offsetResult = query.query({ offset: 1, limit: 2 })
assert(offsetResult.ok, 'Offset query succeeds')

console.log('')

// ============================================================================
// TEST 8: Reconstruct Context
// ============================================================================
console.log('TEST 8: Reconstruct Context\n')

// Get first entry ID
const allResult = query.query({})
assert(allResult.ok, 'Get all entries succeeds')

if (allResult.ok && allResult.value.length > 1) {
  const entryId = allResult.value[1].id  // Skip genesis
  const contextResult = query.reconstructContext(entryId)

  assert(contextResult.ok, 'reconstructContext succeeds')
  if (contextResult.ok) {
    assert(contextResult.value.entry.id === entryId, 'Context has correct entry')
    assert(Array.isArray(contextResult.value.timeline), 'Context has timeline')
    assert(contextResult.value.timeline.length >= 1, 'Timeline has entries')
  }
}

console.log('')

// ============================================================================
// TEST 9: Get Statistics
// ============================================================================
console.log('TEST 9: Get Statistics\n')

const statsResult = query.getStats()
assert(statsResult.ok, 'getStats succeeds')
if (statsResult.ok) {
  assert(statsResult.value.totalEntries > 0, 'Has total count')
  assert(typeof statsResult.value.byDecisionType === 'object', 'Has decision type breakdown')
  assert(typeof statsResult.value.byRecordType === 'object', 'Has record type breakdown')
  assert(statsResult.value.dateRange.earliest !== null, 'Has earliest date')
  assert(statsResult.value.dateRange.latest !== null, 'Has latest date')
}

console.log('')

// ============================================================================
// TEST 10: Search
// ============================================================================
console.log('TEST 10: Search\n')

const searchResult = query.search('error')
assert(searchResult.ok, 'Search succeeds')
if (searchResult.ok) {
  assert(searchResult.value.length >= 1, 'Finds matching entries')
}

const searchResult2 = query.search('sixGates')
assert(searchResult2.ok, 'Search for file name succeeds')
if (searchResult2.ok) {
  assert(searchResult2.value.length >= 1, 'Finds file entries')
}

console.log('')

// ============================================================================
// TEST 11: Get File History
// ============================================================================
console.log('TEST 11: Get File History\n')

const historyResult = query.getFileHistory('src/core/result.ts')
assert(historyResult.ok, 'getFileHistory succeeds')
if (historyResult.ok) {
  assert(historyResult.value.length >= 2, 'Finds history entries')
  // Check chronological order
  if (historyResult.value.length >= 2) {
    assert(historyResult.value[0].timestamp <= historyResult.value[1].timestamp,
           'History is in chronological order')
  }
}

console.log('')

// ============================================================================
// TEST 12: Verify Integrity
// ============================================================================
console.log('TEST 12: Verify Integrity\n')

const integrityResult = query.verifyIntegrity()
assert(integrityResult.ok, 'Integrity verification passes')

console.log('')

// ============================================================================
// TEST 13: Format Evidence Entry
// ============================================================================
console.log('TEST 13: Format Evidence Entry\n')

if (allResult.ok && allResult.value.length > 1) {
  const entry = allResult.value[1]
  const formatted = formatEvidenceEntry(entry)
  assert(formatted.includes('EVIDENCE ENTRY'), 'Format includes header')
  assert(formatted.includes('Type:'), 'Format includes type')
  assert(formatted.includes('Timestamp:'), 'Format includes timestamp')
  assert(formatted.includes('Hash:'), 'Format includes hash')
}

console.log('')

// ============================================================================
// TEST 14: Format Decision Context
// ============================================================================
console.log('TEST 14: Format Decision Context\n')

if (allResult.ok && allResult.value.length > 1) {
  const entryId = allResult.value[1].id
  const contextResult = query.reconstructContext(entryId)
  if (contextResult.ok) {
    const formatted = formatDecisionContext(contextResult.value)
    assert(formatted.includes('DECISION CONTEXT'), 'Format includes header')
    assert(formatted.includes('PRIMARY DECISION'), 'Format includes primary section')
    assert(formatted.includes('TIMELINE'), 'Format includes timeline')
  }
}

console.log('')

// ============================================================================
// TEST 15: Query with Severity Filter
// ============================================================================
console.log('TEST 15: Query with Severity Filter\n')

const severityResult = query.query({ severity: 'critical' })
assert(severityResult.ok, 'Severity filter succeeds')
if (severityResult.ok) {
  assert(severityResult.value.length >= 1, 'Finds critical entries')
  assert(severityResult.value.every(e => e.data.severity === 'critical'),
         'All entries are critical severity')
}

console.log('')

// ============================================================================
// TEST 16: Query with Source Filter
// ============================================================================
console.log('TEST 16: Query with Source Filter\n')

const sourceResult = query.query({ source: 'llm' })
assert(sourceResult.ok, 'Source filter succeeds')
if (sourceResult.ok) {
  assert(sourceResult.value.length >= 2, 'Finds LLM entries')
  assert(sourceResult.value.every(e => e.data.source === 'llm'),
         'All entries are from LLM')
}

console.log('')

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
  console.log('EVIDENCE QUERY TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL EVIDENCE QUERY TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
