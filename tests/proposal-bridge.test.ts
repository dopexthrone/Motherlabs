// Proposal Bridge Integration Tests
//
// Tests the connection between ImprovementProposal and ProposalV0 systems:
// 1. ImprovementProposal converts to valid ProposalV0
// 2. Bridge admits proposals through admission service
// 3. Gate decisions are recorded for bridged proposals
// 4. Pre-validated proposals skip re-validation

import * as fs from 'fs'
import { JSONLLedger } from '../src/persistence/jsonlLedger'
import {
  createProposalBridge,
  convertToProposalV0,
  type BridgeResult,
} from '../src/proposal/proposalBridge'
import { validateProposalV0 } from '../src/validation/proposalV0Validator'
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
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

function createMockImprovementProposal(overrides: Partial<ImprovementProposal> = {}): ImprovementProposal {
  return {
    id: 'imp_test_001',
    targetFile: 'src/test/example.ts',
    issue: {
      type: 'missing_error_handling',
      severity: 'medium',
      message: 'Function lacks error handling',
      location: { line: 10, column: 1 },
    },
    proposedChange: {
      type: 'modify_function',
      code: 'export function example() { try { /* ... */ } catch (e) { throw e; } }',
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
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('=== PROPOSAL BRIDGE INTEGRATION TESTS ===\n')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 1: ImprovementProposal converts to valid ProposalV0
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 1: ImprovementProposal converts to valid ProposalV0\n')

  const improvement = createMockImprovementProposal()
  const proposalV0 = convertToProposalV0(improvement, 'automated')

  assert(proposalV0.version === 'v0', 'Version is v0')
  assert(proposalV0.proposal_id.startsWith('prop_dogfood_'), 'Proposal ID has dogfood prefix')
  assert(proposalV0.intent === improvement.rationale, 'Intent matches rationale')
  assert(proposalV0.requested_action === 'update', 'modify_function maps to update')
  assert(proposalV0.targets.length === 1, 'Single target')
  assert(proposalV0.targets[0].kind === 'file', 'Target kind is file')
  assert(proposalV0.targets[0].identifier === improvement.targetFile, 'Target identifier matches')
  assert(proposalV0.provenance.source === 'automated', 'Source is automated')

  // Validate the converted proposal
  const validationResult = validateProposalV0(proposalV0)
  assert(validationResult.ok === true, 'Converted proposal passes ProposalV0 validation')

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 2: Bridge admits valid proposals
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 2: Bridge admits valid proposals\n')

  const ledgerPath1 = `/tmp/bridge-test-1-${Date.now()}.jsonl`
  const ledger1 = new JSONLLedger(ledgerPath1)
  const bridge1 = createProposalBridge(ledger1, 'test_bridge')

  const improvement2 = createMockImprovementProposal({
    id: 'imp_test_002',
    rationale: 'Test bridge admission',
  })

  const bridgeResult = await bridge1.bridgeValidated(improvement2)

  assert(bridgeResult.ok === true, 'Bridge returns ok=true')

  if (bridgeResult.ok) {
    const result = bridgeResult.value

    assert(result.admissionResult.admitted === true, 'Proposal was admitted')
    assert(result.admissionResult.gateDecision.decision === 'ALLOW', 'Gate decision is ALLOW')
    assert(result.proposalId.startsWith('prop_dogfood_'), 'Proposal ID generated')

    // Verify ledger state
    const allRecords = ledger1.readAll()
    if (allRecords.ok) {
      const gateDecisions = allRecords.value.filter(r => r.record_type === 'GATE_DECISION')
      const proposals = allRecords.value.filter(r => r.record_type === 'PROPOSAL_V0')

      assert(gateDecisions.length >= 1, 'Gate decision recorded')
      assert(proposals.length === 1, 'Proposal recorded')
    }
  }

  // Cleanup
  fs.unlinkSync(ledgerPath1)

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 3: Bridge rejects unvalidated proposals
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 3: Bridge rejects unvalidated proposals\n')

  const ledgerPath2 = `/tmp/bridge-test-2-${Date.now()}.jsonl`
  const ledger2 = new JSONLLedger(ledgerPath2)
  const bridge2 = createProposalBridge(ledger2, 'test_bridge')

  // Create improvement without gate validation
  const unvalidatedImprovement = createMockImprovementProposal({
    id: 'imp_unvalidated',
    gateValidation: undefined,
  })

  const rejectResult = await bridge2.bridgeValidated(unvalidatedImprovement)

  assert(rejectResult.ok === false, 'Bridge rejects unvalidated proposal')
  if (!rejectResult.ok) {
    assert(rejectResult.error.message.includes('gate validation required'), 'Error mentions gate validation')
  }

  // Cleanup
  fs.unlinkSync(ledgerPath2)

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 4: Bridge rejects proposals with failed gates
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 4: Bridge rejects proposals with failed gates\n')

  const ledgerPath3 = `/tmp/bridge-test-3-${Date.now()}.jsonl`
  const ledger3 = new JSONLLedger(ledgerPath3)
  const bridge3 = createProposalBridge(ledger3, 'test_bridge')

  // Create improvement with failed gate validation
  const failedGatesImprovement = createMockImprovementProposal({
    id: 'imp_failed_gates',
    gateValidation: {
      valid: false,
      gateResults: [
        { gateName: 'schema', passed: true },
        { gateName: 'syntax', passed: false, error: 'Syntax error' },
      ],
    },
  })

  const failedResult = await bridge3.bridgeValidated(failedGatesImprovement)

  assert(failedResult.ok === false, 'Bridge rejects proposal with failed gates')

  // Cleanup
  fs.unlinkSync(ledgerPath3)

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 5: Change type to action mapping
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 5: Change type to action mapping\n')

  const addFunctionProposal = convertToProposalV0(
    createMockImprovementProposal({ proposedChange: { type: 'add_function', code: '' } }),
    'automated'
  )
  assert(addFunctionProposal.requested_action === 'create', 'add_function maps to create')

  const addTestProposal = convertToProposalV0(
    createMockImprovementProposal({ proposedChange: { type: 'add_test', code: '' } }),
    'automated'
  )
  assert(addTestProposal.requested_action === 'create', 'add_test maps to create')

  const modifyFunctionProposal = convertToProposalV0(
    createMockImprovementProposal({ proposedChange: { type: 'modify_function', code: '' } }),
    'automated'
  )
  assert(modifyFunctionProposal.requested_action === 'update', 'modify_function maps to update')

  const refactorProposal = convertToProposalV0(
    createMockImprovementProposal({ proposedChange: { type: 'refactor', code: '' } }),
    'automated'
  )
  assert(refactorProposal.requested_action === 'update', 'refactor maps to update')

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 6: Metadata preservation
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 6: Metadata preservation\n')

  const improvementWithMetadata = createMockImprovementProposal({
    id: 'imp_metadata_test',
    classification: {
      type: 'code_change',
      scope: 'local',
      risk: 'low',
    },
  })

  const proposalWithMetadata = convertToProposalV0(improvementWithMetadata, 'automated')

  assert(proposalWithMetadata.metadata !== undefined, 'Metadata preserved')
  if (proposalWithMetadata.metadata) {
    assert(
      proposalWithMetadata.metadata.original_improvement_id === 'imp_metadata_test',
      'Original improvement ID in metadata'
    )
    assert(
      proposalWithMetadata.metadata.source_type === 'llm',
      'Source type preserved'
    )
  }

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 7: Validate-only mode
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 7: Validate-only mode\n')

  const ledgerPath4 = `/tmp/bridge-test-4-${Date.now()}.jsonl`
  const ledger4 = new JSONLLedger(ledgerPath4)
  const bridge4 = createProposalBridge(ledger4, 'test_bridge')

  // Get count before validation
  const countBefore = ledger4.count()

  const improvementToValidate = createMockImprovementProposal({
    id: 'imp_validate_only',
  })

  const validateResult = bridge4.validateOnly(improvementToValidate)
  assert(validateResult.ok === true, 'Validate-only returns ok=true')

  if (validateResult.ok) {
    assert(validateResult.value.version === 'v0', 'Returns validated ProposalV0')
  }

  // Verify no new records were written
  const countAfter = ledger4.count()
  assert(countAfter === countBefore, 'Validate-only did not write new records')

  // Cleanup
  fs.unlinkSync(ledgerPath4)

  console.log('')

  // ══════════════════════════════════════════════════════════════════════════
  // TEST 8: Multiple proposals maintain hash chain
  // ══════════════════════════════════════════════════════════════════════════
  console.log('TEST 8: Multiple proposals maintain hash chain\n')

  const ledgerPath5 = `/tmp/bridge-test-5-${Date.now()}.jsonl`
  const ledger5 = new JSONLLedger(ledgerPath5)
  const bridge5 = createProposalBridge(ledger5, 'test_bridge')

  // Bridge multiple proposals
  for (let i = 1; i <= 3; i++) {
    const imp = createMockImprovementProposal({
      id: `imp_chain_${i}`,
      rationale: `Chain test proposal ${i}`,
    })
    await bridge5.bridgeValidated(imp)
  }

  // Verify hash chain
  const chainResult = ledger5.verifyChain()
  assert(chainResult.ok === true, 'Hash chain valid after multiple proposals')

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
