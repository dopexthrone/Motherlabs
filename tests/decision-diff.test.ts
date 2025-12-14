// Decision Diff Tests - Verifies decision simulation and comparison
// Tests Step 7 of ROADMAP_NEXT_10.md: Add Decision Diff/Simulation

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomBytes } from 'crypto'
import {
  simulateAlternative,
  analyzeWhatIf,
  compareDecisions,
  getDivergenceTimeline,
  formatSimulationResult,
  formatWhatIfAnalysis
} from '../src/analysis/decisionDiff'
import { EvidenceQuery, EvidenceEntry, DecisionContext } from '../src/persistence/evidenceQuery'
import { JSONLLedger } from '../src/persistence/jsonlLedger'

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

function createMockEntry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: 'test-entry-001',
    timestamp: Date.now(),
    type: 'PROPOSAL',
    hash: 'abc123',
    data: {
      proposalId: 'prop-001',
      targetFile: 'src/example/file.ts',
      decisionType: 'irreversible',
      issueType: 'NO_ERROR_HANDLING',
      severity: 'high',
      source: 'llm',
      rationale: 'Test rationale',
      enables: ['Better error handling', 'Safer code'],
      forbids: ['Old API compatibility'],
      assumptions: ['Error handling is needed'],
      ...overrides.data
    },
    ...overrides
  }
}

