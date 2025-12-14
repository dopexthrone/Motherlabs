// Governance Integration Tests
// Tests the 6-phase governance system integration

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomBytes } from 'crypto'

// Phase 1: Gate Decision Types & Effects
import {
  GateType,
  GateDecision,
  createGateDecision,
  createGateDecisionScope,
  createLegacyGateDecision,
  isEffectAuthorized,
  findPriorAuthorization,
  requiresAuthorization
} from '../src/core/gateDecision'

import {
  EffectType,
  checkEffectBounds,
  createEffectManifest,
  validateFilePath,
  createFileManifestEntry,
  EFFECT_SETS
} from '../src/core/effects'

// Phase 2: Evidence Artifacts
import {
  EvidenceKind,
  createEvidenceArtifact,
  verifyArtifact,
  createGateResultArtifact,
  createLLMResponseArtifact,
  createTestResultArtifact,
  bundleArtifacts
} from '../src/persistence/evidenceArtifact'

import { JSONLLedger } from '../src/persistence/jsonlLedger'

// Phase 3: Verification System
import {
  verifyLedger,
  verifyLedgerFromFile,
  formatVerificationResult
} from '../src/verification/verify'

import {
  checkProposalAdmissionAuthorization,
  checkChangeApplicationAuthorization,
  checkEffectAuthorization,
  createAuthorizationGateDecision,
  getSelfImprovementWorkflow
} from '../src/verification/authorizationChecks'

// Phase 5: Outcome Conformance
import {
  validateOutcomeConformance,
  createProposalOutcome,
  REQUIRED_EVIDENCE_BY_STATUS,
  isValidTransition
} from '../src/verification/outcomeConformance'

// Phase 6: Provider Manifests
import {
  PROVIDER_MANIFESTS,
  getProviderManifest,
  isEffectAllowedForProvider,
  hasRequiredEvidence,
  getRecommendedCodeModel,
  isDeterministic,
  formatManifest
} from '../src/adapters/manifest'

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`✓ PASS: ${message}`)
    passCount++
  } else {
    console.error(`✗ FAIL: ${message}`)
    failCount++
  }
}

