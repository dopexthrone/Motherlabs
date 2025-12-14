# ROADMAP: Next 10 Logical Steps
## Post-v0.7.0 Constitutional Freeze

---

## Current State

- Constitutional documentation: **COMPLETE**
- Kernel v0.7.0: **FROZEN & DEPLOYED**
- 6-gate validation: **OPERATIONAL**
- Decision philosophy: **CODIFIED**

---

## The 10 Steps

### 1. Implement Decision Classification Gate

**Purpose:** Mechanically separate reversible/irreversible/premature decisions.

**What:**
- Add `DecisionClassifier` to categorize incoming proposals
- Reversible → low gate (proceed freely)
- Irreversible → high gate (require justification)
- Premature → refuse with explanation

**Implementation:**
```typescript
// src/core/decisionClassifier.ts
export type DecisionType = 'reversible' | 'irreversible' | 'premature'

export function classifyDecision(proposal: Proposal): {
  type: DecisionType
  reason: string
  requiredEvidence: string[]
}
```

**Evidence:** This directly implements the DECISION_PHILOSOPHY.md separation.

---

### 2. Build Consequence Surface Generator

**Purpose:** Answer "what does this permanently forbid?"

**What:**
- For any irreversible decision, generate explicit consequence map
- What this enables
- What this permanently forbids
- What assumptions this depends on
- What must be true for this to be correct

**Implementation:**
```typescript
// src/analysis/consequenceSurface.ts
export type ConsequenceSurface = {
  enables: string[]
  forbids: string[]
  assumptions: string[]
  validationCriteria: string[]
}
```

**Evidence:** Makes closed doors visible and manageable.

---

### 3. Add Alternative Tracking to Proposals

**Purpose:** Document what paths were NOT taken and why.

**What:**
- Every irreversible decision must record alternatives considered
- Include rationale for rejection
- Enable future "what if" analysis

**Implementation:**
```typescript
// src/core/proposal.ts
export type ProposalWithAlternatives = Proposal & {
  alternatives: Array<{
    description: string
    rejectionReason: string
    consequenceSurface: ConsequenceSurface
  }>
}
```

**Evidence:** Decisions become revisitable and diffable.

---

### 4. Enhance Hollow Code Detection (Multi-line)

**Purpose:** Catch hollow patterns that span multiple lines.

**What:**
- Current scanner is line-based (known limitation)
- Add AST-based hollow detection for multi-line patterns
- Detect: empty function bodies, return-only functions, placeholder implementations

**Implementation:**
```typescript
// src/validation/hollowDetector.ts
export function detectHollowPatterns(ast: SourceFile): HollowPattern[]
```

**Evidence:** Closes the gap identified during clean-room testing.

---

### 5. Implement Premature Decision Detection

**Purpose:** Refuse decisions that can be safely deferred.

**What:**
- Detect when a decision is being forced prematurely
- Check: Is this actually blocking? Can we defer?
- If deferrable without cost → refuse with explanation

**Signals of Prematurity:**
- No blocking dependency requires this now
- Multiple valid alternatives exist
- Assumptions are unverified
- Consequences are high but justification is thin

**Implementation:**
```typescript
// src/validation/prematurityChecker.ts
export function checkPrematurity(proposal: Proposal): {
  premature: boolean
  reason?: string
  deferralRecommendation?: string
}
```

---

### 6. Build Evidence Query System

**Purpose:** Answer "why did we choose this six weeks ago?"

**What:**
- Query interface for ledger entries
- Filter by: decision type, date range, file, consequence
- Reconstruct decision context from evidence

**Implementation:**
```typescript
// src/persistence/evidenceQuery.ts
export class EvidenceQuery {
  byFile(path: string): LedgerEntry[]
  byDateRange(from: Date, to: Date): LedgerEntry[]
  byDecisionType(type: DecisionType): LedgerEntry[]
  reconstructContext(entryId: string): DecisionContext
}
```

