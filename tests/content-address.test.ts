// Content Addressing Tests - Deterministic hashing, verification

import { contentAddress, canonicalJSON, verifyContentAddress, isValidContentAddress } from '../src/core/contentAddress'

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

console.log('=== CONTENT ADDRESSING TESTS ===\n')

// ============================================================================
// TEST 1: Deterministic Hashing
// ============================================================================
console.log('TEST 1: Deterministic Hashing\n')

const obj1 = { a: 1, b: 2, c: 3 }
const hash1a = contentAddress(obj1)
const hash1b = contentAddress(obj1)

assert(hash1a === hash1b, 'Same object produces same hash')
assert(hash1a.startsWith('sha256:'), 'Hash has correct prefix')
assert(hash1a.length === 71, 'Hash is correct length (sha256: + 64 hex chars)')

console.log('')

// ============================================================================
// TEST 2: Canonical JSON (Key Ordering)
// ============================================================================
console.log('TEST 2: Canonical JSON\n')

const obj2a = { z: 1, a: 2, m: 3 }
const obj2b = { a: 2, m: 3, z: 1 }  // Different key order

const hash2a = contentAddress(obj2a)
const hash2b = contentAddress(obj2b)

assert(hash2a === hash2b, 'Key order does not affect hash (canonical ordering)')

const canonical = canonicalJSON(obj2a)
assert(canonical.includes('"a":2') && canonical.indexOf('"a"') < canonical.indexOf('"z"'), 'Keys sorted alphabetically')

console.log('')

// ============================================================================
// TEST 3: Content Verification
// ============================================================================
console.log('TEST 3: Content Verification\n')

const obj3 = { data: 'test', num: 42 }
const addr3 = contentAddress(obj3)

assert(verifyContentAddress(obj3, addr3), 'Content matches its address')

const modified = { data: 'modified', num: 42 }
assert(!verifyContentAddress(modified, addr3), 'Modified content fails verification')

console.log('')

// ============================================================================
// TEST 4: Address Format Validation
// ============================================================================
console.log('TEST 4: Address Format Validation\n')

assert(isValidContentAddress('sha256:' + 'a'.repeat(64)), 'Valid address accepted')
assert(!isValidContentAddress('sha256:toolong' + 'a'.repeat(64)), 'Too long address rejected')
assert(!isValidContentAddress('sha256:' + 'a'.repeat(63)), 'Too short address rejected')
assert(!isValidContentAddress('sha256:' + 'g'.repeat(64)), 'Non-hex address rejected')
assert(!isValidContentAddress('md5:' + 'a'.repeat(32)), 'Wrong algorithm rejected')

console.log('')

// ============================================================================
// TEST 5: Immutability Proof
// ============================================================================
console.log('TEST 5: Immutability Proof\n')

const record = { id: contentAddress({ type: 'test', value: 1 }), data: { value: 1 } }

// Extract hash from ID
const originalHash = record.id

// Modify data
const mutated = { ...record, data: { value: 2 } }

// ID should not match content anymore
const newAddr = contentAddress({ type: 'test', value: 2 })

assert(newAddr !== originalHash, 'Mutation changes content address (tamper detection)')
assert(!verifyContentAddress({ type: 'test', value: 2 }, originalHash), 'Modified content fails original address check')

console.log('')

// ============================================================================
// TEST 6: Canonical JSON Edge Cases
// ============================================================================
console.log('TEST 6: Canonical JSON Edge Cases\n')

assert(canonicalJSON(null) === 'null', 'Null handled')
assert(canonicalJSON(true) === 'true', 'Boolean handled')
assert(canonicalJSON(42) === '42', 'Number handled')
assert(canonicalJSON('test') === '"test"', 'String handled')
assert(canonicalJSON([1, 2, 3]) === '[1,2,3]', 'Array handled')
assert(canonicalJSON({}) === '{}', 'Empty object handled')

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)

console.log('\n✓ Content addressing deterministic')
console.log('✓ Canonical JSON working')
console.log('✓ Verification robust')
console.log('✓ Tamper detection functional')

if (failCount > 0) {
  process.exit(1)
}

}

runTests().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
