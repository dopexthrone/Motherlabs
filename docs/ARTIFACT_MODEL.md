# ARTIFACT MODEL
## Motherlabs Artifact Classification v1.0

---

## 1. Core Principle

**Everything is an artifact. Nothing is exempt.**

Motherlabs governs artifacts.
Artifacts do not govern Motherlabs.

---

## 2. Canonical Artifact Classes

### 2.1 Kernel Artifacts (TCB - Trusted Computing Base)

| Artifact | Location | Purpose |
|----------|----------|---------|
| Authority Logic | `src/validation/sixGates.ts` | 6-gate validation system |
| Gate Definitions | `src/validation/*.ts` | Individual gate implementations |
| Execution Semantics | `src/sandbox/runner.ts` | Kernel-grade sandbox |
| Ledger Rules | `src/persistence/jsonlLedger.ts` | Immutable evidence storage |
| Result Types | `src/core/result.ts` | Ok/Err deterministic returns |
| Content Addressing | `src/core/contentAddress.ts` | SHA-256 based identity |

### 2.2 Host Artifacts

| Artifact | Purpose |
|----------|---------|
| Execution Environments | MOTHER PC, local machines |
| OS-level Sandboxing | Process isolation |
| Hardware Accelerators | GPU/NPU for local LLM inference |

**Hosts provide capability; they do not confer authority.**

### 2.3 Project Artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| Applications | `src/cli.ts` | User-facing entry points |
| Architectures | `src/execution/engine.ts` | Execution orchestration |
| Codebases | `src/**/*.ts` | Implementation |
| Documentation | `docs/**/*.md` | Constitutional and operational docs |

**Projects are downstream and non-privileged.**

### 2.4 Proposal Artifacts

| Type | Purpose | Enforced By |
|------|---------|-------------|
| PlanProposal | Describe intended changes | `src/urco/types.ts` |
| PatchProposal | Code modifications | `src/selfbuild/proposer.ts` |
| DocProposal | Documentation changes | Manual review |

**Proposals describe intent and candidate changes only.**

### 2.5 Evidence Artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| Gate Outputs | `evidence/*.jsonl` | Validation results |
| Execution Transcripts | `.sandbox/runs/*/` | Sandbox evidence bundles |
| Hashes | SHA-256 in all evidence | Integrity verification |
| State Transitions | Ledger entries | Change history |

**Evidence is append-only and mandatory.**

### 2.6 Policy & Capability Artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| Capability Manifests | `src/sandbox/types.ts` | FS_READ, FS_WRITE, NET |
| Allowlists | `TestExecRequest.env_allowlist` | Environment variable filtering |
| Budget Constraints | `time_limit_ms` | Resource bounds |

**Capabilities exist only where explicitly declared.**

---

## 3. Artifact Admission Rule

An artifact is legitimate **only if**:

1. It is **typed** (has a declared schema/structure)
2. It **passes gates** (all required gates return PASS)
3. **Evidence is recorded** (gate results + execution evidence logged)

**No unnamed or untyped artifacts may persist.**

---

## 4. Implementation References

```
Kernel TCB Paths:
  src/validation/      # Gate implementations
  src/sandbox/         # Execution isolation
  src/persistence/     # Evidence storage
  src/core/            # Fundamental types

Evidence Paths:
  evidence/            # JSONL ledger files
  .sandbox/runs/       # Execution evidence bundles

Schema Paths:
  schemas/             # JSON Schema definitions
```

---

*If it isn't an artifact, it doesn't exist in Motherlabs.*
