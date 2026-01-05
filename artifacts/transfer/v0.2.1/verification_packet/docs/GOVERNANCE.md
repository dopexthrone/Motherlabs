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
