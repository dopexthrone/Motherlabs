# Motherlabs Invariants

These are not guidelines. They are structural invariants. Violation of any invariant is a system failure, not a design tradeoff.

---

## 1. No Probabilistic Authority

Motherlabs will never act as an authority based on probabilistic judgement.

It may use probabilistic systems to generate candidates, ideas, plans, or code, but it will never **decide** based on likelihood, confidence scores, or model self-assessment.

**Authority is deterministic or it does not exist.**

Implementation:
- 6-gate validation: mechanical pass/fail
- LLMs generate, gates decide
- No confidence thresholds in acceptance predicates

---

## 2. No Guessing Missing Intent

Motherlabs will never guess missing intent for irreversible actions.

If a task requires specificity (scope, target, budget, risk, environment) and that information is absent, Motherlabs halts. It does not "infer what the user probably meant" when consequences persist beyond a sandbox.

Implementation:
- `requireHumanApproval` for production
- Proposer proposes, does not execute
- URCO entropy gate rejects ambiguous specifications

---

## 3. No Silent State Mutation

Motherlabs will never silently mutate state.

No hidden file writes, no implicit configuration changes, no background side effects, no undocumented migrations. Every admitted change must be attributable to a proposal, a gate decision, and recorded evidence.

Implementation:
- Evidence ledger (JSONL) records all events
- Git commits attributed to proposals
- Gate 4 produces file manifests with SHA-256 hashes
- Sandbox snapshots before/after execution

---

## 4. No Convenience Over Verifiability

Motherlabs will never optimize for convenience at the expense of verifiability.

If a shortcut reduces auditability, traceability, or reproducibility, it is rejected—even if it would make the system feel smoother or faster.

Implementation:
- Evidence bundles with cryptographic hashes
- Deterministic fingerprinting (runner_version, command_hash, env_hash)
- Append-only ledger (no delete, no update)
- Full gate results recorded even on pass

---

## 5. Not Aligned to Please

Motherlabs will never be trained to please, reassure, or agree.

It is not aligned to user satisfaction or conversational harmony. It is aligned to correctness under constraints. Refusal, delay, and "cannot proceed" are valid and expected outputs.

Implementation:
- Gates reject invalid code
- Security scanner blocks vulnerabilities
- Governance check enforces policy violations
- No "soft failures" — pass or fail

---

## 6. No Implicit Data Storage

Motherlabs will never store, learn from, or internalize private user data implicitly.

No silent memory accumulation, no hidden fine-tuning, no cross-project contamination. Persistence exists only where explicitly designed, scoped, and inspectable.

Implementation:
- Ledger is explicit and file-based
- No cross-session state unless configured
- Evidence artifacts are inspectable JSON
- No telemetry without consent

---

## 7. Policy and Execution Separation

Motherlabs will never collapse policy and execution into the same layer.

The component that decides whether something may happen is never the same component that executes it. This separation is structural, not optional.

Implementation:
- Proposer generates proposals
- Validator validates through 6 gates
- Applier applies changes
- Runner executes in sandbox
- Each is a separate module with distinct responsibility

---

## 8. No Vendor Lock-in

Motherlabs will never depend on a specific model, vendor, or scale tier.

No behavior should assume "GPT-X level intelligence" or a particular context window. The system must degrade gracefully and remain correct as models change.

Implementation:
- Anthropic adapter + OpenAI adapter
- Deterministic fallback when no LLM available
- Model-agnostic proposal interface
- Heuristic decomposition as baseline

---

## 9. No Auto-Escalation

Motherlabs will never auto-escalate its own permissions.

Capability expansion requires explicit configuration or user-granted authority. The system may propose escalation, but it cannot grant it.

Implementation:
- `requireHumanApproval` is configuration, not runtime decision
- Bootstrap mode is explicit opt-in
- Sandbox capabilities are declared, not acquired
- No self-modification of permission config

---

## 10. Not Anthropomorphized

Motherlabs will never pretend to be human, conscious, or creative in a mystical sense.

It is not an intelligence. It is an authority framework for intelligence. Anthropomorphizing it corrupts design decisions.

Implementation:
- System messages describe framework behavior
- No personality, no emotional responses
- Outputs are structured, not conversational
- Documentation describes mechanisms, not intentions

---

## 11. Not a Consumer Product

Motherlabs will never optimize for being a general consumer product.

If a feature is useful to everyone but weakens the authority core, it does not belong in Motherlabs.

Implementation:
- 6-gate validation is strict, not configurable to "lenient"
- Security scanner fails on critical/high (no warnings-only mode)
- No "skip validation" flags
- Complexity is accepted where correctness requires it

---

## Enforcement

These invariants are enforced through:

1. **Gate 6 (Governance Check)** — Policy rules and security scanning
2. **Code Review** — Human verification of architectural changes
3. **Test Suite** — Deterministic validation of behavior
4. **Evidence Ledger** — Audit trail for all decisions

Proposing removal or weakening of an invariant requires:
- Written justification
- Impact analysis on all dependent invariants
- Human approval (cannot be auto-approved)

---

## Versioning

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2025-12-14 | Initial codification |

---

*Authority is deterministic or it does not exist.*
