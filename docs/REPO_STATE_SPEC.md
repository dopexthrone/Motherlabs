# Repository State Specification

**Version**: 1.0.0
**Status**: Normative
**Last Updated**: 2026-01-06

## Purpose

This specification defines the `repo_state.json` artifact format for capturing a deterministic, content-addressed snapshot of the repository environment. This enables reproducibility auditing and verification without relying on human notes.

**Key principle**: repo_state.json is a consumer/audit artifact, NOT an authoritative source. It captures metadata for verification purposes only.

## Related Specifications

- **[BUNDLE_SPEC.md](./BUNDLE_SPEC.md)** - Bundle output contract
- **[RUN_SPEC.md](./RUN_SPEC.md)** - Run result contract
- **[PACK_SPEC.md](./PACK_SPEC.md)** - Pack export contract
- **[VERIFY_RELEASE.md](./VERIFY_RELEASE.md)** - Release verification recipe

## Schema

### Top-Level Structure

```typescript
interface RepoState {
  // Core fields (content-addressed, included in hash)
  repo_state_schema_version: string;  // "1.0.0"

  // Git state
  repo_commit: string;                // 40-hex SHA-1
  repo_dirty: boolean;
  dirty_paths: string[];              // Sorted, relative paths only

  // Runtime environment
  node_version: string;               // e.g., "v24.11.1"
  npm_version: string;                // e.g., "11.6.2"
  os_platform: string;                // "linux" | "darwin" | "win32"
  os_arch: string;                    // "x64" | "arm64" | etc.

  // Dependencies
  package_lock_sha256: string;        // "sha256:<64hex>"

  // Contract versions (spec version map)
  contracts: {
    bundle_schema_version: string;
    run_schema_version: string;
    patch_schema_version: string;
    pack_schema_version: string;
    model_io_schema_version: string;
    apply_schema_version: string;
    git_apply_schema_version: string;
  };

  // Ephemeral fields (excluded from core hash, display-only)
  ephemeral?: {
    generated_at?: string;            // ISO 8601 UTC timestamp
    display_branch?: string;          // Current branch name (varies)
  };
}
```

### RepoStateCore

The content-addressed core excludes ephemeral fields:

```typescript
interface RepoStateCore {
  repo_state_schema_version: string;
  repo_commit: string;
  repo_dirty: boolean;
  dirty_paths: string[];
  node_version: string;
  npm_version: string;
  os_platform: string;
  os_arch: string;
  package_lock_sha256: string;
  contracts: {
    bundle_schema_version: string;
    run_schema_version: string;
    patch_schema_version: string;
    pack_schema_version: string;
    model_io_schema_version: string;
    apply_schema_version: string;
    git_apply_schema_version: string;
  };
}
```

### Verification Result

```typescript
interface RepoStateVerificationResult {
  valid: boolean;
  violations: RepoStateViolation[];
  repo_state_hash?: string;           // sha256 of RepoStateCore (on success)
  node_version_match?: boolean;       // true if matches baseline
}

interface RepoStateViolation {
  rule_id: string;                    // "RS1", "RS2", etc.
  message: string;
  path?: string;                      // Optional path context
}
```

## Invariants

### RS1: Schema Version Present

The `repo_state_schema_version` field MUST be present and equal `"1.0.0"`.

```
VALID:   { "repo_state_schema_version": "1.0.0", ... }
INVALID: { "repo_state_schema_version": "2.0.0", ... }
INVALID: { }  // missing
```

### RS2: Node Version Baseline

The `node_version` MUST match the freeze baseline (`v24.11.1`) unless policy explicitly allows deviation. This is a warning, not a hard failure, but MUST be flagged.

```
VALID:   { "node_version": "v24.11.1", ... }
WARNING: { "node_version": "v22.0.0", ... }  // flagged but may pass
```

### RS3: Repository Commit Format

The `repo_commit` field MUST be a 40-character lowercase hexadecimal SHA-1 hash.

```
VALID:   "repo_commit": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
INVALID: "repo_commit": "HEAD"
INVALID: "repo_commit": "a1b2c3d4"  // too short
INVALID: "repo_commit": "A1B2C3..."  // uppercase
```

### RS4: Dirty Paths Validity

All entries in `dirty_paths` MUST be:
- Relative paths (no leading `/` or drive letters)
- No path traversal (`..`)
- Sorted lexicographically (codepoint order)
- Unique (no duplicates)

```
VALID:   ["src/foo.ts", "src/bar.ts"]  // sorted
INVALID: ["src/bar.ts", "src/foo.ts"]  // unsorted
INVALID: ["/absolute/path.ts"]
INVALID: ["../escape.ts"]
```

### RS5: Package Lock Hash Format

The `package_lock_sha256` field MUST use the format `sha256:<64hex>`.

```
VALID:   "sha256:a1b2c3d4e5f6..."  (64 hex chars after prefix)
INVALID: "a1b2c3d4e5f6..."  // missing prefix
INVALID: "sha256:ABC..."  // uppercase
INVALID: "md5:..."  // wrong algorithm
```

