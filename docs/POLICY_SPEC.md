# Policy Specification

Normative contract for the harness policy system in context-engine-kernel.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.5+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The structure and semantics of `PolicyProfile` (resolved policy)
- Policy profile definitions (strict, default, dev)
- Model mode enforcement rules
- Sandbox constraint parameters
- Invariants that all valid policies must satisfy

### 1.2 Non-Goals

This specification does NOT define:

- How policies are selected (caller responsibility)
- Custom policy creation (only built-in profiles are normative)
- Policy persistence or caching
- Network security beyond the `allow_network` flag

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **PolicyProfile** | Fully resolved policy object with all limits and constraints |
| **PolicyProfileName** | String enum: `'strict' \| 'default' \| 'dev'` |
| **ResolvedPolicy** | Synonym for PolicyProfile (the fully populated object) |
| **Limits** | Numeric constraints: timeout, file count, byte limits |
| **SandboxPolicy** | Subset controlling sandbox behavior: write roots, commands |
| **ModelPolicy** | Subset controlling model mode: allowed modes per profile |
| **IOCapturePolicy** | Subset controlling output capture: truncation, hashing |

---

## 3. ResolvedPolicy Schema

The `PolicyProfile` type represents the fully resolved policy.

### 3.1 Required Fields

| Field | Type | Description | Determinism |
|-------|------|-------------|-------------|
| `name` | `PolicyProfileName` | Profile identifier | Immutable per profile |
| `allow_network` | `boolean` | Whether network access is permitted | Immutable per profile |
| `timeout_ms` | `number` | Execution timeout in milliseconds | Immutable per profile |
| `max_output_files` | `number` | Maximum number of output files | Immutable per profile |
| `max_total_output_bytes` | `number` | Maximum total output size in bytes | Immutable per profile |
| `allowed_commands` | `string[]` | Allowed command names (empty = all in dev) | Immutable per profile |
| `allowed_write_roots` | `string[]` | Allowed write directories (empty = all in dev) | Immutable per profile |

### 3.2 Field Constraints

| Field | Minimum | Maximum | Notes |
|-------|---------|---------|-------|
| `timeout_ms` | 1000 | 600000 | 1 second to 10 minutes |
| `max_output_files` | 1 | 10000 | At least 1 file |
| `max_total_output_bytes` | 1024 | 1073741824 | 1 KB to 1 GB |

### 3.3 Determinism Rules

- `loadPolicy(name)` MUST return an identical object for the same `name` across all invocations
- `canonicalize(loadPolicy(name))` MUST be byte-identical across processes
- Arrays (`allowed_commands`, `allowed_write_roots`) are returned in definition order

---

## 4. Policy Profiles

### 4.1 Profile Comparison

| Field | `strict` | `default` | `dev` |
|-------|----------|-----------|-------|
| `allow_network` | `false` | `false` | `false` |
| `timeout_ms` | 30000 | 60000 | 300000 |
| `max_output_files` | 200 | 500 | 1000 |
| `max_total_output_bytes` | 10485760 (10 MB) | 52428800 (50 MB) | 104857600 (100 MB) |
| `allowed_commands` | `['node', 'npm']` | `['node', 'npm', 'npx']` | `[]` (all allowed) |
| `allowed_write_roots` | `['out', 'dist', 'build']` | `['out', 'dist', 'build', 'tmp']` | `[]` (all allowed) |

### 4.2 Model Mode Permissions

| Profile | `none` | `record` | `replay` |
|---------|--------|----------|----------|
| `strict` | ALLOWED | DENIED | DENIED |
| `default` | ALLOWED | DENIED | DENIED |
| `dev` | ALLOWED | ALLOWED | ALLOWED |

### 4.3 Empty Array Semantics

For the `dev` profile only:
- `allowed_commands: []` means ALL commands are allowed
- `allowed_write_roots: []` means ALL directories are writable

For `strict` and `default` profiles:
- Empty arrays are NOT used (explicit allowlists are provided)

---

## 5. Invariants

All policy operations MUST satisfy these invariants.

### PL1: Profile Enum

```
name in {'strict', 'default', 'dev'}
```

The `name` field MUST be one of the three defined profile names.

### PL2: Resolved Complete

```
for field in [name, allow_network, timeout_ms, max_output_files,
              max_total_output_bytes, allowed_commands, allowed_write_roots]:
  loadPolicy(profile)[field] !== undefined
```

`loadPolicy(profileName)` MUST return a fully populated object with no `undefined` values.

### PL3: Limits Within Bounds

```
timeout_ms >= 1000 && timeout_ms <= 600000
max_output_files >= 1 && max_output_files <= 10000
max_total_output_bytes >= 1024 && max_total_output_bytes <= 1073741824
```

All numeric limits MUST be within documented bounds.

### PL4: Model Mode Strict/Default

```
if (policy.name === 'strict' || policy.name === 'default') {
  if (mode !== 'none') {
    throw "POLICY_VIOLATION: PL4: Model mode '${mode}' not allowed by ${policy.name}"
  }
}
```

Strict and default policies MUST reject `record` and `replay` modes with stable error format.

### PL5: Model Mode Dev

```
if (policy.name === 'dev') {
  if (mode === 'record' && !recordingPath) {
    throw "POLICY_VIOLATION: PL5: record mode requires recording path"
  }
  if (mode === 'replay' && !recordingPath) {
    throw "POLICY_VIOLATION: PL5: replay mode requires recording path"
  }
}
```

Dev policy with record/replay MUST require a recording path.

### PL6: Sandbox Constraints

Sandbox constraints implied by policy MUST be enforced:
- `max_output_files`: file count limit
- `max_total_output_bytes`: total output size limit
- `allowed_commands`: command allowlist (when non-empty)
- `allowed_write_roots`: write path allowlist (when non-empty)

(Cross-reference: security.test.ts for enforcement tests)

### PL7: Evidence Policy Binding

```
canonicalize(result.policy) === canonicalize(loadPolicy(policyName))
```

The policy included in harness results MUST be canonically equal to the resolved policy for the requested profile.

---

## 6. Error Format

All policy violations MUST use stable error format:

```
POLICY_VIOLATION: PL#: <description>
```

Examples:
- `POLICY_VIOLATION: PL4: Model mode 'record' not allowed by strict policy`
- `POLICY_VIOLATION: PL5: record mode requires recording path`

---

## 7. Versioning

### 7.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to profiles, limits, or invariants
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 7.2 Policy Schema Version

The policy schema does not have a separate version field. Changes to policy definitions require a kernel release bump.

### 7.3 Backwards Compatibility

Policy profiles are immutable within a major version. Changing limit values or adding/removing commands requires a new release.

### 7.4 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 8. References

- [EVIDENCE_SPEC.md](./EVIDENCE_SPEC.md) - Execution evidence contract
- [LEDGER_SPEC.md](./LEDGER_SPEC.md) - Audit trail contract
- [src/harness/policy.ts](../src/harness/policy.ts) - Implementation
- [src/harness/types.ts](../src/harness/types.ts) - Type definitions

---

*This is a normative specification. Implementations MUST conform to all invariants.*
