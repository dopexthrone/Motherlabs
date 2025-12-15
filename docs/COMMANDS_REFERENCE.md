# 09-COMMANDS-REFERENCE.md - Commands to Verify Claims and Invariants

## Purpose

This document lists ONLY commands that verify claims or invariants from the baseline specification. No convenience commands or development utilities.

All commands assume working directory: `/home/motherlabs/motherlabs-runtime`

---

## Environment Verification

### Verify TypeScript Compiles

```bash
cd /home/motherlabs/motherlabs-runtime
npx tsc --noEmit
```
**Expected**: No output (success)

### Verify Dependencies Installed

```bash
cd /home/motherlabs/motherlabs-runtime
npm ls --depth=0
```
**Expected**: List of dependencies without errors

---

## Hash Chain Verification

### Verify Ledger Hash Chain

```bash
npx tsx -e "
const { JSONLLedger } = require('./dist/persistence/jsonlLedger')
const ledger = new JSONLLedger('evidence/canonical.jsonl')
const result = ledger.verifyChain()
console.log(result.ok ? 'PASS: Chain verified' : 'FAIL: ' + result.error)
"
```
**Expected**: `PASS: Chain verified`

### Verify 7-Layer Ledger Verification

```bash
npx tsx -e "
const { verifyLedgerFromFile, formatVerificationResult } = require('./dist/verification/verify')
const result = verifyLedgerFromFile('evidence/canonical.jsonl')
console.log(formatVerificationResult(result))
"
```
**Expected**: `Status: ✓ PASS` or detailed error report

---

## Content Addressing Verification

### Verify Timestamp Rejection

```bash
npx tsx -e "
const { contentAddress } = require('./dist/core/contentAddress')
try {
  contentAddress({ data: 'test', timestamp: Date.now() })
  console.log('FAIL: Should have thrown')
} catch (e) {
  if (e.message.includes('non-deterministic')) {
    console.log('PASS: Timestamp correctly rejected')
  } else {
    console.log('FAIL: Wrong error:', e.message)
  }
}
"
```
**Expected**: `PASS: Timestamp correctly rejected`

### Verify Deterministic Hashing

```bash
npx tsx -e "
const { contentAddress } = require('./dist/core/contentAddress')
const h1 = contentAddress({ a: 1, b: 2 })
const h2 = contentAddress({ b: 2, a: 1 })  // Different key order
console.log(h1 === h2 ? 'PASS: Hashes match' : 'FAIL: Hashes differ')
"
```
**Expected**: `PASS: Hashes match`

---

## Safe I/O Verification

### Verify Path Escape Detection

```bash
npx tsx -e "
const { validatePath } = require('./dist/core/safeIO')
const result = validatePath('/etc/passwd', '/home/motherlabs/motherlabs-runtime')
console.log(!result.value.contained ? 'PASS: Path escape detected' : 'FAIL: Path escape not detected')
"
```
**Expected**: `PASS: Path escape detected`

### Run Safe I/O Tests

```bash
npx tsx tests/safe-io.test.ts 2>&1 | tail -10
```
**Expected**: `SUMMARY: X passed, 0 failed` (or minimal failures)

---

## Proof Artifact Verification

### Verify Proof Artifact Creation

```bash
npx tsx -e "
const { createProofArtifact, verifyProofArtifact } = require('./dist/kernel/proofArtifact')
const result = createProofArtifact(
  [{ gate_name: 'test', passed: true }],
  'ALLOW'
)
if (result.ok) {
  const verification = verifyProofArtifact(result.value)
  console.log(verification.valid ? 'PASS: Proof verified' : 'FAIL: ' + verification.error)
} else {
  console.log('FAIL: Could not create proof')
}
"
```
**Expected**: `PASS: Proof verified`

### Verify Tamper Detection

```bash
npx tsx -e "
const { createProofArtifact, verifyProofArtifact } = require('./dist/kernel/proofArtifact')
const result = createProofArtifact([{ gate_name: 'test', passed: true }], 'ALLOW')
if (result.ok) {
  const tampered = { ...result.value, artifact_id: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
  const verification = verifyProofArtifact(tampered)
  console.log(!verification.valid ? 'PASS: Tamper detected' : 'FAIL: Tamper not detected')
}
"
```
**Expected**: `PASS: Tamper detected`

### Run Proof Artifact Tests

```bash
npx tsx tests/proof-artifact.test.ts 2>&1 | tail -10
```
**Expected**: `SUMMARY: 15 passed, 0 failed`

---

## Six-Gate Validation Verification

### Verify Gate Execution

