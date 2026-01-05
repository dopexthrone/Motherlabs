# Verification Policy

This document defines the governance rules for verification milestones.

## Overview

This project uses a two-level verification system to handle the reality of single-operator development while maintaining clear governance for external verification if/when it becomes available.

## Verification Levels

### L0: Reference Verification (Internal)

- **Verifier Kind**: `internal`
- **Purpose**: Single-operator self-verification
- **Tag Format**: `<release>-reference-<YYYYMMDD>`
- **Requirements**: At least 1 internal verified report with PASS result
- **Use Case**: When the maintainer verifies their own release
- **Tool**: `npm run tag-reference`

### L1: Independent Verification (Third-Party)

- **Verifier Kind**: `independent`
- **Purpose**: External verification by unrelated parties
- **Tag Format**: `<release>-verified-<YYYYMMDD>`
- **Requirements**: At least 1 independent verified report with PASS result
- **Use Case**: When external verifiers confirm the release
- **Tool**: `npm run tag-verified`

**Key Rule**: `verified` tags are ONLY created when `verifier_kind=independent` reports exist. Internal reports cannot mint verified tags.

## Definitions

### Verifier Kind

Each verifier report MUST include a `verifier_kind` field:

- `internal`: Used by the project maintainer or operator (default)
- `independent`: Used ONLY by truly third-party verifiers with no relationship to the maintainer

### Reference Milestone

- Applies to all governed releases
- Indicates the maintainer has verified their own release
- Recorded via annotated git tag pointing to the original release commit
- Does NOT represent external validation

### Verified Milestone

- Applies to governed releases with external verification
- Indicates that independent parties have confirmed determinism and correctness
- Recorded via annotated git tag pointing to the original release commit
- Represents true third-party validation

### Baseline Release

- v0.2.1 is the first release eligible for verification
- Contains kernel + harness without model adapter boundary
- v0.3.0 (adapter boundary) is optional for external audit

## Threshold Rules

### For Reference Tags (L0)

- **Minimum: 1 internal verifier report**
- Only `verifier_kind=internal` reports count

### For Verified Tags (L1)

- **Minimum: 1 independent verifier report**
- Only `verifier_kind=independent` reports count
- Configurable via CLI: `--threshold <n>` where n >= 1
- Internal reports are explicitly ignored

### Counting Rules

Eligible reports are counted from:
```
artifacts/verifier_reports/<release>/verified/
```

A report counts toward the threshold if and only if:

1. **Folder exists** with naming convention `YYYYMMDD_verifier_id`
2. **VERIFIER_REPORT.md exists** in the folder
3. **Overall Result is PASS** (parsed from `### Overall Result: PASS`)
4. **Verifier Kind present** (from `**Verifier Kind**: internal|independent`)
5. **Required fields present:**
   - OS (from `**OS**: ...`)
   - Node version (from `**Node Version**: ...`)
   - npm version (from `**npm Version**: ...`)

### Deduplication

- Each `verifier_id` counts only once
- If multiple submissions exist from the same verifier, only one counts
- Submissions are processed in deterministic folder-name order

## Tag Rules

### Reference Tag Format (L0)

```
<release>-reference-<YYYYMMDD>
```

Example: `v0.2.1-reference-20260105`

### Verified Tag Format (L1)

```
<release>-verified-<YYYYMMDD>
```

Example: `v0.2.1-verified-20260105`

### Tag Requirements

1. **Must be annotated tag** (not lightweight)
2. **Must point to the release commit** (e.g., the commit that v0.2.1 points to)
3. **Must not be created without explicit date** (`--date YYYYMMDD` required)
4. **Must not duplicate** - refuse if tag already exists

### Tag Message Formats

Reference:
```
Reference verification by <n> internal report(s); see artifacts/verifier_reports/INDEX.md
```

Verified:
```
Verified by <n> independent report(s); see artifacts/verifier_reports/INDEX.md
```

## INDEX.md Update Rules

When a reference tag is created:

1. Add `Reference Tag` field to the release section in INDEX.md
2. Format: `| Reference Tag | <tag-name> |`
3. Must be idempotent: refuse if already set

When a verified tag is created:

1. Add `Verified Tag` field to the release section in INDEX.md
2. Format: `| Verified Tag | <tag-name> |`
3. Must be idempotent: refuse if already set
4. Must not create duplicate entries

## Tool Usage

### Create Reference Tag (L0 - Internal)

```bash
npm run tag-reference -- <release> --date <YYYYMMDD>
```

Example:
```bash
npm run tag-reference -- v0.2.1 --date 20260105
```

### Create Verified Tag (L1 - Independent)

```bash
npm run tag-verified -- <release> --threshold <n> --date <YYYYMMDD>
```

Example:
```bash
npm run tag-verified -- v0.2.1 --threshold 1 --date 20260105
```

### Dry Run (Preview)

```bash
npm run tag-reference -- v0.2.1 --date 20260105 --dry-run
npm run tag-verified -- v0.2.1 --threshold 1 --date 20260105 --dry-run
```

Outputs JSON with planned actions without creating tag or modifying files.

### Push Tags

After creating tags:
```bash
git push origin --tags
```

## Error Conditions

### Reference Tagging Errors

| Condition | Exit Code | Message Format |
|-----------|-----------|----------------|
| Threshold not met | 2 | `THRESHOLD_NOT_MET: need 1 internal verified report(s); have 0` |
| Tag already exists | 1 | `TAG_EXISTS: <tag> already exists` |
| Already recorded in INDEX | 1 | `ALREADY_RECORDED: Reference Tag already set for <release>` |

### Verified Tagging Errors

| Condition | Exit Code | Message Format |
|-----------|-----------|----------------|
| Threshold not met | 2 | `THRESHOLD_NOT_MET: need <n> independent verified report(s); have <m>` |
| Tag already exists | 1 | `TAG_EXISTS: <tag> already exists` |
| Already recorded in INDEX | 1 | `ALREADY_RECORDED: Verified Tag already set for <release>` |

### Common Errors

| Condition | Exit Code | Message Format |
|-----------|-----------|----------------|
| Invalid release format | 1 | `INVALID_RELEASE: expected vX.Y.Z format` |
| Missing --date | 1 | `MISSING_DATE: --date YYYYMMDD required (or use --dry-run)` |
| Invalid date format | 1 | `INVALID_DATE: expected YYYYMMDD format` |
| Release tag not found | 1 | `RELEASE_NOT_FOUND: git tag <release> does not exist` |
| Missing verifier_kind | 1 | `MISSING_FIELD: verifier_kind` |

## Governance Process

### Single-Operator Workflow (L0)

1. **Create internal verifier report** with `verifier_kind: internal`
2. **Ingest report** via `npm run ingest-verifier`
3. **Check threshold** via `npm run tag-reference -- <release> --dry-run`
4. **Create reference tag** when threshold met
5. **Push tags** to remote

### Third-Party Verification Workflow (L1)

1. **Receive external verifier report** with `verifier_kind: independent`
2. **Ingest report** via `npm run ingest-verifier`
3. **Check threshold** via `npm run tag-verified -- <release> --dry-run`
4. **Create verified tag** when threshold met
5. **Push tags** to remote
6. **Announce** verified milestone (optional)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2026-01-05 | Added L0/L1 verification levels, verifier_kind field, reference tags |
| 1.0 | 2026-01-05 | Initial policy |