async function runTests() {

console.log('=== DECISION DIFF TESTS ===\n')

// ============================================================================
// TEST 1: Simulate Alternative - Basic
// ============================================================================
console.log('TEST 1: Simulate Alternative - Basic\n')

const entry = createMockEntry()
const simResult = simulateAlternative(entry, 'Defer the decision')

assert(simResult.ok, 'simulateAlternative succeeds')
if (simResult.ok) {
  assert(simResult.value.originalDecision.id === entry.id, 'Original decision preserved')
  assert(simResult.value.simulatedAlternative.description === 'Defer the decision',
         'Alternative description set')
  assert(simResult.value.diff !== undefined, 'Diff computed')
  assert(simResult.value.impact !== undefined, 'Impact assessed')
}

console.log('')

// ============================================================================
// TEST 2: Consequence Diff Computation
// ============================================================================
console.log('TEST 2: Consequence Diff Computation\n')

if (simResult.ok) {
  const diff = simResult.value.diff
  assert(Array.isArray(diff.uniqueEnables), 'Has unique enables')
  assert(Array.isArray(diff.alternativeEnables), 'Has alternative enables')
  assert(Array.isArray(diff.uniqueForbids), 'Has unique forbids')
  assert(Array.isArray(diff.alternativeForbids), 'Has alternative forbids')
  assert(typeof diff.assumptionDiff === 'object', 'Has assumption diff')
}

console.log('')

// ============================================================================
// TEST 3: Impact Assessment
// ============================================================================
console.log('TEST 3: Impact Assessment\n')

if (simResult.ok) {
  const impact = simResult.value.impact
  assert(['high', 'medium', 'low'].includes(impact.severity), 'Valid severity')
  assert(typeof impact.reversible === 'boolean', 'Has reversibility flag')
  assert(typeof impact.summary === 'string', 'Has summary')
  assert(impact.summary.length > 0, 'Summary is not empty')
}

console.log('')

// ============================================================================
// TEST 4: Divergence Point
// ============================================================================
console.log('TEST 4: Divergence Point\n')

if (simResult.ok) {
  const dp = simResult.value.divergencePoint
  assert(typeof dp.timestamp === 'number', 'Has timestamp')
  assert(dp.decisionId === entry.id, 'Correct decision ID')
  assert(typeof dp.description === 'string', 'Has description')
}

console.log('')

// ============================================================================
// TEST 5: Compare Two Decisions
// ============================================================================
console.log('TEST 5: Compare Two Decisions\n')

const entry1 = createMockEntry({
  id: 'entry-1',
  data: {
    enables: ['Feature A', 'Feature B'],
    forbids: ['Legacy support'],
    assumptions: ['Modern browsers only']
  }
})

const entry2 = createMockEntry({
  id: 'entry-2',
  data: {
    enables: ['Feature A', 'Feature C'],
    forbids: ['Performance optimization'],
    assumptions: ['Modern browsers only', 'Fast network']
  }
})

const compareResult = compareDecisions(entry1, entry2)
assert(compareResult.ok, 'compareDecisions succeeds')
if (compareResult.ok) {
  const diff = compareResult.value
  assert(diff.uniqueEnables.includes('Feature B'), 'Finds unique enable from first')
  assert(diff.alternativeEnables.includes('Feature C'), 'Finds unique enable from second')
  assert(diff.sharedEnables.includes('Feature A'), 'Finds shared enable')
}

console.log('')

// ============================================================================
// TEST 6: Simulate Defer Alternative
// ============================================================================
console.log('TEST 6: Simulate Defer Alternative\n')

const deferResult = simulateAlternative(entry, 'Defer action')
assert(deferResult.ok, 'Defer simulation succeeds')
if (deferResult.ok) {
  const altEnables = deferResult.value.alternativeState.enables
  assert(altEnables.some(e => e.includes('time') || e.includes('Flexibility')),
         'Defer enables time/flexibility')
}

console.log('')

// ============================================================================
// TEST 7: Simulate Simple Alternative
// ============================================================================
console.log('TEST 7: Simulate Simple Alternative\n')

const simpleResult = simulateAlternative(entry, 'Use simple approach')
assert(simpleResult.ok, 'Simple simulation succeeds')
if (simpleResult.ok) {
  const altEnables = simpleResult.value.alternativeState.enables
  assert(altEnables.some(e => e.includes('Faster') || e.includes('Lower risk')),
         'Simple enables faster/lower risk')
}

console.log('')

// ============================================================================
// TEST 8: Simulate Refactor Alternative
// ============================================================================
console.log('TEST 8: Simulate Refactor Alternative\n')

const refactorResult = simulateAlternative(entry, 'Full refactor')
assert(refactorResult.ok, 'Refactor simulation succeeds')
if (refactorResult.ok) {
  const altEnables = refactorResult.value.alternativeState.enables
  assert(altEnables.some(e => e.includes('structure') || e.includes('maintainability')),
         'Refactor enables better structure')
}

console.log('')

// ============================================================================
// TEST 9: Format Simulation Result
// ============================================================================
console.log('TEST 9: Format Simulation Result\n')

if (simResult.ok) {
  const formatted = formatSimulationResult(simResult.value)
  assert(formatted.includes('DECISION SIMULATION'), 'Format has header')
  assert(formatted.includes('DIVERGENCE POINT'), 'Format has divergence section')
  assert(formatted.includes('SIMULATED ALTERNATIVE'), 'Format has alternative section')
  assert(formatted.includes('CONSEQUENCE COMPARISON'), 'Format has comparison section')
  assert(formatted.includes('IMPACT ASSESSMENT'), 'Format has impact section')
}

console.log('')

// ============================================================================
// TEST 10: Analyze What-If
// ============================================================================
console.log('TEST 10: Analyze What-If\n')

const mockContext: DecisionContext = {
  entry: entry,
  relatedEntries: [],
  consequenceSurface: {
    enables: ['Better error handling'],
    forbids: ['Old API'],
    assumptions: ['Errors need handling'],
    validationCriteria: []
  },
  alternatives: [
    { description: 'Defer error handling', rejectionReason: 'Too risky' },
    { description: 'Simple try-catch', rejectionReason: 'Not thorough enough' }
  ],
  timeline: []
}

const whatIfResult = analyzeWhatIf(mockContext, 0)
assert(whatIfResult.ok, 'analyzeWhatIf succeeds')
if (whatIfResult.ok) {
  assert(whatIfResult.value.question.includes('Defer error handling'),
         'Question includes alternative')
  assert(whatIfResult.value.originalPath !== undefined, 'Has original path')
  assert(whatIfResult.value.alternativePath !== undefined, 'Has alternative path')
  assert(typeof whatIfResult.value.recommendation === 'string', 'Has recommendation')
}

console.log('')

// ============================================================================
// TEST 11: Format What-If Analysis
// ============================================================================
console.log('TEST 11: Format What-If Analysis\n')

if (whatIfResult.ok) {
  const formatted = formatWhatIfAnalysis(whatIfResult.value)
  assert(formatted.includes('WHAT-IF ANALYSIS'), 'Format has header')
  assert(formatted.includes('Question:'), 'Format has question')
  assert(formatted.includes('ORIGINAL PATH'), 'Format has original path')
  assert(formatted.includes('ALTERNATIVE PATH'), 'Format has alternative path')
  assert(formatted.includes('RECOMMENDATION'), 'Format has recommendation')
}

console.log('')

// ============================================================================
// TEST 12: Get Divergence Timeline
// ============================================================================
console.log('TEST 12: Get Divergence Timeline\n')

// Setup: Create test ledger with multiple entries for same file
const testId = randomBytes(4).toString('hex')
const tempDir = path.join(os.tmpdir(), `diff-test-${testId}`)
fs.mkdirSync(tempDir, { recursive: true })
const ledgerPath = path.join(tempDir, 'test-ledger.jsonl')

const testLedger = new JSONLLedger(ledgerPath)
await testLedger.append('PROPOSAL', {
  proposalId: 'p1',
  targetFile: 'src/core/result.ts',
  decisionType: 'reversible'
})
await testLedger.append('APPLIED', {
  proposalId: 'p1',
  targetFile: 'src/core/result.ts',
  decisionType: 'irreversible',
  alternativesConsidered: 3
})

const query = new EvidenceQuery(ledgerPath)
const timelineResult = getDivergenceTimeline(query, 'src/core/result.ts')

assert(timelineResult.ok, 'getDivergenceTimeline succeeds')
if (timelineResult.ok) {
  assert(timelineResult.value.length >= 2, 'Has timeline entries')
  assert(timelineResult.value.some(t => t.alternatives.length > 0),
         'Some entries have alternatives noted')
}

// Cleanup
fs.rmSync(tempDir, { recursive: true, force: true })

console.log('')

// ============================================================================
// TEST 13: Reversible vs Irreversible Impact
// ============================================================================
console.log('TEST 13: Reversible vs Irreversible Impact\n')

const reversibleEntry = createMockEntry({
  data: { decisionType: 'reversible' }
})
const revResult = simulateAlternative(reversibleEntry, 'Alternative')
assert(revResult.ok, 'Reversible simulation succeeds')
if (revResult.ok) {
  assert(revResult.value.impact.reversible === true, 'Reversible flag is true')
}

const irreversibleEntry = createMockEntry({
  data: { decisionType: 'irreversible' }
})
const irrevResult = simulateAlternative(irreversibleEntry, 'Alternative')
assert(irrevResult.ok, 'Irreversible simulation succeeds')
if (irrevResult.ok) {
  assert(irrevResult.value.impact.reversible === false, 'Reversible flag is false')
}

console.log('')

// ============================================================================
// TEST 14: Empty Consequence Surfaces
// ============================================================================
console.log('TEST 14: Empty Consequence Surfaces\n')

const emptyEntry = createMockEntry({
  data: {
    enables: [],
    forbids: [],
    assumptions: []
  }
})
const emptyResult = simulateAlternative(emptyEntry, 'Alternative')
assert(emptyResult.ok, 'Empty consequence simulation succeeds')
if (emptyResult.ok) {
  assert(emptyResult.value.diff !== undefined, 'Diff still computed')
  assert(emptyResult.value.alternativeState.enables.length > 0,
         'Alternative generates some enables')
}

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('DECISION DIFF TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL DECISION DIFF TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
