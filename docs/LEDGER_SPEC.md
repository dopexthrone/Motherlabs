# Ledger Specification

Normative contract for the append-only ledger (JSONL audit trail) in context-engine-kernel.

**Spec Version:** 1.0.0
**Status:** Normative
**Applies to:** v0.3.4+

---

## 1. Scope and Non-Goals

### 1.1 Scope

This specification defines:

- The JSONL file format for ledger entries
- The `LedgerEntry` schema and field semantics
- Append-only rules and integrity guarantees
- Invariants that all valid ledgers must satisfy

### 1.2 Non-Goals

This specification does NOT define:

- Ledger storage location (deployment-specific)
- Ledger rotation or archival policies
- Ledger replication or backup strategies
- Access control for ledger files

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Ledger** | Append-only JSONL file recording kernel execution history |
| **LedgerEntry** | Single line in the ledger representing one kernel run |
| **JSONL** | JSON Lines format (one JSON object per line) |
| **ContentHash** | `sha256:<hex>` format hash string |
| **Append-only** | New entries added at end; existing entries never modified |
| **canonicalize()** | Deterministic JSON serialization per DETERMINISM.md |

---

## 3. File Format

### 3.1 JSONL Structure

The ledger file uses JSON Lines format:

- One JSON object per line
- Lines terminated by `\n` (LF, not CRLF)
- No trailing comma between lines
- UTF-8 encoding
- No BOM (Byte Order Mark)

### 3.2 Example

```jsonl
{"run_id":"run_abc123","timestamp":"2026-01-05T10:00:00.000Z","intent_sha256":"sha256:a1b2...","bundle_sha256":"sha256:c3d4...","result_kind":"BUNDLE","accepted":true,"mode":"none","policy":"strict"}
{"run_id":"run_def456","timestamp":"2026-01-05T10:01:00.000Z","intent_sha256":"sha256:e5f6...","bundle_sha256":null,"result_kind":"REFUSE","accepted":false,"mode":"none","policy":"strict"}
```

### 3.3 File Naming Convention

Recommended: `ledger.jsonl` or `ledger_<date>.jsonl`

---

## 4. LedgerEntry Schema

### 4.1 Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | `string` | Unique identifier for this kernel run |
| `timestamp` | `string` | ISO 8601 UTC timestamp when entry was created |
| `intent_sha256` | `ContentHash` | SHA256 hash of the input intent |
| `bundle_sha256` | `ContentHash \| null` | SHA256 hash of output bundle (null if no bundle) |
| `result_kind` | `KernelResultKind` | Outcome type: BUNDLE, CLARIFY, REFUSE |
| `accepted` | `boolean` | Whether the result was accepted by the caller |
| `mode` | `ExecutionMode` | Execution mode: none, record, replay |
| `policy` | `PolicyProfileName` | Policy profile used: strict, default, dev |

### 4.2 KernelResultKind Values

| Value | Meaning |
|-------|---------|
| `BUNDLE` | Kernel produced a valid bundle |
| `CLARIFY` | Kernel requested clarification |
| `REFUSE` | Kernel refused to process intent |

### 4.3 ExecutionMode Values

| Value | Meaning |
|-------|---------|
| `none` | Normal execution (no recording) |
| `record` | Record model interactions for replay |
| `replay` | Replay from recorded interactions |

### 4.4 PolicyProfileName Values

| Value | Meaning |
|-------|---------|
| `strict` | Maximum safety constraints |
| `default` | Standard production constraints |
| `dev` | Development mode (relaxed constraints) |

---

## 5. Hashing Rules

### 5.1 Entry Serialization

Each `LedgerEntry` is serialized using `canonicalize()`:

```typescript
function serializeLedgerEntry(entry: LedgerEntry): string {
  return canonicalize(entry);
}
```

### 5.2 Entry Hash (Optional)

For integrity verification, entries may be hashed:

```typescript
function computeEntryHash(entry: LedgerEntry): ContentHash {
  return `sha256:${sha256(canonicalize(entry))}`;
}
```

### 5.3 Ledger Hash (Optional)

For complete ledger integrity:

```typescript
function computeLedgerHash(entries: LedgerEntry[]): ContentHash {
  const combined = entries.map(e => canonicalize(e)).join('\n');
  return `sha256:${sha256(combined)}`;
}
```

---

## 6. Append-Only Rules

### 6.1 Immutability

Once written, a ledger entry MUST NOT be:

- Modified
- Deleted
- Reordered

### 6.2 Append Operation

New entries MUST be appended at the end of the file:

```typescript
function appendToLedger(entry: LedgerEntry, ledgerPath: string): void {
  const line = serializeLedgerEntry(entry) + '\n';
  fs.appendFileSync(ledgerPath, line);
}
```

### 6.3 Atomicity

Append operations SHOULD be atomic to prevent corruption:

- Use file locking if concurrent writers possible
- Write complete line including newline
- Flush to disk before returning

---

## 7. Invariants

All valid ledgers MUST satisfy these invariants.

### LD1: One Entry Per Line

```
ledger.split('\n').filter(line => line.trim()).every(line =>
  JSON.parse(line) is valid LedgerEntry
)
```

Each non-empty line MUST be a complete, valid JSON object conforming to the LedgerEntry schema.

### LD2: Monotonic Timestamps

```
for i in 1..entries.length:
  new Date(entries[i].timestamp) >= new Date(entries[i-1].timestamp)
```

Entry timestamps MUST be monotonically non-decreasing.

### LD3: Unique Run IDs

```
entries.map(e => e.run_id).every((id, i, arr) =>
  arr.indexOf(id) === i
)
```

Each `run_id` MUST appear at most once in the ledger.

### LD4: Valid Content Hashes

```
entries.every(e =>
  isValidContentHash(e.intent_sha256) &&
  (e.bundle_sha256 === null || isValidContentHash(e.bundle_sha256))
)
```

All content hashes MUST be valid `sha256:<64-hex-chars>` format.

---

## 8. Versioning

### 8.1 Spec Version Format

`MAJOR.MINOR.PATCH` following semantic versioning:

- **MAJOR**: Breaking changes to schema or invariants
- **MINOR**: New optional fields or clarifications
- **PATCH**: Typo fixes, examples, non-normative changes

### 8.2 Backwards Compatibility

Ledger entries produced under spec version N MUST be parseable under spec version N+1 (minor/patch) unless a MAJOR version bump is released.

### 8.3 Schema Evolution

When adding new fields:

1. New fields MUST be optional
2. Parsers MUST ignore unknown fields
3. Writers SHOULD include spec version in metadata

### 8.4 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-05 | Initial normative specification |

---

## 9. References

- [DETERMINISM.md](./DETERMINISM.md) - Canonicalization rules
- [EVIDENCE_SPEC.md](./EVIDENCE_SPEC.md) - Execution evidence specification
- [src/harness/types.ts](../src/harness/types.ts) - Type definitions
- [src/harness/ledger.ts](../src/harness/ledger.ts) - Implementation

---

*This is a normative specification. Implementations MUST conform to all invariants.*
