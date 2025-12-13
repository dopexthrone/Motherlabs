# FULL MOTHERLABS BUILD PLAN
**Status:** LOCKED - Gates installed, ready to build
**Timeline:** 8 weeks to 100% of 50-section architecture
**Current:** 15% complete

---

## BUILD ORDER (Exact Sequence)

### **WEEK 1: Persistence & State Machine**

#### **Day 1: File-Based Ledger**
```
Module: src/persistence/fileLedger.ts
Schema: schemas/ledger-entry.schema.json
Tests:  tests/persistence.test.ts

Requirements:
- Append-only file writes
- Atomic operations (write .tmp, rename)
- Hash chain verification
- Crash recovery

Gates will enforce:
✓ Schema exists before implementation
✓ No Date.now() (must use TimeProvider)
✓ All functions have failure case tests
✓ No mocks (use real temp files)

Verification:
./scripts/master-build.sh  # Must pass all 5 gates
```

#### **Day 2: State Machine**
```
Module: src/kernel/stateMachine.ts
Schema: schemas/kernel-state.schema.json
Tests:  tests/state-machine.test.ts

Requirements:
- Deterministic transitions
- Invalid transitions blocked
- State validated at every step
- Evidence for all transitions

Verification:
./scripts/master-build.sh
npm run test:state-machine
```

#### **Day 3-5: Remaining Week 1 modules**
Following same pattern for each...

---

### **WEEK 2: Code Generation with 6-Gate Validation**

#### **Day 6: Constrained LLM Wrapper**
```
Module: src/llm/constrained.ts
Schema: schemas/generation-request.schema.json

Critical implementation:
export class ConstrainedLLM {
  async generate<T>(
    request: GenerateRequest,
    schema: Schema<T>
  ): Promise<Result<T, ValidationError>> {

    // Input sanitization (already implemented)
    const sanitized = sanitizeInput(request.input)

    // LLM call with timeout (already implemented)
    const raw = await this.llm.generate(sanitized.value)

    // GATE 1: Schema validation
    const g1 = validateSchema(raw, schema)
    if (!g1.ok) {
      await logRejection('SCHEMA', raw, g1.error)
      return Err(g1.error)
    }

    // GATE 2: Syntax (if code)
    if (isCode(request.type)) {
      const g2 = await validateSyntax(raw)
      if (!g2.ok) {
        await logRejection('SYNTAX', raw, g2.error)
        return Err(g2.error)
      }
    }

    // GATE 3: Variables (if code)
    if (isCode(request.type)) {
      const g3 = validateAllVariables(raw, request.context)
      if (!g3.ok) {
        await logRejection('UNDEFINED_VARS', raw, g3.error)
        return Err(g3.error)
      }
    }

    // GATE 4: Tests (if testable)
    if (request.testable) {
      const g4 = await runGeneratedTests(raw)
      if (!g4.allPass) {
        await logRejection('TESTS', raw, g4.failures)
        return Err('Tests failed')
      }
    }

    // GATE 5: URCO check
    const g5 = urcoValidate(raw, request.requirements)
    if (g5.entropy > MAX_ENTROPY) {
      await logRejection('URCO', raw, { entropy: g5.entropy })
      return Err('Too ambiguous')
    }

    // GATE 6: Governance
    const g6 = checkGovernance(raw, LOCKED_POLICIES)
    if (!g6.ok) {
      await logRejection('GOVERNANCE', raw, g6.error)
      return Err(g6.error)
    }

    // All gates passed
    return Ok(raw as T)
  }
}
```

**Gates will enforce:**
- ✓ All 6 validation gates MUST be checked
- ✓ Cannot skip gates (enforced by type system)
- ✓ All rejections logged as evidence
- ✓ No LLM output used without validation

#### **Day 7-10: Code generation, testing, validation**

---

### **WEEK 3: Self-Modification**

```
Modules to build:
- src/selfbuild/analyzer.ts   (find issues in own code)
- src/selfbuild/proposer.ts   (generate improvement proposals)
- src/selfbuild/validator.ts  (validate proposals)
- src/selfbuild/applier.ts    (apply with rollback)

Each module:
1. Schema first
2. Implementation
3. Tests (including failure cases)
4. Gates pass
5. Evidence generated
```

---

### **WEEK 4: Dogfooding Loop**

