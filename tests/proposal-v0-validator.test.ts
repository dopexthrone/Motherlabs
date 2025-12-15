// Proposal Schema v0 Validator Tests - Golden Vectors
//
// ACCEPTANCE TESTS:
// (1) Valid minimal proposal passes
// (2) Missing required field fails
// (3) Unknown top-level field fails
// (4) Invalid enum for requested_action fails
// (5) Empty targets fails
// (6) Error ordering is deterministic

import {
  validateProposalV0,
  ERROR_CODES,
  type ProposalV0,
  type ValidationError,
} from '../src/validation/proposalV0Validator'

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

function assertErrorCodes(errors: ValidationError[], expectedCodes: string[], message: string) {
  const actualCodes = errors.map(e => e.code)
  const match = JSON.stringify(actualCodes) === JSON.stringify(expectedCodes)
  if (!match) {
    console.error(`✗ FAIL: ${message}`)
    console.error(`  Expected: ${JSON.stringify(expectedCodes)}`)
    console.error(`  Actual:   ${JSON.stringify(actualCodes)}`)
    failCount++
  } else {
    console.log(`✓ PASS: ${message}`)
    passCount++
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GOLDEN VECTORS
// ═══════════════════════════════════════════════════════════════════════════

const VALID_MINIMAL_PROPOSAL = {
  version: 'v0',
  proposal_id: 'prop_2025-12-15_000001',
  intent: 'Add input validation to user registration endpoint',
  requested_action: 'update',
  targets: [
    {
      kind: 'file',
      identifier: 'src/api/register.ts'
    }
  ],
  constraints: {},
  evidence_plan: {},
  provenance: {
    source: 'cli',
    timestamp_utc: '2025-12-15T12:00:00Z'
  }
}

const VALID_PROPOSAL_WITH_METADATA = {
  ...VALID_MINIMAL_PROPOSAL,
  metadata: { author: 'test', priority: 'high' }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

function runTests() {
  console.log('=== PROPOSAL V0 VALIDATOR TESTS ===\n')
  console.log('Golden vector tests for pure validator\n')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 1: Valid minimal proposal passes
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 1: Valid minimal proposal passes\n')

  const result1 = validateProposalV0(VALID_MINIMAL_PROPOSAL)
  assert(result1.ok === true, 'Valid minimal proposal returns ok=true')

  if (result1.ok) {
    assert(result1.value.version === 'v0', 'Validated proposal has version=v0')
    assert(result1.value.proposal_id === 'prop_2025-12-15_000001', 'proposal_id preserved')
    assert(result1.value.requested_action === 'update', 'requested_action preserved')
    assert(result1.value.targets.length === 1, 'targets array preserved')
    assert(result1.value.targets[0].kind === 'file', 'target kind preserved')
    assert(result1.value.provenance.source === 'cli', 'provenance.source preserved')
  }

  // Test with metadata
  const result1b = validateProposalV0(VALID_PROPOSAL_WITH_METADATA)
  assert(result1b.ok === true, 'Valid proposal with metadata returns ok=true')
  if (result1b.ok) {
    assert(result1b.value.metadata !== undefined, 'metadata field preserved when present')
  }

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 2: Missing required fields fail
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 2: Missing required fields fail\n')

  // Missing version
  const missingVersion = { ...VALID_MINIMAL_PROPOSAL }
  delete (missingVersion as Record<string, unknown>).version
  const r2a = validateProposalV0(missingVersion)
  assert(r2a.ok === false, 'Missing version fails')
  if (!r2a.ok) {
    assert(r2a.error.some(e => e.code === ERROR_CODES.MISSING_REQUIRED_FIELD && e.field === 'version'),
      'Error identifies missing version')
  }

  // Missing proposal_id
  const missingId = { ...VALID_MINIMAL_PROPOSAL }
  delete (missingId as Record<string, unknown>).proposal_id
  const r2b = validateProposalV0(missingId)
  assert(r2b.ok === false, 'Missing proposal_id fails')

  // Missing intent
  const missingIntent = { ...VALID_MINIMAL_PROPOSAL }
  delete (missingIntent as Record<string, unknown>).intent
  const r2c = validateProposalV0(missingIntent)
  assert(r2c.ok === false, 'Missing intent fails')

  // Missing provenance
  const missingProvenance = { ...VALID_MINIMAL_PROPOSAL }
  delete (missingProvenance as Record<string, unknown>).provenance
  const r2d = validateProposalV0(missingProvenance)
  assert(r2d.ok === false, 'Missing provenance fails')

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 3: Unknown top-level field fails
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 3: Unknown top-level field fails\n')

  const withUnknownField = {
    ...VALID_MINIMAL_PROPOSAL,
    unknown_field: 'should cause rejection',
    another_unknown: 123
  }
  const r3 = validateProposalV0(withUnknownField)
  assert(r3.ok === false, 'Unknown top-level field causes rejection')
  if (!r3.ok) {
    assert(r3.error.some(e => e.code === ERROR_CODES.UNKNOWN_FIELD),
      'Error code is UNKNOWN_FIELD')
    assert(r3.error.filter(e => e.code === ERROR_CODES.UNKNOWN_FIELD).length === 2,
      'Both unknown fields reported')
  }

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 4: Invalid enum for requested_action fails
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 4: Invalid enum for requested_action fails\n')

  const invalidAction = {
    ...VALID_MINIMAL_PROPOSAL,
    requested_action: 'modify' // Not in allowed set
  }
  const r4 = validateProposalV0(invalidAction)
  assert(r4.ok === false, 'Invalid requested_action fails')
  if (!r4.ok) {
    assert(r4.error.some(e => e.code === ERROR_CODES.INVALID_REQUESTED_ACTION),
      'Error code is INVALID_REQUESTED_ACTION')
  }

  // Also test invalid target kind
  const invalidTargetKind = {
    ...VALID_MINIMAL_PROPOSAL,
    targets: [{ kind: 'invalid_kind', identifier: 'test' }]
  }
  const r4b = validateProposalV0(invalidTargetKind)
  assert(r4b.ok === false, 'Invalid target kind fails')
  if (!r4b.ok) {
    assert(r4b.error.some(e => e.code === ERROR_CODES.INVALID_TARGET_KIND),
      'Error code is INVALID_TARGET_KIND')
  }

  // Test invalid provenance source
  const invalidSource = {
    ...VALID_MINIMAL_PROPOSAL,
    provenance: { source: 'invalid_source', timestamp_utc: '2025-12-15T12:00:00Z' }
  }
  const r4c = validateProposalV0(invalidSource)
  assert(r4c.ok === false, 'Invalid provenance source fails')
  if (!r4c.ok) {
    assert(r4c.error.some(e => e.code === ERROR_CODES.INVALID_PROVENANCE_SOURCE),
      'Error code is INVALID_PROVENANCE_SOURCE')
  }

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 5: Empty targets fails
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 5: Empty targets fails\n')

  const emptyTargets = {
    ...VALID_MINIMAL_PROPOSAL,
    targets: []
  }
  const r5 = validateProposalV0(emptyTargets)
  assert(r5.ok === false, 'Empty targets array fails')
  if (!r5.ok) {
    assert(r5.error.some(e => e.code === ERROR_CODES.TARGETS_EMPTY),
      'Error code is TARGETS_EMPTY')
  }

  // Test empty intent
  const emptyIntent = {
    ...VALID_MINIMAL_PROPOSAL,
    intent: '   ' // whitespace only
  }
  const r5b = validateProposalV0(emptyIntent)
  assert(r5b.ok === false, 'Whitespace-only intent fails')
  if (!r5b.ok) {
    assert(r5b.error.some(e => e.code === ERROR_CODES.EMPTY_INTENT),
      'Error code is EMPTY_INTENT')
  }

  // Test empty target identifier
  const emptyTargetId = {
    ...VALID_MINIMAL_PROPOSAL,
    targets: [{ kind: 'file', identifier: '' }]
  }
  const r5c = validateProposalV0(emptyTargetId)
  assert(r5c.ok === false, 'Empty target identifier fails')
  if (!r5c.ok) {
    assert(r5c.error.some(e => e.code === ERROR_CODES.EMPTY_TARGET_IDENTIFIER),
      'Error code is EMPTY_TARGET_IDENTIFIER')
  }

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 6: Error ordering is deterministic
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 6: Error ordering is deterministic\n')

  // Multiple errors - run twice and compare order
  const multipleErrors = {
    version: 'v1', // Invalid
    proposal_id: '', // Empty
    intent: '', // Empty
    requested_action: 'invalid', // Invalid enum
    targets: [], // Empty array
    constraints: {},
    evidence_plan: {},
    provenance: {
      source: 'invalid',
      timestamp_utc: ''
    }
  }

  const r6a = validateProposalV0(multipleErrors)
  const r6b = validateProposalV0(multipleErrors)

  assert(r6a.ok === false && r6b.ok === false, 'Both runs return errors')

  if (!r6a.ok && !r6b.ok) {
    const codes1 = r6a.error.map(e => e.code).join(',')
    const codes2 = r6b.error.map(e => e.code).join(',')
    assert(codes1 === codes2, 'Error ordering is identical across runs')

    // Verify expected error codes are present (order matters for determinism)
    const expectedCodes = [
      ERROR_CODES.INVALID_VERSION,
      ERROR_CODES.EMPTY_PROPOSAL_ID,
      ERROR_CODES.EMPTY_INTENT,
      ERROR_CODES.INVALID_REQUESTED_ACTION,
      ERROR_CODES.TARGETS_EMPTY,
      ERROR_CODES.INVALID_PROVENANCE_SOURCE,
      ERROR_CODES.MISSING_PROVENANCE_TIMESTAMP,
    ]
    assertErrorCodes(r6a.error, expectedCodes, 'Error codes in schema-defined order')
  }

  // Test unknown fields come first (alphabetically sorted)
  const unknownFirst = {
    ...VALID_MINIMAL_PROPOSAL,
    aaa_unknown: 1,
    zzz_unknown: 2,
    version: 'v1' // Also invalid
  }
  const r6c = validateProposalV0(unknownFirst)
  if (!r6c.ok) {
    assert(r6c.error[0].code === ERROR_CODES.UNKNOWN_FIELD, 'Unknown fields reported first')
    assert(r6c.error[0].field === 'aaa_unknown', 'Unknown fields alphabetically sorted')
    assert(r6c.error[1].field === 'zzz_unknown', 'Second unknown field in order')
  }

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 7: Edge cases
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 7: Edge cases\n')

  // Non-object input
  const r7a = validateProposalV0(null)
  assert(r7a.ok === false, 'null input fails')
  if (!r7a.ok) {
    assert(r7a.error[0].code === ERROR_CODES.NOT_AN_OBJECT, 'Error is NOT_AN_OBJECT')
  }

  const r7b = validateProposalV0([1, 2, 3])
  assert(r7b.ok === false, 'Array input fails')

  const r7c = validateProposalV0('string')
  assert(r7c.ok === false, 'String input fails')

  const r7d = validateProposalV0(42)
  assert(r7d.ok === false, 'Number input fails')

  // Targets not array
  const targetsNotArray = {
    ...VALID_MINIMAL_PROPOSAL,
    targets: { kind: 'file', identifier: 'test' } // Object instead of array
  }
  const r7e = validateProposalV0(targetsNotArray)
  assert(r7e.ok === false, 'targets as object fails')
  if (!r7e.ok) {
    assert(r7e.error.some(e => e.code === ERROR_CODES.TARGETS_NOT_ARRAY),
      'Error code is TARGETS_NOT_ARRAY')
  }

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  console.log('==========================================')
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed`)
  console.log('==========================================')

  if (failCount > 0) {
    process.exit(1)
  }
}

runTests()
