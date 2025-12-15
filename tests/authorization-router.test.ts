// Authorization Router Tests - Deny-by-default enforcement
//
// ACCEPTANCE TESTS:
// (a) Direct call from proposer to applier must fail
// (b) Any attempt to execute without ALLOW decision must fail
// (c) Proper authorization flow succeeds

import * as fs from 'fs'
import * as path from 'path'
import { AuthorizationRouter, initializeAuthorizationRouter, isAuthorizationRouterInitialized, type AuthorizationToken } from '../src/authorization/router'
import { AutoApplier } from '../src/selfbuild/applier'
import { JSONLLedger } from '../src/persistence/jsonlLedger'
import { contentAddress } from '../src/core/contentAddress'
import { createGateDecision, createGateDecisionScope } from '../src/core/gateDecision'
import { EFFECT_SETS } from '../src/core/effects'
import type { ImprovementProposal } from '../src/selfbuild/proposer'

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

// Create a mock proposal for testing
// NOTE: Timestamps are segregated as metadata, not part of content address
function createMockProposal(): ImprovementProposal {
  return {
    id: 'test-proposal-001',
    targetFile: 'tests/fixtures/test-file.ts',
    issue: {
      type: 'missing_error_handling',
      severity: 'medium',
      description: 'Test issue'
    },
    proposedChange: {
      type: 'add_function',
      code: 'export function testFn() { return true }',
      diff: '+export function testFn() { return true }'
    },
    rationale: 'Test rationale',
    source: 'test'
  } as ImprovementProposal  // Cast to allow missing timestamp (metadata)
}

