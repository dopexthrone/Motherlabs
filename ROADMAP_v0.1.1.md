# Motherlabs Kernel v0.1.1 Roadmap

## What this release contains

v0.1.1 is the first **governed release** of the context-engine-kernel.

### Changes from v0.1.0
- Runtime pinned to Node 24.11.1 (matches freeze manifest baseline)
- CI matrix enforcing determinism on ubuntu + macos
- GOVERNANCE.md establishing version policy and release gates

### Release gates passed
1. `npm ci && npm run build && npm test` (52 tests)
2. Determinism: golden hashes verified cross-platform
3. Banned API checks pass
4. Freeze manifest locked at v0.1.0

## What comes next

### v0.2.0 (planned)
- Executor protocol integration tests
- Evidence validation hardening
- Schema migration tooling

### v0.3.0 (planned)
- Multi-bundle orchestration
- Dependency graph resolution
- Parallel decomposition

## Governance
All releases follow GOVERNANCE.md. Breaking changes require:
1. Justification
2. Updated golden hashes
3. Version bump
4. Migration notes
