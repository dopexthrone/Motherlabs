# Bundle Specification v0.1

The authoritative contract for the Bundle artifact produced by the Context Engine Kernel.

**Schema Version:** `0.1.0`
**Kernel Version:** `0.1.0`
**Status:** Normative

---

## 1. Scope and Non-Goals

### 1.1 Scope

The **Bundle** is the primary authoritative output of the kernel's `transform()` function. This specification defines:

- The structure and fields of a Bundle
- Ordering and normalization invariants
- Hashing rules for deterministic verification
- Result semantics (BUNDLE, CLARIFY, REFUSE)

A conforming Bundle MUST satisfy all invariants defined in this specification.

### 1.2 Non-Goals

This specification does NOT cover:

- **Execution**: How to execute the actions described in a Bundle
- **Dashboards/APIs**: Presentation or network transport of Bundles
- **Model I/O**: Recording, replay, or validation of model interactions
- **Harness Evidence**: Runtime evidence collected during harness execution

These are separate concerns with their own specifications.

---

## 2. Canonical Definitions

### 2.1 Intent (Normalized)

The canonical input to the kernel. After normalization:

```typescript
interface NormalizedIntent {
  goal: string;        // Non-empty, NFC-normalized, trimmed
  constraints: string[]; // Sorted lexicographically, deduplicated
  context: Record<string, unknown>; // Arbitrary metadata
}
```

See: `src/utils/normalize.ts`

### 2.2 Bundle

The complete output artifact from a kernel transform. Contains the decomposition tree, generated outputs, and summary statistics.

See: `src/types/artifacts.ts` (interface `Bundle`)

### 2.3 Artifact / Output

A generated output item within a Bundle. Each output has:
- A content-derived ID
- A relative path (forward slashes, no traversal)
- Content and content hash
- Source constraints and confidence score

See: `src/types/artifacts.ts` (interface `Output`)

### 2.4 Node (ContextNode)

A node in the decomposition tree representing a refined context state with:
- Accumulated constraints
- Entropy and density measurements
- Unresolved questions
- Optional splitting question and children

See: `src/types/artifacts.ts` (interface `ContextNode`)

### 2.5 Constraint

A string representing a requirement or restriction on the solution space. After normalization:
- NFC Unicode normalized
- Trimmed of leading/trailing whitespace
- Collapsed multiple spaces
- Sorted lexicographically within arrays

### 2.6 Gate

A validation check that a Bundle must pass. Gates verify:
- Schema conformance
- Ordering invariants
- Semantic consistency
- Determinism properties

See: `src/validation/gates.ts`

### 2.7 Bundle Hash / Canonical Hash

The SHA-256 hash of the canonical JSON representation of a Bundle (excluding runtime evidence). Used for determinism verification.

Computed via: `canonicalHash(bundle)` from `src/utils/canonical.ts`

### 2.8 Result Kinds

The kernel produces one of three result kinds:

| Kind | Description | Bundle Present |
|------|-------------|----------------|
| `BUNDLE` | Successful decomposition with outputs | Yes |
| `CLARIFY` | High entropy; questions need resolution | Yes (incomplete) |
| `REFUSE` | Invalid input; cannot process | No |

---

## 3. Bundle Schema Overview

### 3.1 Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `BundleId` | Yes | Content-derived ID: `bundle_{hash16}` |
| `schema_version` | `string` | Yes | Schema version (e.g., `"0.1.0"`) |
| `kernel_version` | `string` | Yes | Kernel version that produced this bundle |
| `source_intent_hash` | `string` | Yes | SHA-256 of normalized input intent |
| `status` | `BundleStatus` | Yes | `"complete"` \| `"incomplete"` \| `"error"` |
| `root_node` | `ContextNode` | Yes | Root of decomposition tree |
| `terminal_nodes` | `ContextNode[]` | Yes | Flattened terminal nodes |
| `outputs` | `Output[]` | Yes | Generated output artifacts |
| `unresolved_questions` | `Question[]` | Yes | All unresolved questions |
| `stats` | `BundleStats` | Yes | Summary statistics |

### 3.2 BundleStatus

```typescript
type BundleStatus = 'complete' | 'incomplete' | 'error';
```

- `complete`: All nodes terminal, no unresolved questions
- `incomplete`: Has unresolved questions requiring clarification
- `error`: Processing error occurred

### 3.3 Content IDs

All IDs are content-derived using SHA-256:

| Prefix | Format | Example |
|--------|--------|---------|
| `bundle` | `bundle_{hash16}` | `bundle_04d8c18fbb24effb` |
| `node` | `node_{hash16}` | `node_a1b2c3d4e5f67890` |
| `q` | `q_{hash16}` | `q_1234567890abcdef` |
| `out` | `out_{hash16}` | `out_fedcba0987654321` |

