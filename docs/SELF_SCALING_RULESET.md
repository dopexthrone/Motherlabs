# SELF-SCALING RULESET
## Governed Recursion Protocol v0.1

---

## 1. Purpose

Defines how Motherlabs may scale autonomously without violating authority axioms.

**Self-scaling is governed recursion, not emergent autonomy.**

---

## 2. Core Rule

**All self-modification occurs via governed proposals subject to the same gates as any other artifact.**

Motherlabs is not self-exempt.

```typescript
// src/selfbuild/proposer.ts - Self-improvement goes through gates
const llmResult = await this.constrainedLLM.generateCode({
  issue: topIssue,
  filepath,
  existingCode,
  context
})
// Code MUST pass 6 gates before admission
```

---

## 3. Allowed Self-Scaling Behaviors

Motherlabs MAY:

| Behavior | Constraint |
|----------|------------|
| Propose improvements to prompts, gates, policies | Must pass gates |
| Generate candidate patches via external tools | Must pass gates |
| Expand evaluation corpora explicitly | Requires evidence |
| Improve throughput via governed automation | No authority escalation |

### Implementation Reference
```typescript
// src/dogfood/loop.ts - Self-improvement loop
export class DogfoodingLoop {
  // requireHumanApproval: true by default
  // All proposals go through 6-gate validation
}
```

---

## 4. Prohibited Self-Scaling Behaviors

Motherlabs MUST NOT:

| Prohibited Behavior | Violation | Detection |
|--------------------|-----------|-----------|
| Modify policies without gating | AXIOM 4 | Gate bypass detection |
| Learn implicitly from outcomes | AXIOM 11 | No implicit state paths |
| Increase autonomy without explicit grants | AXIOM 9 | Capability audit |
| Mutate authority logic without evidence | AXIOM 8 | Ledger verification |

### Enforcement Reference
```typescript
// src/validation/securityScanner.ts:249-259
// INVARIANT_AUTO_ESCALATION detection
{
  type: 'INVARIANT_AUTO_ESCALATION',
  severity: 'critical',
  pattern: /requireHumanApproval\s*=\s*false\s*(?!.*\/\/\s*BOOTSTRAP-MODE)/,
  message: 'INVARIANT VIOLATION: Disabling human approval without BOOTSTRAP-MODE'
}
```

---

## 5. External Agent Integration

External agents (e.g., Claude Code) are:

| Property | Constraint |
|----------|------------|
| Role | Proposal generators only |
| Authority | Non-authoritative |
| Output | Evidence-producing |
| Bypass | May NOT bypass gates or mutate state directly |

### Adapter Pattern
```typescript
// src/adapters/anthropicAdapter.ts
export class AnthropicAdapter implements LLMAdapter {
  // Generates code proposals
  // Cannot directly execute or modify state
  async generateCode(prompt: string): Promise<string>
}
```

---

## 6. Self-Scaling Readiness Criteria

Motherlabs is self-scaling-ready when it can:

| Capability | Implementation Status |
|------------|----------------------|
| Upgrade a gate via its own pipeline | `src/selfbuild/applier.ts` |
| Reject its own failed self-proposals | `src/validation/sixGates.ts` |
| Roll back deterministically on regression | Ledger + content addressing |
| Halt safely on ambiguity or budget exhaustion | AXIOM 5 refusal path |

### Evidence
```typescript
// src/selfbuild/proposer.ts:96-102
if (!llmResult.ok) {
  // AXIOM 5: Refusal Is a First-Class Outcome
  return Err(new Error(
    `AXIOM 5 REFUSAL: LLM code generation failed (${llmResult.error.message}). ` +
    `Refusing to generate hollow placeholder.`
  ))
}
```

---

## 7. Final Constraint

**Self-scaling increases capacity, not authority.**

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│    AUTHORITY (Fixed)                                     │
│    ═══════════════════                                   │
│    • 6 gates                                            │
│    • 12 axioms                                          │
│    • Evidence rules                                     │
│                                                          │
│    CAPACITY (Scalable)                                   │
│    ────────────────────                                  │
│    • More adapters                                      │
│    • Faster execution                                   │
│    • Better proposals                                   │
│    • Wider coverage                                     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

Authority remains fixed. Capacity may grow.

---

*The system may improve itself. The rules do not change.*