**Evidence:** Enables organizational learning from past decisions.

---

### 7. Add Decision Diff/Simulation

**Purpose:** Answer "what if we had chosen differently?"

**What:**
- Given a past decision, simulate alternative path
- Compare consequence surfaces
- Identify what would be different today

**Implementation:**
```typescript
// src/analysis/decisionDiff.ts
export function simulateAlternative(
  originalDecision: LedgerEntry,
  alternativePath: string
): {
  currentState: ConsequenceSurface
  alternativeState: ConsequenceSurface
  diff: ConsequenceDiff
}
```

**Evidence:** Recoverability through understanding, not just rollback.

---

### 8. Integrate Local LLM (Ollama) for MOTHER PC

**Purpose:** Full offline-first operation.

**What:**
- Configure Ollama adapter for local model execution
- Test with: codellama, deepseek-coder, etc.
- Ensure all gates work with local LLM output
- No external API dependency for core operation

**Implementation:**
```bash
# On MOTHER PC
ollama pull codellama:13b
KERNEL_LLM=ollama node dist/cli.js dogfood once
```

**Evidence:** Sovereignty - authority doesn't depend on external services.

---

### 9. Implement Gate Elevation Protocol

**Purpose:** Automatically elevate gate requirements based on irreversibility.

**What:**
- Reversible changes: Gates 1-4 required
- Irreversible changes: Gates 1-6 required + human approval
- Architectural changes: All gates + consequence surface + alternatives

**Implementation:**
```typescript
// src/validation/gateElevation.ts
export function determineGateRequirements(
  proposal: Proposal,
  classification: DecisionType
): GateRequirement[]
```

**Evidence:** Gate strictness matches decision weight.

---

### 10. Build Self-Improvement Validation Loop

**Purpose:** Motherlabs improves itself through its own governance.

**What:**
- Run dogfood loop with real LLM
- Propose improvements to kernel code
- Validate proposals through all 6 gates
- Require human approval for irreversible changes
- Log all decisions with full evidence

**Success Criteria:**
- System can propose a gate improvement
- Improvement passes all 6 gates
- Human approves
- Change is applied
- Evidence is complete and queryable

**Implementation:**
```bash
# Supervised self-improvement cycle
ANTHROPIC_API_KEY=xxx node dist/cli.js dogfood once --require-approval
```

---

## Dependency Graph

```
Step 1 (Classification) ─┬─> Step 5 (Prematurity)
                         │
                         └─> Step 9 (Gate Elevation)

Step 2 (Consequences) ───┬─> Step 3 (Alternatives)
                         │
                         └─> Step 7 (Decision Diff)

Step 4 (Hollow Detection) ─> Standalone improvement

Step 6 (Evidence Query) ──> Step 7 (Decision Diff)

Step 8 (Local LLM) ───────> Step 10 (Self-Improvement)

Step 9 (Gate Elevation) ──> Step 10 (Self-Improvement)
```

---

## Priority Order (Recommended)

| Priority | Step | Rationale |
|----------|------|-----------|
| **P0** | 1. Decision Classification | Foundation for everything else |
| **P0** | 2. Consequence Surface | Makes closed doors visible |
| **P1** | 5. Prematurity Detection | Implements core philosophy |
| **P1** | 9. Gate Elevation | Classification → action |
| **P2** | 3. Alternative Tracking | Enables learning |
| **P2** | 6. Evidence Query | Enables "why did we..." |
| **P2** | 4. Hollow Detection | Closes known gap |
| **P3** | 8. Local LLM | MOTHER PC sovereignty |
| **P3** | 7. Decision Diff | Advanced introspection |
| **P3** | 10. Self-Improvement | Capstone capability |

---

## One-Line Summary

> **Build the mechanical infrastructure that makes irreversibility visible, prematurity detectable, and decisions revisitable.**

---

*These steps turn philosophy into enforcement.*