```bash
npx tsx -e "
const { SixGateValidator } = require('./dist/validation/sixGates')
const validator = new SixGateValidator()
validator.validate(
  'export function test() { return 1 }',
  { existingImports: [], existingTypes: [] }
).then(result => {
  if (result.ok) {
    const passed = result.value.gateResults.filter(g => g.passed).length
    console.log('Gates passed:', passed, '/', result.value.gateResults.length)
    console.log('Valid:', result.value.valid)
  } else {
    console.log('Error:', result.error)
  }
})
"
```
**Expected**: Multiple gates passed, `Valid: true`

### Verify Schema Validation Gate Rejects Invalid

```bash
npx tsx -e "
const { SixGateValidator } = require('./dist/validation/sixGates')
const validator = new SixGateValidator()
validator.validate(
  'const x = 1',  // No export
  { existingImports: [], existingTypes: [] }
).then(result => {
  if (result.ok) {
    console.log(result.value.valid ? 'FAIL: Should have rejected' : 'PASS: Correctly rejected')
  }
})
"
```
**Expected**: `PASS: Correctly rejected`

---

## Authorization Router Verification

### Verify Authorization Router Exists

```bash
find /home/motherlabs/motherlabs-runtime/src -name "*router*" -o -name "*authorization*"
```
**Expected**: `src/authorization/router.ts` (Authorization Router component)

### Verify Deny-by-Default Enforcement

```bash
npx tsx -e "
const { AuthorizationRouter } = require('./dist/authorization/router')
const { JSONLLedger } = require('./dist/persistence/jsonlLedger')
const ledger = new JSONLLedger('/tmp/test-router.jsonl')
const router = new AuthorizationRouter(ledger)
const result = router.requestAuthorization('nonexistent-target', 'change_application', [])
console.log(!result.ok ? 'PASS: Deny-by-default enforced' : 'FAIL: Should have denied')
if (!result.ok) console.log('Error:', result.error.message.slice(0, 80) + '...')
"
```
**Expected**: `PASS: Deny-by-default enforced`

### Verify Applier Requires Authorization Token

```bash
npx tsx tests/authorization-router.test.ts 2>&1 | tail -5
```
**Expected**: `SUMMARY: 26 passed, 0 failed`

### Verify Token Replay Determinism

```bash
npx tsx -e "
const { AuthorizationRouter } = require('./dist/authorization/router')
const { JSONLLedger } = require('./dist/persistence/jsonlLedger')
const { contentAddress } = require('./dist/core/contentAddress')
const { createGateDecision, createGateDecisionScope } = require('./dist/core/gateDecision')
const { EFFECT_SETS } = require('./dist/core/effects')

async function test() {
  const ledger = new JSONLLedger('/tmp/determinism-test.jsonl')
  const router = new AuthorizationRouter(ledger)
  const proposal = { id: 'det-test', targetFile: 'test.ts', issue: { type: 'test', severity: 'low', description: 'test' }, proposedChange: { type: 'add_function', code: 'x', diff: '+x' }, rationale: 'test', source: 'test' }
  const proposalId = contentAddress(proposal)
  const allow = createGateDecision('change_application', 'ALLOW', createGateDecisionScope('proposal', proposal, 'test.ts', EFFECT_SETS.CODE_APPLICATION), 'test', 'test')
  await ledger.appendGateDecision(allow)
  const t1 = router.requestAuthorization(proposalId, 'change_application', EFFECT_SETS.CODE_APPLICATION)
  const t2 = router.requestAuthorization(proposalId, 'change_application', EFFECT_SETS.CODE_APPLICATION)
  console.log(t1.value.token_id === t2.value.token_id ? 'PASS: Replay determinism' : 'FAIL: Tokens differ')
  require('fs').unlinkSync('/tmp/determinism-test.jsonl')
}
test()
"
```
**Expected**: `PASS: Replay determinism`

### Verify Token Time Invariance

```bash
npx tsx -e "
const { AuthorizationRouter } = require('./dist/authorization/router')
const { JSONLLedger } = require('./dist/persistence/jsonlLedger')
const { contentAddress } = require('./dist/core/contentAddress')
const { createGateDecision, createGateDecisionScope } = require('./dist/core/gateDecision')
const { EFFECT_SETS } = require('./dist/core/effects')

async function test() {
  const ledger = new JSONLLedger('/tmp/time-test.jsonl')
  const router = new AuthorizationRouter(ledger)
  const proposal = { id: 'time-test', targetFile: 'test.ts', issue: { type: 'test', severity: 'low', description: 'test' }, proposedChange: { type: 'add_function', code: 'x', diff: '+x' }, rationale: 'test', source: 'test' }
  const proposalId = contentAddress(proposal)
  const allow = createGateDecision('change_application', 'ALLOW', createGateDecisionScope('proposal', proposal, 'test.ts', EFFECT_SETS.CODE_APPLICATION), 'test', 'test')
  await ledger.appendGateDecision(allow)
  const token = router.requestAuthorization(proposalId, 'change_application', EFFECT_SETS.CODE_APPLICATION)
  const v1 = router.verifyToken(token.value)
  await new Promise(r => setTimeout(r, 100))
  const v2 = router.verifyToken(token.value)
  console.log(v1.ok && v2.ok ? 'PASS: Time invariance (no expiry)' : 'FAIL: Verification changed')
  console.log('Token has expires_at:', 'expires_at' in token.value)
  require('fs').unlinkSync('/tmp/time-test.jsonl')
}
test()
"
```
**Expected**: `PASS: Time invariance (no expiry)`, `Token has expires_at: false`

