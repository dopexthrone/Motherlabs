// Proposal Lifecycle End-to-End Test
//
// Demonstrates the complete proposal flow:
// 1. External client creates proposal object
// 2. Proposal submitted to admission service
// 3. Validator enforces schema (fail-closed)
// 4. Gate decision recorded (ALLOW or DENY)
// 5. Proposal admitted to ledger (if ALLOW)
// 6. Ledger verifiable with hash chain integrity
//
// This test simulates a Ring-2 Proposer workflow.

import * as fs from 'fs'
import { JSONLLedger } from '../src/persistence/jsonlLedger'
import { createAdmissionService } from '../src/proposal/admissionService'
import { getSchemaRegistry } from '../src/schema/registry'
import { contentAddress } from '../src/core/contentAddress'

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
// SCENARIO 1: Complete successful proposal lifecycle
// ═══════════════════════════════════════════════════════════════════════════

async function scenario1_SuccessfulProposalLifecycle() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('SCENARIO 1: Successful Proposal Lifecycle')
  console.log('═══════════════════════════════════════════════════════════════════\n')

  const ledgerPath = `/tmp/e2e-scenario1-${Date.now()}.jsonl`
  const ledger = new JSONLLedger(ledgerPath)
  const admissionService = createAdmissionService(ledger, 'ring2_proposer')

  // Step 1: External client creates a proposal
  console.log('Step 1: Client creates proposal object\n')
  const clientProposal = {
    version: 'v0',
    proposal_id: `prop_e2e_${Date.now()}`,
    intent: 'Add input validation to user registration endpoint to prevent injection attacks',
    requested_action: 'update',
    targets: [
      { kind: 'file', identifier: 'src/api/register.ts' },
      { kind: 'file', identifier: 'src/validation/userInput.ts' }
    ],
    constraints: {
      max_line_changes: 50,
      require_tests: true
    },
    evidence_plan: {
      required_evidence: ['test_results', 'code_review'],
      success_criteria: 'All tests pass, no regressions'
    },
    provenance: {
      source: 'cli',
      timestamp_utc: new Date().toISOString()
    },
    metadata: {
      author: 'developer@example.com',
      priority: 'high'
    }
  }

  const proposalContentId = contentAddress(clientProposal)
  console.log(`  Proposal ID: ${clientProposal.proposal_id}`)
  console.log(`  Content ID:  ${proposalContentId.slice(0, 16)}...`)
  console.log(`  Targets:     ${clientProposal.targets.length} files\n`)

  // Step 2: Submit proposal to admission service
  console.log('Step 2: Submit proposal to admission service\n')
  const admissionResult = await admissionService.admitProposal(clientProposal)

  assert(admissionResult.ok === true, 'Admission completes without error')
  if (!admissionResult.ok) {
    console.error(`  Error: ${admissionResult.error.message}`)
    fs.unlinkSync(ledgerPath)
    return
  }

  const admission = admissionResult.value

  // Step 3: Verify gate decision was recorded
  console.log('Step 3: Verify gate decision recorded\n')
  assert(admission.gateDecision.decision === 'ALLOW', 'Gate decision is ALLOW')
  assert(admission.gateDecision.gate_type === 'proposal_admission', 'Gate type is proposal_admission')
  assert(admission.gateDecision.scope.target_type === 'proposal', 'Scope target is proposal')
  assert(admission.gateDecision.scope.granted_effects?.includes('LEDGER_APPEND') === true, 'LEDGER_APPEND effect granted')

  console.log(`  Gate Type:   ${admission.gateDecision.gate_type}`)
  console.log(`  Decision:    ${admission.gateDecision.decision}`)
  console.log(`  Authorizer:  ${admission.gateDecision.authorizer}`)
  console.log(`  Effects:     ${admission.gateDecision.scope.granted_effects?.join(', ')}\n`)

  // Step 4: Verify proposal was admitted
  console.log('Step 4: Verify proposal admitted to ledger\n')
  assert(admission.admitted === true, 'Proposal was admitted')
  assert(admission.proposal !== undefined, 'Validated proposal returned')
  assert(admission.proposalRecord !== undefined, 'Proposal record exists in ledger')

  if (admission.proposal) {
    assert(admission.proposal.version === 'v0', 'Version preserved')
    assert(admission.proposal.proposal_id === clientProposal.proposal_id, 'Proposal ID preserved')
    assert(admission.proposal.targets.length === 2, 'All targets preserved')
  }

  // Step 5: Verify ledger state and hash chain
  console.log('Step 5: Verify ledger integrity\n')
  const allRecords = ledger.readAll()
  assert(allRecords.ok === true, 'Ledger readable')

  if (allRecords.ok) {
    const records = allRecords.value
    // GENESIS + GATE_DECISION + PROPOSAL_V0 = 3 records
    assert(records.length === 3, 'Three records in ledger (genesis + gate decision + proposal)')

    const gateRecord = records.find(r => r.record_type === 'GATE_DECISION')
    const proposalRecord = records.find(r => r.record_type === 'PROPOSAL_V0')

    assert(gateRecord !== undefined, 'Gate decision in ledger')
    assert(proposalRecord !== undefined, 'Proposal in ledger')

    if (gateRecord && proposalRecord) {
      assert(gateRecord.seq < proposalRecord.seq, 'Gate decision precedes proposal')

      // Verify proposal references gate decision
      const proposalData = proposalRecord.record as Record<string, unknown>
      assert(
        proposalData.admission_gate_decision_id !== undefined,
        'Proposal references gate decision ID'
      )
    }

    // Verify hash chain
    const chainResult = ledger.verifyChain()
    assert(chainResult.ok === true, 'Hash chain valid')
  }

  // Step 6: Schema registry validation
  console.log('Step 6: Verify schema registry\n')
  const registry = getSchemaRegistry()
  const proposalSchemaResult = registry.resolve('PROPOSAL_V0')
  assert(proposalSchemaResult.ok === true, 'PROPOSAL_V0 schema registered')

  const gateSchemaResult = registry.resolve('GATE_DECISION')
  assert(gateSchemaResult.ok === true, 'GATE_DECISION schema registered')

  // Cleanup
  fs.unlinkSync(ledgerPath)

  console.log('')
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Proposal rejection with audit trail
// ═══════════════════════════════════════════════════════════════════════════

