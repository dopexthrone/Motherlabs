# MOTHER PC POSITIONING
## Host vs Authority Separation v1.0

---

## 1. Definition

**MOTHER PC is a trusted execution host optimized to run Motherlabs.**

It is **not** an authority system.

---

## 2. Responsibilities

MOTHER PC provides:

| Capability | Purpose |
|------------|---------|
| Local Model Execution | Run LLMs without external API calls |
| Secure Secret Storage | OS keychain / hardware security modules |
| Deterministic Execution | Reproducible build and verification environment |
| Evidence Persistence | Local storage for ledger and evidence bundles |
| Offline-First Operation | Full functionality without network |

---

## 3. Non-Responsibilities

MOTHER PC does **NOT**:

| Prohibited Action | Why |
|-------------------|-----|
| Decide admission | Authority resides in Motherlabs kernel |
| Bypass gates | Hardware cannot override software policy |
| Grant capabilities | Capabilities are kernel-declared |
| Modify authority logic | Kernel is software, not hardware |

---

## 4. Sovereignty Boundary

```
┌─────────────────────────────────────────────────────────┐
│                    MOTHER PC (Host)                      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Motherlabs Kernel (Authority)           │ │
│  │                                                      │ │
│  │   src/validation/sixGates.ts  ← Authority Logic     │ │
│  │   src/sandbox/runner.ts       ← Execution Control   │ │
│  │   src/persistence/*.ts        ← Evidence Rules      │ │
│  │                                                      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Hardware: CPU, GPU, Storage, Network                    │
│  OS: Linux/macOS with sandboxing                        │
│  Models: Local Ollama/llama.cpp instances               │
└─────────────────────────────────────────────────────────┘
```

**Authority resides inside Motherlabs, not in hardware, OS, or models.**

---

## 5. Replacement Invariant

Replacing MOTHER PC does **not** alter Motherlabs authority.

The kernel can run on any compliant host:
- Different hardware
- Different OS
- Different local models
- Cloud or local deployment

The authority rules remain identical.

---

## 6. Implementation Notes

### Local LLM Integration
```typescript
// src/adapters/ollamaAdapter.ts
// Adapters are non-authoritative - they provide LLM access only
export class OllamaAdapter implements LLMAdapter {
  // Generates proposals, never decides
}
```

### Evidence Storage
```typescript
// src/persistence/jsonlLedger.ts
// Evidence persists on host storage, rules enforced by kernel
export class JsonlLedger implements Ledger {
  // Append-only, host provides storage
}
```

---

*MOTHER PC is where Motherlabs runs. Motherlabs is what decides.*
