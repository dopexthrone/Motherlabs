# Pack Specification

Normative contract for the Run Export Pack directory format in context-engine-kernel.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.9+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The structure and semantics of a **Pack** (externally shareable run artifacts)
- Required and optional file manifest
- Reference integrity rules (hash matching between files)
- Path safety rules (no symlinks, no traversal)
- Determinism rules for verifier output
- Invariants that all valid packs must satisfy

A Pack is a self-contained directory that can be zipped and handed off to external consumers for independent verification.

### 1.2 Non-Goals

This specification does NOT define:

- How packs are created (harness implementation detail)
- Pack storage or distribution mechanisms
- Pack signing or encryption
- Retention or archival policies
- Individual file formats (see referenced specs)

### 1.3 Authority Model

The kernel/harness is **authoritative** for generating packs. External consumers use the pack verifier to answer: "Is this pack well-formed and internally consistent?"

Pack verification is **structural** verification. It confirms:
- Required files exist with valid schema
- Cross-file references are consistent
- No path safety violations

It does NOT validate:
- Semantic correctness of bundle outputs
- Whether the execution evidence is truthful
- Policy compliance (pack may contain evidence from any policy)

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Pack** | Directory containing run artifacts for external handoff |
| **PackManifest** | Logical set of files in a pack (not a separate file) |
| **RequiredFile** | File that MUST exist: run.json, bundle.json |
| **OptionalFile** | File that MAY exist: patch.json, evidence.json, ledger.jsonl, policy.json, meta.json |
| **ReferenceHash** | SHA256 hash embedded in one file referencing another |
| **ComputedHash** | SHA256 hash computed from file contents via canonicalHash() |
| **ContentHash** | String format: `sha256:<64-hex-chars>` |
| **Violation** | Spec violation with rule_id, path, and message |

---

## 3. Pack Directory Layout

### 3.1 File Manifest

| Filename | Required | Spec Reference | Description |
|----------|----------|----------------|-------------|
| `run.json` | YES | RUN_SPEC.md | Harness run result |
| `bundle.json` | YES | BUNDLE_SPEC.md | Kernel bundle output |
| `patch.json` | NO | PATCH_SPEC.md | Patch set (if execution occurred) |
| `evidence.json` | NO | EVIDENCE_SPEC.md | Execution evidence (if execution occurred) |
| `ledger.jsonl` | NO | LEDGER_SPEC.md | Audit ledger entry (single-line subset) |
| `policy.json` | NO | POLICY_SPEC.md | Resolved policy used |
| `model_io.json` | NO | MODEL_IO_SPEC.md | Model recording session (if model recording used) |
| `runner.json` | NO | RUNNER_SPEC.md | Execution environment details (if runner captured) |
| `meta.json` | NO | (none) | Arbitrary metadata (ignored by verifier) |

### 3.2 File Requirements by Outcome

| Outcome | run.json | bundle.json | patch.json | evidence.json |
|---------|----------|-------------|------------|---------------|
| BUNDLE | Required | Required | Optional | Optional |
| CLARIFY | Required | Required | Not present | Not present |
| REFUSE | Required | Not present | Not present | Not present |

### 3.3 Directory Rules

- Pack MUST be a directory (not a file or symlink)
- Pack MUST NOT contain subdirectories (flat structure)
- Pack MUST NOT contain files other than those in the manifest
- All files MUST be regular files (no symlinks, no devices)

---

## 4. Reference Integrity Rules (Normative)

### 4.1 run.json -> bundle.json

When `run.json` contains a non-null `bundle` reference:

```
run.bundle.sha256 === canonicalHash(bundle.json)
```

The embedded bundle hash MUST match the computed hash of `bundle.json`.

### 4.2 run.json -> intent (External)

The `intent` reference in `run.json` points to an external file:

```
run.intent.sha256 is valid ContentHash format
run.intent.path is relative (no verification of existence)
```

The intent file itself is NOT included in the pack. Only format validation.

### 4.3 bundle.json Self-Consistency

The bundle MUST pass BUNDLE_SPEC.md validation:

```
verifyBundle(bundle.json) === { ok: true }
```

### 4.4 patch.json -> Proposal Reference

When `patch.json` exists:

```
patch.source_proposal_hash is valid ContentHash format
```

(Proposal itself is internal; not included in pack.)

### 4.5 evidence.json -> Proposal Reference

When `evidence.json` exists:

```
evidence.proposal_hash is valid ContentHash format
```

### 4.6 policy.json Consistency

When `policy.json` exists and `run.json` contains embedded policy:

```
canonicalize(policy.json) === canonicalize(run.policy)
```

---

## 5. Path Safety Rules (Normative)

### 5.1 No Symlinks

All files in the pack MUST be regular files. Symlinks are rejected.

Implementation MUST use `lstat()` (not `stat()`) to detect symlinks.

### 5.2 No Path Traversal

Pack directory path MUST NOT be accessed via traversal:

- No `..` in resolved path
- No absolute paths when resolving pack contents

### 5.3 Filename Validation

All filenames MUST:

