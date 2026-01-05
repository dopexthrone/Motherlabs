# Run Result Specification

Normative contract for the `RunResult` JSON emitted by the harness CLI in context-engine-kernel.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.6+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The structure and semantics of `RunResult` (harness CLI output)
- Field requirements per outcome type (BUNDLE, CLARIFY, REFUSE)
- Determinism rules for canonical output
- Error format and semantics
- Invariants that all valid run results must satisfy

### 1.2 Non-Goals

This specification does NOT define:

- How the harness orchestrates execution (implementation detail)
- Internal data structures used during processing
- Storage of run results beyond the CLI output
- Evidence collection details (see EVIDENCE_SPEC.md)
- Ledger format (see LEDGER_SPEC.md)

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **RunResult** | Complete JSON object emitted by harness CLI to stdout |
| **Outcome** | Result classification: `'BUNDLE' \| 'CLARIFY' \| 'REFUSE'` |
| **Ephemeral field** | Field excluded from determinism checks (timestamps, paths) |
| **Canonical field** | Field included in determinism checks |
| **run_schema_version** | Schema version for RunResult format |
| **canonicalize()** | Deterministic JSON serialization per DETERMINISM.md |
| **ContentHash** | SHA256 hash in format `sha256:{64-char-hex}` |

---

## 3. RunResult Schema

### 3.1 Schema Version

All run results MUST include a schema version field:

| Field | Type | Description |
|-------|------|-------------|
| `run_schema_version` | `string` | Schema version, e.g., `"1.0.0"` |

Current schema version: `1.0.0`

### 3.2 Required Fields (All Outcomes)

| Field | Type | Description | Deterministic |
|-------|------|-------------|---------------|
| `run_schema_version` | `string` | Schema version | Yes |
| `run_id` | `string` | Unique run identifier | No (contains timestamp) |
| `started_at` | `string` | ISO 8601 UTC timestamp | No (ephemeral) |
| `completed_at` | `string` | ISO 8601 UTC timestamp | No (ephemeral) |
| `kernel_version` | `string` | Kernel version used | Yes |
| `policy` | `PolicyProfile` | Resolved policy object | Yes |
| `intent` | `IntentRef` | Intent reference (hash only) | Partial (see 3.6) |
| `bundle` | `BundleRef \| null` | Bundle reference or null | Yes |
| `kernel_result_kind` | `Outcome` | Result outcome type | Yes |
| `execution` | `SandboxExecution \| null` | Execution evidence | Yes (when present) |
| `decision` | `DecisionRecord` | Final decision | Yes |
| `model_mode` | `ModelMode` | Model mode used | Yes |

### 3.3 Outcome-Specific Fields

#### BUNDLE Outcome

| Field | Required | Notes |
|-------|----------|-------|
| `bundle` | Yes | Non-null BundleRef |
| `execution` | Conditional | Present if mode='execute-sandbox' |
| `clarify_questions` | No | Must NOT be present |
| `refuse_reason` | No | Must NOT be present |

#### CLARIFY Outcome

| Field | Required | Notes |
|-------|----------|-------|
| `bundle` | Yes | Non-null BundleRef |
| `clarify_questions` | Yes | Non-empty string array |
| `execution` | No | Must be null |
| `refuse_reason` | No | Must NOT be present |

#### REFUSE Outcome

| Field | Required | Notes |
|-------|----------|-------|
| `bundle` | Yes | Must be null |
| `refuse_reason` | Yes | Non-empty string |
| `execution` | No | Must be null |
| `clarify_questions` | No | Must NOT be present |

### 3.4 IntentRef Structure

```typescript
interface IntentRef {
  path: string;      // Relative path or basename (NO absolute paths)
  sha256: ContentHash;
}
```

### 3.5 BundleRef Structure

```typescript
interface BundleRef {
  bundle_id: string;
  sha256: ContentHash;
}
```

### 3.6 Optional Fields

| Field | Type | When Present |
|-------|------|--------------|
| `clarify_questions` | `string[]` | Only when outcome is CLARIFY |
| `refuse_reason` | `string` | Only when outcome is REFUSE |
| `sandbox_path` | `string` | Only when preserve_sandbox=true (internal use only) |
| `model_io_path` | `string` | Only when model_mode='record' |

**Note:** `sandbox_path` and `model_io_path` are for internal/debug use and MUST NOT appear in public/production outputs.

---

## 4. Determinism Rules

### 4.1 Canonical JSON Output

The harness CLI MUST emit canonical JSON:

1. Use `canonicalize()` (not `JSON.stringify()`)
2. Keys sorted lexicographically at all levels
3. No trailing whitespace
4. No BOM
5. UTF-8 encoding
6. No `undefined` values (omit key or use `null`)

### 4.2 Array Sorting

All arrays in RunResult MUST be sorted:

| Array | Sort Key |
|-------|----------|
| `execution.outputs` | `path` (lexicographic) |
| `decision.reasons` | Stable (insertion order) |
| `clarify_questions` | Stable (insertion order) |
| `policy.allowed_commands` | Definition order (not re-sorted) |
| `policy.allowed_write_roots` | Definition order (not re-sorted) |

### 4.3 Ephemeral vs Canonical Fields

**Ephemeral fields** (excluded from determinism checks):

- `run_id` (contains timestamp)
- `started_at`
- `completed_at`
- `sandbox_path` (absolute path)
- `model_io_path` (absolute path)

**Canonical fields** (must be deterministic):

- All other fields
- Same intent + same policy + same mode = identical canonical fields

### 4.4 No Absolute Paths in Public Output

