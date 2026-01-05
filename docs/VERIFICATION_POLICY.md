# Verification Policy

This document defines the governance rules for marking a release as "Verified" through independent verification.

## Overview

A release achieves "Verified" status when enough independent verifiers have successfully reproduced the build and test results. This milestone is recorded as an annotated git tag and tracked in `artifacts/verifier_reports/INDEX.md`.

## Definitions

### Verified Milestone

- Applies to governed releases (e.g., v0.2.1, v0.3.0)
- Indicates that independent parties have confirmed determinism and correctness
- Recorded via annotated git tag pointing to the original release commit

### Baseline Release

- v0.2.1 is the first release eligible for external verification
- Contains kernel + harness without model adapter boundary
- v0.3.0 (adapter boundary) is optional for external audit

## Threshold Rules

### Default Threshold

- **Minimum: 1 independent verifier report**
- Configurable via CLI: `--threshold <n>` where n >= 1

### Counting Rules

Eligible reports are counted from:
```
artifacts/verifier_reports/<release>/verified/
```

A report counts toward the threshold if and only if:

1. **Folder exists** with naming convention `YYYYMMDD_verifier_id`
2. **VERIFIER_REPORT.md exists** in the folder
3. **Overall Result is PASS** (parsed from `### Overall Result: PASS`)
4. **Required fields present:**
   - OS (from `**OS**: ...`)
   - Node version (from `**Node Version**: ...`)
   - npm version (from `**npm Version**: ...`)

### Deduplication

- Each `verifier_id` counts only once
- If multiple submissions exist from the same verifier, only one counts
- Submissions are processed in deterministic folder-name order

## Tag Rules

### Tag Format

```
<release>-verified-<YYYYMMDD>
```

Example: `v0.2.1-verified-20260105`

### Tag Requirements

1. **Must be annotated tag** (not lightweight)
2. **Must point to the release commit** (e.g., the commit that v0.2.1 points to)
3. **Must not be created without explicit date** (`--date YYYYMMDD` required)
4. **Must not duplicate** - refuse if tag already exists

### Tag Message Format

```
Verified by <n> independent report(s); see artifacts/verifier_reports/INDEX.md
```

## INDEX.md Update Rules

When a verified tag is created:

1. Add `Verified Tag` field to the release section in INDEX.md
2. Format: `| Verified Tag | <tag-name> |`
3. Must be idempotent: refuse if already set
4. Must not create duplicate entries

## Tool Usage

### Create Verified Tag

```bash
npm run tag-verified -- <release> --threshold <n> --date <YYYYMMDD>
```

Example:
```bash
npm run tag-verified -- v0.2.1 --threshold 1 --date 20260105
```

### Dry Run (Preview)

```bash
npm run tag-verified -- v0.2.1 --threshold 1 --date 20260105 --dry-run
```

Outputs JSON with planned actions without creating tag or modifying files.

### Push Tags

After creating the verified tag:
```bash
git push origin --tags
```

## Error Conditions

| Condition | Exit Code | Message Format |
|-----------|-----------|----------------|
| Threshold not met | 2 | `THRESHOLD_NOT_MET: need <n> verified report(s); have <m>` |
| Tag already exists | 1 | `TAG_EXISTS: <tag> already exists` |
| Already recorded in INDEX | 1 | `ALREADY_RECORDED: Verified Tag already set for <release>` |
| Invalid release format | 1 | `INVALID_RELEASE: expected vX.Y.Z format` |
| Missing --date | 1 | `MISSING_DATE: --date YYYYMMDD required (or use --dry-run)` |
| Invalid date format | 1 | `INVALID_DATE: expected YYYYMMDD format` |
| Release tag not found | 1 | `RELEASE_NOT_FOUND: git tag <release> does not exist` |

## Governance Process

1. **Receive verifier report** via `npm run ingest-verifier`
2. **Check threshold** via `npm run tag-verified -- <release> --dry-run`
3. **Create verified tag** when threshold met
4. **Push tags** to remote
5. **Announce** verified milestone (optional)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-05 | Initial policy |
