# Motherlabs Runtime - Action Plan

**Status:** System Validated
**Date:** 2025-12-14
**Version:** 0.1.0

---

## Current State Summary

| Component | Status |
|-----------|--------|
| 6-Gate Validation | Fully Operational |
| OpenAI Provider | Ready (gpt-4o) |
| Anthropic Provider | Ready (claude-sonnet-4-5) |
| Sandbox Execution | Secure & Verified |
| Self-Improvement | Achieved (commit 5bd4b59) |
| Test Suite | 18/18 Passing |

---

## Phase 1: Immediate Actions (Priority: Critical)

### 1.1 Test Anthropic Claude Integration
**Goal:** Verify Claude produces code that passes all 6 gates

**Tasks:**
- [ ] Obtain Anthropic API key
- [ ] Run dogfooding cycle with `anthropicApiKey` config
- [ ] Compare output quality vs GPT-4o
- [ ] Document any model-specific prompt adjustments needed

**Command:**
```typescript
const loop = new DogfoodingLoop({
  cycleInterval: 60000,
  requireHumanApproval: false,
  maxImprovementsPerCycle: 1,
  ledgerPath: 'evidence/dogfood-anthropic.jsonl',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: 'claude-sonnet-4-5-20250929'
});
await loop.runOnce();
```

**Success Criteria:**
- LLM-generated code passes all 6 gates
- Commit created with `source: "llm"`
- Tests pass after auto-apply

---

### 1.2 Create CLI Dogfood Command
**Goal:** Easy command-line access to self-improvement

**Tasks:**
- [ ] Add `dogfood` command to `src/cli.ts`
- [ ] Support `--provider openai|anthropic` flag
- [ ] Support `--dry-run` for proposal-only mode
- [ ] Support `--approve` for auto-apply mode
- [ ] Add progress output with gate results

**Usage:**
```bash
npm run dogfood -- --provider openai --dry-run
npm run dogfood -- --provider anthropic --approve
```

**Files to Modify:**
- `src/cli.ts` - Add dogfood command
- `package.json` - Add npm script

---

### 1.3 Fix Gate 4 Local Import Handling
**Goal:** Allow Gate 4 to verify code with local imports

**Current Issue:**
```
Error: Cannot find module '../core/result'
```

**Solution Options:**

| Option | Complexity | Security | Recommended |
|--------|------------|----------|-------------|
| A. Bundle with esbuild | Medium | High | Yes |
| B. Copy source to sandbox | High | Medium | No |
| C. Make Gate 4 advisory for imports | Low | High | Fallback |

**Recommended Approach (Option A):**
```typescript
// In sandbox/executor.ts
import { build } from 'esbuild';

async function bundleCode(code: string, projectRoot: string): Promise<string> {
  const result = await build({
    stdin: { contents: code, loader: 'ts' },
    bundle: true,
    write: false,
    platform: 'node',
    external: ['node:*'],  // Keep node builtins external
    absWorkingDir: projectRoot
  });
  return result.outputFiles[0].text;
}
```

**Tasks:**
- [ ] Add esbuild as dev dependency
- [ ] Create `bundleCode()` function in sandbox
- [ ] Update Gate 4 to bundle before execution
- [ ] Test with code containing local imports
- [ ] Fallback to advisory mode if bundling fails

---

## Phase 2: Enhanced Analysis (Priority: High)

### 2.1 Security Vulnerability Detection
**Goal:** Detect common security issues in generated code

**New Issue Types:**
| Issue Type | Pattern | Severity |
|------------|---------|----------|
| `SQL_INJECTION` | String concatenation in queries | Critical |
| `XSS_VULNERABLE` | Unescaped user input in HTML | Critical |
| `HARDCODED_SECRET` | API keys, passwords in code | Critical |
| `INSECURE_RANDOM` | `Math.random()` for crypto | High |
| `PATH_TRAVERSAL` | Unsanitized file paths | High |
| `COMMAND_INJECTION` | Unsanitized shell commands | Critical |

**Tasks:**
- [ ] Create `src/analysis/securityAnalyzer.ts`
- [ ] Add patterns for each vulnerability type
- [ ] Integrate with `codeAnalyzer.ts`
- [ ] Add corresponding fix prompts for LLM
- [ ] Add tests for each detection

