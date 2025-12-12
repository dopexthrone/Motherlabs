# Motherlabs Runtime v0.2.0

**A governed, deterministic reasoning engine for MOTHER PC**

## What This Is

Motherlabs Runtime is the **execution layer** that consumes the Motherlabs Kernel (governance + schemas + records) and provides **controlled task decomposition, planning, and execution capabilities** under strict audit and safety constraints.

**Current capability:** LLM-powered task decomposition with evidence tracking.

## Architecture

```
┌─────────────────────┐
│ Motherlabs Kernel   │  ← Frozen governance + schemas
│ (Read-only truth)   │
└──────────┬──────────┘
           │ reads
┌──────────▼──────────┐
│ Motherlabs Runtime  │  ← This repository
│ (Controlled worker) │
└─────────────────────┘
```

## Current Status

**Completed Phases:**
- ✓ Phase 0: Governance established
- ✓ Phase 1: Schema boundary defined
- ✓ Phase 6: Intent proposal capability (basic)
- ✓ LLM adapter integrated

**Working capabilities:**
- Task decomposition (LLM or heuristic fallback)
- Evidence ledger (append-only)
- Tree visualization

**Safety guarantees:**
- All LLM calls logged as evidence
- Fallback to heuristics on failure
- No autonomous execution
- Kernel remains immutable

## Usage

### Basic Task Decomposition

```bash
# Without LLM (heuristic only)
node dist/cli.js decompose "Build a todo app"

# With LLM (requires API key)
ANTHROPIC_API_KEY=your_key node dist/cli.js decompose "Build a complex system"
```

### Example Output

```
🤖 Using LLM decomposition...

=== Task Decomposition ===

● [task-0] Build an expense tracking app
  ○ [task-0.0] Set up project structure and dependencies
  ○ [task-0.1] Implement user authentication system
  ○ [task-0.2] Build receipt scanning and OCR pipeline
  ○ [task-0.3] Create expense categorization logic
  ○ [task-0.4] Develop reporting and analytics dashboard

=== Evidence: 2 records ===
```

## Core Principles (Invariants)

All runtime behavior respects these **non-negotiable constraints**:

1. **Schema-before-behavior**: No code relies on undefined record types
2. **Purity-before-execution**: Can propose without acting
3. **Evidence-before-autonomy**: All actions logged
4. **Adapter-only side effects**: No implicit mutations
5. **Append-only kernel**: History never rewritten
6. **Fail-closed**: Invalid states halt execution
7. **Deterministic**: Same inputs → same outputs (modulo timestamps)
8. **No wildcard authority**: Permissions are explicit and scoped

## Roadmap

### Phase 7-9 (Next 2 weeks)
- Add execution evidence persistence to kernel
- Add validation and testing capabilities
- Build feedback loops for outcome tracking

### Phase 10-12 (Weeks 3-4)
- Implement self-improvement based on evidence
- Add code generation capability
- Build proposal → test → verify → apply pipeline

### Phase 13+ (Month 2+)
- Multi-agent coordination
- Complex project builds
- Continuous improvement loops

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run
node dist/cli.js help
```

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for LLM-powered decomposition
- `KERNEL_PATH` - Path to kernel repo (default: `/home/motherlabs/motherlabs-kernel`)

## Architecture Notes

**Why two repositories?**
- Kernel = immutable truth (governance, schemas, audit trail)
- Runtime = mutable intelligence (code that improves over time)

**Why LLM is an "adapter"?**
- External dependency
- Nondeterministic without constraints
- Must be logged and fallback-capable
- Never makes decisions, only proposals

**Why evidence matters?**
- Enables replay and debugging
- Tracks why decisions were made
- Supports safe self-improvement
- Prevents hallucinated authority

## Next Steps

1. **Test it**: Run on 10-20 real tasks
2. **Add API key**: Set `ANTHROPIC_API_KEY` for intelligent decomposition
3. **Measure**: Track success/failure patterns
4. **Improve**: Based on evidence, not guesses

---

**Built on MOTHER PC** | Governed by Motherlabs Kernel | Dec 2025
