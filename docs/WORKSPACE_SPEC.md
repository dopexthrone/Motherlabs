# Workspace Snapshot Specification

**Status**: Normative
**Version**: 1.0.0
**Last Updated**: 2026-01-06

## Overview

This specification defines the **Workspace Snapshot** artifact format for capturing deterministic descriptions of execution inputs outside the repository commit. A workspace snapshot enables consumer reproduction of pack-export, pack-apply, and git-apply outcomes without exposing secrets or absolute paths.

## Related Specifications

- **[REPO_STATE_SPEC.md](./REPO_STATE_SPEC.md)** - Repository state (commit, lockfile, node version)
- **[PACK_SPEC.md](./PACK_SPEC.md)** - Pack format and verification
- **[MODEL_IO_SPEC.md](./MODEL_IO_SPEC.md)** - Model IO recording sessions
- **[POLICY_SPEC.md](./POLICY_SPEC.md)** - Policy profiles and enforcement

## Design Principles

1. **Determinism**: Identical inputs produce byte-identical snapshots
2. **Secret Prevention**: No raw secrets, tokens, or credentials ever appear
3. **Path Safety**: All paths are relative, no traversal, no absolute paths
4. **Content-Addressed**: All referenced artifacts identified by SHA256
5. **Minimal Surface**: Only capture what affects execution outcomes

## Schema

### WorkspaceSnapshot

```typescript
interface WorkspaceSnapshot {
  // Required: Schema version (WS1)
  workspace_schema_version: '1.0.0';

  // Tool invocation (WS2, WS3)
  tool_id: 'pack-export' | 'pack-apply' | 'git-apply' | 'repo-state' | 'workspace-snapshot';
  args: Record<string, string | boolean | string[]>;  // Canonical: sorted keys, sorted arrays

  // Referenced inputs (WS4, WS5)
  refs: {
    intent?: { rel_path: string; sha256: string };
    pack?: { rel_path: string; pack_hash: string };
    model_io?: { rel_path: string; sha256: string };
    policy: { profile: string; policy_hash: string };
    repo_state?: { rel_path: string; sha256: string };
  };

  // Environment (WS6, WS7, WS8)
  env: {
    allowlist: string[];  // Sorted, unique
    hashed: Array<{ name: string; sha256: string }>;  // Sorted by name
  };

  // Safety boundaries (WS14)
  safety: {
    work_root_rel: '.';
    denies_absolute: true;
    denies_traversal: true;
  };

  // Optional warnings
  warnings?: string[];  // Sorted, stable codes

  // Ephemeral (excluded from core hash) (WS9)
  ephemeral?: {
    generated_at?: string;  // ISO 8601 UTC
    tool_version?: string;  // Display only
    human_notes?: string;
  };
}
```

### WorkspaceSnapshotCore

The core fields used for content-addressing (excludes `ephemeral`):

```typescript
interface WorkspaceSnapshotCore {
  workspace_schema_version: string;
  tool_id: string;
  args: Record<string, string | boolean | string[]>;
  refs: { ... };
  env: { ... };
  safety: { ... };
  warnings?: string[];
}
```

## Tool IDs

| Tool ID | Description | Required Refs |
|---------|-------------|---------------|
| `pack-export` | Export pack from intent | `intent` |
| `pack-apply` | Apply pack to filesystem | `pack` |
| `git-apply` | Apply pack via git | `pack` |
| `repo-state` | Capture repository state | (none) |
| `workspace-snapshot` | Capture workspace snapshot | (none) |

## Environment Variable Handling

### Default Allowlist

The following environment variables are captured by default (values hashed, never raw):

- `NODE_ENV`
- `TZ`
- `LANG`
- `LC_ALL`

### Forbidden Prefixes

The following prefixes are **never** allowed, even with explicit `--env-allow`:

- `PATH` (exact match)
- `HOME` (exact match)
- `USER` (exact match)
- `SSH_*`
- `NPM_*`
- `GIT_*`
- `AWS_*`
- `OPENAI_*`
- `ANTHROPIC_*`

### Custom Allowlist

Additional variables may be added via `--env-allow NAME` (repeatable). Values are always hashed, never stored raw.

## Invariants

### WS1: Schema Version Present

The `workspace_schema_version` field:
- MUST be present
- MUST equal `"1.0.0"`
- MUST be a non-empty string

### WS2: Tool ID Valid

The `tool_id` field:
- MUST be present
- MUST be one of: `pack-export`, `pack-apply`, `git-apply`, `repo-state`, `workspace-snapshot`

### WS3: Args Canonical

The `args` object:
- MUST have keys sorted lexicographically
- MUST have array values sorted lexicographically
- MUST NOT contain `null` or `undefined` values
- MUST NOT contain raw filesystem paths (use refs instead)

### WS4: All Refs Relative