---

## Schema Registry Verification

### Verify Schema Registry Exists

```bash
find /home/motherlabs/motherlabs-runtime/src -name "*registry*" -path "*/schema/*"
```
**Expected**: `src/schema/registry.ts` (Schema Registry component)

### Verify Deny-by-Default Schema Enforcement

```bash
npx tsx -e "
const { JSONLLedger } = require('./dist/persistence/jsonlLedger')
const ledger = new JSONLLedger('/tmp/schema-test.jsonl')
const result = await ledger.append('UNKNOWN_SCHEMA', { data: 'test' })
console.log(!result.ok ? 'PASS: Unknown schema rejected' : 'FAIL: Should have rejected')
if (!result.ok) console.log('Error:', result.error.message.slice(0, 60) + '...')
"
```
**Expected**: `PASS: Unknown schema rejected`

### Verify Schema Registry Determinism

```bash
npx tsx -e "
const { SchemaRegistry } = require('./dist/schema/registry')
const r1 = new SchemaRegistry()
const r2 = new SchemaRegistry()
const s1 = r1.resolve('GATE_DECISION', '1.0.0')
const s2 = r2.resolve('GATE_DECISION', '1.0.0')
console.log(s1.ok && s2.ok && s1.value.schema_id === s2.value.schema_id ? 'PASS: Deterministic' : 'FAIL')
console.log('Registered schemas:', r1.count())
"
```
**Expected**: `PASS: Deterministic`, schema count > 0

### Run Schema Registry Tests

```bash
npx tsx tests/schema-registry.test.ts 2>&1 | tail -5
```
**Expected**: `SUMMARY: 40 passed, 0 failed`

---

## Baseline Spec Violation Detection

### Check for Intent Type (should not exist)

```bash
grep -r "type Intent" /home/motherlabs/motherlabs-runtime/src/
```
**Expected**: No results (violation of Intent → Attempt → Outcome model)

---

## Effect Verification

### Check Effect Bounds Function Exists

```bash
npx tsx -e "
const { checkEffectBounds } = require('./dist/core/effects')
const result = checkEffectBounds(['FS_READ_SANDBOX'], ['FS_WRITE_SANDBOX'])
console.log(result.valid ? 'FAIL: Should detect violation' : 'PASS: Violation detected')
console.log('Violations:', result.violations)
"
```
**Expected**: `PASS: Violation detected`, `Violations: [ 'FS_WRITE_SANDBOX' ]`

### Note: Runtime Effect Enforcement

**There is no command to verify runtime effect enforcement because it does not exist.**

Effects are declared and checked but not enforced at syscall level.

---

## TCB Protection Verification

### Check TCB Path Detection

```bash
npx tsx -e "
const { isTCBPath, getTCBClassification } = require('./dist/core/tcbBoundary')
const paths = [
  'src/validation/sixGates.ts',
  'src/core/contentAddress.ts',
  'src/authorization/router.ts',
  'src/dogfood/loop.ts'  // Not TCB
]
for (const p of paths) {
  console.log(p, '->', isTCBPath(p) ? 'TCB (' + getTCBClassification(p) + ')' : 'not TCB')
}
"
```
**Expected**: sixGates.ts, contentAddress.ts, router.ts are TCB (authority), loop.ts is not TCB

### Verify TCB Boundary Runtime Immutability

```bash
npx tsx -e "
const { TCB_AUTHORITY_PATHS, isTCBPath, getTCBClassification } = require('./dist/core/tcbBoundary')

console.log('BEFORE:', isTCBPath('src/malicious/evil.ts'), getTCBClassification('src/malicious/evil.ts'))
let threw = false
try {
  TCB_AUTHORITY_PATHS.push('src/malicious/')
} catch (e) {
  threw = true
  console.log('MUTATION BLOCKED:', e.message.slice(0, 50))
}
console.log('AFTER:', isTCBPath('src/malicious/evil.ts'), getTCBClassification('src/malicious/evil.ts'))
console.log('Arrays frozen:', Object.isFrozen(TCB_AUTHORITY_PATHS))
console.log(threw ? 'PASS: Runtime mutation blocked' : 'FAIL: Mutation succeeded')
"
```
**Expected**: `PASS: Runtime mutation blocked`, `Arrays frozen: true`

