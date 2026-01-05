# Verification Index

Single source of truth for release verification status.

## Releases

### v0.3.0

| Item | Value |
|------|-------|
| Commit | `faecc2582af025b32fa6d09f1689ee3f5a6f8916` |
| Tag date | 2026-01-05 |
| Reference run | `v0.3.0/reference_linux/` |
| Independent verifiers | 0 |
| Verified | NO (pending external verification) |

**Reference run (linux x64, Node v24.11.1):**
- Tests: 221 pass, 0 fail
- Goldens: 10/10 unchanged
- Logs: `v0.3.0/reference_linux/npm_test.log`, `npm_golden.log`

**External verification reports:**
- None yet

---

### v0.2.1

| Item | Value |
|------|-------|
| Commit | `a55e3f9f9c4cbd32b8bd48ea1cbf342ab451b762` |
| Tag date | 2026-01-04 |
| Reference run | `v0.2.1/README.txt` |
| Reference Tag | `v0.2.1-reference-20260105` |
| Independent verifiers | 0 |
| Internal verifiers | 1 |
| Verified | NO (pending external verification) |

**Transfer bundle ready:** `artifacts/transfer/v0.2.1/`

**External verification reports:**
| Date | Verifier | Release | Result | Kind | OS | Node | npm | Path |
|------|----------|---------|--------|------|-----|------|-----|------|
| 20260105 | internal_me | v0.2.1 | PASS | internal | Ubuntu 24.04.3 LTS | v24.11.1 | 11.6.2 | v0.2.1/verified/20260105_internal_me/ |

---

## Verification Process

1. Send `artifacts/transfer/<version>/` to independent verifier
2. Verifier follows `verification_packet/README_VERIFY.txt`
3. Verifier returns filled `docs/VERIFIER_REPORT.template.md`
4. Store report at `artifacts/verifier_reports/<version>/<verifier_name_or_date>/`
5. Update this INDEX.md with verifier count and verdict

## Verified Tag Convention

After at least 1 independent verifier returns a passing report:
- Create annotated tag: `v<version>-verified-<YYYYMMDD>`
- Tag points to same commit as release tag (no new commit)