async function scenario2_ProposalRejectionAudit() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('SCENARIO 2: Proposal Rejection with Audit Trail')
  console.log('═══════════════════════════════════════════════════════════════════\n')

  const ledgerPath = `/tmp/e2e-scenario2-${Date.now()}.jsonl`
  const ledger = new JSONLLedger(ledgerPath)
  const admissionService = createAdmissionService(ledger, 'ring2_proposer')

  // Malformed proposal (missing required field - triggers early fail-closed rejection)
  console.log('Step 1: Submit malformed proposal\n')
  const malformedProposal = {
    version: 'v0',
    // proposal_id missing - causes structural rejection
    intent: 'Malformed proposal test',
    requested_action: 'update',
    targets: [{ kind: 'file', identifier: 'test.ts' }],
    constraints: {},
    evidence_plan: {},
    provenance: {
      source: 'cli',
      timestamp_utc: '2025-12-15T12:00:00Z'
    }
  }

  const result = await admissionService.admitProposal(malformedProposal)

  // Step 2: Verify rejection
  console.log('Step 2: Verify rejection\n')
  assert(result.ok === true, 'Admission returns ok=true (rejection is not an error)')

  if (result.ok) {
    const admission = result.value
    assert(admission.admitted === false, 'Proposal NOT admitted')
    assert(admission.gateDecision.decision === 'DENY', 'Gate decision is DENY')
    assert(admission.validationErrors !== undefined, 'Validation errors returned')
    assert(admission.validationErrors!.length >= 1, 'At least one validation error captured')

    console.log(`  Decision:     ${admission.gateDecision.decision}`)
    console.log(`  Error count:  ${admission.validationErrors?.length}`)
    console.log(`  Error codes:  ${admission.validationErrors?.map(e => e.code).join(', ')}\n`)
  }

  // Step 3: Verify audit trail exists
  console.log('Step 3: Verify audit trail\n')
  const allRecords = ledger.readAll()
  assert(allRecords.ok === true, 'Ledger readable')

  if (allRecords.ok) {
    const records = allRecords.value
    // GENESIS + GATE_DECISION = 2 records (invalid proposal NOT admitted)
    assert(records.length === 2, 'Genesis + gate decision recorded (not invalid proposal)')

    const gateRecord = records.find(r => r.record_type === 'GATE_DECISION')
    assert(gateRecord !== undefined, 'Gate decision in ledger')

    if (gateRecord) {
      const gateData = gateRecord.record as Record<string, unknown>
      assert(gateData.decision === 'DENY', 'DENY decision recorded')

      // DENY decision should have error details in metadata
      const details = gateData.details as Record<string, unknown> | undefined
      if (details) {
        assert(typeof details.error_count === 'number', 'Error count in details')
        assert(Array.isArray(details.error_codes), 'Error codes in details')
      }
    }
  }

  // Cleanup
  fs.unlinkSync(ledgerPath)

  console.log('')
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Multi-proposal workflow
// ═══════════════════════════════════════════════════════════════════════════

