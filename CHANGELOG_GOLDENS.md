# Golden Hash Changelog

This file tracks all intentional changes to golden hashes. Every time a golden hash changes, it MUST be documented here with:

1. **Old hash** and **new hash**
2. **Version** that introduced the change
3. **Reason** for the change
4. **Which invariant** was affected (if any)

## Format

```markdown
## [VERSION] - YYYY-MM-DD

### Changed
- **intent_id**: `old_hash` -> `new_hash`
  - Reason: <why the hash changed>
  - Invariant: <which invariant was affected, or "none">

### Added
- **intent_id**: `new_hash` (first recording)
```

---

## [0.2.1] - 2026-01-05

### Added

Initial golden suite with 10 real intents:

- **intent_001_api_spec**: `sha256:04d8c18fbb24effb...` (CLARIFY)
  - Blueprint: REST API specification for transform endpoint
- **intent_002_data_model**: `sha256:b8cc2cb7c82960fa...` (CLARIFY)
  - Blueprint: TypeScript data model for validation pipeline
- **intent_003_add_validation**: `sha256:3083388bf9cb9c25...` (BUNDLE, accepted)
  - Patch: Add input validation to intent parser
- **intent_004_error_handling**: `sha256:41a82c6f7169cf07...` (BUNDLE, accepted)
  - Patch: Refactor to centralized error class hierarchy
- **intent_005_cli_tool**: `sha256:75b497552bd30353...` (BUNDLE, accepted)
  - Scaffold: CLI tool structure for processing intents
- **intent_006_test_fixtures**: `sha256:c32c9fe331bb1b7c...` (BUNDLE, accepted)
  - Scaffold: Test fixture generator for intent test cases
- **intent_007_deploy_staging**: `sha256:a55471dd9936e3b6...` (BUNDLE, accepted)
  - Runbook: Deployment runbook for staging environment
- **intent_008_verify_determinism**: `sha256:1bd2712bc2a3ec0f...` (CLARIFY)
  - Runbook: Verification runbook for kernel determinism
- **intent_009_empty_goal**: `null` (REFUSE)
  - Edge case: Empty goal correctly refused
- **intent_010_contradictory**: `sha256:6afdd273897f0204...` (CLARIFY)
  - Edge case: Contradictory constraints handled gracefully

---

## Policy

1. **Never** change a golden hash without documenting here first
2. **Always** run `npm run golden` before and after kernel changes
3. If a hash changes unexpectedly, investigate before updating
4. Breaking changes require a version bump (v0.x.0, not v0.x.y)