```
Module: src/dogfood/loop.ts

async function dogfoodingLoop() {
  while (true) {
    // 1. Analyze self (deterministic)
    const issues = await analyzeMotherlabs()

    // 2. Propose fix (LLM + 6 gates)
    const proposal = await proposeFix(issues[0])
    if (!proposal.ok) {
      await logRejection(proposal.error)
      continue
    }

    // 3. Validate in sandbox
    const validated = await validateInSandbox(proposal.value)
    if (!validated.ok) {
      await logRejection(validated.error)
      continue
    }

    // 4. Human approval (if required)
    if (requiresApproval(proposal.value)) {
      const approved = await waitForApproval()
      if (!approved) continue
    }

    // 5. Apply with automatic rollback on failure
    const applied = await applyWithRollback(proposal.value)

    // 6. Verify improvement
    const metrics = await measureImprovement()
    await logEvidence(metrics)

    // Sleep
    await sleep(3600_000)  // 1 hour
  }
}
```

**Gates enforce:**
- ✓ Cannot apply without validation
- ✓ Cannot skip sandbox testing
- ✓ Auto-rollback on test failure
- ✓ All changes evidenced

---

## SYSTEMATIC MODULE BUILD TEMPLATE

**For EVERY module, execute this EXACT sequence:**

```bash
#!/bin/bash
# build-module.sh - Template for building any module

MODULE_NAME=$1

echo "Building module: $MODULE_NAME"

# Step 1: Create schema
echo "[1/8] Creating schema..."
cat > schemas/${MODULE_NAME}.schema.json << SCHEMA
{
  "\$schema": "https://json-schema.org/draft/2020-12/schema",
  "\$id": "motherlabs://schemas/${MODULE_NAME}.schema.json",
  ...
}
SCHEMA

# Step 2: Create type
echo "[2/8] Creating type definition..."
cat > src/types/${MODULE_NAME}.ts << TYPE
export type ${MODULE_NAME} = {
  // Define structure
}
TYPE

# Step 3: Create implementation
echo "[3/8] Creating implementation..."
# (Write real implementation, no stubs)

# Step 4: Create tests
echo "[4/8] Creating tests..."
cat > tests/${MODULE_NAME}.test.ts << TEST
// Must include:
// - Success case
// - Failure case
// - Edge case
// - Null/undefined handling
TEST

# Step 5: Run pre-build gates
echo "[5/8] Running pre-build gates..."
./scripts/pre-build.sh || exit 1

# Step 6: Compile
echo "[6/8] Compiling..."
npx tsc || exit 1

# Step 7: Test
echo "[7/8] Running tests..."
npm test || exit 1

# Step 8: Generate evidence
echo "[8/8] Generating evidence..."
./scripts/master-build.sh || exit 1

echo "✓ Module $MODULE_NAME complete and gated"
```

---

## LLM ESCAPE PREVENTION (Hardcoded)

**Every LLM call MUST go through ConstrainedLLM:**

```typescript
// FORBIDDEN (direct LLM call):
const result = await anthropic.messages.create(...)

// REQUIRED (gated LLM call):
const result = await constrainedLLM.generate(request, schema)
// This ENFORCES all 6 gates, cannot be bypassed
```

**Enforcement:**
```javascript
// Add to check-determinism.js:
if (/anthropic\.messages\.create/.test(line) &&
    !line.includes('// UNGATED-ALLOWED:')) {
  throw new Error('Direct LLM call detected - use ConstrainedLLM')
}
```

---

## VARIABLE TRACKING (Automated)

**Add to pre-build.sh:**
```bash
# Check for undefined variables
echo "[Gate 6] Checking variable resolution..."
node scripts/check-variables.js || exit 1
```

**scripts/check-variables.js:**
```javascript
// Parse all TypeScript, verify:
// 1. All imports resolve
// 2. All function calls exist
// 3. All types defined
// 4. No circular dependencies

const ts = require('typescript')

function checkVariables(file) {
  const program = ts.createProgram([file], {})
  const checker = program.getTypeChecker()

  // Get diagnostics (includes undefined errors)
  const diagnostics = ts.getPreEmitDiagnostics(program)

  if (diagnostics.length > 0) {
    diagnostics.forEach(d => {
      console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    })
    return false
  }

  return true
}
```

---

## CURRENT STATUS

**Gates installed:** ✓
**Gates tested:** ✓
**Gates passing:** ✓

**Ready to build:** ✓

**Next action:** Start Week 1, Day 1 - Build persistent ledger

---

**Say "start week 1" to begin systematic gated build**