**Files to Create:**
- `src/analysis/securityAnalyzer.ts`
- `tests/security-analyzer.test.ts`
- `schemas/securityissue.schema.json`

---

### 2.2 Performance Issue Detection
**Goal:** Identify performance anti-patterns

**New Issue Types:**
| Issue Type | Pattern |
|------------|---------|
| `N_PLUS_ONE_QUERY` | Loop with async call inside |
| `SYNC_IN_ASYNC` | Blocking calls in async functions |
| `MEMORY_LEAK` | Event listeners without cleanup |
| `INEFFICIENT_LOOP` | O(n^2) patterns in loops |

**Tasks:**
- [ ] Create `src/analysis/performanceAnalyzer.ts`
- [ ] Integrate with main analyzer
- [ ] Add LLM fix prompts

---

### 2.3 Expand Code Issue Coverage
**Goal:** Detect more code quality issues

**Additional Issue Types:**
- [ ] `UNUSED_EXPORT` - Exported but never imported
- [ ] `CIRCULAR_DEPENDENCY` - Module cycles
- [ ] `MAGIC_NUMBER` - Unexplained numeric literals
- [ ] `LONG_FUNCTION` - Functions > 50 lines
- [ ] `DEEP_NESTING` - > 4 levels of nesting
- [ ] `MISSING_AWAIT` - Unhandled promises

---

## Phase 3: Workflow & UX (Priority: Medium)

### 3.1 Human Approval Workflow
**Goal:** Production-safe approval process

**Components:**
```
[Proposal] → [Review Queue] → [Human Review] → [Approve/Reject] → [Apply/Discard]
```

**Tasks:**
- [ ] Create `src/approval/queue.ts` - Proposal queue manager
- [ ] Create `src/approval/reviewer.ts` - CLI review interface
- [ ] Add proposal diff view (before/after)
- [ ] Add gate results summary in review
- [ ] Support batch approve/reject
- [ ] Add rejection reason tracking

**CLI Interface:**
```bash
npm run review              # List pending proposals
npm run review show <id>    # Show proposal details
npm run review approve <id> # Approve and apply
npm run review reject <id>  # Reject with reason
```

---

### 3.2 Metrics Dashboard
**Goal:** Track self-improvement progress

**Metrics to Track:**
| Metric | Description |
|--------|-------------|
| `total_cycles` | Number of dogfood cycles run |
| `proposals_generated` | Total improvement proposals |
| `gate_pass_rate` | % proposals passing all gates |
| `gate_failure_breakdown` | Which gates reject most |
| `issues_fixed` | Successfully applied improvements |
| `rollbacks` | Applied but rolled back |
| `llm_cost` | Estimated API costs |

**Tasks:**
- [ ] Create `src/metrics/collector.ts`
- [ ] Add metrics to ledger on each event
- [ ] Create `npm run metrics` command
- [ ] Output as JSON for external dashboards
- [ ] Optional: HTML report generation

**Output Format:**
```json
{
  "period": "2025-12-14",
  "cycles": 47,
  "proposals": 23,
  "accepted": 5,
  "rejected": 18,
  "gate_failures": {
    "schema_validation": 3,
    "syntax_validation": 2,
    "variable_resolution": 8,
    "test_execution": 4,
    "urco_entropy": 1,
    "governance_check": 0
  },
  "improvements_applied": 3,
  "rollbacks": 1
}
```

---

### 3.3 Improved Prompts
**Goal:** Higher quality LLM outputs

**Tasks:**
- [ ] Add few-shot examples to prompts
- [ ] Include project context (tsconfig, style)
- [ ] Add "avoid these patterns" section
- [ ] Test prompt variations for quality
- [ ] A/B test between providers

---

## Phase 4: Advanced Features (Priority: Low)

### 4.1 Multi-File Refactoring
**Goal:** Handle changes spanning multiple files

**Challenges:**
- Dependency graph analysis
- Coordinated changes
- Rollback complexity

**Tasks:**
- [ ] Build module dependency graph
- [ ] Detect cross-file impacts
- [ ] Generate multi-file proposals
- [ ] Atomic multi-file apply with rollback
- [ ] Update evidence format for multi-file

---

### 4.2 Auto Test Generation
**Goal:** Generate tests for untested code

