# Kernel Determinism Contract

**Version**: 0.1.1
**Status**: ENFORCED
**Last Updated**: 2026-01-05

---

## Definition (Operational)

A kernel run is **deterministic** iff, for the same logical input intent (byte-identical after normalization) and the same kernel version, the kernel produces:

1. **Byte-identical canonical output bundle JSON**
2. **Identical `sha256(bundle_canonical_bytes)`**

Independent of: host machine, OS, filesystem ordering, locale, timezone, and timing.

This is enforced by eliminating or pinning every source of nondeterminism and by making determinism **mechanically testable**.

---

## 1. Pinned Execution Environment

### 1.1 Node Version
- `.nvmrc`: `24.11.1`
- `package.json` engines: `{ "node": "24.11.1" }`
- CI uses `npm ci` with locked dependencies

### 1.2 Locale and Timezone
All scripts and CI enforce:
```bash
TZ=UTC
LANG=C
LC_ALL=C
```

**Rationale**: Date/number formatting and string collation can drift with locale/timezone.

---

## 2. Banned APIs (Bundle Hash Domain)

The following APIs are **BANNED** in any code path that affects bundle output:

| Banned API | Reason | Alternative |
|------------|--------|-------------|
| `Date.now()` | Wall-clock time | Evidence logs only, not bundle |
| `new Date()` | Wall-clock time | Evidence logs only, not bundle |
| `Math.random()` | Non-deterministic | Never use; seeded PRNG for tests only |
| `crypto.randomUUID()` | Non-deterministic | Derive IDs from content hash |
| `os.hostname()` | Host-dependent | Evidence logs only |
| `process.uptime()` | Host-dependent | Never in bundle |
| `fs.readdirSync()` without `.sort()` | Order varies by OS | Always sort results |
| `Object.keys()` for serialization | Order not guaranteed | Use canonical serializer |
| Map/Set iteration without sort | Order not guaranteed | Convert to array, sort, then use |
| `Promise.all()` with order-dependent assembly | Race conditions | Collect all, sort by key, then assemble |
| Floating-point in output | Platform variance | Integers 0-100 or fixed-point |

### Enforcement
```bash
# CI gate: scripts/check-banned-apis.sh
grep -rn "Math.random\|Date.now\|new Date\|randomUUID\|os.hostname" src/kernel/ && exit 1
grep -rn "readdirSync" src/kernel/ | grep -v "\.sort(" && exit 1
```

---

## 3. Input Normalization

### 3.1 Normalization Function
All inputs pass through `normalizeIntent()`:

1. Parse as UTF-8
2. Strip BOM if present
3. Convert CRLF → LF
4. Normalize Unicode to NFC
5. Validate against input schema

### 3.2 Canonical Intent
After normalization:
1. Serialize with canonical JSON (sorted keys)
2. Compute: `intent_sha256 = sha256(canonical_intent_bytes)`

This hash becomes `source_intent_hash` in all bundles and evidence.

---

## 4. Canonical JSON Serialization

### 4.1 Rules
The canonical serializer (`canonicalize()`) applies:

1. **Primitives**: Standard JSON form
2. **Arrays**: Elements in exact index order
3. **Objects**: Keys sorted lexicographically (UTF-16 code units), then serialized
4. **Encoding**: UTF-8, no BOM
5. **Whitespace**: No extra spaces, single trailing LF
6. **Rejected values**: `NaN`, `Infinity`, `BigInt`, `undefined` (throw, not serialize)

### 4.2 Single Path
**All** artifact serialization uses `canonicalize()`. No direct `JSON.stringify()`.

### 4.3 Hash Computation
```typescript
bundle_sha256 = sha256(canonicalize(bundle))
output_sha256 = sha256(canonicalize(output))
```

Never hash non-canonical objects.

---

## 5. Stable Ordering Rules

Every list in output has a defined ordering rule:

