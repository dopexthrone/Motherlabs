# KERNEL FREEZE PROTOCOL
## Deterministic Freeze, Verification, and Packaging v0.1

---

## A. Definition of "Kernel Freeze"

A Kernel Freeze is the act of producing a reference-grade, reproducible, auditable snapshot of the Motherlabs Kernel Trusted Computing Base (TCB), with:

1. Deterministic verification passing
2. An immutable anchor (hashes + tag)
3. A packaged artifact suitable for transfer to MOTHER PC or other hosts
4. An evidence record stored locally (ledger entry or freeze manifest committed to repo)

---

## B. Scope: TCB vs Non-TCB

### TCB (Must be frozen and high-bar gated)

```
src/validation/         # Gate implementations (AUTHORITY)
src/sandbox/            # Execution isolation (AUTHORITY)
src/persistence/        # Evidence storage (AUTHORITY)
src/core/               # Fundamental types (AUTHORITY)
src/selfbuild/          # Self-improvement (GOVERNED)
schemas/                # Schema validators
docs/                   # Constitution and specs that define authority
scripts/test-all.js     # Verification script
```

### Non-TCB (May evolve; not part of freeze guarantee)

```
src/adapters/           # LLM adapters (NON-AUTHORITATIVE)
src/benchmark/          # Benchmarking tools
src/llm/                # LLM interaction helpers
src/urco/               # Intent analysis (ADVISORY)
evidence/               # Runtime evidence (not frozen)
```

---

## C. Preconditions (Hard Gates)

**All must be true or freeze is rejected.**

### C1. Clean Working Tree
- No uncommitted changes
- No untracked files inside TCB paths
- Optional: allow untracked in non-TCB

### C2. Deterministic Verification Passes
```bash
npm run build           # TypeScript compilation
npm test               # Test suite (if present)
node scripts/test-all.js  # Full verification suite
```

### C3. No Secrets
```bash
# Must return empty or only false positives
git grep -nE "(OPENAI|ANTHROPIC|API[_-]?KEY|SECRET|TOKEN)" -- ':!node_modules'
```

---

## D. Freeze Procedure

### Step 1: Synchronize and confirm branch
```bash
git checkout main
git status -sb
```

### Step 2: Run full verification suite
```bash
npm run build
node scripts/test-all.js
```
**If any fail: STOP. Fix. Repeat.**

### Step 3: Confirm TCB has no untracked files
```bash
git status -sb
```
If `??` in TCB paths: add/commit, delete, or update TCB scope.

### Step 4: Create Freeze Manifest
Create `docs/FREEZE_MANIFEST.<VERSION>.json` containing:
- Version string (e.g., `kernel-v0.7.0`)
- Git commit hash
- Timestamp (ISO8601)
- List of TCB files with SHA-256
- Verification commands executed and PASS/FAIL
- Environment notes (Node version, OS, architecture)

### Step 5: Commit the Freeze Manifest
```bash
git add docs/FREEZE_MANIFEST.<VERSION>.json
git commit -m "chore(freeze): kernel freeze manifest <VERSION>"
```

### Step 6: Tag the freeze
```bash
git tag -a kernel-<VERSION> -m "Motherlabs Kernel Freeze <VERSION>"
```

### Step 7: Generate distributable package
```bash
tar -czf motherlabs-kernel-<VERSION>-tcb.tar.gz \
  src/validation src/sandbox src/persistence src/core src/selfbuild \
  schemas docs scripts/test-all.js \
  package.json package-lock.json tsconfig.json
```

### Step 8: Generate checksums
```bash
sha256sum motherlabs-kernel-<VERSION>-tcb.tar.gz > motherlabs-kernel-<VERSION>-checksums.sha256
```

### Step 9: Store packages
```bash
mkdir -p ~/MotherlabsFreezes/<VERSION>/
mv motherlabs-kernel-<VERSION>-* ~/MotherlabsFreezes/<VERSION>/
```

---

## E. Freeze Acceptance Criteria

A freeze is valid **only if**:

| Criterion | Verification |
|-----------|--------------|
| Git commit matches manifest | `git rev-parse HEAD` |
| All verification PASS | Command outputs in manifest |
| Package checksums exist | SHA-256 file present |
| Clean-room replay succeeds | Extract + npm ci + verify |

---

## F. Clean-Room Replay Test

```bash
mkdir -p /tmp/motherlabs-freeze-test && cd /tmp/motherlabs-freeze-test
tar -xzf <path-to-tarball>
npm ci
npm run build
node scripts/test-all.js
```

**If replay fails, freeze is INVALID.**

---

## G. Claude Code Constraints During Freeze

### Role: Verifier + Patch Preparer (NON-AUTHORITATIVE)

### Absolute Prohibitions
1. ❌ Run `git push`
2. ❌ Modify ledger history
3. ❌ Edit evidence records retroactively
4. ❌ Change TCB files without explicit instruction
5. ❌ Introduce dependencies without request
6. ❌ Store or print secrets
7. ❌ Declare PASS without command output

### Required Verification Checklist
1. Repo state: `git rev-parse --abbrev-ref HEAD`, `git status -sb`, `git log -1`
2. Verification: `npm run build`, `node scripts/test-all.js`
3. TCB cleanliness: `git status`, `git diff --stat`
4. Secret scan: `git grep -nE "(API[_-]?KEY|SECRET|TOKEN)"`

### Halt Conditions
- Any verification fails
- Untracked files in TCB scope
- Command output missing/truncated
- Secret-like content detected

---

## H. Implementation References

### Verification Entry Point
```typescript
// scripts/test-all.js
// Runs security scanner, axiom checker, 6-gate validator, Gate 4 kernel tests
```

### Evidence Storage
```typescript
// src/persistence/jsonlLedger.ts
// Append-only ledger for freeze evidence
```

### Gate Authority
```typescript
// src/validation/sixGates.ts
// All 6 gates must pass for TCB admission
```

---

*A freeze is proof. Proof is deterministic. Deterministic or invalid.*