async function scenario3_MultiProposalWorkflow() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('SCENARIO 3: Multi-Proposal Workflow')
  console.log('═══════════════════════════════════════════════════════════════════\n')

  const ledgerPath = `/tmp/e2e-scenario3-${Date.now()}.jsonl`
  const ledger = new JSONLLedger(ledgerPath)
  const admissionService = createAdmissionService(ledger, 'ring2_proposer')

  // Create 5 proposals (3 valid, 2 invalid)
  const proposals = [
    {
      version: 'v0',
      proposal_id: 'prop_001',
      intent: 'First feature implementation',
      requested_action: 'create',
      targets: [{ kind: 'file', identifier: 'src/feature1.ts' }],
      constraints: {},
      evidence_plan: {},
      provenance: { source: 'cli', timestamp_utc: '2025-12-15T10:00:00Z' }
    },
    {
      version: 'v0',
      proposal_id: 'prop_002',
      intent: 'Bug fix',
      requested_action: 'update',
      targets: [{ kind: 'file', identifier: 'src/buggy.ts' }],
      constraints: {},
      evidence_plan: {},
      provenance: { source: 'cli', timestamp_utc: '2025-12-15T11:00:00Z' }
    },
    {
      // Invalid - missing proposal_id
      version: 'v0',
      intent: 'Invalid proposal 1',
      requested_action: 'update',
      targets: [{ kind: 'file', identifier: 'test.ts' }],
      constraints: {},
      evidence_plan: {},
      provenance: { source: 'cli', timestamp_utc: '2025-12-15T12:00:00Z' }
    },
    {
      version: 'v0',
      proposal_id: 'prop_004',
      intent: 'Refactoring',
      requested_action: 'update',
      targets: [{ kind: 'module', identifier: 'src/core' }],
      constraints: {},
      evidence_plan: {},
      provenance: { source: 'api', timestamp_utc: '2025-12-15T13:00:00Z' }
    },
    {
      // Invalid - empty targets
      version: 'v0',
      proposal_id: 'prop_005',
      intent: 'Invalid proposal 2',
      requested_action: 'delete',
      targets: [],
      constraints: {},
      evidence_plan: {},
      provenance: { source: 'cli', timestamp_utc: '2025-12-15T14:00:00Z' }
    }
  ]

  console.log('Step 1: Submit 5 proposals (3 valid, 2 invalid)\n')

  let admitted = 0
  let rejected = 0

  for (const proposal of proposals) {
    const result = await admissionService.admitProposal(proposal)
    if (result.ok) {
      if (result.value.admitted) {
        admitted++
        console.log(`  ✓ ${(proposal as Record<string, unknown>).proposal_id || 'no-id'}: ADMITTED`)
      } else {
        rejected++
        console.log(`  ✗ ${(proposal as Record<string, unknown>).proposal_id || 'no-id'}: REJECTED`)
      }
    }
  }

  console.log('')
  console.log('Step 2: Verify counts\n')
  assert(admitted === 3, '3 proposals admitted')
  assert(rejected === 2, '2 proposals rejected')

  console.log('Step 3: Verify ledger state\n')
  const allRecords = ledger.readAll()
  assert(allRecords.ok === true, 'Ledger readable')

  if (allRecords.ok) {
    const records = allRecords.value
    const gateDecisions = records.filter(r => r.record_type === 'GATE_DECISION')
    const admittedProposals = records.filter(r => r.record_type === 'PROPOSAL_V0')

    assert(gateDecisions.length === 5, '5 gate decisions recorded (all attempts)')
    assert(admittedProposals.length === 3, '3 proposals in ledger (valid only)')

    const allowCount = gateDecisions.filter(r =>
      (r.record as Record<string, unknown>).decision === 'ALLOW'
    ).length
    const denyCount = gateDecisions.filter(r =>
      (r.record as Record<string, unknown>).decision === 'DENY'
    ).length

    assert(allowCount === 3, '3 ALLOW decisions')
    assert(denyCount === 2, '2 DENY decisions')

    // Verify hash chain integrity across all records
    const chainResult = ledger.verifyChain()
    assert(chainResult.ok === true, 'Hash chain valid after multi-proposal workflow')
  }

  // Cleanup
  fs.unlinkSync(ledgerPath)

  console.log('')
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function runE2ETests() {
  console.log('')
  console.log('╔═════════════════════════════════════════════════════════════════╗')
  console.log('║        PROPOSAL LIFECYCLE END-TO-END TESTS                     ║')
  console.log('║        Ring-2 Proposer → Gate Decision → Ledger                ║')
  console.log('╚═════════════════════════════════════════════════════════════════╝')
  console.log('')

  await scenario1_SuccessfulProposalLifecycle()
  await scenario2_ProposalRejectionAudit()
  await scenario3_MultiProposalWorkflow()

  console.log('═══════════════════════════════════════════════════════════════════')
  console.log(`E2E SUMMARY: ${passCount} passed, ${failCount} failed`)
  console.log('═══════════════════════════════════════════════════════════════════')

  if (failCount > 0) {
    process.exit(1)
  }
}

runE2ETests().catch(err => {
  console.error('E2E test error:', err)
  process.exit(1)
})
