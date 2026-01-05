# Verification Index

Single source of truth for release verification status.

## Releases

### v0.2.1

| Item | Value |
|------|-------|
| Commit | `a55e3f9f9c4cbd32b8bd48ea1cbf342ab451b762` |
| Tag date | 2026-01-04 |
| Reference run | `v0.2.1/README.txt` |
| Independent verifiers | 0 |
| Internal verifiers | 1 |
| Verified | NO (pending independent verification) |

**Transfer bundle ready:** `artifacts/transfer/v0.2.1/`

**External verification reports:**
| Date | Verifier | Release | Result | Kind | OS | Node | npm | Path |
|------|----------|---------|--------|------|-----|------|-----|------|
| 20260105 | internal_verifier | v0.2.1 | PASS | internal | Ubuntu 22.04.3 LTS | v24.11.1 | 10.2.0 | v0.2.1/verified/20260105_internal_verifier/ |

---

## Verification Process

1. Send `artifacts/transfer/<version>/` to independent verifier
2. Verifier follows `verification_packet/README_VERIFY.txt`
3. Verifier returns filled `docs/VERIFIER_REPORT.template.md`
4. Store report at `artifacts/verifier_reports/<version>/<verifier_name_or_date>/`
5. Update this INDEX.md with verifier count and verdict
