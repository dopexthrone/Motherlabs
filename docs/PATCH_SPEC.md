# Patch Specification

Normative contract for the patch/proposal format emitted by the kernel proposal protocol and consumed by the harness.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.7+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The structure and semantics of `PatchSet` (file change operations)
- The structure of `PatchOperation` (individual file operations)
- Path validation rules for target paths
- Content validation rules for file content
- Operation type constraints
- Determinism rules for canonical representation
- Pre-execution validation ("safe to attempt in sandbox")

### 1.2 Non-Goals

This specification does NOT define:

- Execution authority (harness/executor is non-authoritative)
- Correctness of patch content (verification is a gate, not a guarantee)
- Post-execution validation (see EVIDENCE_SPEC.md)
- Diff/hunk semantics for modify operations (currently whole-file replacement)
- Shell command operations (execute_command, validate, test types)

### 1.3 Authority Model

The kernel is **authoritative** for generating patches. The harness/executor is **non-authoritative** and only:
- Verifies patches are safe to attempt
- Applies patches in a sandboxed environment
- Reports evidence back to kernel for validation

Patch verification answers: "Is this safe to attempt in sandbox?" not "Is this correct?"

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **PatchSet** | Ordered collection of file operations extracted from a Proposal |
| **PatchOperation** | Single file operation: create, modify, or delete |
| **TargetPath** | Relative file path that is the target of an operation |
| **FileContent** | UTF-8 text content for create/modify operations |
| **PatchOpType** | Operation type enum: `'create' \| 'modify' \| 'delete'` |
| **PatchCore** | Canonical subset of PatchSet for hashing (excludes ephemeral metadata) |
| **Violation** | Spec violation with rule_id, path, and message |

---

## 3. PatchSet Schema

### 3.1 Schema Version

All patch sets MUST include a schema version:

| Field | Type | Description |
|-------|------|-------------|
| `patch_schema_version` | `string` | Schema version, e.g., `"1.0.0"` |

Current schema version: `1.0.0`

### 3.2 PatchSet Structure

```typescript
interface PatchSet {
  /** Schema version for this format */
  patch_schema_version: string;

  /** Source proposal ID that generated this patch set */
  source_proposal_id: string;

  /** Hash of the source proposal */
  source_proposal_hash: string;

  /** Ordered list of file operations */
  operations: PatchOperation[];

  /** Total byte count of all content */
  total_bytes: number;
}
```

### 3.3 PatchOperation Structure

```typescript
interface PatchOperation {
  /** Operation type */
  op: PatchOpType;

  /** Target file path (relative, POSIX-style) */
  path: string;

  /** File content (for create/modify operations) */
  content?: string;

  /** Expected content hash after operation */
  expected_hash?: string;

  /** Content size in bytes */
  size_bytes?: number;
}
```

### 3.4 PatchOpType Enum

| Value | Description |
|-------|-------------|
| `create` | Create a new file (MUST not exist) |
| `modify` | Replace existing file content (MUST exist) |
| `delete` | Delete an existing file (MUST exist) |

### 3.5 Mapping from ProposedAction

PatchOperations are derived from `ProposedAction` in the proposal protocol:

| ProposedAction.type | PatchOperation.op |
|---------------------|-------------------|
| `create_file` | `create` |
| `modify_file` | `modify` |
| `delete_file` | `delete` |

Non-file operations (`execute_command`, `validate`, `test`) are excluded from PatchSet.

---

## 4. Path Rules (Normative)

### 4.1 Required Format

Target paths MUST be:

- Relative paths (no leading `/`)
- POSIX-style (forward slashes `/` only)
- Normalized (no `.` or `..` segments)
- Non-empty

### 4.2 Forbidden Patterns

Target paths MUST NOT contain:

| Pattern | Rule |
|---------|------|
| Absolute paths | Paths starting with `/` |
| Path traversal | `..` segments anywhere |
| Windows drive prefixes | `C:`, `D:`, etc. |
| Backslashes | `\` characters |
| Null bytes | `\0` characters |
| Control characters | ASCII 0x00-0x1F except tab/newline |
| Leading/trailing whitespace | Spaces at start/end |

### 4.3 Path Normalization

If a path contains redundant segments, it MUST be rejected (not normalized):

- `./foo/bar` → REJECT (use `foo/bar`)
- `foo//bar` → REJECT (use `foo/bar`)
- `foo/` → REJECT (use `foo`)

### 4.4 Duplicate Path Handling

A PatchSet MUST NOT contain duplicate target paths. If duplicates exist:

- Verifier returns a PS5 violation
- Operations are NOT merged or deduplicated

---

## 5. Content Rules (Normative)

### 5.1 Encoding

All file content MUST be valid UTF-8 text.

Binary files are NOT supported. The verifier rejects content with:
- Invalid UTF-8 sequences
- Null bytes (`\0`)

### 5.2 Newline Policy

Newlines are preserved exactly as provided. The kernel does NOT normalize newlines.

- `\n` (LF) is preserved
- `\r\n` (CRLF) is preserved
- `\r` (CR) is preserved
- Mixed line endings are preserved

### 5.3 Size Limits

Content size is constrained by policy limits:

