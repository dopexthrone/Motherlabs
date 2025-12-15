// Proposal Admission Integration Tests
//
// Tests the full flow: validation → gate decision → ledger admission
//
// ACCEPTANCE TESTS:
// (1) Valid proposal → ALLOW gate decision → proposal admitted to ledger
// (2) Invalid proposal → DENY gate decision → proposal NOT admitted
// (3) Gate decision always recorded (even on failure)
// (4) Deterministic: same input produces same gate decision structure

import * as fs from 'fs'
import { JSONLLedger } from '../src/persistence/jsonlLedger'
import {
  ProposalAdmissionService,
  createAdmissionService,
} from '../src/proposal/admissionService'
import { validateProposalV0 } from '../src/validation/proposalV0Validator'

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

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

const VALID_PROPOSAL = {
  version: 'v0',
  proposal_id: 'prop_test_001',
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

const INVALID_PROPOSAL = {
  version: 'v1', // Wrong version
  intent: '', // Empty intent
  requested_action: 'modify', // Invalid action
  targets: [], // Empty targets
  provenance: {
    source: 'cli'
    // Missing timestamp_utc
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('=== PROPOSAL ADMISSION INTEGRATION TESTS ===\n')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 1: Valid proposal → ALLOW → admitted
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 1: Valid proposal admission flow\n')

  const ledgerPath1 = `/tmp/proposal-admission-test-1-${Date.now()}.jsonl`
  const ledger1 = new JSONLLedger(ledgerPath1)
  const service1 = createAdmissionService(ledger1, 'test_authorizer')

  const initialCount1 = ledger1.count()

  const result1 = await service1.admitProposal(VALID_PROPOSAL)

  assert(result1.ok === true, 'Admission returns ok=true')

  if (result1.ok) {
    const admission = result1.value

    assert(admission.admitted === true, 'Proposal was admitted')
    assert(admission.proposal !== undefined, 'Validated proposal returned')
    assert(admission.proposal?.proposal_id === 'prop_test_001', 'Proposal ID preserved')

    assert(admission.gateDecision.decision === 'ALLOW', 'Gate decision is ALLOW')
    assert(admission.gateDecision.gate_type === 'proposal_admission', 'Gate type is proposal_admission')
    assert(admission.gateDecision.scope.target_type === 'proposal', 'Target type is proposal')

    assert(admission.gateDecisionRecord !== undefined, 'Gate decision recorded to ledger')
    assert(admission.proposalRecord !== undefined, 'Proposal recorded to ledger')

    // Verify ledger state
    const finalCount1 = ledger1.count()
    assert(finalCount1 === initialCount1 + 2, 'Two records added (gate decision + proposal)')

    // Verify records in ledger
    const allRecords = ledger1.readAll()
    if (allRecords.ok) {
      const gateRecord = allRecords.value.find(r => r.record_type === 'GATE_DECISION')
      const proposalRecord = allRecords.value.find(r => r.record_type === 'PROPOSAL_V0')

      assert(gateRecord !== undefined, 'Gate decision found in ledger')
      assert(proposalRecord !== undefined, 'Proposal found in ledger')

      if (gateRecord && proposalRecord) {
        assert(gateRecord.seq < proposalRecord.seq, 'Gate decision recorded before proposal')
      }
    }
  }

  // Cleanup
  fs.unlinkSync(ledgerPath1)

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 2: Invalid proposal → DENY → not admitted
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 2: Invalid proposal rejection flow\n')

  const ledgerPath2 = `/tmp/proposal-admission-test-2-${Date.now()}.jsonl`
  const ledger2 = new JSONLLedger(ledgerPath2)
  const service2 = createAdmissionService(ledger2, 'test_authorizer')

  const initialCount2 = ledger2.count()

  const result2 = await service2.admitProposal(INVALID_PROPOSAL)

  assert(result2.ok === true, 'Admission returns ok=true (rejection is not an error)')

  if (result2.ok) {
    const admission = result2.value

    assert(admission.admitted === false, 'Proposal was NOT admitted')
    assert(admission.proposal === undefined, 'No validated proposal returned')
    assert(admission.proposalRecord === undefined, 'No proposal record in ledger')

    assert(admission.gateDecision.decision === 'DENY', 'Gate decision is DENY')
    assert(admission.gateDecision.gate_type === 'proposal_admission', 'Gate type is proposal_admission')

    assert(admission.gateDecisionRecord !== undefined, 'Gate decision recorded to ledger')
    assert(admission.validationErrors !== undefined, 'Validation errors returned')
    assert(admission.validationErrors!.length > 0, 'At least one validation error')

    // Verify only gate decision was recorded (not the invalid proposal)
    const finalCount2 = ledger2.count()
    assert(finalCount2 === initialCount2 + 1, 'Only gate decision added (not proposal)')

    // Verify no proposal in ledger
    const allRecords2 = ledger2.readAll()
    if (allRecords2.ok) {
      const proposalRecord = allRecords2.value.find(r => r.record_type === 'PROPOSAL_V0')
      assert(proposalRecord === undefined, 'No proposal in ledger after rejection')
    }
  }

  // Cleanup
  fs.unlinkSync(ledgerPath2)

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 3: Pre-validated proposal admission
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 3: Pre-validated proposal admission\n')

  const ledgerPath3 = `/tmp/proposal-admission-test-3-${Date.now()}.jsonl`
  const ledger3 = new JSONLLedger(ledgerPath3)
  const service3 = createAdmissionService(ledger3, 'test_authorizer')

  // Validate externally first
  const validationResult = validateProposalV0(VALID_PROPOSAL)
  assert(validationResult.ok === true, 'External validation passes')

  if (validationResult.ok) {
    const result3 = await service3.admitValidatedProposal(validationResult.value)

    assert(result3.ok === true, 'Pre-validated admission succeeds')

    if (result3.ok) {
      assert(result3.value.admitted === true, 'Proposal admitted')
      assert(result3.value.gateDecision.decision === 'ALLOW', 'Gate decision is ALLOW')
      assert(result3.value.proposalRecord !== undefined, 'Proposal in ledger')
    }
  }

  // Cleanup
  fs.unlinkSync(ledgerPath3)

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 4: Determinism - same input produces consistent structure
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 4: Deterministic gate decision structure\n')

  const ledgerPath4a = `/tmp/proposal-admission-test-4a-${Date.now()}.jsonl`
  const ledgerPath4b = `/tmp/proposal-admission-test-4b-${Date.now()}.jsonl`

  const ledger4a = new JSONLLedger(ledgerPath4a)
  const ledger4b = new JSONLLedger(ledgerPath4b)

  const service4a = createAdmissionService(ledger4a, 'determinism_test')
  const service4b = createAdmissionService(ledger4b, 'determinism_test')

  const result4a = await service4a.admitProposal(VALID_PROPOSAL)
  const result4b = await service4b.admitProposal(VALID_PROPOSAL)

  assert(result4a.ok && result4b.ok, 'Both admissions succeed')

  if (result4a.ok && result4b.ok) {
    const gd4a = result4a.value.gateDecision
    const gd4b = result4b.value.gateDecision

    assert(gd4a.gate_type === gd4b.gate_type, 'Gate types match')
    assert(gd4a.decision === gd4b.decision, 'Decisions match')
    assert(gd4a.scope.target_type === gd4b.scope.target_type, 'Target types match')
    assert(gd4a.scope.target_id === gd4b.scope.target_id, 'Target IDs match (content-addressed)')
    assert(gd4a.authorizer === gd4b.authorizer, 'Authorizers match')

    // Note: issued_at_utc will differ (timestamps are metadata)
    // But the structural content should be identical
  }

  // Cleanup
  fs.unlinkSync(ledgerPath4a)
  fs.unlinkSync(ledgerPath4b)

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 5: Multiple proposals to same ledger
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 5: Multiple proposals to same ledger\n')

  const ledgerPath5 = `/tmp/proposal-admission-test-5-${Date.now()}.jsonl`
  const ledger5 = new JSONLLedger(ledgerPath5)
  const service5 = createAdmissionService(ledger5, 'test_authorizer')

  const proposal2 = {
    ...VALID_PROPOSAL,
    proposal_id: 'prop_test_002',
    intent: 'Refactor authentication module',
    requested_action: 'update',
    targets: [{ kind: 'module', identifier: 'src/auth' }]
  }

  const proposal3 = {
    ...VALID_PROPOSAL,
    proposal_id: 'prop_test_003',
    intent: 'Add new API endpoint',
    requested_action: 'create',
    targets: [{ kind: 'file', identifier: 'src/api/newEndpoint.ts' }]
  }

  const r5a = await service5.admitProposal(VALID_PROPOSAL)
  const r5b = await service5.admitProposal(proposal2)
  const r5c = await service5.admitProposal(proposal3)

  assert(r5a.ok && r5a.value.admitted, 'First proposal admitted')
  assert(r5b.ok && r5b.value.admitted, 'Second proposal admitted')
  assert(r5c.ok && r5c.value.admitted, 'Third proposal admitted')

  // Check ledger has all records in order
  const allRecords5 = ledger5.readAll()
  if (allRecords5.ok) {
    const gateDecisions = allRecords5.value.filter(r => r.record_type === 'GATE_DECISION')
    const proposals = allRecords5.value.filter(r => r.record_type === 'PROPOSAL_V0')

    assert(gateDecisions.length === 3, 'Three gate decisions recorded')
    assert(proposals.length === 3, 'Three proposals recorded')

    // Verify hash chain integrity
    const chainResult = ledger5.verifyChain()
    assert(chainResult.ok === true, 'Hash chain is valid')
  }

  // Cleanup
  fs.unlinkSync(ledgerPath5)

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

runTests().catch(err => {
  console.error('Test error:', err)
  process.exit(1)
})
