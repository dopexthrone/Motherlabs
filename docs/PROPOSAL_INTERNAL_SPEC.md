# Proposal Internal Specification

Internal contract for the Proposal TypeScript type used within the kernel.

**Spec Version:** 1.0.0
**Status:** Internal (NOT a consumer artifact contract)
**Applies to:** v0.3.8+

---

## IMPORTANT: Internal Contract Notice

This specification documents an **internal TypeScript shape** defined in `src/protocol/proposal.ts`.

**Key facts:**
- No proposal artifact is emitted to disk in v0.3.7/v0.3.8
- This is NOT a consumer verification contract
- External envelope contracts remain: BUNDLE_SPEC, PATCH_SPEC, RUN_SPEC, EVIDENCE_SPEC, LEDGER_SPEC, POLICY_SPEC

If proposal serialization is needed in the future, a dedicated track should add:
- `proposal.json` artifact emission
- Determinism guarantees (canonical output)
- Leak prevention (RS6-like path sanitization)
- Consumer verification tooling

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines the **internal** structure of:

- The `Proposal` type (executable action bundle, in-memory only)
- The `ProposedAction` type (individual executable actions)
- The `AcceptanceTest` type (verification conditions)
- Reference validation rules for source bundle linkage
- Action and test ordering requirements
- Determinism rules for canonical representation

### 1.2 Non-Goals

This specification does NOT define:

- External artifact format (no proposal.json is emitted)
- Consumer verification contract (consumers cannot obtain proposals)
- Proposal generation logic (kernel implementation detail)
- Execution semantics (see EVIDENCE_SPEC.md)
- File path validation (see PATCH_SPEC.md for file operations)
- Evidence validation (see EVIDENCE_SPEC.md)

### 1.3 Authority Model

The kernel is **authoritative** for generating proposals internally. Proposals are:
- Generated from Bundles by the proposal protocol (`generateProposal()`)
- Used internally by the harness for sandbox execution
- Never serialized to disk as external artifacts

Proposal verification is **internal-only**: it answers "Is this proposal well-formed?" for kernel self-consistency.

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Proposal** | Executable action bundle generated from a Bundle |
| **ProposedAction** | Single action: file operation, command, or test |
| **AcceptanceTest** | Verification condition that must pass post-execution |
| **ProposalId** | Unique identifier, format: `prop_{hash16}` |
| **ActionId** | Unique action identifier, format: `act_{hash16}` |
| **ActionType** | Action type enum: file ops, command, validate, test |
| **TestType** | Test type enum: hash_match, command_success, file_exists, content_match |
| **Violation** | Spec violation with rule_id, path, and message |

---

## 3. Proposal Schema

### 3.1 Schema Version

All proposals MUST include a schema version:

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | `string` | Schema version, e.g., `"1.0.0"` |

Current schema version: `1.0.0`

### 3.2 Proposal Structure

```typescript
interface Proposal {
  /** Unique identifier derived from content */
  id: ProposalId;

  /** Schema version for this format */
  schema_version: string;

  /** Source bundle ID that generated this proposal */
  source_bundle_id: BundleId;

  /** Hash of the source bundle */
  source_bundle_hash: string;

  /** Proposed actions to execute (sorted) */
  actions: ProposedAction[];

  /** Acceptance tests that must pass (sorted) */
  acceptance_tests: AcceptanceTest[];

  /** Human-readable summary */
  summary: string;

  /** Whether this proposal requires explicit human approval */
  requires_approval: boolean;

  /** Confidence score (0-100) */
  confidence: Score;
}
```

### 3.3 ProposedAction Structure

```typescript
interface ProposedAction {
  /** Unique identifier derived from content */
  id: ActionId;

  /** Type of action */
  type: ActionType;

  /** Target path (for file operations) or command (for execute) */
  target: string;

  /** Content to write (for create/modify operations) */
  content?: string;

  /** Expected hash of result (for verification) */
  expected_hash?: string;

  /** Whether this action is required or optional */
  required: boolean;

  /** Description of what this action does */
  description: string;

  /** Ordering priority (lower = earlier) */
  order: number;
}
```

