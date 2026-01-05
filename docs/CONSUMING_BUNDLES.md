# Consuming Bundles

Guide for third-party consumers of Context Engine Kernel bundles.

## What is a Bundle?

A Bundle is the primary output artifact from the kernel's `transform()` function. It contains:

- Decomposition tree (nodes, constraints, entropy measurements)
- Generated outputs (files, commands, configs)
- Unresolved questions (for CLARIFY outcomes)
- Summary statistics

See [BUNDLE_SPEC.md](./BUNDLE_SPEC.md) for the full specification.

## Verifying a Bundle

Use the `bundle-verify` CLI to check if a bundle conforms to BUNDLE_SPEC.md:

```bash
npm run bundle-verify -- path/to/bundle.json
```

**Exit codes:**
- `0` - Bundle is valid
- `1` - IO error (file not found)
- `2` - Parse error (invalid JSON)
- `3` - Validation error (spec violations)

**Output (canonical JSON):**

Valid bundle:
```json
{"ok":true}
```

Invalid bundle:
```json
{"ok":false,"violations":[{"message":"outputs not sorted by path","path":"$.outputs","rule_id":"BS3"}]}
```

## Summarizing a Bundle

Use the `bundle-summarize` CLI to get a deterministic summary:

```bash
npm run bundle-summarize -- path/to/bundle.json
```

**Output (canonical JSON):**

```json
{
  "artifact_count": 1,
  "artifact_paths": ["src/hello.ts"],
  "bundle_hash": "abc123...",
  "outcome": "BUNDLE",
  "question_ids": [],
  "schema_version": "0.1.0",
  "terminal_node_ids": ["node_root123456789a"],
  "terminal_nodes_count": 1,
  "unresolved_questions_count": 0
}
```

## Programmatic Usage

Import the consumer module in your TypeScript/JavaScript code:

```typescript
import { verifyBundle, summarizeBundle } from 'context-engine-kernel/consumer';

// Load a bundle from file
const bundle = JSON.parse(await readFile('bundle.json', 'utf-8'));

// Verify against BUNDLE_SPEC.md
const result = verifyBundle(bundle);
if (!result.ok) {
  console.error('Violations:', result.violations);
  process.exit(1);
}

// Get deterministic summary
const summary = summarizeBundle(bundle);
console.log('Outcome:', summary.outcome);
console.log('Artifacts:', summary.artifact_count);
```

## CI Integration

Add bundle verification to your CI pipeline:

```yaml
# GitHub Actions example
- name: Verify bundle
  run: npm run bundle-verify -- output/bundle.json

- name: Get summary
  run: npm run bundle-summarize -- output/bundle.json > summary.json
```

## Rule IDs

Violations reference rule IDs from BUNDLE_SPEC.md:

| Rule | Description |
|------|-------------|
| BS1 | Schema version present |
| BS3 | Outputs sorted by path |
| BS4 | Constraints sorted lexicographically |
| BS5 | Questions sorted (priority desc, id asc) |
| BS6 | Terminal nodes sorted by id |
| BS7 | No path traversal in output paths |
| BS8 | Canonical serialization idempotent |
| SCHEMA | Basic schema structure valid |

## Outcome Types

| Outcome | Bundle Status | Description |
|---------|---------------|-------------|
| BUNDLE | complete | Successful decomposition with outputs |
| CLARIFY | incomplete | High entropy; needs question resolution |
| REFUSE | error | Invalid input; processing failed |

## Determinism Guarantee

Both `verifyBundle()` and `summarizeBundle()` produce byte-identical output for the same input. This is achieved through:

1. Canonical JSON serialization (sorted keys)
2. Deterministic violation ordering (by rule_id, then path)
3. Deterministic list ordering (artifact_paths sorted, question_ids by priority)
4. No timestamps or host information in output

---

*See also: [BUNDLE_SPEC.md](./BUNDLE_SPEC.md) | [VERIFY_RELEASE.md](./VERIFY_RELEASE.md)*