async function runTests() {
  const testLedgerPath = '/tmp/auth-router-test-' + Date.now() + '.jsonl'

  console.log('=== AUTHORIZATION ROUTER TESTS ===\n')
  console.log('Testing deny-by-default enforcement\n')

  // ============================================================================
  // TEST 1: Direct call to applier without authorization token fails
  // ACCEPTANCE TEST (a): Direct call from proposer to applier must fail
  // ============================================================================
  console.log('TEST 1: Direct call without token fails\n')

  // Initialize router first
  const ledger = new JSONLLedger(testLedgerPath)
  initializeAuthorizationRouter(ledger)

  const applier = new AutoApplier()
  const proposal = createMockProposal()

  // TypeScript won't let us call apply() without a token, but we can
  // test that the applier correctly rejects when given an invalid token

  // Create a fake token without proper authorization
  const fakeToken: AuthorizationToken = {
    token_id: 'fake-token-id',
    authorization_decision_id: 'nonexistent-decision-id',
    target_id: 'wrong-target-id',
    gate_type: 'change_application',
    granted_effects: [],
    issued_at: Date.now(),
    expires_at: Date.now() + 60000
  }

  const result1 = await applier.apply(proposal, fakeToken)

  assert(!result1.ok, 'Apply with fake token fails')
  if (!result1.ok) {
    assert(
      result1.error.message.includes('AUTHORIZATION DENIED'),
      'Error message indicates authorization denial'
    )
  }

  console.log('')

  // ============================================================================
  // TEST 2: Request authorization without prior ALLOW fails
  // ACCEPTANCE TEST (b): Any attempt to execute without ALLOW decision fails
  // ============================================================================
  console.log('TEST 2: Request authorization without prior ALLOW fails\n')

  const ledger2Path = '/tmp/auth-router-test-2-' + Date.now() + '.jsonl'
  const ledger2 = new JSONLLedger(ledger2Path)
  const router2 = new AuthorizationRouter(ledger2)

  const proposal2 = createMockProposal()
  const proposalId2 = contentAddress(proposal2)

  // Try to get authorization without any ALLOW decision in ledger
  const authResult2 = router2.requestAuthorization(
    proposalId2,
    'change_application',
    EFFECT_SETS.CODE_APPLICATION
  )

  assert(!authResult2.ok, 'Authorization request without prior ALLOW fails')
  if (!authResult2.ok) {
    assert(
      authResult2.error.message.includes('deny-by-default'),
      'Error mentions deny-by-default'
    )
    assert(
      authResult2.error.message.includes('No prior ALLOW'),
      'Error mentions no prior ALLOW decision'
    )
  }

  // Cleanup
  try { fs.unlinkSync(ledger2Path) } catch {}

  console.log('')

  // ============================================================================
  // TEST 3: Proper authorization flow succeeds
  // ============================================================================
  console.log('TEST 3: Proper authorization flow succeeds\n')

  const ledger3Path = '/tmp/auth-router-test-3-' + Date.now() + '.jsonl'
  const ledger3 = new JSONLLedger(ledger3Path)
  const router3 = new AuthorizationRouter(ledger3)

  const proposal3 = createMockProposal()
  const proposalId3 = contentAddress(proposal3)

  // First, record an ALLOW decision in the ledger
  const allowDecision = createGateDecision(
    'change_application',
    'ALLOW',
    createGateDecisionScope(
      'proposal',
      proposal3,
      proposal3.targetFile,
      EFFECT_SETS.CODE_APPLICATION
    ),
    'test_authorizer',
    'Test authorization for test proposal',
    { proposalId: proposal3.id }
  )

  await ledger3.appendGateDecision(allowDecision)

  // Now request authorization - should succeed
  const authResult3 = router3.requestAuthorization(
    proposalId3,
    'change_application',
    EFFECT_SETS.CODE_APPLICATION
  )

  assert(authResult3.ok, 'Authorization request with prior ALLOW succeeds')

  if (authResult3.ok) {
    const token = authResult3.value
    assert(token.target_id === proposalId3, 'Token has correct target_id')
    assert(token.gate_type === 'change_application', 'Token has correct gate_type')
    assert(token.granted_effects.length > 0, 'Token has granted effects')
    assert(token.token_id.startsWith('sha256:'), 'Token ID is content-addressed')

    // Verify the token
    const verifyResult = router3.verifyToken(token)
    assert(verifyResult.ok, 'Token verification succeeds')
  }

  // Cleanup
  try { fs.unlinkSync(ledger3Path) } catch {}

  console.log('')

  // ============================================================================
  // TEST 4: Token for wrong proposal is rejected
  // ============================================================================
  console.log('TEST 4: Token for wrong proposal is rejected\n')

  const ledger4Path = '/tmp/auth-router-test-4-' + Date.now() + '.jsonl'
  const ledger4 = new JSONLLedger(ledger4Path)
  initializeAuthorizationRouter(ledger4)
  const router4 = new AuthorizationRouter(ledger4)
  const applier4 = new AutoApplier()

  // Create two different proposals
  const proposalA = createMockProposal()
  proposalA.id = 'proposal-A'
  const proposalB = createMockProposal()
  proposalB.id = 'proposal-B'

  const proposalAId = contentAddress(proposalA)

  // Record ALLOW for proposal A
  const allowDecisionA = createGateDecision(
    'change_application',
    'ALLOW',
    createGateDecisionScope(
      'proposal',
      proposalA,
      proposalA.targetFile,
      EFFECT_SETS.CODE_APPLICATION
    ),
    'test_authorizer',
    'Test authorization for proposal A'
  )

  await ledger4.appendGateDecision(allowDecisionA)

  // Get token for proposal A
  const tokenResultA = router4.requestAuthorization(
    proposalAId,
    'change_application',
    EFFECT_SETS.CODE_APPLICATION
  )

  assert(tokenResultA.ok, 'Token obtained for proposal A')

  if (tokenResultA.ok) {
    // Try to use token A for proposal B - should fail
    const applyResult = await applier4.apply(proposalB, tokenResultA.value)

    assert(!applyResult.ok, 'Apply with wrong proposal token fails')
    if (!applyResult.ok) {
      assert(
        applyResult.error.message.includes('does not match proposal ID'),
        'Error indicates token/proposal mismatch'
      )
    }
  }

  // Cleanup
  try { fs.unlinkSync(ledger4Path) } catch {}

  console.log('')

  // ============================================================================
  // TEST 5: Expired token is rejected
  // ============================================================================
  console.log('TEST 5: Expired token is rejected\n')

  const ledger5Path = '/tmp/auth-router-test-5-' + Date.now() + '.jsonl'
  const ledger5 = new JSONLLedger(ledger5Path)

  // Create router with very short token validity (1ms)
  const router5 = new AuthorizationRouter(ledger5, 1)

  const proposal5 = createMockProposal()
  const proposalId5 = contentAddress(proposal5)

  // Record ALLOW decision
  const allowDecision5 = createGateDecision(
    'change_application',
    'ALLOW',
    createGateDecisionScope('proposal', proposal5, proposal5.targetFile, EFFECT_SETS.CODE_APPLICATION),
    'test_authorizer',
    'Test authorization'
  )
  await ledger5.appendGateDecision(allowDecision5)

  // Get token
  const tokenResult5 = router5.requestAuthorization(
    proposalId5,
    'change_application',
    EFFECT_SETS.CODE_APPLICATION
  )

  assert(tokenResult5.ok, 'Token obtained')

  if (tokenResult5.ok) {
    // Wait for token to expire
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify should fail
    const verifyResult = router5.verifyToken(tokenResult5.value)
    assert(!verifyResult.ok, 'Expired token verification fails')
    if (!verifyResult.ok) {
      assert(
        verifyResult.error.message.includes('expired'),
        'Error indicates token expired'
      )
    }
  }

  // Cleanup
  try { fs.unlinkSync(ledger5Path) } catch {}

  console.log('')

  // ============================================================================
  // TEST 6: DENY decision does not authorize
  // ============================================================================
  console.log('TEST 6: DENY decision does not authorize\n')

  const ledger6Path = '/tmp/auth-router-test-6-' + Date.now() + '.jsonl'
  const ledger6 = new JSONLLedger(ledger6Path)
  const router6 = new AuthorizationRouter(ledger6)

  const proposal6 = createMockProposal()
  const proposalId6 = contentAddress(proposal6)

  // Record a DENY decision (not ALLOW)
  const denyDecision = createGateDecision(
    'change_application',
    'DENY',  // DENY, not ALLOW
    createGateDecisionScope('proposal', proposal6, proposal6.targetFile, []),
    'test_authorizer',
    'Test denial'
  )
  await ledger6.appendGateDecision(denyDecision)

  // Try to get authorization - should fail because there's no ALLOW
  const authResult6 = router6.requestAuthorization(
    proposalId6,
    'change_application',
    []
  )

  assert(!authResult6.ok, 'DENY decision does not grant authorization')
  if (!authResult6.ok) {
    assert(
      authResult6.error.message.includes('No prior ALLOW'),
      'Error indicates no ALLOW decision (DENY is not ALLOW)'
    )
  }

  // Cleanup
  try { fs.unlinkSync(ledger6Path) } catch {}
  try { fs.unlinkSync(testLedgerPath) } catch {}

  console.log('')

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('==========================================')
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed`)
  console.log('==========================================\n')

  if (failCount > 0) {
    console.log('ACCEPTANCE CRITERIA:')
    console.log('(a) Direct call from proposer to applier must fail - TESTED')
    console.log('(b) Any attempt to execute without ALLOW decision must fail - TESTED')
    console.log('(c) Proper authorization flow succeeds - TESTED')
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Test runner failed:', err)
  process.exit(1)
})