### 3.4 AcceptanceTest Structure

```typescript
interface AcceptanceTest {
  /** Unique identifier */
  id: string;

  /** Test name */
  name: string;

  /** Type of test */
  type: TestType;

  /** Target to test */
  target: string;

  /** Expected value (hash, exit code, etc.) */
  expected: string;

  /** Whether this test is required */
  required: boolean;
}
```

### 3.5 ActionType Enum

| Value | Description | Requires Content |
|-------|-------------|------------------|
| `create_file` | Create a new file | Yes |
| `modify_file` | Modify an existing file | Yes |
| `delete_file` | Delete an existing file | No |
| `execute_command` | Run a shell command | No |
| `validate` | Run validation check | No |
| `test` | Run acceptance test | No |

### 3.6 TestType Enum

| Value | Description |
|-------|-------------|
| `hash_match` | Verify file hash matches expected |
| `command_success` | Verify command exits with 0 |
| `file_exists` | Verify file exists at path |
| `content_match` | Verify file content matches expected |

---

## 4. Reference Rules (Normative)

### 4.1 Source Bundle Reference

Every Proposal MUST reference its source bundle:

- `source_bundle_id`: Valid bundle ID (format: `bun_{hash16}`)
- `source_bundle_hash`: SHA256 hash of canonical source bundle

### 4.2 Reference Integrity

The `source_bundle_hash` MUST match the canonical hash of the referenced bundle.

### 4.3 ID Derivation

Proposal and Action IDs are derived from content:

```typescript
const id = deriveId('prop', proposalContent);  // prop_{hash16}
const actionId = deriveId('act', actionContent);  // act_{hash16}
```

This ensures:
- Same content produces same ID
- IDs are deterministic and verifiable

---

## 5. Embedding Rules (Normative)

### 5.1 File Content Embedding

For `create_file` and `modify_file` actions:

- `content` field MUST be present
- `content` MUST be valid UTF-8
- `content` MUST NOT contain null bytes
- `expected_hash` SHOULD be present for verification

### 5.2 Command Embedding

For `execute_command` actions:

- `target` contains the command string
- `content` is NOT used
- Commands are executed in sandbox environment

### 5.3 Test Embedding

For `validate` and `test` actions:

- `target` contains the validation/test identifier
- `content` MAY contain test configuration
- Results are captured in evidence

---

## 6. Determinism Rules (Normative)

### 6.1 Proposal Canonicalization

When serialized, a Proposal MUST use canonical JSON:

1. Keys sorted lexicographically at all levels
2. Actions sorted by (order, id)
3. Tests sorted by id
4. No trailing whitespace
5. UTF-8 encoding
6. No undefined values

### 6.2 Action Ordering

Actions MUST be sorted by:
1. `order` field ascending
2. `id` field ascending (for stability when order is equal)

### 6.3 Test Ordering

Acceptance tests MUST be sorted by `id` ascending.

### 6.4 Proposal Hash

```typescript
function computeProposalHash(proposal: Proposal): string {
  const canonical = canonicalize(proposal);
  return `sha256:${sha256(canonical)}`;
}
```

### 6.5 Violation Reporting

Violations MUST be reported in deterministic order:

1. Sort by `rule_id` ascending
2. Then by `path` ascending

---

## 7. Error Semantics

### 7.1 Verification Result

```typescript
interface ProposalVerifyResult {
  ok: true;
} | {
  ok: false;
  violations: ProposalViolation[];
}

interface ProposalViolation {
  rule_id: string;   // PR1, PR2, etc.
  path?: string;     // Optional: relevant path or action ID
  message: string;   // Human-readable description
}
```

### 7.2 Error Categories

| Category | Rule IDs | Description |
|----------|----------|-------------|
| Schema | SCHEMA | Structural validation failures |
| Reference | PR1, PR2 | Version and source reference errors |
| Action | PR3-PR6, PR12 | Action validation errors |
| Test | PR7-PR8 | Test validation errors |
| Metadata | PR9, PR10 | Metadata validation errors |
| Determinism | PR11 | Ordering/stability errors |

