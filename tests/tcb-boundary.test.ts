// TCB Boundary Tests - Authoritative TCB membership verification
//
// ACCEPTANCE TESTS:
// (a) File outside declared TCB is NOT treated as TCB
// (b) Authority paths are correctly identified
// (c) TCB boundary is deterministic (static, no runtime registration)

import {
  isTCBPath,
  isTCBAuthorityPath,
  getTCBClassification,
  isAutonomousModificationAllowed,
  listAllTCBPaths,
  describeTCBClassification,
  TCB_AUTHORITY_PATHS,
  TCB_GOVERNED_PATHS,
  CONSTITUTIONAL_PATHS,
  SCHEMA_PATHS,
  type TCBClassification
} from '../src/core/tcbBoundary'

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

function runTests() {
  console.log('=== TCB BOUNDARY TESTS ===\n')
  console.log('Testing authoritative TCB membership declarations\n')

  // ============================================================================
  // TEST 1: Files outside declared TCB are NOT treated as TCB
  // ACCEPTANCE TEST (a)
  // ============================================================================
  console.log('TEST 1: Files outside declared TCB are NOT treated as TCB\n')

  const nonTCBPaths = [
    'src/adapters/openaiAdapter.ts',
    'src/dogfood/loop.ts',
    'src/llm/constrained.ts',
    'src/products/approval/workflow.ts',
    'tests/some-test.test.ts',
    'package.json',
    'tsconfig.json',
    'README.md',
    'random/application/code.ts'
  ]

  for (const filepath of nonTCBPaths) {
    const isTCB = isTCBPath(filepath)
    assert(!isTCB, `Non-TCB path "${filepath}" is NOT treated as TCB`)

    const classification = getTCBClassification(filepath)
    assert(classification === 'non-tcb', `"${filepath}" classified as non-tcb`)
  }

  console.log('')

  // ============================================================================
  // TEST 2: Authority paths are correctly identified
  // ACCEPTANCE TEST (b)
  // ============================================================================
  console.log('TEST 2: Authority paths (Ring 1) are correctly identified\n')

  const authorityPaths = [
    'src/validation/sixGates.ts',
    'src/core/contentAddress.ts',
    'src/persistence/jsonlLedger.ts',
    'src/authorization/router.ts',
    'src/schema/registry.ts',
    'src/verification/verify.ts',
    'src/sandbox/secureEval.ts'
  ]

  for (const filepath of authorityPaths) {
    const isTCB = isTCBPath(filepath)
    assert(isTCB, `Authority path "${filepath}" IS treated as TCB`)

    const isAuthority = isTCBAuthorityPath(filepath)
    assert(isAuthority, `"${filepath}" identified as TCB AUTHORITY`)

    const classification = getTCBClassification(filepath)
    assert(classification === 'authority', `"${filepath}" classified as authority`)

    const canAutoModify = isAutonomousModificationAllowed(filepath)
    assert(!canAutoModify, `Autonomous modification BLOCKED for "${filepath}"`)
  }

  console.log('')

  // ============================================================================
  // TEST 3: Governed paths (Ring 2) are correctly identified
  // ============================================================================
  console.log('TEST 3: Governed paths (Ring 2) are correctly identified\n')

  const governedPaths = [
    'src/selfbuild/proposer.ts',
    'src/selfbuild/applier.ts'
  ]

  for (const filepath of governedPaths) {
    const isTCB = isTCBPath(filepath)
    assert(isTCB, `Governed path "${filepath}" IS treated as TCB`)

    const classification = getTCBClassification(filepath)
    assert(classification === 'governed', `"${filepath}" classified as governed`)

    const canAutoModify = isAutonomousModificationAllowed(filepath)
    assert(canAutoModify, `Autonomous modification ALLOWED for governed path "${filepath}"`)
  }

  console.log('')

  // ============================================================================
  // TEST 4: Constitutional paths are correctly identified
  // ============================================================================
  console.log('TEST 4: Constitutional paths are correctly identified\n')

  const constitutionalPaths = [
    'docs/MOTHERLABS_CONSTITUTION.md',
    'docs/DECISION_PHILOSOPHY.md'
  ]

  for (const filepath of constitutionalPaths) {
    const isTCB = isTCBPath(filepath)
    assert(isTCB, `Constitutional path "${filepath}" IS treated as TCB`)

    const classification = getTCBClassification(filepath)
    assert(classification === 'constitutional', `"${filepath}" classified as constitutional`)

    const canAutoModify = isAutonomousModificationAllowed(filepath)
    assert(!canAutoModify, `Autonomous modification BLOCKED for constitutional path`)
  }

  console.log('')

  // ============================================================================
  // TEST 5: Schema paths are correctly identified
  // ============================================================================
  console.log('TEST 5: Schema paths are correctly identified\n')

  const schemaPaths = [
    'schemas/gate-decision.json',
    'schemas/evidence-artifact.json'
  ]

  for (const filepath of schemaPaths) {
    const isTCB = isTCBPath(filepath)
    assert(isTCB, `Schema path "${filepath}" IS treated as TCB`)

    const classification = getTCBClassification(filepath)
    assert(classification === 'schema', `"${filepath}" classified as schema`)
  }

  console.log('')

  // ============================================================================
  // TEST 6: TCB boundary is DETERMINISTIC (static, no runtime registration)
  // ACCEPTANCE TEST (c)
  // ============================================================================
  console.log('TEST 6: TCB boundary is deterministic\n')

  // Call listAllTCBPaths twice - should return identical results
  const paths1 = listAllTCBPaths()
  const paths2 = listAllTCBPaths()

  assert(
    JSON.stringify(paths1) === JSON.stringify(paths2),
    'listAllTCBPaths() returns identical results on repeated calls'
  )

  // Verify path arrays are readonly (TypeScript enforces this at compile time)
  // Runtime check: arrays should be the exact same reference as exported constants
  assert(
    paths1.authority === TCB_AUTHORITY_PATHS,
    'Authority paths are the authoritative constant reference'
  )
  assert(
    paths1.governed === TCB_GOVERNED_PATHS,
    'Governed paths are the authoritative constant reference'
  )
  assert(
    paths1.constitutional === CONSTITUTIONAL_PATHS,
    'Constitutional paths are the authoritative constant reference'
  )
  assert(
    paths1.schema === SCHEMA_PATHS,
    'Schema paths are the authoritative constant reference'
  )

  // Check same file always gets same classification
  const testPath = 'src/core/contentAddress.ts'
  const class1 = getTCBClassification(testPath)
  const class2 = getTCBClassification(testPath)
  const class3 = getTCBClassification(testPath)
  assert(
    class1 === class2 && class2 === class3,
    'getTCBClassification returns deterministic result'
  )

  console.log('')

  // ============================================================================
  // TEST 7: Classification descriptions are correct
  // ============================================================================
  console.log('TEST 7: Classification descriptions\n')

  const classifications: TCBClassification[] = ['authority', 'governed', 'constitutional', 'schema', 'non-tcb']

  for (const classification of classifications) {
    const description = describeTCBClassification(classification)
    assert(description.length > 0, `Description exists for '${classification}'`)
    // Check that description contains relevant keywords
    const hasRelevantContent =
      description.includes(classification) ||
      (classification === 'authority' && description.includes('Ring 1')) ||
      (classification === 'governed' && description.includes('Ring 2')) ||
      (classification === 'constitutional' && description.includes('Constitutional')) ||
      (classification === 'schema' && description.includes('Schema')) ||
      (classification === 'non-tcb' && description.includes('Non-TCB'))
    assert(hasRelevantContent, `Description is relevant for '${classification}'`)
  }

  console.log('')

  // ============================================================================
  // TEST 8: NEW paths (authorization, schema, verification) are TCB Authority
  // This tests that the new components are protected
  // ============================================================================
  console.log('TEST 8: New components are TCB Authority\n')

  const newAuthorityPaths = [
    'src/authorization/router.ts',
    'src/schema/registry.ts',
    'src/verification/verify.ts'
  ]

  for (const filepath of newAuthorityPaths) {
    const classification = getTCBClassification(filepath)
    assert(
      classification === 'authority',
      `NEW component "${filepath}" is TCB Authority`
    )

    const canAutoModify = isAutonomousModificationAllowed(filepath)
    assert(
      !canAutoModify,
      `Autonomous modification BLOCKED for new authority component`
    )
  }

  console.log('')

  // ============================================================================
  // TEST 9: RUNTIME MUTATION BLOCKED (Object.freeze)
  // CRITICAL: Proves TCB boundary cannot be silently expanded at runtime
  // ============================================================================
  console.log('TEST 9: Runtime mutation blocked (Object.freeze)\n')

  // Before mutation attempt
  const maliciousPath = 'src/malicious/evil.ts'
  const beforeIsTCB = isTCBPath(maliciousPath)
  const beforeClassification = getTCBClassification(maliciousPath)

  assert(!beforeIsTCB, `BEFORE: "${maliciousPath}" is NOT TCB`)
  assert(beforeClassification === 'non-tcb', `BEFORE: "${maliciousPath}" classified as non-tcb`)

  // Attempt mutation - should throw TypeError or silently fail
  let mutationThrew = false
  let mutationError = ''
  try {
    // This should throw TypeError because array is frozen
    (TCB_AUTHORITY_PATHS as string[]).push('src/malicious/')
  } catch (e) {
    mutationThrew = true
    mutationError = (e as Error).message
  }

  // Verify mutation was blocked
  assert(mutationThrew, 'MUTATION BLOCKED: push() threw TypeError on frozen array')
  if (mutationThrew) {
    assert(
      mutationError.includes('Cannot add property') ||
      mutationError.includes('object is not extensible') ||
      mutationError.includes('read only'),
      `Error message indicates frozen array: "${mutationError.slice(0, 50)}..."`
    )
  }

  // After mutation attempt - classification must be unchanged
  const afterIsTCB = isTCBPath(maliciousPath)
  const afterClassification = getTCBClassification(maliciousPath)

  assert(!afterIsTCB, `AFTER: "${maliciousPath}" still NOT TCB`)
  assert(afterClassification === 'non-tcb', `AFTER: "${maliciousPath}" still classified as non-tcb`)

  // Verify array length unchanged
  assert(
    TCB_AUTHORITY_PATHS.length === 7,
    `TCB_AUTHORITY_PATHS length unchanged (expected 7, got ${TCB_AUTHORITY_PATHS.length})`
  )

  // Verify all boundary arrays are frozen
  assert(Object.isFrozen(TCB_AUTHORITY_PATHS), 'TCB_AUTHORITY_PATHS is Object.frozen')
  assert(Object.isFrozen(TCB_GOVERNED_PATHS), 'TCB_GOVERNED_PATHS is Object.frozen')
  assert(Object.isFrozen(CONSTITUTIONAL_PATHS), 'CONSTITUTIONAL_PATHS is Object.frozen')
  assert(Object.isFrozen(SCHEMA_PATHS), 'SCHEMA_PATHS is Object.frozen')

  console.log('')

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('==========================================')
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed`)
  console.log('==========================================\n')

  console.log('ACCEPTANCE CRITERIA:')
  console.log('(a) File outside declared TCB NOT treated as TCB - TEST 1')
  console.log('(b) Authority paths correctly identified - TEST 2')
  console.log('(c) TCB boundary is deterministic (static) - TEST 6')
  console.log('(d) Runtime mutation blocked (Object.freeze) - TEST 9')
  console.log('')
  console.log('TCB BOUNDARY VERIFICATION:')
  console.log('- Authority (Ring 1): src/validation, src/core, src/persistence,')
  console.log('                      src/authorization, src/schema, src/verification, src/sandbox')
  console.log('- Governed (Ring 2): src/selfbuild')
  console.log('- Constitutional: docs/*.md')
  console.log('- Schema: schemas/')
  console.log('- Non-TCB: Everything else (adapters, dogfood, llm, products, tests)')

  if (failCount > 0) {
    process.exit(1)
  }
}

runTests()