| Field | Ordering |
|-------|----------|
| `outputs[]` | Sorted by `path` ascending |
| `unresolved_questions[]` | Sorted by `priority` desc, then `id` asc |
| `constraints[]` | Sorted lexicographically after normalization |
| `children[]` | Sorted by `node_id` ascending |
| `evidence[]` | Sorted by `source_hash` ascending |

These rules are:
- Documented in schema
- Enforced in code
- Tested in determinism suite

---

## 6. Numeric Representation

### 6.1 Integers Only in Bundle
- `ambiguity_score`: integer 0-100
- `confidence`: integer 0-100
- `entropy_proxy`: integer 0-100
- `information_gain`: integer 0-100
- Counters: integers

### 6.2 If Ratios Required
Store as `{ numerator: number, denominator: number }` (integers, reduced by GCD).

**Rationale**: Float representation varies across platforms and can cause bit-level differences.

---

## 7. Identifier Derivation

### 7.1 Bundle ID
```typescript
bundle_id = "bundle_" + sha256(canonical_bundle_bytes).slice(0, 16)
```
Deterministic, stable, derived from content.

### 7.2 Node ID
```typescript
node_id = "node_" + sha256(canonical({
  parent_id,
  splitting_question,
  context_hash
})).slice(0, 16)
```

### 7.3 Question ID
```typescript
question_id = "q_" + sha256(canonical({
  text,
  expected_answer_type,
  why_needed
})).slice(0, 16)
```

### 7.4 Run ID (Evidence Only)
`run_id` may include timestamp for audit trail but **must not affect bundle hash domain**.

---

## 8. Text Normalization

### 8.1 Line Endings
- Internal: always LF
- Output files: always LF
- Never use OS default conversion

### 8.2 Paths
- Forward slashes in bundle paths regardless of OS
- Never include absolute paths in bundle
- Relative paths only

### 8.3 Encoding
- UTF-8 everywhere
- Explicit encode/decode
- Reject unknown encodings

---

## 9. Pure Function Pipeline

### 9.1 Transform is Synchronous
The core `transform(intent) → bundle` path is:
- Synchronous
- Single-threaded
- No parallelism
- No async in transform path

### 9.2 If Async Required
- Collect all results
- Sort by deterministic key
- Then assemble

**Never** allow completion order to become output order.

---

## 10. Determinism Tests

### 10.1 Same-Process Repeatability
```typescript
const bundle1 = transform(intent)
const bundle2 = transform(intent)
assert(canonicalize(bundle1) === canonicalize(bundle2))
assert(sha256(bundle1) === sha256(bundle2))
```

### 10.2 Cross-Process Repeatability
```bash
node dist/cli.js transform intent.json > bundle1.json
node dist/cli.js transform intent.json > bundle2.json
diff bundle1.json bundle2.json  # Must be empty
```

### 10.3 Cross-Platform (CI Matrix)
```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest]
steps:
  - run: node dist/cli.js transform golden-intent.json
  - run: |
      EXPECTED="abc123..."
      ACTUAL=$(sha256sum bundle.json | cut -d' ' -f1)
      [ "$ACTUAL" = "$EXPECTED" ] || exit 1
```

### 10.4 Mutation Resistance
Deliberately shuffle object key insertion order during construction.
Assert canonicalization still yields identical bytes.

---

## 11. Golden Hashes

### Golden Intent 001
```json
{
  "goal": "Create a user authentication system",
  "constraints": ["Must use JWT", "Session timeout 24h"]
}
```
**Expected bundle_sha256**: `<computed on first valid build>`

### Update Protocol
1. Changes to kernel logic require new golden hashes
2. Golden hashes are versioned with kernel version
3. Hash mismatches fail CI unconditionally

---

## 12. Minimal Compliance Checklist

If you only do 5 things:

1. **Canonicalize JSON** for input and output with sorted keys
2. **Define and enforce stable ordering** for every list
3. **Remove time/random/host state** from bundle hash domain
4. **Use integers only**; avoid floats in hashed outputs
5. **Prove it** with golden hash tests across processes and OSes

---

*This contract is enforced by CI. Violations fail the build.*
