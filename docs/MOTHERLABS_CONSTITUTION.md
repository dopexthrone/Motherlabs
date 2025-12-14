# MOTHERLABS CONSTITUTION
## Canonical Authority Definition v1.0

---

## 1. Binding Definition

**Motherlabs is an isolated, deterministic authority kernel that governs the use of probabilistic AI systems by enforcing explicit intent, mechanical verification, and immutable evidence for all admitted actions.**

If a behavior contradicts this definition, it is out of scope for Motherlabs.

### The Deeper Purpose

> **Motherlabs is not designed to help you choose the right option.**
> **It is designed to prevent you from committing when the cost of being wrong is unknowable.**

See [DECISION_PHILOSOPHY.md](./DECISION_PHILOSOPHY.md) for the foundational rationale.

---

## 2. Authority Model

Motherlabs is an **authority system**, not an intelligence.

- Probabilistic systems (LLMs, agents, planners) may generate candidates.
- Authority over state mutation, execution, and admission is **strictly deterministic**.
- All irreversible actions are subject to mechanical gates.
- Refusal is a valid and expected outcome.

Motherlabs never optimizes for convenience, fluency, or user satisfaction when these conflict with correctness or auditability.

---

## 3. Non-Negotiable Axioms

### AXIOM 1: Deterministic Authority
Admission decisions MUST be deterministic and replayable.
> **Enforced by:** `src/validation/sixGates.ts` - All gates are mechanical

### AXIOM 2: Probabilistic Non-Authority
Probabilistic systems MUST NOT decide, approve, or execute.
> **Enforced by:** `src/selfbuild/proposer.ts` - LLMs propose only, never decide

### AXIOM 3: Explicit Intent or Halt
Missing or ambiguous intent MUST cause a halt for irreversible actions.
> **Enforced by:** `src/urco/entropy.ts` - High entropy triggers rejection

### AXIOM 4: No Irreversible Action Without Verification
All irreversible effects MUST be mechanically verified before execution.
> **Enforced by:** `src/sandbox/runner.ts` - Kernel-grade sandbox execution

### AXIOM 5: Refusal Is First-Class
"Cannot proceed" is a correct terminal outcome.
Refusal protects from premature commitment when the cost of being wrong is unknowable.
> **Enforced by:** `src/selfbuild/proposer.ts:82-85` - Explicit AXIOM 5 REFUSAL

### AXIOM 6: No Silent State Mutation
All state changes require proposal, gate decision, and evidence.
> **Enforced by:** `src/validation/securityScanner.ts` - INVARIANT_SILENT_MUTATION

### AXIOM 7: Decision ≠ Execution
Admission logic and execution logic MUST be separated.
> **Enforced by:** `src/validation/axiomChecker.ts` - INVARIANT_POLICY_EXECUTION_COLLAPSE

### AXIOM 8: Immutable Evidence
Evidence is append-only and non-mutable.
> **Enforced by:** `src/persistence/jsonlLedger.ts` - Append-only ledger

### AXIOM 9: Explicit Capabilities Only
Capabilities MUST be declared and granted explicitly.
> **Enforced by:** `src/sandbox/types.ts` - Capability-based security model

### AXIOM 10: Sandbox by Default
Destructive power requires explicit elevation.
> **Enforced by:** `src/sandbox/runner.ts` - All execution sandboxed

### AXIOM 11: No Implicit Learning
Behavioral change requires explicit, inspectable state changes.
> **Enforced by:** Architecture - No implicit state modification paths

### AXIOM 12: Local Authority
External systems are tools, never authorities.
> **Enforced by:** `src/adapters/*` - Adapters are non-authoritative

---

## 4. Scope Exclusions

Motherlabs will **never**:

- Guess missing intent for irreversible actions.
- Escalate its own permissions.
- Learn implicitly from user data.
- Act differently due to model upgrades.
- Bypass evidence requirements.
- Anthropomorphize its own behavior.

---

## 5. Constitutional Finality

This document is constitutionally binding.

Changes require a governed proposal and MUST preserve all axioms.

Violation of any axiom invalidates Motherlabs authority.

---

*Authority is deterministic or it does not exist.*
