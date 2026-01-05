# Model IO Specification

Normative contract for model recording sessions in context-engine-kernel.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.10+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The structure and semantics of model recording sessions
- The `ModelIOCore` subset used for content-addressing
- Hashing rules for deterministic recording identification
- Invariants that all valid model_io.json artifacts must satisfy

### 1.2 Non-Goals

This specification does NOT define:

- How recordings are captured (implementation detail of adapters)
- Which model backends are supported
- Recording retention policies
- Real-time streaming formats

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **ModelIOSession** | Complete recording session including ephemeral metadata |
| **ModelIOCore** | Canonical subset for content-addressing (excludes timestamps) |
| **ModelIOHash** | `sha256(canonicalize(ModelIOCore))` |
| **Interaction** | Single prompt/response pair with metadata |
| **prompt_hash** | SHA256 hash of the UTF-8 encoded prompt string |
| **response_hash** | SHA256 hash of the UTF-8 encoded response content |
| **canonicalize()** | Deterministic JSON serialization per KERNEL_DETERMINISM.md |

---

## 3. ModelIOSession Object

### 3.1 Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `model_io_schema_version` | `string` | Schema version (e.g., "1.0.0") |
| `adapter_id` | `string` | Unique adapter instance identifier |
| `model_id` | `string` | Human-readable model identifier |
| `mode` | `'record' \| 'replay'` | Recording or replay mode |
| `interactions` | `Interaction[]` | Ordered list of recorded interactions |

### 3.2 Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `created_at_utc` | `string` | ISO 8601 UTC timestamp (ephemeral) |
| `ended_at_utc` | `string` | ISO 8601 UTC timestamp (ephemeral) |
| `stats` | `SessionStats` | Summary statistics (ephemeral) |

### 3.3 Interaction Structure

```typescript
interface Interaction {
  /** Sequence index (0-based, monotonically increasing) */
  i: number;

  /** SHA256 hash of the prompt (format: sha256:hex64) */
  prompt_hash: ContentHash;

  /** SHA256 hash of the response content (format: sha256:hex64) */
  response_hash: ContentHash;

  /** Response content (UTF-8 string) */
  response_content: string;

  /** Tokens consumed in request (optional, ephemeral) */
  tokens_input?: number;

  /** Tokens generated in response (optional, ephemeral) */
  tokens_output?: number;

  /** Latency in milliseconds (optional, ephemeral) */
  latency_ms?: number;
}
```

### 3.4 SessionStats Structure (Optional, Ephemeral)

```typescript
interface SessionStats {
  total_interactions: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_latency_ms: number;
}
```

### 3.5 Mode Values

| Mode | Meaning |
|------|---------|
| `record` | Session was created by recording live model calls |
| `replay` | Session is intended for deterministic replay |

---

## 4. ModelIOCore and Hashing Rules

### 4.1 ModelIOCore Definition

`ModelIOCore` is the canonical subset of `ModelIOSession` used for content-addressing. It excludes ephemeral fields that vary between recordings.

**Included fields (in canonical order):**

1. `model_io_schema_version`
2. `adapter_id`
3. `model_id`
4. `mode`
5. `interactions` (only core fields per interaction, sorted by `i`)

**Excluded fields (ephemeral):**

- `created_at_utc`
- `ended_at_utc`
- `stats`
- Per-interaction: `tokens_input`, `tokens_output`, `latency_ms`

### 4.2 InteractionCore Structure

```typescript
interface InteractionCore {
  i: number;
  prompt_hash: ContentHash;
  response_hash: ContentHash;
  response_content: string;
}
```

### 4.3 Computing ModelIOCore

```typescript
function computeModelIOCore(session: ModelIOSession): ModelIOCore {
  return {
    model_io_schema_version: session.model_io_schema_version,
    adapter_id: session.adapter_id,
    model_id: session.model_id,
    mode: session.mode,
    interactions: session.interactions
      .map(interaction => ({
        i: interaction.i,
        prompt_hash: interaction.prompt_hash,
        response_hash: interaction.response_hash,
        response_content: interaction.response_content,
      }))
      .sort((a, b) => a.i - b.i),
  };
}
```