### RS6: No Absolute Paths

No field in `repo_state.json` may contain absolute paths. This includes:
- `dirty_paths` entries
- Any string field that could leak system paths

```
INVALID: "dirty_paths": ["/home/user/project/file.ts"]
INVALID: "dirty_paths": ["C:\\Users\\..."]
```

### RS7: Sorted Arrays

All array fields MUST be sorted lexicographically (simple codepoint comparison) and stable across runs.

Affected fields:
- `dirty_paths`

### RS8: Violation Ordering

Verification violations MUST be sorted deterministically:
1. Primary: `rule_id` ascending
2. Secondary: `path` ascending (if present)

### RS9: Contracts Map Validity

The `contracts` object MUST:
- Have all required keys present
- Have all keys sorted lexicographically
- Have all values be non-empty strings

```
VALID: {
  "contracts": {
    "apply_schema_version": "1.0.0",
    "bundle_schema_version": "1.0.0",
    ...
  }
}
INVALID: { "contracts": { "bundle_schema_version": "" } }  // empty value
```

### RS10: Core Hash Excludes Ephemeral

When computing the `repo_state_hash`, the `ephemeral` field MUST be excluded. Only `RepoStateCore` fields contribute to the hash.

```typescript
function computeRepoStateCore(state: RepoState): RepoStateCore {
  const { ephemeral, ...core } = state;
  return core;
}
```

### RS11: Canonical Round-Trip

The repo_state.json content MUST be canonical JSON that round-trips identically:

```typescript
const canonical = canonicalize(state);
const parsed = JSON.parse(canonical);
const recanonical = canonicalize(parsed);
assert(canonical === recanonical);
```

### RS12: CLI Output Determinism

The CLI tool MUST produce byte-identical output across repeated runs when:
- Repository state is unchanged
- Same flags are provided
- Ephemeral fields are excluded from comparison

## Forbidden Content

The following MUST NOT appear in repo_state.json:

| Forbidden | Reason |
|-----------|--------|
| `hostname` | Leaks machine identity |
| `username` | Leaks user identity |
| `pwd` / `cwd` | Leaks absolute paths |
| `git remote` URLs | May contain credentials |
| Timestamps in core | Breaks determinism |
| `process.env` values | May leak secrets |

## CLI Tool

### Usage

```bash
# Generate repo state to stdout
npm run repo-state

# Generate repo state to file
npm run repo-state -- --out artifacts/repo_state.json

# Skip dependency analysis (faster)
npm run repo-state -- --no-deps --out artifacts/repo_state.json

# Verify existing repo state
npm run repo-state-verify -- artifacts/repo_state.json
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | I/O error (file not found, permission denied) |
| 2 | Parse error (invalid JSON) |
| 3 | Validation error (invariant violation) |

### Output Format

All JSON output MUST use `canonicalize()` for deterministic serialization.

## Policy Integration

### Dirty Repository Handling

If `repo_dirty` is `true`:
- The tool MUST still emit the artifact
- The verifier MUST flag this condition
- Policy enforcement determines whether dirty state is acceptable:
  - `strict` policy: MUST reject dirty repos for release operations
  - `default` policy: SHOULD warn but may allow
  - `dev` policy: MAY allow dirty repos

### Node Version Mismatch

If `node_version` does not match baseline:
- The verifier MUST include a violation with rule_id `RS2`
- Policy determines severity:
  - `strict` policy: MUST reject
  - `default`/`dev` policy: SHOULD warn

## Examples

### Valid Repo State

```json
{
  "repo_state_schema_version": "1.0.0",
  "repo_commit": "c5e3fcc5bc857fda56e81a3aa28eff4dad497374",
  "repo_dirty": false,
  "dirty_paths": [],
  "node_version": "v24.11.1",
  "npm_version": "11.6.2",
  "os_platform": "linux",
  "os_arch": "x64",
  "package_lock_sha256": "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "contracts": {
    "apply_schema_version": "1.0.0",
    "bundle_schema_version": "1.0.0",
    "git_apply_schema_version": "1.0.0",
    "model_io_schema_version": "1.0.0",
    "pack_schema_version": "1.0.0",
    "patch_schema_version": "1.0.0",
    "run_schema_version": "1.0.0"
  },
  "ephemeral": {
    "generated_at": "2026-01-06T12:00:00.000Z",
    "display_branch": "master"
  }
}
```

### Dirty Repository State

```json
{
  "repo_state_schema_version": "1.0.0",
  "repo_commit": "c5e3fcc5bc857fda56e81a3aa28eff4dad497374",
  "repo_dirty": true,
  "dirty_paths": [
    "src/foo.ts",
    "src/bar.ts"
  ],
  "node_version": "v24.11.1",
  ...
}
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-06 | Initial specification |

## References

- [KERNEL_DETERMINISM.md](./KERNEL_DETERMINISM.md) - Determinism requirements
- [GOVERNANCE.md](./GOVERNANCE.md) - Release governance
