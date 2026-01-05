# Verifier Report: v0.2.1

## Verifier Information

- **Name/Handle**: [your name or pseudonym]
- **Verifier Kind**: internal
- **Date (UTC)**: [YYYY-MM-DD]
- **Report Version**: 1

> **Verifier Kind guidance:**
> - Use `internal` for single-operator self-verification (default)
> - Use `independent` ONLY if you are a truly third-party verifier with no relationship to the maintainer

## Environment

### System

- **OS**: [e.g., Ubuntu 22.04.3 LTS]
- **Architecture**: [e.g., x86_64]
- **Kernel**: [e.g., Linux 6.5.0-14-generic]

### Runtime

- **Node Version**: [output of `node --version`]
- **npm Version**: [output of `npm --version`]

## Source Verification

### Archive Hash

```
Source archive: source.tar.gz
Expected SHA256: d6f5a30c7067291ec4153eb1140b8204fc203c3fe52a666df0ce15596a086ac4
Actual SHA256:   [your computed hash]
Match: [YES/NO]
```

### Git Tag

```
Tag: v0.2.1
Commit: [git rev-parse v0.2.1 output]
Expected: a55e3f9f9c4cbd32b8bd48ea1cbf342ab451b762
Match: [YES/NO]
```

## Build Verification

### npm ci

```
Exit code: [0/non-zero]
Warnings: [count or "none"]
Errors: [count or "none"]
```

### npm run build

```
Exit code: [0/non-zero]
Output: [PASS/FAIL]
```

### npm run lint:banned

```
Exit code: [0/non-zero]
Result: [PASSED: No violations found / FAILED: X violations]
```

## Test Results

### npm test

```
Total tests: [count]
Passed: [count]
Failed: [count]
Skipped: [count]
```

Expected (v0.2.1): 193 tests, 193 pass, 0 fail

### Test Output Hash

```
Command: npm test 2>&1 | sha256sum
Hash: [your hash]
```

## Golden Suite Results

### npm run golden

```
Passed: [count]
Failed: [count]
Changed: [count]
New: [count]
```

Expected (v0.2.1): 10 passed, 0 failed, 0 changed, 0 new

### Golden Hash Verification

| Intent ID | Expected Hash (truncated) | Actual Hash (truncated) | Match |
|-----------|---------------------------|-------------------------|-------|
| intent_001_api_spec | `04d8c18fbb24effb...` | `[your hash]` | [YES/NO] |
| intent_002_data_model | `b8cc2cb7c82960fa...` | `[your hash]` | [YES/NO] |
| intent_003_add_validation | `3083388bf9cb9c25...` | `[your hash]` | [YES/NO] |
| intent_004_error_handling | `41a82c6f7169cf07...` | `[your hash]` | [YES/NO] |
| intent_005_cli_tool | `75b497552bd30353...` | `[your hash]` | [YES/NO] |
| intent_006_test_fixtures | `c32c9fe331bb1b7c...` | `[your hash]` | [YES/NO] |
| intent_007_deploy_staging | `a55471dd9936e3b6...` | `[your hash]` | [YES/NO] |
| intent_008_verify_determinism | `1bd2712bc2a3ec0f...` | `[your hash]` | [YES/NO] |
| intent_009_empty_goal | `null` (REFUSE) | `[null/hash]` | [YES/NO] |
| intent_010_contradictory | `6afdd273897f0204...` | `[your hash]` | [YES/NO] |

## Determinism Check

### Consecutive Run Comparison

```
Run 1 golden hash for intent_003: [hash]
Run 2 golden hash for intent_003: [hash]
Identical: [YES/NO]
```

## Freeze Manifest Verification

### File Hash Check

```
Command: sha256sum -c artifacts/freeze/v0.2.1/file_sha256.txt 2>&1 | grep -c "OK"
Files OK: [count]
Files FAILED: [count]
Total: [count]
```

Expected: All files OK

## Summary

### Overall Result: [PASS / FAIL / PARTIAL]

### Issues Found

[List any issues, mismatches, or anomalies. If none, write "None"]

1. [Issue description]
2. [Issue description]

### Notes

[Any additional observations, such as timing differences, warnings, etc.]

## Attestation

I verify that:

- [ ] I ran all verification steps myself
- [ ] I used a clean environment (fresh clone, `npm ci`)
- [ ] I used the exact Node version (24.11.1)
- [ ] All results reported above are accurate

Signed: [your name/handle]
Date: [YYYY-MM-DD]

---

*Report format version: 1.0*
*Generated for: context-engine-kernel v0.2.1*
