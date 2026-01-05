# Motherlabs Kernel Governance

## Authority boundary
- Kernel is authoritative only for: normalization, canonicalization, typing, validation, gating, evidence format, proposal format.
- Executors/builders are non-authoritative and must return evidence.

## Version policy
- Any behavior change that can alter bundle bytes or hashes requires a version bump.
- Schema changes require explicit migration notes and a version bump.
- Golden hash sets are version-scoped. A change that breaks a golden hash must:
  1) justify the break,
  2) update goldens,
  3) bump version.

## Release gates (must pass)
1) npm ci && npm run build && npm test
2) Determinism: golden hashes match on ubuntu + macos
3) Banned API checks pass
4) Freeze manifest generated for the release tag

## Release discipline

No new release tag unless ALL of the following are satisfied:
1) CI green on ubuntu + macos
2) Transfer + packet checksums verified locally (`sha256sum -c`)
3) Reference logs captured in `artifacts/verifier_reports/<version>/reference_<platform>/`
4) Goldens unchanged OR changelog entry exists in `CHANGELOG_GOLDENS.md`

After tagging:
- Generate transfer packet: `npm run release-packets -- <version>`
- Verify checksums immediately
- Update `artifacts/verifier_reports/INDEX.md` with release entry

External verification:
- Send `artifacts/transfer/<version>/` to independent verifier
- Require filled `docs/VERIFIER_REPORT.template.md` in return
- Store reports at `artifacts/verifier_reports/<version>/<verifier>/`
- Only after 1+ independent passing report: create `v<version>-verified-<YYYYMMDD>` tag
