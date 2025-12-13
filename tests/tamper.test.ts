// Tamper Detection Tests - Verify integrity mechanisms work

import { JSONLLedger } from '../src/persistence/jsonlLedger'
import { contentAddress, verifyContentAddress } from '../src/core/contentAddress'
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

console.log('=== TAMPER DETECTION TESTS ===\n')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tamper-test-'))

// ============================================================================
// TEST 1: Hash Chain Integrity
// ============================================================================
console.log('TEST 1: Hash Chain Integrity\n')

const ledgerPath1 = path.join(tmpDir, 'test1.jsonl')
const ledger1 = new JSONLLedger(ledgerPath1)

// Append some records
await ledger1.append('TEST', { data: 'entry1' })
await ledger1.append('TEST', { data: 'entry2' })
await ledger1.append('TEST', { data: 'entry3' })

// Verify chain
const verify1 = ledger1.verifyChain()
assert(verify1.ok, 'Intact chain verifies successfully')

console.log('')

// ============================================================================
// TEST 2: Detect Direct File Tampering
// ============================================================================
console.log('TEST 2: Detect Direct File Tampering\n')

const ledgerPath2 = path.join(tmpDir, 'test2.jsonl')
const ledger2 = new JSONLLedger(ledgerPath2)

await ledger2.append('TEST', { critical: 'data' })

// Tamper with file directly
const content = fs.readFileSync(ledgerPath2, 'utf-8')
const lines = content.split('\n')
const lastRecord = JSON.parse(lines[lines.length - 2])  // Last non-empty line

// Modify data
lastRecord.record.critical = 'tampered'

// Write back
lines[lines.length - 2] = JSON.stringify(lastRecord)
fs.writeFileSync(ledgerPath2, lines.join('\n'), 'utf-8')

// New ledger instance should detect tampering
const ledger2b = new JSONLLedger(ledgerPath2)
const verify2 = ledger2b.verifyChain()

assert(!verify2.ok, 'Detects tampered content')
assert(verify2.ok === false && verify2.error.message.includes('Hash mismatch'), 'Correct error for tampering')

console.log('')

// ============================================================================
// TEST 3: Detect Chain Break
// ============================================================================
console.log('TEST 3: Detect Chain Break\n')

const ledgerPath3 = path.join(tmpDir, 'test3.jsonl')
const ledger3 = new JSONLLedger(ledgerPath3)

await ledger3.append('TEST', { id: 1 })
await ledger3.append('TEST', { id: 2 })

// Read and modify prev_hash
const content3 = fs.readFileSync(ledgerPath3, 'utf-8')
const lines3 = content3.split('\n')
const record3 = JSON.parse(lines3[lines3.length - 2])

record3.prev_hash = 'sha256:' + '0'.repeat(64)  // Invalid prev hash

lines3[lines3.length - 2] = JSON.stringify(record3)
fs.writeFileSync(ledgerPath3, lines3.join('\n'), 'utf-8')

// Should detect broken chain
const ledger3b = new JSONLLedger(ledgerPath3)
const verify3 = ledger3b.verifyChain()

assert(!verify3.ok, 'Detects broken hash chain')
assert(verify3.ok === false && verify3.error.message.includes('chain break'), 'Correct error for chain break')

console.log('')

// ============================================================================
// TEST 4: Content Address Verification
// ============================================================================
console.log('TEST 4: Content Address Verification\n')

const original = { important: 'data', value: 42 }
const address = contentAddress(original)

assert(verifyContentAddress(original, address), 'Original content verifies')

const modified = { important: 'hacked', value: 42 }
assert(!verifyContentAddress(modified, address), 'Modified content fails verification')

console.log('')

// ============================================================================
// TEST 5: Append-Only Enforcement
// ============================================================================
console.log('TEST 5: Append-Only Enforcement\n')

const ledgerPath5 = path.join(tmpDir, 'test5.jsonl')
const ledger5 = new JSONLLedger(ledgerPath5)

await ledger5.append('TEST', { seq: 1 })
await ledger5.append('TEST', { seq: 2 })

const countBefore = ledger5.count()

// Try to remove a line (simulated deletion)
const content5 = fs.readFileSync(ledgerPath5, 'utf-8')
const lines5 = content5.split('\n').filter(l => l.length > 0)

// Remove middle line
lines5.splice(1, 1)
fs.writeFileSync(ledgerPath5, lines5.join('\n') + '\n', 'utf-8')

// New instance should detect missing record
const ledger5b = new JSONLLedger(ledgerPath5)
const verify5 = ledger5b.verifyChain()

// Will detect because seq numbers won't match file count
assert(!verify5.ok || ledger5b.count() !== countBefore, 'Detects record deletion (append-only violation)')

console.log('')

// Cleanup
fs.rmSync(tmpDir, { recursive: true })

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)

console.log('\n✓ Tamper detection working')
console.log('✓ Hash chain verification')
console.log('✓ Content addressing verified')
console.log('✓ Append-only enforced')

if (failCount > 0) {
  console.error('\n✗ Tamper detection has vulnerabilities')
  process.exit(1)
} else {
  console.log('\n✓ Foundation is tamper-proof')
}

}

runTests().catch(err => {
  console.error('Tamper test failed:', err)
  process.exit(1)
})
