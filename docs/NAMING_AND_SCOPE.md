# NAMING AND SCOPE
## Authority Boundary Definitions v1.0

---

## 1. Naming Discipline

| Name | Definition | Authority Level |
|------|------------|-----------------|
| **Motherlabs** | The authority kernel and governance runtime | AUTHORITATIVE |
| **QRPT** | Reasoning/planning protocol used by Motherlabs | NON-AUTHORITATIVE |
| **URCO** | Unambiguous representation of computational operations | ADVISORY |
| **Products** | User-facing systems built on Motherlabs governance | NON-AUTHORITATIVE |
| **Adapters** | LLM and external service integrations | NON-AUTHORITATIVE |

---

## 2. Scope Enforcement

### Authoritative Components (TCB)

These components **decide** what is admitted:

```
src/validation/sixGates.ts      # Gate orchestration
src/validation/securityScanner.ts   # Security gate
src/validation/axiomChecker.ts      # Axiom enforcement
src/sandbox/runner.ts           # Execution authority
src/persistence/jsonlLedger.ts  # Evidence authority
src/core/result.ts              # Ok/Err decision types
```

### Non-Authoritative Components

These components **propose** but never decide:

```
src/adapters/*                  # LLM adapters
src/llm/*                       # LLM interaction
src/selfbuild/proposer.ts       # Improvement proposals
src/urco/*                      # Intent analysis
src/decompose.ts                # Task decomposition
```

---

## 3. Naming-Authority Invariant

**If a component's name implies authority, it MUST enforce authority.**

| Name Pattern | Implies | Must Enforce |
|--------------|---------|--------------|
| `*Validator` | Validation authority | Gate logic |
| `*Gate*` | Admission authority | Pass/Fail decision |
| `*Ledger` | Evidence authority | Append-only storage |
| `*Adapter` | No authority | Proposal generation only |
| `*Proposer` | No authority | Candidate generation only |

---

## 4. Anti-Drift Rule

**If naming ambiguity appears, scope has already drifted.**

Warning signs:
- A "helper" that makes decisions
- An "adapter" that bypasses gates
- A "utility" that mutates state without evidence
- A "proposer" that auto-applies changes

---

## 5. Component Map

```
┌────────────────────────────────────────────────────────────┐
│                    AUTHORITY BOUNDARY                       │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │   SixGates      │    │  SecurityScanner │               │
│  │   (AUTHORITY)   │    │  (AUTHORITY)     │               │
│  └────────┬────────┘    └────────┬─────────┘               │
│           │                      │                          │
│           └──────────┬───────────┘                          │
│                      │                                      │
│              ┌───────▼───────┐                              │
│              │  GateDecision │                              │
│              │  (AUTHORITY)  │                              │
│              └───────┬───────┘                              │
│                      │                                      │
├──────────────────────┼──────────────────────────────────────┤
│                      │         NON-AUTHORITY BOUNDARY       │
│                      │                                      │
│  ┌───────────────────▼───────────────────┐                 │
│  │         Proposer (NON-AUTHORITY)       │                 │
│  │                                        │                 │
│  │  ┌────────────┐    ┌────────────┐     │                 │
│  │  │ Adapters   │    │    URCO    │     │                 │
│  │  │ (NON-AUTH) │    │ (ADVISORY) │     │                 │
│  │  └────────────┘    └────────────┘     │                 │
│  └───────────────────────────────────────┘                 │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation References

### Authority Enforcement
```typescript
// src/validation/sixGates.ts:87-92
// Required gates must ALL pass for admission
const requiredGatesFailed = gateResults.filter(g => g.required && !g.passed)
const valid = requiredGatesFailed.length === 0
```

### Non-Authority Declaration
```typescript
// src/selfbuild/proposer.ts:1-2
// Self-Improvement Proposer - Motherlabs proposes improvements to itself
// Uses ConstrainedLLM for real code generation (AXIOM 5: Refuses if LLM unavailable)
```

---

*Names carry weight. Authority is explicit or absent.*
