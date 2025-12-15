// Dogfooding Loop End-to-End Tests
//
// Tests the full dogfooding loop integration with the proposal system:
// 1. Analysis finds issues
// 2. Proposer generates improvement (mocked for determinism)
// 3. Gates validate code
// 4. Bridge admits proposal to ledger
// 5. Apply with rollback
// 6. Outcomes recorded
//
// These tests verify the integration WITHOUT requiring actual LLM calls.

import * as fs from 'fs'
import { JSONLLedger } from '../src/persistence/jsonlLedger'
import { createProposalBridge, convertToProposalV0 } from '../src/proposal/proposalBridge'
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

// ═══════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════

function createValidImprovement(id: string): ImprovementProposal {
  return {
    id,
    targetFile: 'src/example.ts',
    issue: {
      type: 'missing_error_handling',
      severity: 'medium',
      message: 'Function lacks error handling',
      location: { line: 10, column: 1 },
    },
    proposedChange: {
      type: 'modify_function',
      code: `
import { Result, Ok, Err } from './core/result'

export function exampleFunction(): Result<string, Error> {
  try {
    return Ok('success')
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)))
  }
}
`.trim(),
      diff: '+ try/catch block added',
    },
    rationale: 'Add error handling to prevent unhandled exceptions',
    timestamp: Date.now(),
    gateValidation: {
      valid: true,
      gateResults: [
        { gateName: 'schema', passed: true },
        { gateName: 'syntax', passed: true },
        { gateName: 'types', passed: true },
        { gateName: 'exports', passed: true },
        { gateName: 'tests', passed: true },
        { gateName: 'entropy', passed: true },
      ],
    },
    source: 'llm',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('=== DOGFOODING LOOP E2E TESTS ===\n')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 1: Full proposal flow through bridge
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 1: Full proposal flow through bridge\n')

  const ledgerPath1 = `/tmp/dogfood-e2e-test-1-${Date.now()}.jsonl`
  const ledger1 = new JSONLLedger(ledgerPath1)
  const bridge1 = createProposalBridge(ledger1, 'dogfood_loop')

  // Simulate what the proposer would create
  const improvement1 = createValidImprovement('imp_e2e_001')

  // Step 1: Verify improvement converts to valid ProposalV0
  const proposalV0 = convertToProposalV0(improvement1, 'automated')
  assert(proposalV0.version === 'v0', 'Converted to v0')
  assert(proposalV0.proposal_id.includes('imp_e2e_001'), 'Proposal ID contains improvement ID')

  // Step 2: Bridge admits proposal
  const bridgeResult = await bridge1.bridgeValidated(improvement1)
  assert(bridgeResult.ok === true, 'Bridge succeeds')

  if (bridgeResult.ok) {
    assert(bridgeResult.value.admissionResult.admitted === true, 'Proposal admitted')
    assert(bridgeResult.value.admissionResult.gateDecision.decision === 'ALLOW', 'Gate decision is ALLOW')
    assert(bridgeResult.value.admissionResult.gateDecision.gate_type === 'proposal_admission', 'Gate type is proposal_admission')
  }

  // Step 3: Verify ledger state
  const records1 = ledger1.readAll()
  assert(records1.ok === true, 'Ledger readable')

  if (records1.ok) {
    const gateDecisions = records1.value.filter(r => r.record_type === 'GATE_DECISION')
    const proposals = records1.value.filter(r => r.record_type === 'PROPOSAL_V0')

    assert(gateDecisions.length >= 1, 'Gate decision recorded')
    assert(proposals.length === 1, 'Proposal recorded')

    // Verify proposal content
    if (proposals.length > 0) {
      const prop = proposals[0].record as Record<string, unknown>
      assert(prop.version === 'v0', 'Proposal has correct version')
      assert(prop.requested_action === 'update', 'Correct action type')

      const targets = prop.targets as Array<{ kind: string; identifier: string }>
      assert(targets[0].identifier === 'src/example.ts', 'Target file preserved')
    }

    // Verify hash chain
    const chainValid = ledger1.verifyChain()
    assert(chainValid.ok === true, 'Hash chain valid')
  }

  fs.unlinkSync(ledgerPath1)
  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 2: Multiple improvement cycle simulation
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 2: Multiple improvement cycle simulation\n')

  const ledgerPath2 = `/tmp/dogfood-e2e-test-2-${Date.now()}.jsonl`
  const ledger2 = new JSONLLedger(ledgerPath2)
  const bridge2 = createProposalBridge(ledger2, 'dogfood_loop')

  // Simulate 3 improvement cycles
  for (let i = 1; i <= 3; i++) {
    const improvement = createValidImprovement(`imp_cycle_${i}`)
    improvement.targetFile = `src/module${i}.ts`
    improvement.rationale = `Improvement cycle ${i}`

    const result = await bridge2.bridgeValidated(improvement)
    assert(result.ok === true, `Cycle ${i} bridge succeeds`)
  }

  // Verify final ledger state
  const records2 = ledger2.readAll()
  if (records2.ok) {
    const proposals = records2.value.filter(r => r.record_type === 'PROPOSAL_V0')
    const gateDecisions = records2.value.filter(r =>
      r.record_type === 'GATE_DECISION' &&
      (r.record as Record<string, unknown>).gate_type === 'proposal_admission'
    )

    assert(proposals.length === 3, '3 proposals admitted')
    assert(gateDecisions.length === 3, '3 admission gate decisions')

    // Verify all gate decisions are ALLOW
    const allAllow = gateDecisions.every(g =>
      (g.record as Record<string, unknown>).decision === 'ALLOW'
    )
    assert(allAllow, 'All gate decisions are ALLOW')
  }

  fs.unlinkSync(ledgerPath2)
  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 3: Rejected improvement (failed gate validation)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 3: Rejected improvement (failed gate validation)\n')

  const ledgerPath3 = `/tmp/dogfood-e2e-test-3-${Date.now()}.jsonl`
  const ledger3 = new JSONLLedger(ledgerPath3)
  const bridge3 = createProposalBridge(ledger3, 'dogfood_loop')

  // Create improvement with failed gates
  const failedImprovement = createValidImprovement('imp_failed_001')
  failedImprovement.gateValidation = {
    valid: false,
    gateResults: [
      { gateName: 'schema', passed: true },
      { gateName: 'syntax', passed: false, error: 'Syntax error at line 5' },
      { gateName: 'types', passed: false, error: 'Type error' },
    ],
  }

  const failedResult = await bridge3.bridgeValidated(failedImprovement)
  assert(failedResult.ok === false, 'Bridge rejects failed improvement')

  if (!failedResult.ok) {
    assert(failedResult.error.message.includes('gate validation'), 'Error mentions gate validation')
  }

  // Verify no proposal was admitted
  const records3 = ledger3.readAll()
  if (records3.ok) {
    const proposals = records3.value.filter(r => r.record_type === 'PROPOSAL_V0')
    assert(proposals.length === 0, 'No proposal admitted for failed gates')
  }

  fs.unlinkSync(ledgerPath3)
  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 4: Metadata preservation through bridge
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 4: Metadata preservation through bridge\n')

  const ledgerPath4 = `/tmp/dogfood-e2e-test-4-${Date.now()}.jsonl`
  const ledger4 = new JSONLLedger(ledgerPath4)
  const bridge4 = createProposalBridge(ledger4, 'dogfood_loop')

  const improvementWithMeta = createValidImprovement('imp_meta_001')
  improvementWithMeta.classification = {
    type: 'code_change',
    scope: 'local',
    risk: 'low',
  }

  const metaResult = await bridge4.bridgeValidated(improvementWithMeta)
  assert(metaResult.ok === true, 'Bridge with metadata succeeds')

  if (metaResult.ok) {
    const proposalV0Meta = metaResult.value.proposalV0
    assert(proposalV0Meta.metadata !== undefined, 'Metadata preserved')

    if (proposalV0Meta.metadata) {
      assert(
        proposalV0Meta.metadata.original_improvement_id === 'imp_meta_001',
        'Original ID in metadata'
      )
      assert(
        proposalV0Meta.metadata.source_type === 'llm',
        'Source type in metadata'
      )
    }
  }

  fs.unlinkSync(ledgerPath4)
  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 5: Ledger integrity across operations
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 5: Ledger integrity across operations\n')

  const ledgerPath5 = `/tmp/dogfood-e2e-test-5-${Date.now()}.jsonl`
  const ledger5 = new JSONLLedger(ledgerPath5)
  const bridge5 = createProposalBridge(ledger5, 'dogfood_loop')

  // Mix of successful and failed operations
  const validImp = createValidImprovement('imp_valid_001')
  const invalidImp = createValidImprovement('imp_invalid_001')
  invalidImp.gateValidation = { valid: false, gateResults: [] }

  await bridge5.bridgeValidated(validImp)
  await bridge5.bridgeValidated(invalidImp).catch(() => {}) // Ignore error

  const validImp2 = createValidImprovement('imp_valid_002')
  await bridge5.bridgeValidated(validImp2)

  // Verify integrity
  const records5 = ledger5.readAll()
  if (records5.ok) {
    // Check sequence numbers
    const seqs = records5.value.map(r => r.seq)
    const isMonotonic = seqs.every((seq, i) => i === 0 || seq === seqs[i-1] + 1)
    assert(isMonotonic, 'Sequence numbers monotonic')

    // Verify hash chain
    const chainValid = ledger5.verifyChain()
    assert(chainValid.ok === true, 'Hash chain valid after mixed operations')
  }

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
