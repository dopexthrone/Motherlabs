# Runner Specification

**Status**: Normative
**Version**: 1.0.0
**Last Updated**: 2026-01-06

## Overview

This specification defines the **Runner** artifact format for capturing deterministic execution environment details. A runner record describes "how execution was performed" - the runtime environment, sandbox configuration, and execution context that affects reproducibility.

## Related Specifications

- **[RUN_SPEC.md](./RUN_SPEC.md)** - Run result contract (what was produced)
- **[POLICY_SPEC.md](./POLICY_SPEC.md)** - Policy profiles (what was allowed)
- **[REPO_STATE_SPEC.md](./REPO_STATE_SPEC.md)** - Repository state (commit, dependencies)
- **[WORKSPACE_SPEC.md](./WORKSPACE_SPEC.md)** - Workspace snapshot (inputs, env)
- **[PACK_SPEC.md](./PACK_SPEC.md)** - Pack format (optional runner.json)

## Design Principles

1. **Determinism**: Identical environments produce byte-identical runner records
2. **Reproducibility**: Captures all environment factors affecting execution outcomes
3. **Secret Prevention**: No credentials, tokens, or sensitive paths
4. **Minimal Surface**: Only execution-relevant factors, not arbitrary system state
5. **Canonical Output**: All JSON output uses `canonicalize()`

## Schema

### Runner

```typescript
interface Runner {
  // Required: Schema version (RN1)
  runner_schema_version: '1.0.0';

  // Runner identity (RN2)
  runner_id: string;      // Format: runner_{timestamp}_{random}
  runner_version: string; // Kernel version or runner software version

  // Platform (RN3)
  platform: {
    os: string;           // e.g., 'linux', 'darwin', 'win32'
    arch: string;         // e.g., 'x64', 'arm64'
    node_version: string; // e.g., 'v24.11.1'
    npm_version: string;  // e.g., '10.9.2'
  };

  // Sandbox configuration (RN4)
  sandbox: {
    backend: 'process' | 'container' | 'vm' | 'none';
    isolation_level: 'strict' | 'standard' | 'none';
    network_blocked: boolean;
    filesystem_readonly: boolean;
  };

  // Execution limits (RN5)
  limits: {
    timeout_ms: number;
    max_output_files: number;
    max_total_output_bytes: number;
    max_memory_bytes?: number;
    max_cpu_seconds?: number;
  };

  // Command policy (RN6)
  commands: {
    allowlist: string[];      // Sorted, empty = all allowed
    blocklist: string[];      // Sorted, explicit blocks
    shell: string;            // e.g., '/bin/sh', 'cmd.exe'
  };

  // Write policy (RN7)
  write_roots: string[];      // Sorted, relative paths only

  // Execution context (RN8)
  context: {
    working_dir: '.';         // Always relative
    env_allowlist: string[];  // Sorted, what env vars were visible
    locale: string;           // e.g., 'en_US.UTF-8'
    timezone: string;         // e.g., 'UTC'
  };

  // Timing (RN9)
  timing: {
    started_at: string;       // ISO 8601 UTC
    completed_at: string;     // ISO 8601 UTC
    duration_ms: number;
    phases?: ExecutionPhase[];
  };

  // Exit status (RN10)
  exit: {
    code: number;
    signal?: string;
    oom_killed: boolean;
    timeout_killed: boolean;
  };

  // Optional warnings (sorted)
  warnings?: string[];

  // Ephemeral (excluded from core hash) (RN11)
  ephemeral?: {
    host_id?: string;       // Display only, not for determinism
    session_id?: string;
    human_notes?: string;
  };
}
```

### ExecutionPhase

```typescript
interface ExecutionPhase {
  name: string;           // e.g., 'setup', 'execute', 'teardown'
  started_at: string;     // ISO 8601 UTC
  duration_ms: number;
}
```

### RunnerCore

The core fields used for content-addressing (excludes `ephemeral` and timing):

```typescript
interface RunnerCore {
  runner_schema_version: string;
  runner_id: string;
  runner_version: string;
  platform: { ... };
  sandbox: { ... };
  limits: { ... };
  commands: { ... };
  write_roots: string[];
  context: { ... };
  exit: { ... };
  warnings?: string[];
}
```

## Invariants

### RN1: Schema Version Present

The `runner_schema_version` field:
- MUST be present
- MUST equal `"1.0.0"`
- MUST be a non-empty string

### RN2: Runner Identity Valid

The `runner_id` field:
- MUST be present and non-empty
- MUST match pattern `runner_\d{8}_\d{6}_[a-z0-9]+`
- MUST be unique per execution

The `runner_version` field:
- MUST be present and non-empty
- SHOULD be a semver string

### RN3: Platform Complete

The `platform` object:
- MUST have all required fields: `os`, `arch`, `node_version`, `npm_version`
- `os` MUST be one of: `linux`, `darwin`, `win32`
- `arch` MUST be one of: `x64`, `arm64`, `ia32`
- `node_version` MUST start with `v` followed by semver
- `npm_version` MUST be a semver string

### RN4: Sandbox Configuration Valid

