# Git Apply Specification

Normative contract for applying a patch from a pack to a git repository working tree.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.13+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The structure and semantics of `GitApplyResult` (outcome of applying a patch to a git repo)
- Git repository validation rules
- Branch behavior and naming conventions
- Commit behavior (optional)
- Safety constraints for git operations
- Determinism rules for git apply reports

### 1.2 Non-Goals

This specification does NOT define:

- Patch format (see PATCH_SPEC.md)
- Apply result format (see APPLY_SPEC.md)
- Pack format (see PACK_SPEC.md)
- Network git operations (fetch, push, pull, remote)
- Git merge or rebase operations
- Conflict resolution

### 1.3 Authority Model

The git apply operation is **non-authoritative**. It:
- Validates the target is a git repository
- Validates working tree state (clean/dirty)
- Applies patch operations via the standard apply engine
- Optionally creates commits with deterministic messages
- Reports results with file hashes for auditing

The kernel does NOT participate in git apply; this is purely a harness operation.

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **GitApplyResult** | Complete outcome of applying a patch to a git repo |
| **RepoRoot** | Directory containing the git repository (.git) |
| **WorkingTree** | The checked-out files in the repository |
| **TargetBranch** | Branch where changes are applied |
| **HeadCommit** | The commit SHA at HEAD before/after apply |
| **CleanState** | Working tree has no uncommitted changes |
| **DirtyState** | Working tree has uncommitted changes |

---

## 3. GitApplyResult Schema

### 3.1 Schema Version

All git apply results MUST include a schema version:

| Field | Type | Description |
|-------|------|-------------|
| `git_apply_schema_version` | `string` | Schema version, e.g., `"1.0.0"` |

Current schema version: `1.0.0`

### 3.2 GitApplyResult Structure

```typescript
interface GitApplyResult {
  /** Schema version for this format */
  git_apply_schema_version: string;

  /** Overall outcome */
  outcome: GitApplyOutcome;

  /** Whether this was a dry run (no writes, no git state changes) */
  dry_run: boolean;

  /** Repository root (relative, no absolute paths) */
  repo_root: string;

  /** Branch information */
  branch: {
    name: string;
    created: boolean;
    head_before: string;
    head_after: string;
  };

  /** Git state information */
  git_state: {
    clean_before: boolean;
    clean_after: boolean;
  };

  /** Pack source information */
  pack_source: {
    run_id: string | null;
    bundle_hash: string | null;
  };

  /** Underlying apply result reference */
  apply_result_hash: string;

  /** Changed files with content hashes (sorted by path) */
  changed_files: GitChangedFile[];

  /** Summary statistics */
  summary: GitApplySummary;

  /** Commit information (if commit was created) */
  commit?: {
    sha: string;
    message: string;
  };

  /** Violations if any (sorted by rule_id, path) */
  violations?: GitApplyViolation[];

  /** Error message if outcome is FAILED or REFUSED */
  error?: string;
}
```

### 3.3 GitApplyOutcome Enum

| Value | Description |
|-------|-------------|
| `SUCCESS` | All operations completed successfully |
| `PARTIAL` | Some operations succeeded, some failed |
| `FAILED` | All operations failed or critical error occurred |
| `REFUSED` | Apply was refused before attempting (validation failure) |

### 3.4 GitChangedFile Structure

```typescript
interface GitChangedFile {
  /** Relative path from repo root */
  path: string;

  /** Operation type */
  op: 'create' | 'modify' | 'delete';

  /** SHA-256 hash of final file content (null for delete) */
  content_hash: string | null;
}
```

### 3.5 GitApplySummary Structure

```typescript
interface GitApplySummary {
  /** Total files changed */
  total_files: number;

  /** Files created */
  created: number;

  /** Files modified */
  modified: number;

  /** Files deleted */
  deleted: number;

  /** Total bytes written */
  total_bytes_written: number;
}
```

### 3.6 GitApplyViolation Structure

```typescript
interface GitApplyViolation {
  /** Rule ID from GIT_APPLY_SPEC (e.g., "GA2") */
  rule_id: string;

  /** Relevant path (optional) */
  path?: string;

  /** Human-readable message */
  message: string;
}
```