- Be one of the allowed manifest filenames
- Not contain path separators (`/` or `\`)
- Not contain null bytes
- Not be `.` or `..`

---

## 6. Determinism Rules (Normative)

### 6.1 Canonical JSON Output

The verifier CLI MUST emit canonical JSON:

1. Use `canonicalize()` (not `JSON.stringify()`)
2. Keys sorted lexicographically at all levels
3. No trailing whitespace
4. UTF-8 encoding
5. No undefined values

### 6.2 Violation Ordering

Violations MUST be sorted by:

1. `rule_id` ascending (lexicographic)
2. `path` ascending (lexicographic)
3. `message` ascending (for stability)

### 6.3 Stable Output

Given the same pack directory contents, the verifier MUST produce byte-identical output.

---

## 7. Verifier Output Schema

### 7.1 Success Result

```typescript
interface PackVerifySuccess {
  ok: true;
  pack_path: string;
  files_verified: string[];
  reference_checks: ReferenceCheck[];
}

interface ReferenceCheck {
  source: string;       // e.g., "run.json"
  target: string;       // e.g., "bundle.json"
  field: string;        // e.g., "bundle.sha256"
  expected: ContentHash;
  computed: ContentHash;
  match: true;
}
```

### 7.2 Failure Result

```typescript
interface PackVerifyFailure {
  ok: false;
  pack_path: string;
  violations: PackViolation[];
}

interface PackViolation {
  rule_id: string;   // PK1, PK2, etc.
  path?: string;     // Relevant file path
  message: string;   // Human-readable description
}
```

### 7.3 Exit Codes (CLI)

| Code | Meaning |
|------|---------|
| 0 | Valid pack |
| 1 | Invalid pack (violations found) |
| 2 | I/O error (pack not accessible) |
| 3 | Usage error (bad arguments) |

---

## 8. Invariants

All valid packs MUST satisfy these invariants.

### PK1: Required Files Exist

```
exists(pack/run.json)
exists(pack/bundle.json) when run.kernel_result_kind !== 'REFUSE'
```

Required files MUST exist based on outcome type.

### PK2: No Unknown Files

```
files(pack).every(f => f in MANIFEST)
```

Only files in the manifest are allowed. Unknown files are violations.

### PK3: Run Spec Valid

```
verifyRunResult(run.json) passes basic schema checks
```

`run.json` MUST have valid RUN_SPEC structure (schema version, required fields).

### PK4: Bundle Spec Valid

```
if (bundle.json exists) {
  verifyBundle(bundle.json) === { ok: true }
}
```

`bundle.json` MUST pass BUNDLE_SPEC validation.

### PK5: Hash Match (run -> bundle)

```
if (run.bundle !== null) {
  run.bundle.sha256 === canonicalHash(readFile(bundle.json))
}
```

The bundle hash in `run.json` MUST match the computed hash of `bundle.json`.

### PK6: No Symlinks

```
files(pack).every(f => !isSymlink(f))
```

No file in the pack may be a symbolic link. Use `lstat()` to check.

### PK7: No Path Traversal

```
pack_path does not contain '..'
filenames do not contain '/' or '\\'
```

No traversal patterns in pack path or filenames.

### PK8: Optional Files Valid

```
if (patch.json exists) { verifyPatch(patch.json).ok }
if (evidence.json exists) { basic schema validation }
if (policy.json exists) { basic schema validation }
if (ledger.jsonl exists) { each line is valid JSON }
if (model_io.json exists) { verifyModelIO(model_io.json).ok }
if (runner.json exists) { verifyRunner(runner.json).valid }
```

Optional files, when present, MUST pass their respective validations.

### PK9: Ledger Format Valid

```
if (ledger.jsonl exists) {
  lines.every(line => JSON.parse(line) is valid LedgerEntry schema)
}
```

Ledger file MUST be valid JSONL with proper entry schema.

### PK10: Stable Violations

```
violations === sortBy(violations, ['rule_id', 'path', 'message'])
```

Violation output MUST be deterministically sorted.

### PK11: Meta Ignored

```
meta.json is parsed for JSON validity only
meta.json contents do not affect ok/violations
```

`meta.json` is not validated beyond JSON syntax. It carries no invariants.

### PK12: Regular Files Only

```
files(pack).every(f => isFile(f) && !isDirectory(f) && !isDevice(f))
```

All pack entries MUST be regular files.

---

## 9. Versioning

### 9.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to manifest or invariants
- **MINOR**: New optional files or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 9.2 Pack Schema Version

Packs do not have an embedded schema version. Compatibility is determined by the verifier version and the versions of embedded files (run_schema_version, etc.).

### 9.3 Backwards Compatibility

A verifier supporting spec version N MUST accept packs created under spec version N-1 (within the same major version).

### 9.4 Version History

| Spec Version | Date | Changes |
|--------------|------|---------|
| 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 10. References

### 10.1 Related Specifications

- [BUNDLE_SPEC.md](./BUNDLE_SPEC.md) - Bundle output contract
- [RUN_SPEC.md](./RUN_SPEC.md) - Run result contract
- [PATCH_SPEC.md](./PATCH_SPEC.md) - Patch set contract
- [EVIDENCE_SPEC.md](./EVIDENCE_SPEC.md) - Execution evidence contract
- [LEDGER_SPEC.md](./LEDGER_SPEC.md) - Audit trail contract
- [POLICY_SPEC.md](./POLICY_SPEC.md) - Policy profiles contract
- [MODEL_IO_SPEC.md](./MODEL_IO_SPEC.md) - Model recording session contract
- [RUNNER_SPEC.md](./RUNNER_SPEC.md) - Execution environment details contract
- [GIT_APPLY_SPEC.md](./GIT_APPLY_SPEC.md) - Git apply result contract

### 10.2 Implementation References

- [src/consumer/pack_types.ts](../src/consumer/pack_types.ts) - Pack types
- [src/consumer/pack_verify.ts](../src/consumer/pack_verify.ts) - Pack verifier
- [src/tools/pack_verify.ts](../src/tools/pack_verify.ts) - CLI tool

---

*This is a normative specification. Implementations MUST conform to all invariants.*