### 7.3 Exit Codes (CLI)

| Code | Meaning |
|------|---------|
| 0 | Valid proposal |
| 1 | I/O error |
| 2 | Parse error |
| 3 | Validation error |

---

## 8. Invariants

All valid `Proposal` objects MUST satisfy these invariants.

### PR1: Schema Version Present

```
schema_version !== undefined && schema_version !== ''
```

Every Proposal MUST include a non-empty schema version string.

### PR2: Source References Valid

```
source_bundle_id !== undefined && source_bundle_id !== ''
source_bundle_hash !== undefined && source_bundle_hash.startsWith('sha256:')
```

Source bundle ID and hash MUST be present and properly formatted.

### PR3: Actions Non-Empty for BUNDLE

```
// For proposals from BUNDLE results, actions should be non-empty
// Empty actions array is allowed for CLARIFY/REFUSE proposals
```

Proposals generated from BUNDLE results SHOULD have at least one action.

### PR4: Action IDs Unique

```
new Set(actions.map(a => a.id)).size === actions.length
```

All action IDs MUST be unique within a Proposal.

### PR5: Action Types Valid

```
actions.every(a => a.type in {
  'create_file', 'modify_file', 'delete_file',
  'execute_command', 'validate', 'test'
})
```

All actions MUST have a valid action type.

### PR6: Action IDs Well-Formed

```
actions.every(a => /^act_[a-f0-9]{16}$/.test(a.id))
```

All action IDs MUST follow the `act_{hash16}` format.

### PR7: Test IDs Unique

```
new Set(acceptance_tests.map(t => t.id)).size === acceptance_tests.length
```

All test IDs MUST be unique within a Proposal.

### PR8: Test Types Valid

```
acceptance_tests.every(t => t.type in {
  'hash_match', 'command_success', 'file_exists', 'content_match'
})
```

All tests MUST have a valid test type.

### PR9: Confidence Range Valid

```
confidence >= 0 && confidence <= 100
```

Confidence score MUST be an integer in range 0-100.

### PR10: Summary Non-Empty

```
summary !== undefined && summary.trim() !== ''
```

Proposal summary MUST be non-empty.

### PR11: Sorting Canonical

```
actions === sortBy(actions, ['order', 'id'])
acceptance_tests === sortBy(acceptance_tests, ['id'])
```

Actions MUST be sorted by (order, id). Tests MUST be sorted by id.

### PR12: File Actions Have Content

```
actions.every(a =>
  (a.type === 'create_file' || a.type === 'modify_file')
    ? a.content !== undefined
    : true
)
actions.every(a =>
  a.type === 'delete_file'
    ? a.content === undefined
    : true
)
```

File create/modify actions MUST have content. Delete actions MUST NOT.

---

## 9. Versioning

### 9.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to schema or invariants
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 9.2 Schema Version

The `schema_version` field tracks the Proposal schema independently.

### 9.3 Version History

| Spec Version | Schema Version | Date | Changes |
|--------------|----------------|------|---------|
| 1.0.0 | 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 10. References

### 10.1 Related Specifications

- [BUNDLE_SPEC.md](./BUNDLE_SPEC.md) - Bundle output contract
- [PATCH_SPEC.md](./PATCH_SPEC.md) - Patch/file operations contract
- [EVIDENCE_SPEC.md](./EVIDENCE_SPEC.md) - Execution evidence contract
- [POLICY_SPEC.md](./POLICY_SPEC.md) - Policy profiles and limits
- [RUN_SPEC.md](./RUN_SPEC.md) - Run result contract

### 10.2 Implementation References

- [src/protocol/proposal.ts](../src/protocol/proposal.ts) - Kernel proposal types (authoritative)
- [src/protocol/proposal_verify.ts](../src/protocol/proposal_verify.ts) - Internal verifier (PR1-PR12)

---

*This is a normative specification. Implementations MUST conform to all invariants.*