---

## 4. Repository Validation Rules (Normative)

### 4.1 Git Repository Detection

The target MUST be a valid git repository:
- Contains `.git` directory, OR
- `git rev-parse --is-inside-work-tree` returns `true`

### 4.2 Working Tree State

By default, apply MUST refuse if working tree is dirty:
- `git status --porcelain` returns non-empty output

The `--allow-dirty` flag can override this check.

### 4.3 Path Safety

All paths MUST follow APPLY_SPEC.md rules:
- No absolute paths
- No path traversal (`..`)
- Relative to repo root only

---

## 5. Branch Behavior (Normative)

### 5.1 Deterministic Branch Naming

If `--branch` is NOT provided, use deterministic default:

| Condition | Branch Name |
|-----------|-------------|
| Pack has run_id | `apply/{run_id}` |
| No run_id | `apply/manual` |

Branch names MUST NOT include timestamps or random components.

### 5.2 Branch Creation

| Condition | Behavior |
|-----------|----------|
| Branch exists | Checkout existing branch |
| Branch does not exist | Create and checkout new branch |

### 5.3 Branch State in Result

The result MUST include:
- `branch.name`: The target branch name
- `branch.created`: Whether branch was newly created
- `branch.head_before`: Commit SHA before apply
- `branch.head_after`: Commit SHA after apply (same if dry-run or no commit)

---

## 6. Commit Behavior (Normative)

### 6.1 Commit is Optional

Commits are ONLY created when `--commit` flag is provided.

### 6.2 Deterministic Commit Message

If no `--message` is provided, use deterministic format:

```
Apply patch from pack

Pack run_id: {run_id or "manual"}
Bundle hash: {bundle_hash or "unknown"}

Applied via git-apply CLI
```

### 6.3 Commit Requirements

When committing:
- Stage all changes with `git add -A`
- Create commit with provided or default message
- Result includes commit SHA and message

---

## 7. Allowed Git Commands (Normative)

### 7.1 Command Allowlist

ONLY these git commands are permitted:

| Command | Purpose |
|---------|---------|
| `git rev-parse --is-inside-work-tree` | Validate git repo |
| `git rev-parse --show-toplevel` | Get repo root |
| `git rev-parse HEAD` | Get current commit SHA |
| `git status --porcelain` | Check working tree state |
| `git branch --show-current` | Get current branch name |
| `git checkout -b <branch>` | Create and switch branch |
| `git checkout <branch>` | Switch to existing branch |
| `git branch --list <branch>` | Check if branch exists |
| `git add -A` | Stage changes (only if committing) |
| `git commit -m <message>` | Create commit (only if --commit) |
| `git config user.name` | Set local user (for commit) |
| `git config user.email` | Set local email (for commit) |

### 7.2 Forbidden Commands

The following are NEVER allowed:
- `git fetch`, `git pull`, `git push`
- `git remote`
- `git merge`, `git rebase`
- Any command with network access

---

## 8. Dry-Run Semantics (Normative)

### 8.1 Dry-Run Mode

When `dry_run=true`:

1. All validations are performed
2. Patch is verified
3. File changes are computed but NOT written
4. NO git state changes occur (no checkout, no staging, no commit)
5. Result has `dry_run=true`
6. `git_state.clean_after` equals `git_state.clean_before`
7. `branch.head_after` equals `branch.head_before`

---

## 9. Determinism Rules (Normative)

### 9.1 Result Canonicalization

When serialized, a GitApplyResult MUST use canonical JSON:

1. Keys sorted lexicographically at all levels
2. Changed files sorted by path
3. Violations sorted by (rule_id, path)
4. No trailing whitespace
5. UTF-8 encoding

### 9.2 Hash Format

All hashes use the format: `sha256:{64 hex characters}`

