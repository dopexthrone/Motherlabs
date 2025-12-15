// Schema Registry Tests - Deny-by-default schema enforcement
//
// ACCEPTANCE TESTS:
// (a) Unknown schema → refusal + no ledger write
// (b) Known schema → allowed path succeeds
// (c) Registry determinism test

import * as fs from 'fs'
import { SchemaRegistry, getSchemaRegistry, validateSchemaForAdmission } from '../src/schema/registry'
import { JSONLLedger } from '../src/persistence/jsonlLedger'

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
  console.log('=== SCHEMA REGISTRY TESTS ===\n')
  console.log('Testing deny-by-default schema enforcement\n')

  // ============================================================================
  // TEST 1: Unknown schema → refusal + no ledger write
  // ACCEPTANCE TEST (a)
  // ============================================================================
  console.log('TEST 1: Unknown schema → refusal + no ledger write\n')

  const testLedgerPath1 = '/tmp/schema-test-1-' + Date.now() + '.jsonl'
  const ledger1 = new JSONLLedger(testLedgerPath1)

  // Get initial count (should be 1 for GENESIS)
  const initialCount = ledger1.count()

  // Try to append with unknown schema
  const unknownResult = await ledger1.append('UNKNOWN_SCHEMA_TYPE', {
    some: 'data',
    more: 'fields'
  })

  assert(!unknownResult.ok, 'Unknown schema is rejected')
  if (!unknownResult.ok) {
    assert(
      unknownResult.error.message.includes('SCHEMA DENIED') ||
      unknownResult.error.message.includes('LEDGER ADMISSION DENIED'),
      'Error message indicates schema denial'
    )
  }

  // Verify no ledger write occurred
  const afterCount = ledger1.count()
  assert(afterCount === initialCount, 'Ledger count unchanged after rejection (no write)')

  // Verify by reading ledger - should only have GENESIS
  const records1 = ledger1.readAll()
  assert(records1.ok, 'Can read ledger')
  if (records1.ok) {
    const hasUnknown = records1.value.some(r => r.record_type === 'UNKNOWN_SCHEMA_TYPE')
    assert(!hasUnknown, 'Unknown schema record NOT in ledger')
  }

  // Cleanup
  try { fs.unlinkSync(testLedgerPath1) } catch {}

  console.log('')

  // ============================================================================
  // TEST 2: Known schema → allowed path succeeds
  // ACCEPTANCE TEST (b)
  // ============================================================================
  console.log('TEST 2: Known schema → allowed path succeeds\n')

  const testLedgerPath2 = '/tmp/schema-test-2-' + Date.now() + '.jsonl'
  const ledger2 = new JSONLLedger(testLedgerPath2)

  const initialCount2 = ledger2.count()

  // Append with known schema (GATE_DECISION)
  const knownResult = await ledger2.append('GATE_DECISION', {
    gate_type: 'test_gate',
    decision: 'ALLOW',
    scope: { target_type: 'test', target_id: 'test-123' },
    authorizer: 'test_authorizer',
    issued_at_utc: new Date().toISOString(),
    reason: 'Test gate decision'
  })

  assert(knownResult.ok, 'Known schema is accepted')
  if (knownResult.ok) {
    assert(knownResult.value.record_type === 'GATE_DECISION', 'Record type correct')
    assert(knownResult.value.seq === initialCount2 + 1, 'Sequence incremented')
  }

  // Verify ledger write occurred
  const afterCount2 = ledger2.count()
  assert(afterCount2 === initialCount2 + 1, 'Ledger count incremented after acceptance')

  // Verify by reading ledger
  const records2 = ledger2.readAll()
  assert(records2.ok, 'Can read ledger')
  if (records2.ok) {
    const hasGateDecision = records2.value.some(r => r.record_type === 'GATE_DECISION')
    assert(hasGateDecision, 'GATE_DECISION record is in ledger')
  }

  // Cleanup
  try { fs.unlinkSync(testLedgerPath2) } catch {}

  console.log('')

  // ============================================================================
  // TEST 3: Registry determinism test
  // ACCEPTANCE TEST (c)
  // ============================================================================
  console.log('TEST 3: Registry determinism test\n')

  const registry1 = new SchemaRegistry()
  const registry2 = new SchemaRegistry()

  // Same schema lookup returns identical results
  const result1 = registry1.resolve('GATE_DECISION', '1.0.0')
  const result2 = registry2.resolve('GATE_DECISION', '1.0.0')

  assert(result1.ok && result2.ok, 'Both registries resolve known schema')
  if (result1.ok && result2.ok) {
    assert(result1.value.schema_id === result2.value.schema_id, 'Schema IDs match')
    assert(result1.value.version === result2.value.version, 'Versions match')
    assert(result1.value.description === result2.value.description, 'Descriptions match')
    assert(
      JSON.stringify(result1.value.required_fields) === JSON.stringify(result2.value.required_fields),
      'Required fields match'
    )
  }

  // Same unknown schema lookup returns identical error pattern
  const unknown1 = registry1.resolve('NONEXISTENT', '1.0.0')
  const unknown2 = registry2.resolve('NONEXISTENT', '1.0.0')

  assert(!unknown1.ok && !unknown2.ok, 'Both registries reject unknown schema')
  if (!unknown1.ok && !unknown2.ok) {
    assert(
      unknown1.error.message.includes('SCHEMA DENIED') &&
      unknown2.error.message.includes('SCHEMA DENIED'),
      'Both errors indicate schema denial'
    )
  }

  // Registry count is deterministic
  assert(registry1.count() === registry2.count(), 'Registry counts match')
  assert(registry1.count() > 0, 'Registry has schemas registered')

  console.log('')

  // ============================================================================
  // TEST 4: Schema validation rejects missing required fields
  // ============================================================================
  console.log('TEST 4: Schema validation rejects missing required fields\n')

  const registry = getSchemaRegistry()

  // GATE_DECISION requires: gate_type, decision, scope, authorizer, issued_at_utc, reason
  const incompleteResult = registry.validate('GATE_DECISION', {
    gate_type: 'test',
    decision: 'ALLOW'
    // Missing: scope, authorizer, issued_at_utc, reason
  })

  assert(!incompleteResult.ok, 'Incomplete record is rejected')
  if (!incompleteResult.ok) {
    assert(
      incompleteResult.error.message.includes('Missing required fields'),
      'Error mentions missing required fields'
    )
    assert(
      incompleteResult.error.message.includes('scope') ||
      incompleteResult.error.message.includes('authorizer'),
      'Error mentions specific missing field'
    )
  }

  console.log('')

  // ============================================================================
  // TEST 5: Ledger rejects record with missing required fields
  // ============================================================================
  console.log('TEST 5: Ledger rejects record with missing required fields\n')

  const testLedgerPath5 = '/tmp/schema-test-5-' + Date.now() + '.jsonl'
  const ledger5 = new JSONLLedger(testLedgerPath5)

  const initialCount5 = ledger5.count()

  // Try to append GATE_DECISION with missing fields
  const incompleteAppend = await ledger5.append('GATE_DECISION', {
    gate_type: 'test',
    decision: 'ALLOW'
    // Missing required fields
  })

  assert(!incompleteAppend.ok, 'Incomplete record rejected by ledger')
  if (!incompleteAppend.ok) {
    assert(
      incompleteAppend.error.message.includes('LEDGER ADMISSION DENIED'),
      'Error indicates admission denial'
    )
  }

  // Verify no write
  assert(ledger5.count() === initialCount5, 'No ledger write for invalid record')

  // Cleanup
  try { fs.unlinkSync(testLedgerPath5) } catch {}

  console.log('')

  // ============================================================================
  // TEST 6: All governance-critical schemas are registered
  // ============================================================================
  console.log('TEST 6: All governance-critical schemas are registered\n')

  const criticalSchemas = [
    'GENESIS',
    'GATE_DECISION',
    'EVIDENCE_ARTIFACT',
    'TCB_PROTECTION_EVENT',
    'LEDGER_FREEZE'
  ]

  for (const schemaId of criticalSchemas) {
    const result = registry.resolve(schemaId, '1.0.0')
    assert(result.ok, `Critical schema '${schemaId}' is registered`)
    if (result.ok) {
      assert(result.value.governance_critical, `Schema '${schemaId}' marked as governance_critical`)
    }
  }

  console.log('')

  // ============================================================================
  // TEST 7: validateSchemaForAdmission convenience function
  // ============================================================================
  console.log('TEST 7: validateSchemaForAdmission convenience function\n')

  // Valid admission
  const validAdmission = validateSchemaForAdmission('dogfood_event', {
    event: 'test_event',
    data: { some: 'data' }
  })
  assert(validAdmission.ok, 'Valid record passes admission check')
  if (validAdmission.ok) {
    assert(validAdmission.value.schema_id === 'dogfood_event', 'Returns schema definition')
  }

  // Invalid admission - unknown schema
  const unknownAdmission = validateSchemaForAdmission('TOTALLY_UNKNOWN', { data: 'test' })
  assert(!unknownAdmission.ok, 'Unknown schema fails admission check')

  // Invalid admission - missing fields
  const missingFieldsAdmission = validateSchemaForAdmission('cycle_failure', {
    // Missing: type, message
  })
  assert(!missingFieldsAdmission.ok, 'Missing fields fails admission check')

  console.log('')

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('==========================================')
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed`)
  console.log('==========================================\n')

  if (failCount > 0) {
    console.log('ACCEPTANCE CRITERIA:')
    console.log('(a) Unknown schema → refusal + no ledger write - TESTED')
    console.log('(b) Known schema → allowed path succeeds - TESTED')
    console.log('(c) Registry determinism test - TESTED')
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Test runner failed:', err)
  process.exit(1)
})
