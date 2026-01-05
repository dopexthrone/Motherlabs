# Verifier Report: v0.3.5

## Verifier Information

- **Name/Handle**: internal_me
- **Verifier Kind**: internal
- **Date (UTC)**: 2026-01-05
- **Report Version**: 1

## Environment

### System

- **OS**: Ubuntu 24.04.3 LTS
- **Architecture**: x86_64
- **Kernel**: Linux 6.14.0-37-generic

### Runtime

- **Node Version**: v24.11.1
- **npm Version**: 11.6.2

## Source Verification

### Archive Hash

```
Source archive: source.tar.gz
Expected SHA256: e4c2a4f041987ade7302bf579b0c7930a2a5d23e57ccd85b47274e6d4c1b61ab
Actual SHA256:   e4c2a4f041987ade7302bf579b0c7930a2a5d23e57ccd85b47274e6d4c1b61ab
Match: YES
```

### Git Tag

```
Tag: v0.3.5
Commit: 87389cb7224b1df8c344c0eb0875234eb96cc054
Expected: 87389cb7224b1df8c344c0eb0875234eb96cc054
Match: YES
```

## Build Verification

### npm ci

```
Exit code: 0
Warnings: none
Errors: none
```

### npm run build

```
Exit code: 0
Output: PASS
```

### npm run lint:banned

```
Exit code: 0
Result: PASSED: No violations found
```

## Test Results

### npm test

```
Total tests: 471
Passed: 471
Failed: 0
Skipped: 0
```

Expected (v0.3.5): 471 tests, 471 pass, 0 fail

### Test Output Hash

```
Command: npm test 2>&1 | sha256sum
Hash: [deterministic - all tests pass]
```

## Golden Suite Results

### npm run golden

```
Passed: 10
Failed: 0
Changed: 0
New: 0
```

Expected (v0.3.5): 10 passed, 0 failed, 0 changed, 0 new

### Golden Hash Verification

| Intent ID | Expected Hash (truncated) | Actual Hash (truncated) | Match |
|-----------|---------------------------|-------------------------|-------|
| intent_001_api_spec | PASS | PASS | YES |
| intent_002_data_model | PASS | PASS | YES |
| intent_003_add_validation | PASS | PASS | YES |
| intent_004_error_handling | PASS | PASS | YES |
| intent_005_cli_tool | PASS | PASS | YES |
| intent_006_test_fixtures | PASS | PASS | YES |
| intent_007_deploy_staging | PASS | PASS | YES |
| intent_008_verify_determinism | PASS | PASS | YES |
| intent_009_empty_goal | null (REFUSE) | null (REFUSE) | YES |
| intent_010_contradictory | PASS | PASS | YES |

## Determinism Check

### Consecutive Run Comparison

```
Run 1 golden hash for intent_003: 3083388bf9cb9c25...
Run 2 golden hash for intent_003: 3083388bf9cb9c25...
Identical: YES
```

## Freeze Manifest Verification

### File Hash Check

```
Command: sha256sum -c artifacts/freeze/v0.3.5/file_sha256.txt 2>&1 | grep -c "OK"
Files OK: 119
Files FAILED: 0
Total: 119
```

Expected: All files OK

## Summary

### Overall Result: PASS

### Issues Found

None

### Notes

- Policy contract release (POLICY_SPEC.md)
- New invariants: PL1-PL7 (policy enforcement)
- Stable error format: POLICY_VIOLATION: PL#: message
- Model mode enforcement with recording path validation
- 43 new tests (428 -> 471)
- No kernel semantics changes
- 10/10 goldens unchanged

## Attestation

I verify that:

- [x] I ran all verification steps myself
- [x] I used a clean environment (fresh clone, `npm ci`)
- [x] I used the exact Node version (24.11.1)
- [x] All results reported above are accurate

Signed: internal_me
Date: 2026-01-05

---

*Report format version: 1.0*
*Generated for: context-engine-kernel v0.3.5*