async function runTests(): Promise<void> {
  console.log('═══════════════════════════════════════')
  console.log('  GOVERNANCE INTEGRATION TESTS')
  console.log('═══════════════════════════════════════\n')

  // Create temp directory for test ledger
  const testId = randomBytes(4).toString('hex')
  const tempDir = path.join(os.tmpdir(), `governance-test-${testId}`)
  fs.mkdirSync(tempDir, { recursive: true })
  const ledgerPath = path.join(tempDir, 'test-ledger.jsonl')

  // ============================================================================
  // PHASE 1 TESTS: Gate Decision Types & Effects
  // ============================================================================
  console.log('=== PHASE 1: Gate Decision Types & Effects ===\n')

  // Test 1.1: Create Gate Decision
  const scope = createGateDecisionScope('code', { test: 'code' }, 'test.ts', ['CODE_MODIFY'])
  const gateDecision = createGateDecision(
    'schema_validation',
    'ALLOW',
    scope,
    'gate:schema_validation',
    'Passed schema validation',
    { score: 100 }
  )
  assert(gateDecision.decision === 'ALLOW', 'Gate decision has ALLOW decision')
  assert(gateDecision.gate_type === 'schema_validation', 'Gate decision has correct type')
  assert(gateDecision.scope.granted_effects?.includes('CODE_MODIFY'), 'Gate decision has granted effects')
  assert(gateDecision.authorizer === 'gate:schema_validation', 'Gate decision has authorizer')

  // Test 1.2: Legacy Gate Decision
  const legacyDecision = createLegacyGateDecision(
    'syntax_validation',
    'DENY',
    { id: '123', type: 'code' },
    'Syntax error'
  )
  assert(legacyDecision.decision === 'DENY', 'Legacy decision has DENY')
  assert(legacyDecision.target.id === '123', 'Legacy decision has target id')

  // Test 1.3: Effect Bounds Checking
  const granted: EffectType[] = ['CODE_MODIFY', 'GIT_COMMIT']
  const exercised: EffectType[] = ['CODE_MODIFY']
  const boundsResult = checkEffectBounds(granted, exercised)
  assert(boundsResult.valid, 'Effect bounds valid when within limits')

  const exceededExercised: EffectType[] = ['CODE_MODIFY', 'GIT_PUSH']
  const exceededResult = checkEffectBounds(granted, exceededExercised)
  assert(!exceededResult.valid, 'Effect bounds invalid when exceeded')
  assert(exceededResult.violations.includes('GIT_PUSH'), 'Violation includes GIT_PUSH')

  // Test 1.4: Effect Manifest
  const manifest = createEffectManifest(granted, exercised)
  assert(manifest.within_bounds, 'Effect manifest within bounds')

  // Test 1.5: File Path Validation
  assert(validateFilePath('../test') !== null, 'Rejects .. in path')
  assert(validateFilePath('/absolute/path') !== null, 'Rejects absolute path')
  assert(validateFilePath('src/test.ts') === null, 'Accepts valid relative path')

  // Test 1.6: Standard Effect Sets
  assert(EFFECT_SETS.PURE_VALIDATION.includes('NONE'), 'PURE_VALIDATION includes NONE')
  assert(EFFECT_SETS.CODE_APPLICATION.includes('GIT_COMMIT'), 'CODE_APPLICATION includes GIT_COMMIT')

  // Test 1.7: Authorization Requirements
  assert(requiresAuthorization('proposal_admission'), 'proposal_admission requires auth')
  assert(requiresAuthorization('change_application'), 'change_application requires auth')
  assert(!requiresAuthorization('schema_validation'), 'schema_validation does not require auth')

  console.log('')

  // ============================================================================
  // PHASE 2 TESTS: Evidence Artifacts
  // ============================================================================
  console.log('=== PHASE 2: Evidence Artifacts ===\n')

  // Test 2.1: Create Evidence Artifact
  const artifact = createEvidenceArtifact('test payload', 'stdout_log', {
    created_at_utc: new Date().toISOString(),
    description: 'Test artifact'
  })
  assert(artifact.artifact_id.startsWith('sha256:'), 'Artifact has sha256 ID')
  assert(artifact.evidence_kind === 'stdout_log', 'Artifact has correct kind')
  assert(artifact.payload === 'test payload', 'Artifact has payload')

  // Test 2.2: Verify Artifact
  assert(verifyArtifact(artifact), 'Artifact verification passes')
  const tamperedArtifact = { ...artifact, payload: 'tampered' }
  assert(!verifyArtifact(tamperedArtifact), 'Tampered artifact fails verification')

  // Test 2.3: Gate Result Artifact
  const gateArtifact = createGateResultArtifact('schema_validation', true)
  assert(gateArtifact.evidence_kind === 'gate_result', 'Gate artifact has correct kind')

  // Test 2.4: LLM Response Artifact
  const llmArtifact = createLLMResponseArtifact(
    'function test() {}',
    'gpt-4o',
    'openai'
  )
  assert(llmArtifact.evidence_kind === 'llm_response', 'LLM artifact has correct kind')

  // Test 2.5: Test Result Artifact
  const testArtifact = createTestResultArtifact(10, 2, 1)
  assert(testArtifact.evidence_kind === 'test_result', 'Test artifact has correct kind')

  // Test 2.6: Bundle Artifacts
  const bundle = bundleArtifacts([artifact, gateArtifact], 'Test bundle')
  assert(bundle.artifacts.length === 2, 'Bundle has 2 artifacts')
  assert(bundle.bundle_hash.startsWith('sha256:'), 'Bundle has hash')

  // Test 2.7: Ledger Artifact Methods
  const ledger = new JSONLLedger(ledgerPath)
  const appendResult = await ledger.appendArtifact(artifact)
  assert(appendResult.ok, 'Artifact appended to ledger')

  const retrieved = ledger.getArtifact(artifact.artifact_id)
  assert(retrieved.ok && retrieved.value?.artifact_id === artifact.artifact_id, 'Artifact retrieved from ledger')

  const byKind = ledger.getArtifactsByKind('stdout_log')
  assert(byKind.ok && byKind.value.length >= 1, 'Artifacts retrieved by kind')

  console.log('')

  // ============================================================================
  // PHASE 3 TESTS: Verification System
  // ============================================================================
  console.log('=== PHASE 3: Verification System ===\n')

  // Test 3.1: Verify Valid Ledger
  const records = ledger.readAll()
  assert(records.ok, 'Ledger reads successfully')

  const verifyResult = verifyLedger(records.value)
  assert(verifyResult.pass, 'Ledger verification passes')
  assert(verifyResult.stats.records_checked > 0, 'Records were checked')

  // Test 3.2: Verify From File
  const fileResult = verifyLedgerFromFile(ledgerPath)
  assert(fileResult.pass, 'File verification passes')

  // Test 3.3: Format Verification Result
  const formatted = formatVerificationResult(verifyResult)
  assert(formatted.includes('PASS'), 'Formatted result shows PASS')

  // Test 3.4: Authorization Checks - No Prior Auth
  const noAuthResult = checkProposalAdmissionAuthorization('sha256:abc123', [])
  assert(!noAuthResult.authorized, 'No auth without prior decision')

  // Test 3.5: Create Authorization Gate Decision
  const authDecision = createAuthorizationGateDecision(
    'proposal_admission',
    'ALLOW',
    'sha256:proposal123',
    'human:admin',
    'Approved by admin',
    ['CODE_MODIFY', 'GIT_COMMIT']
  )
  assert(authDecision.decision === 'ALLOW', 'Auth decision is ALLOW')
  assert(authDecision.authorizer === 'human:admin', 'Auth decision has authorizer')

  // Test 3.6: Self Improvement Workflow
  const workflow = getSelfImprovementWorkflow('sha256:prop', 'sha256:code')
  assert(workflow.length === 3, 'Workflow has 3 steps')
  assert(workflow[0].gateType === 'proposal_admission', 'First step is proposal admission')

  console.log('')

  // ============================================================================
  // PHASE 5 TESTS: Outcome Conformance
  // ============================================================================
  console.log('=== PHASE 5: Outcome Conformance ===\n')

  // Test 5.1: Required Evidence By Status
  assert(REQUIRED_EVIDENCE_BY_STATUS['COMPLETED'].includes('gate_result'), 'COMPLETED requires gate_result')
  assert(REQUIRED_EVIDENCE_BY_STATUS['REJECTED'].length === 0, 'REJECTED requires no evidence')

  // Test 5.2: Create Proposal Outcome
  const outcome = createProposalOutcome('sha256:prop', 'COMPLETED', [artifact.artifact_id])
  assert(outcome.status === 'COMPLETED', 'Outcome has correct status')
  assert(outcome.applied_at !== undefined, 'Outcome has applied_at timestamp')

  // Test 5.3: Validate Conformance - Missing Evidence
  const artifactMap = new Map<string, typeof artifact>()
  artifactMap.set(artifact.artifact_id, artifact)

  const conformance = validateOutcomeConformance(outcome, artifactMap)
  assert(!conformance.ok, 'Conformance fails with missing evidence')
  assert(conformance.missing_required.length > 0, 'Missing required evidence identified')

  // Test 5.4: Valid Status Transitions
  assert(isValidTransition('pending', 'COMPLETED'), 'pending -> COMPLETED is valid')
  assert(isValidTransition('in_progress', 'ROLLED_BACK'), 'in_progress -> ROLLED_BACK is valid')
  assert(!isValidTransition('COMPLETED', 'FAILED'), 'COMPLETED -> FAILED is invalid')

  console.log('')

  // ============================================================================
  // PHASE 6 TESTS: Provider Manifests
  // ============================================================================
  console.log('=== PHASE 6: Provider Manifests ===\n')

  // Test 6.1: Get Provider Manifest
  const anthropicManifest = getProviderManifest('anthropic')
  assert(anthropicManifest !== undefined, 'Anthropic manifest exists')
  assert(anthropicManifest?.determinism_claim === 'NONDETERMINISTIC', 'Anthropic is non-deterministic')

  // Test 6.2: Effect Allowed For Provider
  assert(isEffectAllowedForProvider('anthropic', 'LLM_GENERATE'), 'Anthropic allows LLM_GENERATE')
  assert(!isEffectAllowedForProvider('anthropic', 'GIT_PUSH'), 'Anthropic does not allow GIT_PUSH')

  // Test 6.3: Required Evidence Check
  const evidenceCheck = hasRequiredEvidence('anthropic', ['llm_response'])
  assert(evidenceCheck.ok, 'Anthropic has required evidence')
  const missingCheck = hasRequiredEvidence('anthropic', [])
  assert(!missingCheck.ok, 'Missing evidence detected')

  // Test 6.4: Recommended Code Model
  const recommended = getRecommendedCodeModel('ollama')
  assert(recommended === 'qwen2.5-coder:14b', 'Ollama recommends qwen2.5-coder:14b')

  // Test 6.5: Determinism Check
  assert(!isDeterministic('anthropic'), 'Anthropic is not deterministic')
  assert(isDeterministic('deterministic'), 'Deterministic provider is deterministic')

  // Test 6.6: Format Manifest
  const formatted2 = formatManifest(anthropicManifest!)
  assert(formatted2.includes('anthropic'), 'Formatted manifest contains provider name')
  assert(formatted2.includes('NONDETERMINISTIC'), 'Formatted manifest contains determinism claim')

  // Test 6.7: All Providers Exist
  assert(PROVIDER_MANIFESTS['anthropic'] !== undefined, 'Anthropic manifest registered')
  assert(PROVIDER_MANIFESTS['openai'] !== undefined, 'OpenAI manifest registered')
  assert(PROVIDER_MANIFESTS['ollama'] !== undefined, 'Ollama manifest registered')
  assert(PROVIDER_MANIFESTS['deterministic'] !== undefined, 'Deterministic manifest registered')

  console.log('')

  // ============================================================================
  // CLEANUP
  // ============================================================================
  console.log('=== CLEANUP ===\n')

  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
    console.log('Cleanup successful\n')
  } catch {
    console.log('Cleanup failed (non-critical)\n')
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('═══════════════════════════════════════')
  console.log(`RESULTS: ${passCount} passed, ${failCount} failed`)
  console.log('═══════════════════════════════════════\n')

  if (failCount > 0) {
    console.log('GOVERNANCE TESTS FAILED')
    process.exit(1)
  } else {
    console.log('ALL GOVERNANCE TESTS PASSED')
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
