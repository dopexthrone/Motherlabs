# Release Verification Recipe

This document provides exact steps to verify a release of the Context Engine Kernel.

## Related Specifications

- **[BUNDLE_SPEC.md](./BUNDLE_SPEC.md)** - Authoritative bundle output contract
- **[EVIDENCE_SPEC.md](./EVIDENCE_SPEC.md)** - Execution evidence contract (EvidenceCore, hashing)
- **[LEDGER_SPEC.md](./LEDGER_SPEC.md)** - Append-only ledger contract (JSONL format)
- **[PACK_SPEC.md](./PACK_SPEC.md)** - Run export pack contract (PK1-PK12 invariants, external handoff)
- **[MODEL_IO_SPEC.md](./MODEL_IO_SPEC.md)** - Model IO recording session contract (MI1-MI12 invariants)
- **[PATCH_SPEC.md](./PATCH_SPEC.md)** - Patch/proposal contract (PS1-PS10 invariants, pre-exec validation)
- **[POLICY_SPEC.md](./POLICY_SPEC.md)** - Policy profiles and enforcement (PL1-PL7 invariants)
- **[RUN_SPEC.md](./RUN_SPEC.md)** - Run result contract (RS1-RS8 invariants, canonical output)

**Internal Contracts (non-artifact):**
- **[PROPOSAL_INTERNAL_SPEC.md](./PROPOSAL_INTERNAL_SPEC.md)** - Internal Proposal type contract (PR1-PR12 invariants, no external artifact)
- **[VERIFICATION_POLICY.md](./VERIFICATION_POLICY.md)** - L0/L1 verification milestone definitions

## Prerequisites

- Node.js 24.11.1 (exact version required for determinism)
- Git
- Unix-like environment (Linux or macOS)

### Verify Node Version

```bash
node --version
# Expected: v24.11.1
```

If you have a different version, use nvm or another version manager:

```bash
nvm install 24.11.1
nvm use 24.11.1
```

## Verification Steps

### 1. Checkout the Release Tag

```bash
git clone https://github.com/motherlabs/context-engine-kernel.git
cd context-engine-kernel
git checkout v0.2.1  # Current governed release
```

### 2. Clean Install Dependencies

```bash
rm -rf node_modules
npm ci
```

### 3. Build from Source

```bash
npm run build
```

Expected output: No errors.

### 4. Run Banned API Check

```bash
npm run lint:banned
```

Expected output:
```
=== Summary ===
PASSED: No violations found
```

### 5. Run Full Test Suite

```bash
npm test
```

Expected output (v0.2.1):
```
ℹ tests 193
ℹ pass 193
ℹ fail 0
```

### 6. Run Golden Suite

```bash
npm run golden
```

Expected output:
```
Summary: 10 passed, 0 failed, 0 changed, 0 new
```

### 7. Verify Golden Hashes

The golden hashes should match exactly. Check `artifacts/goldens/goldens.json`:

```bash
cat artifacts/goldens/goldens.json | head -20
```

Key hashes to verify (v0.2.1):
- `intent_003_add_validation`: `sha256:3083388bf9cb9c25d67dc11432206fd4569cf8137210d38baa79ebb62a46e67a`
- `intent_005_cli_tool`: `sha256:75b497552bd303530b7a1a9c6a4bb09e596aadc10faacb61b5eed2a8f0d3de26`

### 8. Test Determinism Across Runs

Run the test suite twice and compare:

```bash
npm test > test_run_1.txt 2>&1
npm test > test_run_2.txt 2>&1
diff test_run_1.txt test_run_2.txt
```

Expected: Only timing differences, no test result differences.

### 9. Dogfood a Sample Intent

```bash
npm run dogfood -- intents/real/a_blueprints/intent_001_api_spec.json --mode plan-only
```

Expected output includes:
- `Result Kind: CLARIFY` or `BUNDLE`
- `Bundle SHA256:` (deterministic hash)
- `Outputs written to:` path

## Cross-Platform Verification

For full verification, run on both:

1. **Linux** (Ubuntu 22.04+)
2. **macOS** (13.0+)

The following should be identical across platforms:
- All golden hashes
- Test counts and pass/fail
- Bundle hashes for same intents

## Troubleshooting

### Wrong Node Version

```
Error: Expected Node 24.11.1
```

Fix: Use nvm to install the correct version.

### Golden Hash Mismatch

```
Status: CHANGED
Hash changed: old_hash -> new_hash
```

This indicates a non-determinism bug. Report to maintainers with:
- Node version
- OS and version
- Full test output

### Tests Fail

Run with verbose output:

```bash
npm test -- --reporter=verbose
```

Report the specific failing test and error message.

## Version History

| Version | Tests | Goldens | Notes |
|---------|-------|---------|-------|
| v0.1.0  | 52    | 3       | Baseline |
| v0.1.1  | 52    | 3       | Node 24.11.1 pin |
| v0.1.2  | 170   | 3       | Property tests |
| v0.2.0  | 184   | 3       | Harness + sandbox |
| v0.2.1  | 193   | 10      | Security + golden suite |
| v0.3.6  | 506   | 10      | RUN_SPEC.md + canonical CLI output |
| v0.3.7  | 552   | 10      | PATCH_SPEC.md + patch verifier |
| v0.3.8  | 595   | 10      | Governance: re-scope proposal spec as internal (no external artifact) |
| v0.3.9  | 645   | 10      | PACK_SPEC.md + pack verifier (PK1-PK12 invariants) |
| v0.3.10 | TBD   | 10      | MODEL_IO_SPEC.md + model IO verifier (MI1-MI12 invariants) |

## Contact

For verification issues, open an issue at:
https://github.com/motherlabs/context-engine-kernel/issues