Example: `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

### 9.3 Reproducibility

Given:
- Same pack content
- Same initial repository state
- Same options (branch, commit, dry_run)

The git apply result MUST be byte-identical across invocations.

---

## 10. Invariants

All valid `GitApplyResult` objects MUST satisfy these invariants.

### GA1: Schema Version Present

```
git_apply_schema_version !== undefined && git_apply_schema_version === '1.0.0'
```

Every GitApplyResult MUST include schema version "1.0.0".

### GA2: Git Repository Required

```
if !isGitRepo(repo_root) → outcome === 'REFUSED'
error message: "target is not a git repository"
```

Target MUST be a valid git repository.

### GA3: No Path Traversal or Absolute Paths

```
!hasPathTraversal(repo_root)
changed_files.every(f => !f.path.startsWith('/'))
changed_files.every(f => !f.path.includes('..'))
```

No absolute paths or traversal in any output.

### GA4: Write Set Equals Patch Set

```
set(changed_files.map(f => f.path)) === set(patch.operations.map(o => o.path))
```

Exactly the paths in the patch are reported; no extra writes.

### GA5: Deterministic Ordering

```
changed_files === sortBy(changed_files, ['path'])
violations === sortBy(violations, ['rule_id', 'path'])
```

Changed files and violations MUST be sorted deterministically.

### GA6: Deterministic Branch Naming

```
if --branch provided:
  branch.name === provided_name
else if pack.run_id exists:
  branch.name === `apply/${pack.run_id}`
else:
  branch.name === 'apply/manual'
```

Branch names are deterministic and NEVER include timestamps.

### GA7: Dry-Run No State Changes

```
if dry_run === true:
  git_state.clean_after === git_state.clean_before
  branch.head_after === branch.head_before
  no filesystem writes
  no git index changes
```

Dry-run mode MUST NOT modify any state.

### GA8: Local Commands Only

```
// All git commands in allowlist (Section 7.1)
// NO network commands ever
```

Only local git commands from the allowlist are permitted.

### GA9: No Absolute Path Leakage

```
!repo_root.startsWith('/')
changed_files.every(f => !f.path.startsWith('/'))
```

No absolute paths in any output field.

### GA10: Commit Requires Flag

```
if commit !== undefined:
  --commit flag was provided
if --commit not provided:
  commit === undefined
  git_state.clean_after may be false
```

Commits are only created when explicitly requested.

### GA11: Canonical JSON Output

```
serialize(result) === canonicalize(result)
```

All JSON output MUST use canonical serialization.

### GA12: Deterministic Diff Summary

```
changed_files sorted by path
content_hash is sha256 of actual file content (not git blob id)
no line numbers or hunks included
```

Diff summary uses content hashes, not git-specific identifiers.

---

## 11. Error Codes

### 11.1 CLI Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (outcome=SUCCESS) |
| 1 | IO error (file not found, etc.) |
| 2 | Parse error (invalid JSON, etc.) |
| 3 | Validation/spec violation (GA*) |
| 4 | Git error (command failed) |

### 11.2 Stable Error Messages

| Condition | Message |
|-----------|---------|
| Not a git repo | `target is not a git repository` |
| Dirty working tree | `working tree has uncommitted changes` |
| Pack has no patch | `pack has no patch.json` |
| Patch verification failed | `patch verification failed: {count} violations` |
| Git command failed | `GIT_ERROR: {command} failed: {stderr}` |
| Path traversal | `path traversal not allowed: {path}` |
| Absolute path | `absolute path not allowed: {path}` |

---

## 12. Versioning

### 12.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to schema or invariants
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 12.2 Version History

| Spec Version | Schema Version | Date | Changes |
|--------------|----------------|------|---------|
| 1.0.0 | 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 13. References

### 13.1 Related Specifications

- [PATCH_SPEC.md](./PATCH_SPEC.md) - Patch format contract
- [APPLY_SPEC.md](./APPLY_SPEC.md) - Apply result contract
- [PACK_SPEC.md](./PACK_SPEC.md) - Pack directory contract

### 13.2 Implementation References

- [src/harness/git_apply.ts](../src/harness/git_apply.ts) - Git apply engine
- [src/tools/git_apply.ts](../src/tools/git_apply.ts) - CLI tool

---

*This is a normative specification. Implementations MUST conform to all invariants.*