Where `hash16` is the first 16 hex characters of SHA-256.

### 3.4 Score Type

All scores are integers in range `[0, 100]`:

```typescript
type Score = number; // Integer 0-100
```

Fields using Score:
- `entropy_score`, `density_score`
- `information_gain`, `priority`
- `confidence`
- `avg_terminal_entropy`, `avg_terminal_density`

### 3.5 TypeScript Type Reference

Primary types defined in `src/types/artifacts.ts`:
- `Bundle`, `BundleStats`, `BundleStatus`
- `ContextNode`, `NodeStatus`
- `Output`, `OutputType`
- `Question`, `AnswerType`
- `EntropyMeasurement`, `DensityMeasurement`

---

## 4. Sorting and Normalization Invariants

### 4.1 Canonical Serialization

Object keys are sorted **lexicographically by UTF-16 code units**:

```typescript
// Keys sorted: a < b < z
{"a":1,"b":2,"z":3}
```

Arrays preserve **index order** (not sorted by value):

```typescript
// Array order preserved
[3,1,2] // NOT sorted to [1,2,3]
```

See: `src/utils/canonical.ts`

### 4.2 Array Ordering Rules

| Array Field | Ordering Rule |
|-------------|---------------|
| `constraints` | Lexicographic ascending |
| `outputs` | By `path` ascending |
| `terminal_nodes` | By `id` ascending |
| `children` | By `id` ascending |
| `unresolved_questions` | By `priority` descending, then `id` ascending |
| `options` (in Question) | Lexicographic ascending |
| `source_constraints` | Lexicographic ascending |
| `branches` (in SplittingQuestion) | By `branch_id` ascending |

### 4.3 Comparator Definitions

**Lexicographic comparison:**
```typescript
(a, b) => a < b ? -1 : a > b ? 1 : 0
```

**Question ordering (priority desc, id asc):**
```typescript
(a, b) => {
  if (a.priority !== b.priority) return b.priority - a.priority; // desc
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // asc
}
```

### 4.4 Unicode Normalization

All string inputs are normalized to **NFC** (Canonical Decomposition, followed by Canonical Composition):

```typescript
result = input.normalize('NFC');
```

Additional normalization:
- BOM stripped if present
- CRLF converted to LF
- Lone CR converted to LF

See: `src/utils/normalize.ts`

### 4.5 Path Normalization