Public outputs MUST NOT contain:

- Absolute filesystem paths
- Hostnames or machine identifiers
- User-specific directory names (e.g., `/home/user/...`)

The `intent.path` field MUST contain only:
- Relative path from working directory, OR
- Basename of the intent file

### 4.5 Byte-Identical Outputs

Given identical inputs:
- Same intent content (by hash)
- Same policy profile
- Same execution mode
- Same model mode

The canonical subset of the RunResult MUST be byte-identical.

---

## 5. Error Semantics

### 5.1 Error Format

All errors MUST use structured format:

```typescript
interface RunError {
  code: string;      // Stable error code (e.g., "RUN_E001")
  message: string;   // Human-readable message
  rule_id?: string;  // Related invariant (e.g., "RS3")
  details?: object;  // Additional structured details
}
```

### 5.2 Error Codes

| Code | Meaning |
|------|---------|
| `RUN_E001` | Intent file not found or unreadable |
| `RUN_E002` | Intent parse error (invalid JSON) |
| `RUN_E003` | Intent validation error (missing goal) |
| `RUN_E004` | Policy violation |
| `RUN_E005` | Sandbox execution error |
| `RUN_E006` | Evidence validation error |
| `RUN_E007` | Internal harness error |

### 5.3 Decision Record

The `decision` field captures the final outcome:

```typescript
interface DecisionRecord {
  accepted: boolean;
  reasons: string[];
  validated_by_kernel: boolean;
}
```

- `accepted`: True only for successful BUNDLE outcomes
- `reasons`: Ordered list of decision factors
- `validated_by_kernel`: Always true (kernel is authoritative)

### 5.4 Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success: decision.accepted = true |
| 1 | Rejected: decision.accepted = false |
| 2 | Error: Harness error (not a decision) |

---

## 6. References

### 6.1 Related Specifications

- [BUNDLE_SPEC.md](./BUNDLE_SPEC.md) - Bundle output contract
- [EVIDENCE_SPEC.md](./EVIDENCE_SPEC.md) - Execution evidence contract
- [LEDGER_SPEC.md](./LEDGER_SPEC.md) - Audit trail contract
- [POLICY_SPEC.md](./POLICY_SPEC.md) - Policy profiles and enforcement
- [DETERMINISM.md](./DETERMINISM.md) - Canonicalization rules

### 6.2 Implementation References

- [src/harness/run_intent.ts](../src/harness/run_intent.ts) - CLI entrypoint
- [src/harness/types.ts](../src/harness/types.ts) - Type definitions
- [src/harness/policy.ts](../src/harness/policy.ts) - Policy loading

---

## 7. Invariants

All valid `RunResult` objects MUST satisfy these invariants.

### RS1: Schema Version Present

```
run_schema_version !== undefined && run_schema_version !== ''
```

Every RunResult MUST include a non-empty schema version string.

### RS2: Outcome Coverage

```
kernel_result_kind in {'BUNDLE', 'CLARIFY', 'REFUSE'}
```

The outcome MUST be one of the three defined types.

### RS3: Outcome-Field Consistency

```
if (kernel_result_kind === 'BUNDLE') {
  bundle !== null
  clarify_questions === undefined
  refuse_reason === undefined
}
if (kernel_result_kind === 'CLARIFY') {
  bundle !== null
  clarify_questions !== undefined && clarify_questions.length > 0
  refuse_reason === undefined
}
if (kernel_result_kind === 'REFUSE') {
  bundle === null
  refuse_reason !== undefined && refuse_reason !== ''
  clarify_questions === undefined
}
```

Outcome-specific fields MUST match the declared outcome.

### RS4: Reference Integrity

```
if (bundle !== null) {
  bundle.sha256 matches /^sha256:[a-f0-9]{64}$/
  bundle.bundle_id !== ''
}
intent.sha256 matches /^sha256:[a-f0-9]{64}$/
```

All hash references MUST be valid ContentHash format.

### RS5: Policy Binding

```
canonicalize(result.policy) === canonicalize(loadPolicy(policyName))
```

The embedded policy MUST be canonically equal to the resolved policy for the requested profile.

### RS6: No Leak (Public Output)

```
!result.intent.path.startsWith('/')
result.sandbox_path === undefined  // in public output
result.model_io_path === undefined  // in public output
```

Public outputs MUST NOT contain absolute paths or host-identifying data.

### RS7: Canonical Output

```
JSON.parse(stdout) deep-equals JSON.parse(canonicalize(result))
```

CLI stdout MUST be parseable and canonically equivalent to the internal result.

### RS8: Decision Consistency

```
if (kernel_result_kind === 'BUNDLE' && execution !== null) {
  decision.accepted === (execution.exit_code === 0)
}
if (kernel_result_kind !== 'BUNDLE') {
  decision.accepted === false
}
decision.validated_by_kernel === true
```

Decision MUST be consistent with outcome and execution results.

---

## 8. Versioning

### 8.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to schema or invariants
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 8.2 Schema Version

The `run_schema_version` field tracks the RunResult schema independently:

- Changes to required fields require schema version bump
- Consumers SHOULD check schema version for compatibility

### 8.3 Backwards Compatibility

RunResults produced under schema version N MUST be valid under schema version N+1 (minor/patch) unless a MAJOR version bump is released.

### 8.4 Version History

| Spec Version | Schema Version | Date | Changes |
|--------------|----------------|------|---------|
| 1.0.0 | 1.0.0 | 2026-01-05 | Initial normative specification |

---

*This is a normative specification. Implementations MUST conform to all invariants.*
