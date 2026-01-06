# Verifier Report: v0.3.13

## Verifier Information

- **Name/Handle**: internal_me
- **Verifier Kind**: internal
- **Date (UTC)**: 2026-01-06
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
Expected SHA256: 682a3d8583ae3fa1ee80cc81255924aaba54df65d0d060082d9c0785db1c9b2f
Actual SHA256:   682a3d8583ae3fa1ee80cc81255924aaba54df65d0d060082d9c0785db1c9b2f
Match: YES
```

### Git Tag

```
Tag: v0.3.13
Commit: 464f61eaa8f279ab7005164c3158df87f48f6f1b
Expected: 464f61eaa8f279ab7005164c3158df87f48f6f1b
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
Total tests: 833
Passed: 833
Failed: 0
Skipped: 0
```

Expected (v0.3.13): 833 tests, 833 pass, 0 fail

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

Expected (v0.3.13): 10 passed, 0 failed, 0 changed, 0 new

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
Command: sha256sum -c artifacts/freeze/v0.3.13/file_sha256.txt 2>&1 | grep -c "OK"
Files OK: 202
Files FAILED: 0
Total: 202
```

Expected: All files OK

## Summary

### Overall Result: PASS

### Issues Found

None

### Notes

- GIT_APPLY_SPEC.md: normative spec for git apply result format (GA1-GA12 invariants)
- GitApplyResult schema with deterministic branch naming
- Engine: applyPackToGitRepo (src/harness/git_apply.ts)
- CLI tool: git-apply with canonical JSON output
- Git command allowlist: local-only (rev-parse, status, checkout, add, commit)
- Dry-run mode: generate report without writes or git state changes
- Branch naming: apply/{run_id} or apply/manual
- Content hashes (sha256:) for changed files
- 45 new tests (788 -> 833)
- No kernel semantics changes
- 10/10 goldens unchanged

## Attestation

I verify that:

- [x] I ran all verification steps myself
- [x] I used a clean environment (fresh clone, `npm ci`)
- [x] I used the exact Node version (24.11.1)
- [x] All results reported above are accurate

Signed: internal_me
Date: 2026-01-06

---

*Report format version: 1.0*
*Generated for: context-engine-kernel v0.3.13*
