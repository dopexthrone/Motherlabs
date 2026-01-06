# Apply Specification

Normative contract for the apply result format produced when applying a patch to a target directory.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.12+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The structure and semantics of `ApplyResult` (outcome of applying a patch)
- The structure of `ApplyOperationResult` (individual operation outcome)
- Target directory validation rules
- Safety constraints for patch application
- Determinism rules for apply reports
- Dry-run semantics

### 1.2 Non-Goals

This specification does NOT define:

- Patch format (see PATCH_SPEC.md)
- Kernel authority (apply is a consumer operation)
- Git integration or version control
- Rollback mechanisms
- Concurrent application handling

### 1.3 Authority Model

The apply operation is **non-authoritative**. It:
- Validates the target directory is safe
- Validates the patch before application
- Applies patch operations in deterministic order
- Reports results with before/after hashes for auditing

The kernel does NOT participate in apply; this is purely a consumer operation.

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **ApplyResult** | Complete outcome of applying a patch to a target |
| **ApplyOperationResult** | Outcome of a single operation (create/modify/delete) |
| **TargetRoot** | Directory path where patch operations are applied |
| **BeforeHash** | SHA-256 hash of file content before operation |
| **AfterHash** | SHA-256 hash of file content after operation |
| **DryRun** | Mode where report is generated but no writes occur |
| **ApplyOutcome** | Status enum: `SUCCESS`, `PARTIAL`, `FAILED`, `REFUSED` |

---

## 3. ApplyResult Schema

### 3.1 Schema Version

All apply results MUST include a schema version:

| Field | Type | Description |
|-------|------|-------------|
| `apply_schema_version` | `string` | Schema version, e.g., `"1.0.0"` |

Current schema version: `1.0.0`

### 3.2 ApplyResult Structure

```typescript
interface ApplyResult {
  /** Schema version for this format */
  apply_schema_version: string;

  /** Overall outcome */
  outcome: ApplyOutcome;

  /** Whether this was a dry run (no writes) */
  dry_run: boolean;

  /** Target root directory (sanitized, no absolute paths in output) */
  target_root: string;

  /** Patch source info */
  patch_source: {
    proposal_id: string;
    proposal_hash: string;
  };

  /** Per-operation results (sorted by path) */
  operation_results: ApplyOperationResult[];

  /** Summary statistics */
  summary: ApplySummary;

  /** Violations if any (sorted by rule_id, path) */
  violations?: ApplyViolation[];

  /** Error message if outcome is FAILED or REFUSED */
  error?: string;
}
```

### 3.3 ApplyOutcome Enum

| Value | Description |
|-------|-------------|
| `SUCCESS` | All operations completed successfully |
| `PARTIAL` | Some operations succeeded, some failed |
| `FAILED` | All operations failed or critical error occurred |
| `REFUSED` | Apply was refused before attempting (validation failure) |

### 3.4 ApplyOperationResult Structure

```typescript
interface ApplyOperationResult {
  /** Operation type */
  op: 'create' | 'modify' | 'delete';

  /** Target path (relative) */
  path: string;

  /** Operation status */
  status: 'success' | 'skipped' | 'error';

  /** Hash of file before operation (null if didn't exist) */
  before_hash: string | null;

  /** Hash of file after operation (null if deleted/error) */
  after_hash: string | null;

  /** Bytes written (0 for delete) */
  bytes_written: number;

  /** Error message if status is 'error' */
  error?: string;
}
```

### 3.5 ApplySummary Structure

```typescript
interface ApplySummary {
  /** Total operations in patch */
  total_operations: number;

  /** Operations that succeeded */
  succeeded: number;

  /** Operations that were skipped (dry-run or precondition failed) */
  skipped: number;

  /** Operations that failed with error */
  failed: number;

  /** Total bytes written */
  total_bytes_written: number;
}
```

### 3.6 ApplyViolation Structure

```typescript
interface ApplyViolation {
  /** Rule ID from APPLY_SPEC (e.g., "AS5") */
  rule_id: string;

  /** Relevant path (optional) */
  path?: string;

  /** Human-readable message */
  message: string;
}
```

---

## 4. Target Root Rules (Normative)

### 4.1 Required Properties

The target root MUST be:

- An existing directory
- Writable by the process
- Not a symbolic link itself

### 4.2 Forbidden Patterns

Target root MUST NOT:

| Pattern | Rule |
|---------|------|
| Contain symlinks in ancestry | No symlinks in path to root |
| Be root filesystem | `/` is forbidden |
| Contain path traversal | No `..` in path |

### 4.3 Symlink Safety

Before applying any operation:

1. Target root MUST NOT be a symlink
2. Any existing file in target tree that is a symlink causes REFUSE
3. Patch MUST NOT create symlinks (enforced by PATCH_SPEC)

### 4.4 Path Resolution

All patch paths are resolved relative to target root:
- `foo/bar.txt` → `{target_root}/foo/bar.txt`
- Parent directories are created as needed
- No operation may write outside target root

---

## 5. Operation Rules (Normative)

### 5.1 Create Operation

| Condition | Result |
|-----------|--------|
| File does not exist | Create file with content, status=success |
| File exists | status=error with message "file already exists" |
| Parent dir missing | Create parent dirs, then file |

### 5.2 Modify Operation

| Condition | Result |
|-----------|--------|
| File exists (regular) | Replace content, status=success |
| File does not exist | status=error with message "file does not exist" |
| Path is directory | status=error with message "path is a directory" |

### 5.3 Delete Operation