Output paths MUST be:
- Relative (no leading `/`)
- Forward slashes only (no `\`)
- No parent directory references (`..`)
- No current directory prefixes (`./`)
- No double slashes

```typescript
// Valid paths
"context/node_abc123.md"
"src/components/Button.tsx"

// Invalid paths (will throw)
"/absolute/path"      // Absolute
"../parent/file"      // Parent traversal
"path\\with\\backslash" // Backslashes
```

---

## 5. Hashing Rules

### 5.1 What Affects Bundle Hash

The bundle hash is computed from the **canonical JSON representation** of the entire Bundle object, which includes:

- `id` (derived from content, so recursive)
- `schema_version`, `kernel_version`
- `source_intent_hash`
- `status`
- `root_node` (full tree structure)
- `terminal_nodes`
- `outputs` (including content and content_hash)
- `unresolved_questions`
- `stats`

### 5.2 What Does NOT Affect Bundle Hash

The following are **excluded** from bundle hash computation:

- Runtime timestamps
- Host information
- Execution duration
- Harness evidence
- File system paths (except relative paths in outputs)
- Environment variables
- Process IDs or run IDs

### 5.3 Hash Computation

```typescript
import { canonicalizeToBytes } from './utils/canonical.js';
import { createHash } from 'node:crypto';

function getBundleHash(bundle: Bundle): string {
  const bytes = canonicalizeToBytes(bundle);
  return createHash('sha256').update(bytes).digest('hex');
}
```

The canonical bytes include a **trailing LF** character:
```typescript
Buffer.from(canonicalJson + '\n', 'utf-8')
```

### 5.4 ID Derivation

Content IDs are derived from a subset of the object (excluding the ID field itself):

```typescript
function deriveId(prefix: string, content: object): string {
  const hash = canonicalHash(content); // content without 'id' field
  return `${prefix}_${hash.slice(0, 16)}`;
}
```

---

## 6. Failure and Refusal Semantics

### 6.1 REFUSE Conditions

The kernel MUST refuse (return no bundle) when:

| Condition | Error Code | Message Pattern |
|-----------|------------|-----------------|
| Empty goal | `EMPTY_GOAL` | `Intent goal cannot be empty` |
| Invalid goal type | `INVALID_GOAL` | `Intent must have a string goal` |
| Absolute path in output | `INVALID_PATH` | `Absolute paths not allowed in bundle` |
| Parent traversal in path | `INVALID_PATH` | `Parent directory references not allowed` |

### 6.2 CLARIFY Conditions

The kernel returns a bundle with `status: 'incomplete'` when:

- High entropy score (many unresolved references)
- Placeholders detected in constraints
- Contradictory constraints detected
- Schema gaps found

The `unresolved_questions` array will be populated with questions to resolve.

### 6.3 Error Message Format

Error messages follow stable patterns for deterministic testing:

```
<ERROR_CODE>: <human_readable_message>
```

Example:
```
EMPTY_GOAL: Intent goal cannot be empty
INVALID_PATH: Absolute paths not allowed in bundle: /etc/passwd
```

---

## 7. Compatibility and Versioning

### 7.1 Schema Version

The `schema_version` field follows semantic versioning:

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: Breaking structural changes (golden hashes will change)
- **MINOR**: Additive changes (new optional fields)
- **PATCH**: Documentation or comment changes only

### 7.2 Backward Compatibility

When `schema_version` changes:

| Change Type | Golden Hashes | Migration Required |
|-------------|---------------|-------------------|
| MAJOR bump | Change | Yes |
| MINOR bump | May change | No |
| PATCH bump | No change | No |

### 7.3 Version Bump Requirements

A schema version bump is required when:

1. Adding, removing, or renaming fields
2. Changing field types
3. Changing ordering rules
4. Changing hash computation method
5. Changing normalization rules

Document all changes in `CHANGELOG_GOLDENS.md`.

---

## 8. Examples

### 8.1 CLARIFY Outcome (Incomplete Bundle)

```json
{
  "id": "bundle_04d8c18fbb24effb",
  "schema_version": "0.1.0",
  "kernel_version": "0.1.0",
  "status": "incomplete",
  "stats": {
    "total_nodes": 1,
    "terminal_nodes": 1,
    "max_depth": 0,
    "total_outputs": 1,
    "unresolved_count": 2,
    "avg_terminal_entropy": 45,
    "avg_terminal_density": 30
  },
  "unresolved_questions": [
    {
      "id": "q_abc123...",
      "text": "What authentication method should be used?",
      "priority": 80,
      "information_gain": 75
    }
  ]
}
```

### 8.2 REFUSE Outcome

No bundle is produced. The harness result indicates:

```json
{
  "kernel_result_kind": "REFUSE",
  "decision": {
    "accepted": false,
    "reason": "Intent goal cannot be empty"
  },
  "bundle": null
}
```

### 8.3 BUNDLE Outcome (Complete)

```json
{
  "id": "bundle_3083388bf9cb9c25",
  "schema_version": "0.1.0",
  "kernel_version": "0.1.0",
  "status": "complete",
  "stats": {
    "total_nodes": 1,
    "terminal_nodes": 1,
    "max_depth": 0,
    "total_outputs": 1,
    "unresolved_count": 0,
    "avg_terminal_entropy": 25,
    "avg_terminal_density": 70
  },
  "outputs": [
    {
      "id": "out_fedcba...",
      "type": "instruction",
      "path": "context/node_abc123.md",
      "content_hash": "sha256:...",
      "confidence": 72
    }
  ],
  "unresolved_questions": []
}
```

---

## Appendix A: Validation Checklist

A conforming Bundle MUST pass all of these checks:

- [ ] `id` matches pattern `bundle_[a-f0-9]{16}`
- [ ] `schema_version` is present and valid
- [ ] `outputs` sorted by `path` ascending
- [ ] `terminal_nodes` sorted by `id` ascending
- [ ] `unresolved_questions` sorted by `priority` desc, `id` asc
- [ ] All Score fields are integers in `[0, 100]`
- [ ] All output paths are relative (no `/` prefix, no `..`)
- [ ] All constraints arrays are sorted lexicographically
- [ ] Canonical serialization is idempotent
- [ ] Bundle hash is stable across repeated transforms

See: `src/tests/bundle_spec_invariants.test.ts`

---

## Appendix B: Related Documents

- `src/types/artifacts.ts` - TypeScript type definitions
- `src/utils/canonical.ts` - Canonical serialization implementation
- `src/utils/normalize.ts` - Input normalization implementation
- `src/types/validation.ts` - Runtime validation functions
- `src/validation/gates.ts` - Validation gate implementations
- `docs/VERIFY_RELEASE.md` - Release verification process

---

*Specification version: 0.1.0*
*Last updated: 2026-01-05*