**Approach:**
1. Identify files without test coverage
2. Analyze public API surface
3. Generate test cases via LLM
4. Validate tests actually test the code

**Tasks:**
- [ ] Add coverage analysis
- [ ] Create test generation prompts
- [ ] Validate generated tests compile
- [ ] Validate tests exercise target code
- [ ] Add to dogfooding pipeline

---

### 4.3 CI/CD Integration
**Goal:** Run dogfooding in CI pipeline

**Workflow:**
```yaml
# .github/workflows/dogfood.yml
on:
  schedule:
    - cron: '0 0 * * *'  # Daily
  workflow_dispatch:

jobs:
  dogfood:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run dogfood -- --provider openai --dry-run
      - run: |
          if [ -f proposal.json ]; then
            gh pr create --title "Auto-improvement" --body-file proposal.md
          fi
```

**Tasks:**
- [ ] Create GitHub Action workflow
- [ ] Output proposal as PR-ready format
- [ ] Add status checks for gates
- [ ] Configure branch protection

---

### 4.4 Model Benchmarking
**Goal:** Compare LLM providers objectively

**Metrics:**
| Metric | Description |
|--------|-------------|
| Gate pass rate | % of outputs passing all gates |
| First-attempt success | % passing on attempt 1 |
| Code quality score | Static analysis metrics |
| Cost per success | $ per accepted proposal |
| Latency | Time to generate |

**Tasks:**
- [ ] Create benchmark harness
- [ ] Run same issues across providers
- [ ] Track metrics per provider/model
- [ ] Generate comparison report
- [ ] Recommend optimal model per issue type

---

## Phase 5: Production Hardening (Priority: Future)

### 5.1 Rate Limiting & Cost Control
- [ ] Add API call rate limiting
- [ ] Set daily/monthly cost caps
- [ ] Alert on unusual spending
- [ ] Track token usage per proposal

### 5.2 Audit Trail
- [ ] Full audit log of all actions
- [ ] Who approved what, when
- [ ] Immutable evidence chain
- [ ] Export for compliance

### 5.3 Multi-Tenant Support
- [ ] Separate ledgers per project
- [ ] Project-specific governance rules
- [ ] Isolated sandboxes

### 5.4 Rollback System
- [ ] One-click rollback to any commit
- [ ] Automatic rollback on test failure
- [ ] Rollback notification system

---

## Dependency Graph

```
Phase 1.1 (Anthropic Test)
    ↓
Phase 1.2 (CLI Command)
    ↓
Phase 1.3 (Gate 4 Imports) ←─── Required for deterministic fallback
    ↓
Phase 2.* (Analysis) ←───────── Can be parallelized
    ↓
Phase 3.1 (Approval) ←───────── Required for production
    ↓
Phase 3.2 (Metrics)
    ↓
Phase 4.* (Advanced) ←───────── Can be parallelized
    ↓
Phase 5.* (Production)
```

---

## Quick Reference

### Run Dogfooding (Current)
```typescript
import { DogfoodingLoop } from './dist/dogfood/loop';

const loop = new DogfoodingLoop({
  cycleInterval: 60000,
  requireHumanApproval: true,
  maxImprovementsPerCycle: 1,
  ledgerPath: 'evidence/dogfood.jsonl',
  openaiApiKey: process.env.OPENAI_API_KEY
});

await loop.runOnce();
```

### Validate Code Manually
```typescript
import { SixGateValidator } from './dist/validation/sixGates';

const validator = new SixGateValidator();
const result = await validator.validate(code, {
  existingImports: [],
  existingTypes: [],
  governanceRules: ['no_date_now', 'determinism_required']
});

console.log('Valid:', result.value.valid);
result.value.gateResults.forEach(g => {
  console.log(`${g.passed ? '✓' : '✗'} ${g.gateName}`);
});
```

### Check System Health
```bash
npm run build && npm test
```

---

## Success Metrics

| Milestone | Target | Current |
|-----------|--------|---------|
| Gates operational | 6/6 | 6/6 ✓ |
| LLM providers | 2 | 2 ✓ |
| Self-improvement achieved | Yes | Yes ✓ |
| Test coverage | >80% | ~60% |
| Issues auto-fixable | 10+ | 5 |
| Production ready | No | No |

---

*This plan is a living document. Update as progress is made.*