### 4.4 Computing ModelIOHash

```typescript
function computeModelIOHash(session: ModelIOSession): ContentHash {
  const core = computeModelIOCore(session);
  const canonical = canonicalize(core);
  return `sha256:${sha256(canonical)}`;
}
```

### 4.5 Computing Response Hash

The `response_hash` for each interaction MUST be computed as:

```typescript
function computeResponseHash(response_content: string): ContentHash {
  return `sha256:${sha256(response_content)}`;
}
```

Where `sha256()` operates on the UTF-8 encoded string and returns lowercase hexadecimal.

---

## 5. Invariants

All valid `model_io.json` artifacts MUST satisfy these invariants.

### MI1: Schema Version Present

```
model_io_schema_version is non-empty string
model_io_schema_version matches semver format (X.Y.Z)
```

The schema version MUST be present and follow semantic versioning.

### MI2: Adapter and Model ID Non-Empty

```
adapter_id is non-empty string
model_id is non-empty string
```

Both identifiers MUST be non-empty strings.

### MI3: Mode Valid

```
mode in ['record', 'replay']
```

The mode MUST be one of the recognized values.

### MI4: Interactions Array Present

```
interactions is array
interactions.length >= 0
interactions.length <= 10000
```

The interactions array MUST be present. Maximum 10,000 interactions per session.

### MI5: Indices Monotonic and Contiguous

```
interactions[0].i === 0
interactions[n].i === n for all n
```

Interaction indices MUST start at 0 and be contiguous (0, 1, 2, ...).

### MI6: Prompt Hash Format

```
interaction.prompt_hash matches /^sha256:[a-f0-9]{64}$/
```

All prompt hashes MUST be lowercase SHA256 hashes with `sha256:` prefix.

### MI7: Response Hash Integrity

```
interaction.response_hash matches /^sha256:[a-f0-9]{64}$/
interaction.response_hash === sha256(interaction.response_content)
```

Response hashes MUST match the SHA256 of the response content.

### MI8: No Duplicate Prompt Hashes Within Session

```
prompt_hashes are unique OR (prompt_hash, i) pairs are unique
```

Note: Duplicate prompt hashes are allowed if they occur at different indices (same prompt asked multiple times). The (prompt_hash, i) pair MUST be unique.

### MI9: Deterministic Sorting

```
interactions are sorted by i ascending
```

Interactions MUST be sorted by index in ascending order.

### MI10: Stable Violations

```
violations are sorted by (rule_id ASC, path ASC, message ASC)
```

Verifier violations MUST be deterministically sorted for reproducible output.

### MI11: Size Limits

```
interactions.length <= 10000
response_content.length <= 1_000_000 bytes per interaction
total response bytes <= 100_000_000 bytes per session
```

Size limits prevent resource exhaustion.

### MI12: No Hidden Nondeterminism

```
ModelIOCore excludes all timestamp fields
ModelIOCore excludes all metric fields (tokens, latency)
```

The core representation used for hashing MUST NOT include any fields that could vary between identical logical recordings.

---

## 6. Versioning

### 6.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to invariants or required fields
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 6.2 Backwards Compatibility

Model IO files produced under spec version N MUST be valid under spec version N+1 (minor/patch) unless a MAJOR version bump is released.

### 6.3 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 7. Integration with Pack Format

When included in a run export pack (see PACK_SPEC.md):

- Filename: `model_io.json`
- Verification: MUST satisfy all MI1-MI12 invariants
- Reference: May be referenced by `run.json` via `model_io_hash` field

---

## 8. References

- [KERNEL_DETERMINISM.md](./KERNEL_DETERMINISM.md) - Canonicalization rules
- [PACK_SPEC.md](./PACK_SPEC.md) - Run export pack specification
- [src/adapters/model.ts](../src/adapters/model.ts) - Type definitions
- [src/adapters/recording.ts](../src/adapters/recording.ts) - Implementation

---

*This is a normative specification. Implementations MUST conform to all invariants.*
