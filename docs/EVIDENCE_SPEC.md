# Evidence Specification

Normative contract for `ExecutionEvidence` in context-engine-kernel.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.4+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The structure and semantics of `ExecutionEvidence`
- The `EvidenceCore` subset used for content-addressing
- Hashing rules for deterministic evidence identification
- Invariants that all valid evidence must satisfy

### 1.2 Non-Goals

This specification does NOT define:

- How evidence is collected (implementation detail of harness)
- Storage format for evidence files (see LEDGER_SPEC.md for audit trail)
- Evidence retention policies
- Evidence verification by external parties

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **ExecutionEvidence** | Complete execution proof including ephemeral metadata |
| **EvidenceCore** | Canonical subset of evidence for content-addressing |
| **EvidenceHash** | `sha256(canonicalize(EvidenceCore))` |
| **Ephemeral field** | Field excluded from EvidenceCore (timestamps, executor info) |
| **ActionResult** | File-level execution outcome (path, sha256, exit_code) |
| **TestResult** | Test execution outcome referencing an ActionResult |
| **canonicalize()** | Deterministic JSON serialization per DETERMINISM.md |

---

## 3. ExecutionEvidence Object

### 3.1 Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `proposal_id` | `ProposalId` | Content-addressed proposal identifier |
| `proposal_hash` | `string` | SHA256 hash of the canonical proposal |
| `action_results` | `ActionResult[]` | Ordered list of file operation results |
| `test_results` | `TestResult[]` | Ordered list of test execution results |
| `status` | `'complete' \| 'partial' \| 'failed'` | Overall execution status |
| `started_at` | `string` | ISO 8601 timestamp (ephemeral) |
| `completed_at` | `string` | ISO 8601 timestamp (ephemeral) |
| `total_duration_ms` | `number` | Execution duration in milliseconds (ephemeral) |
| `executor_id` | `string` | Executor identifier (ephemeral) |
| `working_dir` | `string` | Absolute path to working directory (ephemeral) |

### 3.2 ActionResult Structure

```typescript
interface ActionResult {
  path: string;           // Relative file path
  action: 'create' | 'modify' | 'delete';
  sha256: ContentHash;    // Hash of file content after action
  exit_code: number;      // 0 = success
}
```

### 3.3 TestResult Structure

```typescript
interface TestResult {
  test_id: string;        // Unique test identifier
  passed: boolean;        // Test outcome
  exit_code: number;      // Process exit code
  stdout_sha256: ContentHash;  // Hash of stdout
  stderr_sha256: ContentHash;  // Hash of stderr
}
```

### 3.4 Status Values

| Status | Meaning |
|--------|---------|
| `complete` | All actions and tests executed successfully |
| `partial` | Some actions executed, execution was interrupted |
| `failed` | Execution failed due to error |

---

## 4. EvidenceCore and Hashing Rules

### 4.1 EvidenceCore Definition

`EvidenceCore` is the canonical subset of `ExecutionEvidence` used for content-addressing. It excludes ephemeral fields that vary between executions.

**Included fields (in canonical order):**

1. `proposal_id`
2. `proposal_hash`
3. `action_results` (sorted by `path`)
4. `test_results` (sorted by `test_id`)
5. `status`

**Excluded fields (ephemeral):**

- `started_at`
- `completed_at`
- `total_duration_ms`
- `executor_id`
- `working_dir`

### 4.2 Computing EvidenceCore

```typescript
function computeEvidenceCore(evidence: ExecutionEvidence): EvidenceCore {
  return {
    proposal_id: evidence.proposal_id,
    proposal_hash: evidence.proposal_hash,
    action_results: [...evidence.action_results].sort((a, b) =>
      a.path.localeCompare(b.path)
    ),
    test_results: [...evidence.test_results].sort((a, b) =>
      a.test_id.localeCompare(b.test_id)
    ),
    status: evidence.status,
  };
}
```

### 4.3 Computing EvidenceHash

```typescript
function computeEvidenceHash(evidence: ExecutionEvidence): ContentHash {
  const core = computeEvidenceCore(evidence);
  const canonical = canonicalize(core);
  return `sha256:${sha256(canonical)}`;
}
```

### 4.4 Canonicalization Rules

Per DETERMINISM.md:

1. Keys sorted lexicographically
2. No trailing whitespace
3. No BOM
4. UTF-8 encoding
5. No undefined values (omit or use null)

---

## 5. Invariants

All valid `ExecutionEvidence` MUST satisfy these invariants.

### EV1: Proposal Hash Integrity

```
proposal_hash === sha256(canonicalize(proposal))
```

The `proposal_hash` field MUST be the SHA256 hash of the canonicalized proposal that was executed.

### EV2: Action Results Consistency

```
action_results.every(ar =>
  ar.sha256 is valid ContentHash &&
  ar.action in ['create', 'modify', 'delete'] &&
  ar.path is non-empty string
)
```

All action results MUST have valid content hashes and recognized actions.

### EV3: Test Results Reference Validity

```
test_results.every(tr =>
  tr.test_id is non-empty string &&
  tr.stdout_sha256 is valid ContentHash &&
  tr.stderr_sha256 is valid ContentHash
)
```

All test results MUST have valid identifiers and output hashes.

### EV4: Status Consistency

```
status === 'complete' implies action_results.every(ar => ar.exit_code === 0)
status === 'failed' implies action_results.some(ar => ar.exit_code !== 0) || error occurred
```

The status field MUST be consistent with the actual execution outcomes.

### EV5: EvidenceHash Determinism

```
computeEvidenceHash(e1) === computeEvidenceHash(e2)
  iff
computeEvidenceCore(e1) deep-equals computeEvidenceCore(e2)
```

Two evidence objects with identical EvidenceCore MUST produce identical EvidenceHash.

---

## 6. Versioning

### 6.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to invariants or required fields
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 6.2 Backwards Compatibility

Evidence produced under spec version N MUST be valid under spec version N+1 (minor/patch) unless a MAJOR version bump is released.

### 6.3 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 7. References

- [DETERMINISM.md](./DETERMINISM.md) - Canonicalization rules
- [LEDGER_SPEC.md](./LEDGER_SPEC.md) - Audit trail specification
- [src/protocol/proposal.ts](../src/protocol/proposal.ts) - Type definitions
- [src/harness/evidence.ts](../src/harness/evidence.ts) - Implementation

---

*This is a normative specification. Implementations MUST conform to all invariants.*
