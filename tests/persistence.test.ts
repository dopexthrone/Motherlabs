// Persistent Ledger Tests - Append-only, atomic, verifiable

import { FileLedger } from '../src/persistence/fileLedger'
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

console.log('=== PERSISTENT LEDGER TESTS ===\n')

// Create temp directory for tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motherlabs-ledger-test-'))

// ============================================================================
// TEST 1: Basic Append
// ============================================================================
console.log('TEST 1: Basic Append\n')

const ledger1 = new FileLedger(tmpDir)

const result1 = await ledger1.append({
  id: 'test-1',
  timestamp: 1000,
  type: 'task_created',
  data: { input: 'test task' }
})

assert(result1.ok, 'Append succeeds')
assert(result1.ok && result1.value.hash.length === 64, 'Hash is SHA-256 (64 hex chars)')
assert(ledger1.count() === 1, 'Count is 1 after first append')

// Verify file was created
const files1 = fs.readdirSync(tmpDir).filter(f => f.endsWith('.json'))
assert(files1.length === 1, 'Exactly one file created')

console.log('')

// ============================================================================
// TEST 2: Hash Chain
// ============================================================================
console.log('TEST 2: Hash Chain\n')

const ledger2 = new FileLedger(tmpDir)

const entry2 = await ledger2.append({
  id: 'test-2',
  timestamp: 2000,
  type: 'task_created',
  data: { input: 'second task' }
})

assert(entry2.ok, 'Second append succeeds')
assert(
  entry2.ok && entry2.value.previousHash === result1.value!.hash,
  'Hash chain links correctly'
)

console.log('')

// ============================================================================
// TEST 3: Integrity Verification
// ============================================================================
console.log('TEST 3: Integrity Verification\n')

const ledger3 = new FileLedger(tmpDir)
const integrity = ledger3.verifyIntegrity()

assert(integrity.ok, 'Hash chain integrity verified')

console.log('')

// ============================================================================
// TEST 4: Atomic Write (Crash Simulation)
// ============================================================================
console.log('TEST 4: Atomic Write (Crash Simulation)\n')

const tmpDir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'motherlabs-crash-'))
const ledger4 = new FileLedger(tmpDir4)

// Append successfully
await ledger4.append({
  id: 'pre-crash',
  timestamp: 3000,
  type: 'task_created',
  data: {}
})

// Simulate crash by creating .tmp file that never got renamed
const crashTmp = path.join(tmpDir4, '00000001-crash.json.tmp')
fs.writeFileSync(crashTmp, 'incomplete data')

// Ledger should ignore .tmp files
const ledger4b = new FileLedger(tmpDir4)
assert(ledger4b.count() === 1, 'Incomplete writes ignored (only committed entries count)')

// Cleanup
fs.rmSync(tmpDir4, { recursive: true })

console.log('')

// ============================================================================
// TEST 5: Corruption Detection
// ============================================================================
console.log('TEST 5: Corruption Detection\n')

const tmpDir5 = fs.mkdtempSync(path.join(os.tmpdir(), 'motherlabs-corrupt-'))
const ledger5 = new FileLedger(tmpDir5)

await ledger5.append({
  id: 'entry-1',
  timestamp: 5000,
  type: 'task_created',
  data: { x: 1 }
})

await ledger5.append({
  id: 'entry-2',
  timestamp: 6000,
  type: 'task_created',
  data: { x: 2 }
})

// Corrupt the first entry
const files5 = fs.readdirSync(tmpDir5).filter(f => f.endsWith('.json')).sort()
const corruptPath = path.join(tmpDir5, files5[0])
const original = JSON.parse(fs.readFileSync(corruptPath, 'utf-8'))
original.data = { corrupted: true }
fs.writeFileSync(corruptPath, JSON.stringify(original))

// Verify should detect corruption
const ledger5b = new FileLedger(tmpDir5)
const integrity5 = ledger5b.verifyIntegrity()

assert(!integrity5.ok, 'Corruption detected')
assert(
  integrity5.ok === false && integrity5.error.message.includes('Hash mismatch'),
  'Correct error message for corruption'
)

// Cleanup
fs.rmSync(tmpDir5, { recursive: true })

console.log('')

// ============================================================================
// TEST 6: Query Functionality
// ============================================================================
console.log('TEST 6: Query Functionality\n')

const tmpDir6 = fs.mkdtempSync(path.join(os.tmpdir(), 'motherlabs-query-'))
const ledger6 = new FileLedger(tmpDir6)

await ledger6.append({ id: 'task-1', timestamp: 7000, type: 'task_created', data: {} })
await ledger6.append({ id: 'task-2', timestamp: 8000, type: 'llm_decompose', data: {} })
await ledger6.append({ id: 'task-3', timestamp: 9000, type: 'task_created', data: {} })

const taskCreated = ledger6.query('task_created')
assert(taskCreated.length === 2, 'Query by type returns correct count')

const all = ledger6.query()
assert(all.length === 3, 'Query without type returns all entries')

// Cleanup
fs.rmSync(tmpDir6, { recursive: true })

console.log('')

// ============================================================================
// TEST 7: Persistence Across Instances
// ============================================================================
console.log('TEST 7: Persistence Across Instances\n')

const tmpDir7 = fs.mkdtempSync(path.join(os.tmpdir(), 'motherlabs-persist-'))
const ledger7a = new FileLedger(tmpDir7)

await ledger7a.append({ id: 'persist-1', timestamp: 10000, type: 'task_created', data: { test: 'data' } })

// Create new ledger instance pointing to same directory
const ledger7b = new FileLedger(tmpDir7)

assert(ledger7b.count() === 1, 'New instance sees existing entries')

const entries7 = ledger7b.query()
assert(entries7[0].id === 'persist-1', 'Data persisted correctly')
assert(JSON.stringify(entries7[0].data) === JSON.stringify({ test: 'data' }), 'Data content preserved')

// Cleanup
fs.rmSync(tmpDir7, { recursive: true })

console.log('')

// Cleanup main test dir
fs.rmSync(tmpDir, { recursive: true })

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)

console.log('\n✓ Persistent ledger verified')
console.log('✓ Atomic writes working')
console.log('✓ Hash chain integrity')
console.log('✓ Corruption detection')

if (failCount > 0) {
  process.exit(1)
}
}
runTests().catch(err => { console.error(err); process.exit(1) })