| Policy | max_total_output_bytes | Per-file implicit |
|--------|------------------------|-------------------|
| strict | 10 MB | No explicit limit |
| default | 50 MB | No explicit limit |
| dev | 100 MB | No explicit limit |

Total patch content (`total_bytes`) MUST NOT exceed the policy limit.

### 5.4 Empty Content

- `create` with empty content (`""`) is allowed (creates empty file)
- `modify` with empty content is allowed (truncates file)
- `delete` MUST NOT have `content` field

---

## 6. Operation Rules (Normative)

### 6.1 Allowed Operations

| Operation | Description | Requirements |
|-----------|-------------|--------------|
| `create` | Create new file | `content` required, `path` must not exist |
| `modify` | Replace file content | `content` required, `path` must exist |
| `delete` | Delete file | No `content`, `path` must exist |

### 6.2 Disallowed Operations

The following are NOT supported:

| Operation | Reason |
|-----------|--------|
| Rename/move | Not in proposal protocol |
| Symbolic links | Security concern |
| Permission changes | Not in proposal protocol |
| Directory operations | Implicit (created as needed) |
| Glob patterns | Explicit paths only |

### 6.3 Operation Ordering

Operations MUST be ordered by:
1. `order` field ascending (from ProposedAction)
2. `path` ascending (lexicographic, for stability)

This ensures deterministic application order.

---

## 7. Determinism Rules (Normative)

### 7.1 PatchSet Canonicalization

When serialized, a PatchSet MUST use canonical JSON:

1. Keys sorted lexicographically at all levels
2. Operations sorted by (order, path)
3. No trailing whitespace
4. UTF-8 encoding
5. No undefined values

### 7.2 PatchCore Definition

`PatchCore` is the canonical subset for hashing, excluding ephemeral metadata:

**Included fields:**
- `patch_schema_version`
- `source_proposal_id`
- `source_proposal_hash`
- `operations` (sorted)
- `total_bytes`

**All fields are included** (no ephemeral fields in current schema).

### 7.3 PatchSet Hash

```typescript
function computePatchHash(patchSet: PatchSet): string {
  const canonical = canonicalize(patchSet);
  return `sha256:${sha256(canonical)}`;
}
```

### 7.4 Violation Reporting

Violations MUST be reported in deterministic order:

1. Sort by `rule_id` ascending
2. Then by `path` ascending

---

## 8. Invariants

All valid `PatchSet` objects MUST satisfy these invariants.

### PS1: Schema Version Present

```
patch_schema_version !== undefined && patch_schema_version !== ''
```

Every PatchSet MUST include a non-empty schema version string.

### PS2: Op Enum Valid

```
operations.every(op => op.op in {'create', 'modify', 'delete'})
```

All operations MUST have a valid operation type.

### PS3: Path Relative Only

```
operations.every(op => !op.path.startsWith('/'))
operations.every(op => !/^[A-Za-z]:/.test(op.path))
```

All target paths MUST be relative (no absolute paths, no Windows drives).

### PS4: No Path Traversal

```
operations.every(op => !op.path.includes('..'))
operations.every(op => !op.path.includes('\\'))
```

No path traversal (`..`) or backslash characters in paths.

### PS5: No Duplicate Targets

```
new Set(operations.map(op => op.path)).size === operations.length
```

All target paths MUST be unique within a PatchSet.

### PS6: Text Only UTF-8

```
operations.every(op =>
  op.content === undefined || isValidUtf8(op.content)
)
operations.every(op =>
  op.content === undefined || !op.content.includes('\0')
)
```

All content MUST be valid UTF-8 without null bytes.

### PS7: Max Bytes Enforced

```
total_bytes <= policy.max_total_output_bytes
```

Total content size MUST NOT exceed policy limits.

### PS8: Sorting Canonical

```
operations === sortBy(operations, ['order', 'path'])
```

Operations MUST be sorted by order, then path.

### PS9: No Symlink Intent

```
operations.every(op => op.op !== 'symlink')
```

No symlink operations (not in enum, but reject if encountered).

### PS10: Stable Violations

```
violations === sortBy(violations, ['rule_id', 'path'])
```

Violation output MUST be deterministically sorted.

---

## 9. Versioning

### 9.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to schema or invariants
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 9.2 Schema Version

The `patch_schema_version` field tracks the PatchSet schema independently.

### 9.3 Version History

| Spec Version | Schema Version | Date | Changes |
|--------------|----------------|------|---------|
| 1.0.0 | 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 10. References

### 10.1 Related Specifications

- [BUNDLE_SPEC.md](./BUNDLE_SPEC.md) - Bundle output contract
- [EVIDENCE_SPEC.md](./EVIDENCE_SPEC.md) - Execution evidence contract
- [POLICY_SPEC.md](./POLICY_SPEC.md) - Policy profiles and limits
- [RUN_SPEC.md](./RUN_SPEC.md) - Run result contract

### 10.2 Implementation References

- [src/protocol/proposal.ts](../src/protocol/proposal.ts) - ProposedAction types
- [src/consumer/patch_types.ts](../src/consumer/patch_types.ts) - Consumer types
- [src/consumer/patch_verify.ts](../src/consumer/patch_verify.ts) - Verifier

---

*This is a normative specification. Implementations MUST conform to all invariants.*