The `sandbox` object:
- `backend` MUST be one of: `process`, `container`, `vm`, `none`
- `isolation_level` MUST be one of: `strict`, `standard`, `none`
- `network_blocked` MUST be boolean
- `filesystem_readonly` MUST be boolean
- If `isolation_level` is `none`, `backend` MUST be `none`

### RN5: Limits Within Bounds

The `limits` object:
- `timeout_ms` MUST be in range [1000, 600000]
- `max_output_files` MUST be in range [1, 10000]
- `max_total_output_bytes` MUST be in range [1024, 1073741824]
- Optional `max_memory_bytes` MUST be positive if present
- Optional `max_cpu_seconds` MUST be positive if present

### RN6: Commands Canonical

The `commands` object:
- `allowlist` MUST be sorted lexicographically
- `blocklist` MUST be sorted lexicographically
- `shell` MUST be a non-empty string
- `allowlist` and `blocklist` MUST NOT overlap

### RN7: Write Roots Valid

The `write_roots` array:
- MUST be sorted lexicographically
- MUST contain only relative paths (no leading `/`)
- MUST NOT contain path traversal (`..`)
- MUST NOT contain absolute paths

### RN8: Context Safe

The `context` object:
- `working_dir` MUST be `"."`
- `env_allowlist` MUST be sorted lexicographically
- `env_allowlist` MUST NOT contain forbidden prefixes (SSH_, NPM_, GIT_, AWS_, OPENAI_, ANTHROPIC_)
- `locale` MUST be a valid locale string
- `timezone` SHOULD be `UTC` for reproducibility

### RN9: Timing Consistent

The `timing` object:
- `started_at` MUST be valid ISO 8601 UTC
- `completed_at` MUST be valid ISO 8601 UTC
- `completed_at` MUST be >= `started_at`
- `duration_ms` MUST equal `completed_at - started_at` (within 1ms tolerance)
- `phases` if present MUST be sorted by `started_at`

### RN10: Exit Status Valid

The `exit` object:
- `code` MUST be an integer in range [0, 255]
- `signal` if present MUST be uppercase (e.g., `SIGTERM`, `SIGKILL`)
- If `timeout_killed` is true, `signal` SHOULD be `SIGKILL` or `SIGTERM`
- `oom_killed` and `timeout_killed` MUST be boolean

### RN11: Core Hash Excludes Ephemeral

When computing the runner hash:
- The `ephemeral` field MUST be excluded
- The `timing` field MUST be excluded (timing is not reproducible)
- Hash MUST be computed from RunnerCore only

### RN12: Canonical Round-Trip

The runner:
- MUST survive JSON parse/stringify round-trip unchanged
- MUST be serialized using `canonicalize()`

## Verification

### Input

Any JSON value (parsed from file or stdin).

### Output

```typescript
interface RunnerVerificationResult {
  valid: boolean;
  violations: RunnerViolation[];
  runner_hash?: string;  // Present only if valid
}

interface RunnerViolation {
  rule_id: string;  // RN1, RN2, etc.
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
# Verify a runner record
npm run runner-verify -- runner.json

# Verify from stdin
cat runner.json | npm run runner-verify -- -

# Output format
{"ok":true,"runner_hash":"sha256:..."}
# or
{"ok":false,"violations":[...]}
```

## Pack Integration

When present in a pack as `runner.json`:
- PK8 (Optional Files Valid) applies
- The runner record describes the execution environment used to produce the pack
- Consumer tools MAY use runner data to validate reproducibility claims

## Example Output

```json
{
  "runner_schema_version": "1.0.0",
  "runner_id": "runner_20260106_120000_abc123",
  "runner_version": "0.3.15",
  "platform": {
    "os": "linux",
    "arch": "x64",
    "node_version": "v24.11.1",
    "npm_version": "10.9.2"
  },
  "sandbox": {
    "backend": "process",
    "isolation_level": "standard",
    "network_blocked": true,
    "filesystem_readonly": false
  },
  "limits": {
    "timeout_ms": 60000,
    "max_output_files": 500,
    "max_total_output_bytes": 52428800
  },
  "commands": {
    "allowlist": ["node", "npm", "npx"],
    "blocklist": [],
    "shell": "/bin/sh"
  },
  "write_roots": ["build", "dist", "out", "tmp"],
  "context": {
    "working_dir": ".",
    "env_allowlist": ["LANG", "LC_ALL", "NODE_ENV", "TZ"],
    "locale": "en_US.UTF-8",
    "timezone": "UTC"
  },
  "timing": {
    "started_at": "2026-01-06T12:00:00.000Z",
    "completed_at": "2026-01-06T12:00:05.000Z",
    "duration_ms": 5000
  },
  "exit": {
    "code": 0,
    "oom_killed": false,
    "timeout_killed": false
  }
}
```

## Security Considerations

1. **No Host Identification**: `host_id` is ephemeral, not in core hash
2. **No Credentials**: No env values, only allowlist names
3. **Relative Paths Only**: No absolute paths leak host structure
4. **Forbidden Env Prefixes**: Secret-bearing variables blocked from allowlist
5. **Minimal Platform Data**: Only reproducibility-relevant system info

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-06 | Initial specification |