| Condition | Result |
|-----------|--------|
| File exists (regular) | Delete file, status=success |
| File does not exist | status=error with message "file does not exist" |
| Path is directory | status=error with message "path is a directory" |

### 5.4 Operation Order

Operations MUST be applied in this order:

1. Sort by `path` ascending (lexicographic)
2. Apply in sorted order
3. Report in sorted order

This ensures deterministic behavior regardless of original patch ordering.

---

## 6. Dry-Run Semantics (Normative)

### 6.1 Dry-Run Mode

When `dry_run=true`:

1. All validations are performed
2. Before hashes are computed
3. After hashes are computed (as if content would be written)
4. NO filesystem writes occur
5. Result has `dry_run=true`

### 6.2 Dry-Run Result Equivalence

A dry-run result MUST be byte-identical to an actual apply result EXCEPT:

- `dry_run` field is `true` instead of `false`
- Actual apply writes files; dry-run does not

### 6.3 Hash Computation in Dry-Run

For create/modify operations in dry-run:
- `before_hash`: Hash of existing file or null
- `after_hash`: Hash of content that WOULD be written

---

## 7. Determinism Rules (Normative)

### 7.1 Result Canonicalization

When serialized, an ApplyResult MUST use canonical JSON:

1. Keys sorted lexicographically at all levels
2. Operation results sorted by path
3. Violations sorted by (rule_id, path)
4. No trailing whitespace
5. UTF-8 encoding

### 7.2 Hash Format

All hashes use the format: `sha256:{64 hex characters}`

Example: `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

### 7.3 Reproducibility

Given:
- Same patch content
- Same target directory initial state
- Same dry_run setting

The apply result MUST be byte-identical across invocations.

---

## 8. Invariants

All valid `ApplyResult` objects MUST satisfy these invariants.

### AS1: Schema Version Present

```
apply_schema_version !== undefined && apply_schema_version !== ''
```

Every ApplyResult MUST include a non-empty schema version string.

### AS2: Deterministic Ordering

```
operation_results === sortBy(operation_results, ['path'])
violations === sortBy(violations, ['rule_id', 'path'])
```

Operation results and violations MUST be sorted deterministically.

### AS3: Patch Required

```
if no patch.json in pack → outcome === 'REFUSED'
```

Apply MUST refuse if the pack has no patch.json file.

### AS4: Patch Must Pass Verification

```
if verifyPatch(patch).ok === false → outcome === 'REFUSED'
```

Patch MUST pass PATCH_SPEC verification before apply attempts.

### AS5: Target Root Safety

```
!hasPathTraversal(target_root)
!isSymlink(target_root)
isDirectory(target_root)
```

Target root MUST be safe: no traversal, no symlinks, must be directory.

### AS6: Write Set Equals Patch Set

```
set(operation_results.map(r => r.path)) === set(patch.operations.map(o => o.path))
```

Exactly the paths in the patch are reported; no extra writes.

### AS7: Hashes Present

```
operation_results.every(r =>
  r.before_hash === null || r.before_hash.startsWith('sha256:')
)
operation_results.every(r =>
  r.after_hash === null || r.after_hash.startsWith('sha256:')
)
```

All hashes use `sha256:` prefix format.

### AS8: Dry-Run No Writes

```
if dry_run === true → no filesystem modifications
```

Dry-run mode MUST NOT modify the filesystem.

### AS9: Stable Error Codes

```
error messages are deterministic for same conditions
```

Error messages MUST be stable and deterministic.

### AS10: Canonical JSON Output

```
serialize(result) === canonicalize(result)
```

All JSON output MUST use canonical serialization.

### AS11: Idempotence Documentation

```
// Documented in spec, not enforced
```

Applying the same patch twice is documented behavior:
- Create on existing file → error
- Modify on modified file → success (whole-file replace)
- Delete on missing file → error

### AS12: No Absolute Path Leakage

```
!target_root.startsWith('/')
operation_results.every(r => !r.path.startsWith('/'))
```

No absolute paths in the result output.

---

## 9. Error Codes

### 9.1 CLI Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (outcome=SUCCESS) |
| 1 | Partial or failed (outcome=PARTIAL or FAILED) |
| 2 | Refused or validation error (outcome=REFUSED) |
| 3 | IO error (pack not found, etc.) |

### 9.2 Stable Error Messages

| Condition | Message |
|-----------|---------|
| No patch.json | `pack has no patch.json` |
| Patch verification failed | `patch verification failed: {count} violations` |
| Target not directory | `target root is not a directory` |
| Target is symlink | `target root is a symbolic link` |
| Traversal in target | `target root contains path traversal` |
| File exists (create) | `file already exists: {path}` |
| File missing (modify/delete) | `file does not exist: {path}` |
| Path is directory | `path is a directory: {path}` |

---

## 10. Versioning

### 10.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to schema or invariants
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 10.2 Version History

| Spec Version | Schema Version | Date | Changes |
|--------------|----------------|------|---------|
| 1.0.0 | 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 11. References

### 11.1 Related Specifications

- [PATCH_SPEC.md](./PATCH_SPEC.md) - Patch format contract
- [PACK_SPEC.md](./PACK_SPEC.md) - Pack directory contract
- [EVIDENCE_SPEC.md](./EVIDENCE_SPEC.md) - Execution evidence contract

### 11.2 Implementation References

- [src/consumer/apply_types.ts](../src/consumer/apply_types.ts) - Consumer types
- [src/consumer/apply_verify.ts](../src/consumer/apply_verify.ts) - Apply result verifier
- [src/tools/pack_apply.ts](../src/tools/pack_apply.ts) - CLI tool

---

*This is a normative specification. Implementations MUST conform to all invariants.*