### Run TCB Boundary Tests

```bash
npx tsx tests/tcb-boundary.test.ts 2>&1 | tail -10
```
**Expected**: `SUMMARY: 95 passed, 0 failed`

---

## Full Test Suite

### Run All Tests (may take time)

```bash
npm test
```
**Expected**: Most tests pass

### Run Specific Test Files

```bash
# Core tests
npx tsx tests/proof-artifact.test.ts 2>&1 | grep -E "PASS|FAIL|SUMMARY"

# Safe I/O tests
npx tsx tests/safe-io.test.ts 2>&1 | grep -E "PASS|FAIL|SUMMARY"

# Governance tests
npx tsx tests/governance-integration.test.ts 2>&1 | grep -E "PASS|FAIL|SUMMARY"
```

---

## Invariant Verification Summary

| Invariant | Verification Command | Current Status |
|-----------|---------------------|----------------|
| Hash chain integrity | See "Verify Ledger Hash Chain" | SHOULD PASS |
| Timestamp segregation | See "Verify Timestamp Rejection" | SHOULD PASS |
| Deterministic hashing | See "Verify Deterministic Hashing" | SHOULD PASS |
| Path escape detection | See "Verify Path Escape Detection" | SHOULD PASS |
| Proof tamper detection | See "Verify Tamper Detection" | SHOULD PASS |
| Gate execution | See "Verify Gate Execution" | SHOULD PASS |
| Authorization Router | See "Verify Authorization Router Exists" | IMPLEMENTED |
| Deny-by-default (auth) | See "Verify Deny-by-Default Enforcement" | IMPLEMENTED |
| Token replay determinism | See "Verify Token Replay Determinism" | IMPLEMENTED |
| Token time invariance | See "Verify Token Time Invariance" | IMPLEMENTED |
| Schema Registry | See "Verify Schema Registry Exists" | IMPLEMENTED |
| Deny-by-default (schema) | See "Verify Deny-by-Default Schema Enforcement" | IMPLEMENTED |
| TCB boundary static | See "Verify TCB Boundary Runtime Immutability" | IMPLEMENTED |
| Effect enforcement | N/A | VIOLATION (not implemented) |

---

## Note on Missing Verifications

The following baseline spec requirements **cannot be verified** because the components do not exist:

1. ~~Authorization Router enforcement - component missing~~ **IMPLEMENTED**
2. ~~Schema Registry validation - component missing~~ **IMPLEMENTED**
3. Process isolation - single process
4. Effect runtime enforcement - no seccomp/landlock
5. Cryptographic approval signatures - not implemented

**UPDATE 1**: Authorization Router with deny-by-default enforcement has been implemented.
- `src/authorization/router.ts` - Authorization Router component
- `AutoApplier.apply()` now requires `AuthorizationToken` parameter
- Token can only be obtained with prior ALLOW decision in ledger
- Tests verify: direct calls fail, missing ALLOW fails, proper flow succeeds

**UPDATE 2**: Schema Registry with deny-by-default enforcement has been implemented.
- `src/schema/registry.ts` - Schema Registry component (deterministic, hardcoded)
- `JSONLLedger.append()` validates schema before any ledger write
- Unknown schema_id = DENY (fail-closed)
- Missing required fields = DENY
- Tests verify: unknown schema rejected, known schema succeeds, determinism

**UPDATE 3**: Determinism Hardening + TCB Boundary Formalization
- **Authorization Token Determinism**: Removed all time dependencies from token system
  - `src/authorization/router.ts` - Removed `globalTimeProvider`, `tokenValidityMs`
  - Token ID computed from authorization truth only (no time in content address)
  - `issued_at_metadata` is optional metadata, not part of token_id
  - No time-based expiry - ledger is sole source of authorization truth
  - Tests verify: replay determinism (same ledger → identical token_id), time invariance
- **TCB Boundary Formalization**: Created authoritative TCB membership source
  - `src/core/tcbBoundary.ts` - Single source of truth for TCB paths
  - All path arrays wrapped with `Object.freeze()` for runtime immutability
  - `src/core/decisionClassifier.ts` - Updated to use tcbBoundary.ts (no duplicate definitions)
  - Tests verify: runtime mutation throws TypeError, classification is deterministic
- **AXIOM**: Time is adversarial. Authorization truth comes from ledger only.

Remaining missing verifications correspond to CRITICAL violations in [05-GAPS-AND-FAILURES.md](./05-GAPS-AND-FAILURES.md).