All path fields in `refs`:
- MUST be relative paths (no leading `/`)
- MUST NOT contain path traversal (`..`)
- MUST NOT contain Windows drive letters (`C:\`, etc.)
- MUST NOT contain backslashes

### WS5: Hash Format

All hash fields (`sha256`, `pack_hash`, `policy_hash`):
- MUST use format `sha256:<64 lowercase hex chars>`
- MUST be computed from canonical JSON or file bytes

### WS6: Env Allowlist Valid

The `env.allowlist` array:
- MUST be sorted lexicographically
- MUST contain unique values (no duplicates)
- MUST NOT contain forbidden names or prefixes
- MUST only contain uppercase alphanumeric and underscore

### WS7: Env Hashed Subset

The `env.hashed` array:
- MUST only contain names present in `env.allowlist`
- MUST be sorted by `name` lexicographically
- Each entry MUST have valid `sha256` format

### WS8: No Plaintext Values

No field in the snapshot:
- MAY contain a key named `value` with environment variable content
- MAY contain raw credential strings
- All sensitive data MUST be hashed

### WS9: Core Hash Excludes Ephemeral

When computing the workspace snapshot hash:
- The `ephemeral` field MUST be excluded
- Hash MUST be computed from WorkspaceSnapshotCore only

### WS10: Canonical Round-Trip

The snapshot:
- MUST survive JSON parse/stringify round-trip unchanged
- MUST be serialized using `canonicalize()`

### WS11: Violations Stable

Verification violations:
- MUST be sorted by `rule_id` ascending
- MUST be sorted by `path` ascending (secondary)
- MUST be deterministic across runs

### WS12: Required Refs by Tool

Based on `tool_id`:
- `pack-export`: MUST have `refs.intent`
- `pack-apply`: MUST have `refs.pack`
- `git-apply`: MUST have `refs.pack`
- `repo-state`: No required refs
- `workspace-snapshot`: No required refs

### WS13: Model IO Ref Conditional

The `refs.model_io` field:
- MUST be present if `args.model_mode` is `record` or `replay`
- MAY be absent if `args.model_mode` is `none` or undefined

### WS14: Leak Prevention

All string fields:
- MUST NOT start with `/` (Unix absolute)
- MUST NOT match pattern `^[A-Za-z]:` (Windows absolute)
- MUST NOT contain path segments with `..`

## Verification

### Input

Any JSON value (parsed from file or stdin).

### Output

```typescript
interface WorkspaceVerificationResult {
  valid: boolean;
  violations: WorkspaceViolation[];
  workspace_hash?: string;  // Present only if valid
}

interface WorkspaceViolation {
  rule_id: string;  // WS1, WS2, etc.
  message: string;
  path?: string;    // Field path if applicable
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | I/O error |
| 2 | Parse error (invalid JSON) |
| 3 | Validation error (invariant violations) |

## CLI Usage

```bash
# Generate workspace snapshot
npm run workspace-snapshot -- \
  --out workspace.json \
  --intent intent.json \
  --policy strict \
  --mode plan

# With pack reference
npm run workspace-snapshot -- \
  --out workspace.json \
  --pack ./packs/run_001 \
  --policy default

# With model IO reference
npm run workspace-snapshot -- \
  --out workspace.json \
  --intent intent.json \
  --model-io recording.json \
  --policy dev \
  --mode exec

# With custom env allowlist
npm run workspace-snapshot -- \
  --out workspace.json \
  --intent intent.json \
  --env-allow CI \
  --env-allow BUILD_NUMBER

# Verify existing snapshot
npm run workspace-snapshot -- --verify workspace.json
```

## Example Output

```json
{
  "workspace_schema_version": "1.0.0",
  "tool_id": "pack-export",
  "args": {
    "dry_run": false,
    "mode": "plan",
    "policy": "strict"
  },
  "refs": {
    "intent": {
      "rel_path": "intents/test.json",
      "sha256": "sha256:abc123..."
    },
    "policy": {
      "profile": "strict",
      "policy_hash": "sha256:def456..."
    }
  },
  "env": {
    "allowlist": ["LANG", "LC_ALL", "NODE_ENV", "TZ"],
    "hashed": [
      { "name": "NODE_ENV", "sha256": "sha256:..." }
    ]
  },
  "safety": {
    "work_root_rel": ".",
    "denies_absolute": true,
    "denies_traversal": true
  },
  "ephemeral": {
    "generated_at": "2026-01-06T12:00:00.000Z",
    "tool_version": "0.3.15"
  }
}
```

## Security Considerations

1. **No Secret Leakage**: Environment values are hashed, never stored raw
2. **Forbidden Variables**: Common secret-bearing env vars are blocked
3. **Path Sanitization**: Absolute paths stripped, traversal rejected
4. **Content-Addressed**: All refs verified by hash, not trust
5. **Minimal Surface**: Only explicitly referenced files are accessed

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-06 | Initial specification |
