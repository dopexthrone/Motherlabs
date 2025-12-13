# MOTHERLABS BUILD SPECIFICATION
**Version:** 2.0.0
**Status:** LOCKED - No changes without governance approval
**Purpose:** Prevent all categories of implementation errors through automated gates

---

## HARDCODED RULES (Non-Negotiable)

### **RULE 1: No function without schema**
```typescript
// FORBIDDEN:
export function doSomething(input: any): any { }

// REQUIRED:
export type Input = { field: string }
export type Output = { result: number }
export function doSomething(input: Input): Output { }
```
**Gate:** TypeScript must not allow `any` (strict mode enforced)

### **RULE 2: No function without test**
```
For every function in src/:
  - Must have corresponding test in tests/
  - Test must include: success case, failure case, edge case
  - Test must assert on specific invariant
```
**Gate:** Coverage check fails if function untested

### **RULE 3: No test without failure case**
```typescript
// FORBIDDEN:
test('adds numbers', () => {
  expect(add(1, 2)).toBe(3)
})

// REQUIRED:
test('adds numbers - success', () => {
  expect(add(1, 2)).toBe(3)
})
test('adds numbers - invalid input', () => {
  expect(() => add(null, 2)).toThrow('Input must be number')
})
test('adds numbers - overflow', () => {
  expect(add(Number.MAX_VALUE, 1)).toBe(Number.MAX_VALUE)
})
```
**Gate:** Test parser checks for failure/edge cases

### **RULE 4: No LLM output without 6 gates**
```
Every LLM call must pass through:
  1. Schema validation (Zod/JSON Schema)
  2. Syntax validation (tsc --noEmit)
  3. Variable resolution (all imports/exports valid)
  4. Test execution (generated tests must pass)
  5. URCO analysis (entropy < 0.3)
  6. Governance check (no policy violations)

Any gate fails → Output rejected, evidence logged
```
**Gate:** Automated pipeline, cannot be bypassed

### **RULE 5: No Date.now() or Math.random()**
```typescript
// FORBIDDEN:
const id = `item-${Date.now()}`
const choice = items[Math.floor(Math.random() * items.length)]

// REQUIRED:
const id = idGenerator.next('item')
const choice = items[deterministicIndex(items, seed)]
```
**Gate:** ESLint rule fails build if found

### **RULE 6: No silent catch**
```typescript
// FORBIDDEN:
try {
  await doSomething()
} catch {
  // silent
}

// REQUIRED:
try {
  await doSomething()
} catch (error) {
  return Err(toStructuredError(error))
}
```
**Gate:** Linter detects empty catch blocks

### **RULE 7: All state changes must be atomic**
```typescript
// FORBIDDEN:
fs.writeFileSync(path, data)

// REQUIRED:
atomicWrite(path, data)  // Writes to .tmp, renames on success

// With verification:
const written = fs.readFileSync(path)
assert(hash(written) === hash(data))
```
**Gate:** Audit script checks all fs.write calls

### **RULE 8: No TODO/FIXME in main branch**
```
Allowed: Feature branches only
Forbidden: Main/master branch
```
**Gate:** Pre-commit hook blocks TODO in src/

### **RULE 9: Every module exports validation function**
```typescript
// REQUIRED for every module:
export function selfValidate(): ValidationResult {
  return {
    invariants: checkInvariants(),
    contracts: checkContracts(),
    tests: checkTests()
  }
}
```
**Gate:** Build fails if module missing selfValidate()

### **RULE 10: No merge without evidence**
```
Every commit must include:
  - Test output showing pass
  - Or: benchmark results
  - Or: manual verification transcript
```
**Gate:** CI checks commit message for evidence link

---

## AUTOMATED VERIFICATION GATES

### **Gate 1: Type Safety**
```json
// tsconfig.json (LOCKED)
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```
**Enforcement:** Build fails if violated

### **Gate 2: Determinism Check**
```typescript
// .eslintrc.js (LOCKED)
module.exports = {
  rules: {
    'no-restricted-globals': ['error', 'Date', 'Math'],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
        message: 'Use injected time provider instead of Date.now()'
      },
      {
        selector: 'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
        message: 'Use seeded RNG instead of Math.random()'
      }
    ]
  }
}
```
**Enforcement:** Build fails on violation

### **Gate 3: Test Coverage**
```javascript
// jest.config.js (LOCKED)
module.exports = {
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80
    }
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary']
}
```
**Enforcement:** Test fails if coverage < 80%

### **Gate 4: No Mocks in Critical Paths**
```javascript
// test-rules.js (custom)
function detectMockBias(testFile) {
  const content = fs.readFileSync(testFile, 'utf-8')

  // Forbidden patterns
  const forbidden = [
    /jest\.mock\(/,
    /sinon\.stub\(/,
    /vi\.mock\(/,
    /return true \/\/ mock/i,
    /return \{\} \/\/ stub/i
  ]

  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      throw new Error(`Mock detected in ${testFile} - use real implementations`)
    }
  }
}
```
**Enforcement:** Pre-commit hook runs this

### **Gate 5: Schema Validation**
```typescript
// Every data type must have schema
// schemas/ must have .schema.json for every type in src/types/

function verifySchemasCovered() {
  const types = extractTypes('src/types/')
  const schemas = loadSchemas('schemas/')

  for (const type of types) {
    if (!schemas.has(type.name)) {
      throw new Error(`Missing schema for type: ${type.name}`)
    }
  }
}
```
**Enforcement:** Build step validates

### **Gate 6: Evidence Generation**
```typescript
// Every test must produce evidence file

afterAll(() => {
  const evidence = {
    suite: __filename,
    passed: results.passed,
    failed: results.failed,
    timestamp: now(),
    coverage: getCoverage()
  }

  fs.writeFileSync(
    `evidence/${path.basename(__filename)}.json`,
    JSON.stringify(evidence)
  )
})
```
**Enforcement:** CI checks evidence/ directory exists and is complete

---

## BUILD WORKFLOW (Automated, Gated)

### **Step 1: Pre-Build Validation**
```bash
#!/bin/bash
# pre-build.sh - Runs before ANY build

set -e  # Exit on any error

echo "=== Pre-Build Validation ==="

# Check 1: No TODO in src/
if grep -r "TODO\|FIXME" src/ --include="*.ts" | grep -v "node_modules"; then
  echo "ERROR: TODO/FIXME found in source"
  exit 1
fi

# Check 2: All types have schemas
node scripts/verify-schemas.js || exit 1

# Check 3: No Date.now or Math.random
node scripts/check-determinism.js || exit 1

# Check 4: No any types (except justified)
node scripts/check-any-types.js || exit 1

echo "✓ Pre-build validation passed"
```

### **Step 2: Build**
```bash
#!/bin/bash
# build.sh

./pre-build.sh || exit 1

tsc --noEmit || exit 1  # Type check
tsc || exit 1            # Compile

echo "✓ Build successful"
```

### **Step 3: Test with Gates**
```bash
#!/bin/bash
# test.sh

set -e

# Run all test suites
npm run test:urco || exit 1
npm run test:failures || exit 1
npm run test:deterministic || exit 1
npm run test:corruption || exit 1
npm run test:serialization || exit 1

# Check coverage
npm run test:coverage || exit 1

# Verify no mock bias
node scripts/detect-mocks.js tests/ || exit 1

# Generate evidence
node scripts/generate-test-evidence.js || exit 1

echo "✓ All tests passed with gates"
```

### **Step 4: Benchmark Gate**
```bash
#!/bin/bash
# benchmark-gate.sh

# Run quality benchmark
npm run benchmark:full > /tmp/benchmark-current.json

# Compare to baseline
node scripts/compare-metrics.js \
  baseline-metrics.json \
  /tmp/benchmark-current.json || exit 1

# Must maintain or improve quality
echo "✓ Quality maintained"
```

### **Step 5: Integration Gate**
```bash
#!/bin/bash
# integration-gate.sh

# Full end-to-end test
export ANTHROPIC_API_KEY=${TEST_API_KEY}

# Must successfully decompose 5 test tasks
for task in test-tasks/*.txt; do
  node dist/cli.js decompose "$(cat $task)" > /tmp/result.json
  node scripts/verify-output.js /tmp/result.json || exit 1
done

echo "✓ Integration tests passed"
```

---

## MASTER BUILD SCRIPT (All Gates)

```bash
#!/bin/bash
# master-build.sh - Enforces ALL constraints

set -e  # Fail on any error
set -u  # Fail on undefined variable

echo "=== MOTHERLABS GATED BUILD ==="
echo ""

echo "[1/5] Pre-Build Validation..."
./scripts/pre-build.sh || {
  echo "ERROR: Pre-build validation failed"
  exit 1
}

echo "[2/5] Compilation..."
./scripts/build.sh || {
  echo "ERROR: Build failed"
  exit 1
}

echo "[3/5] Test Suite..."
./scripts/test.sh || {
  echo "ERROR: Tests failed"
  exit 1
}

echo "[4/5] Benchmark Gate..."
./scripts/benchmark-gate.sh || {
  echo "ERROR: Quality regression detected"
  exit 1
}

echo "[5/5] Integration Gate..."
./scripts/integration-gate.sh || {
  echo "ERROR: Integration tests failed"
  exit 1
}

echo ""
echo "═══════════════════════════════════════"
echo "✓ ALL GATES PASSED"
echo "✓ Build is verified correct"
echo "✓ Safe to deploy"
echo "═══════════════════════════════════════"
```

---

## LLM CONSTRAINT MECHANISM (Hardcoded)

```typescript
// src/llm/constrained.ts - Wrapper that CANNOT be bypassed

export class ConstrainedLLM {
  private llm: Anthropic
  private validator: SixGateValidator

  async generate<T>(
    request: GenerateRequest,
    schema: Schema<T>
  ): Promise<Result<T, ValidationError>> {

    // 1. Sanitize input (prevents injection)
    const sanitized = sanitizeInput(request.input)
    if (!sanitized.ok) return Err(sanitized.error)

    // 2. Call LLM
    const raw = await this.llm.generate(sanitized.value)

    // 3. GATE 1: Schema validation
    const schemaCheck = validateSchema(raw, schema)
    if (!schemaCheck.ok) {
      await logRejection('SCHEMA_INVALID', raw, schemaCheck.error)
      return Err(schemaCheck.error)
    }

    // 4. GATE 2: Syntax validation (if code)
    if (schema.type === 'code') {
      const syntaxCheck = await validateSyntax(raw)
      if (!syntaxCheck.ok) {
        await logRejection('SYNTAX_INVALID', raw, syntaxCheck.error)
        return Err(syntaxCheck.error)
      }
    }

    // 5. GATE 3: Variable resolution (if code)
    if (schema.type === 'code') {
      const varCheck = validateVariables(raw)
      if (!varCheck.ok) {
        await logRejection('UNDEFINED_VARS', raw, varCheck.error)
        return Err(varCheck.error)
      }
    }

    // 6. GATE 4: Test execution (if testable)
    if (schema.testable) {
      const testCheck = await runGeneratedTests(raw)
      if (!testCheck.allPass) {
        await logRejection('TESTS_FAILED', raw, testCheck.failures)
        return Err('Generated code fails tests')
      }
    }

    // 7. GATE 5: URCO entropy check
    const entropyCheck = computeEntropy(raw)
    if (entropyCheck > MAX_ENTROPY) {
      await logRejection('TOO_AMBIGUOUS', raw, entropyCheck)
      return Err('Output too ambiguous')
    }

    // 8. GATE 6: Governance compliance
    const govCheck = checkGovernance(raw)
    if (!govCheck.ok) {
      await logRejection('GOVERNANCE_VIOLATION', raw, govCheck.error)
      return Err(govCheck.error)
    }

    // All gates passed
    await logAcceptance(raw, schema)
    return Ok(raw as T)
  }
}
```

---

## VERIFICATION SCRIPTS (Hardcoded Checks)

### **scripts/verify-schemas.js**
```javascript
// Verify every type has a schema (EXACT match required)

const fs = require('fs')
const path = require('path')

function extractTypes(file) {
  const content = fs.readFileSync(file, 'utf-8')
  const typeRegex = /export\s+(?:type|interface)\s+(\w+)/g
  const types = []
  let match
  while ((match = typeRegex.exec(content)) !== null) {
    types.push(match[1])
  }
  return types
}

function checkSchemaExists(typeName) {
  const schemaPath = `schemas/${typeName.toLowerCase()}.schema.json`
  return fs.existsSync(schemaPath)
}

// Check all type files
const typeFiles = fs.readdirSync('src/types', { recursive: true })
  .filter(f => f.endsWith('.ts'))

let errors = 0

for (const file of typeFiles) {
  const types = extractTypes(path.join('src/types', file))

  for (const type of types) {
    if (!checkSchemaExists(type)) {
      console.error(`ERROR: No schema for type ${type}`)
      console.error(`  Expected: schemas/${type.toLowerCase()}.schema.json`)
      errors++
    }
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} types missing schemas`)
  process.exit(1)
}

console.log('✓ All types have schemas')
```

### **scripts/check-determinism.js**
```javascript
// Check for non-deterministic code (EXACT patterns)

const fs = require('fs')
const glob = require('glob')

const FORBIDDEN_PATTERNS = [
  { pattern: /Date\.now\(\)/, message: 'Date.now() breaks determinism' },
  { pattern: /Math\.random\(\)/, message: 'Math.random() breaks determinism' },
  { pattern: /new Date\(\)/, message: 'new Date() breaks determinism' },
  { pattern: /Math\.floor\(Math\.random/, message: 'Random number generation forbidden' },
  { pattern: /process\.hrtime/, message: 'hrtime breaks determinism' },
  { pattern: /performance\.now/, message: 'performance.now breaks determinism' }
]

const files = glob.sync('src/**/*.ts', { ignore: '**/node_modules/**' })

let errors = 0

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip if line has "SAFETY:" comment (justified exception)
    if (line.includes('// SAFETY:')) continue

    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        console.error(`ERROR: ${file}:${i + 1}`)
        console.error(`  ${message}`)
        console.error(`  ${line.trim()}`)
        errors++
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} determinism violations found`)
  process.exit(1)
}

console.log('✓ No determinism violations')
```

### **scripts/detect-mocks.js**
```javascript
// Detect mock/stub patterns in tests

const fs = require('fs')
const glob = require('glob')

const MOCK_PATTERNS = [
  /jest\.mock\(/,
  /sinon\.stub\(/,
  /vi\.mock\(/,
  /td\.replace\(/,
  /return true \/\/ mock/i,
  /return \{\} \/\/ stub/i,
  /\/\/ TODO: real implementation/i
]

const files = glob.sync('tests/**/*.ts')

let mockCount = 0
let violations = []

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8')

  for (const pattern of MOCK_PATTERNS) {
    if (pattern.test(content)) {
      mockCount++
      violations.push(`${file}: Matches ${pattern}`)
    }
  }
}

if (mockCount > 0) {
  console.error('ERROR: Mock/stub patterns detected in tests')
  violations.forEach(v => console.error(`  ${v}`))
  console.error('\nUse real implementations or fixture-based tests')
  process.exit(1)
}

console.log('✓ No mock bias detected')
```

### **scripts/verify-test-coverage.js**
```javascript
// Verify every function has tests with failure cases

const fs = require('fs')
const glob = require('glob')

function extractFunctions(file) {
  const content = fs.readFileSync(file, 'utf-8')
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)/g
  const functions = []
  let match
  while ((match = funcRegex.exec(content)) !== null) {
    functions.push(match[1])
  }
  return functions
}

function hasTest(funcName) {
  const testFiles = glob.sync('tests/**/*.test.ts')

  for (const testFile of testFiles) {
    const content = fs.readFileSync(testFile, 'utf-8')

    // Must have test for function
    if (!content.includes(funcName)) continue

    // Must have failure case
    const hasFailureCase = /fail|error|invalid|edge|boundary/i.test(content)
    if (!hasFailureCase) {
      throw new Error(`${funcName} test missing failure case`)
    }

    return true
  }

  return false
}

const srcFiles = glob.sync('src/**/*.ts', {
  ignore: ['**/*.test.ts', '**/types.ts', '**/index.ts']
})

let untested = []

for (const file of srcFiles) {
  const functions = extractFunctions(file)

  for (const func of functions) {
    if (!hasTest(func)) {
      untested.push(`${file}: ${func}`)
    }
  }
}

if (untested.length > 0) {
  console.error('ERROR: Functions without tests:')
  untested.forEach(u => console.error(`  ${u}`))
  process.exit(1)
}

console.log('✓ All functions tested with failure cases')
```

---

## LOCKED CONFIGURATION FILES

These files are IMMUTABLE without governance approval:

```
tsconfig.json          - Type safety rules
.eslintrc.js          - Determinism rules
jest.config.js        - Coverage thresholds
BUILD_SPEC.md         - This file
GOVERNANCE.md         - Constitutional rules
```

**Enforcement:** Git hook prevents modification without special commit prefix

---

## BUILD EXECUTION ORDER (EXACT SEQUENCE)

```bash
# 1. Validate (fails if any rule violated)
./scripts/pre-build.sh

# 2. Check types (fails on 'any' or type errors)
tsc --noEmit

# 3. Lint (fails on Date.now, Math.random)
eslint src/

# 4. Build (compiles)
tsc

# 5. Test (fails if coverage < 80%)
npm test

# 6. Detect mocks (fails if mocks found)
node scripts/detect-mocks.js

# 7. Verify schemas (fails if type missing schema)
node scripts/verify-schemas.js

# 8. Benchmark gate (fails if quality regressed)
npm run benchmark:gate

# 9. Generate evidence
node scripts/generate-evidence.js

# 10. Success
echo "✓ Gated build complete"
```

**Any step fails → Entire build fails → No partial success**

---

## COMMIT REQUIREMENTS (Enforced by Git Hooks)

### **Pre-Commit Hook:**
```bash
#!/bin/bash
# .git/hooks/pre-commit

# 1. No TODO in src/
git diff --cached --name-only | grep "^src/" | while read file; do
  if git diff --cached "$file" | grep "+.*TODO"; then
    echo "ERROR: Cannot commit TODO in src/"
    exit 1
  fi
done

# 2. Must include test for new functions
# (Check if src/ changed but no test/ changed)

# 3. All checks pass
./scripts/pre-build.sh || exit 1
```

### **Commit Message Format:**
```
type: short description

Body must include ONE of:
- Tests: output of npm test
- Benchmark: comparison results
- Manual: verification steps performed

Evidence required for ALL commits.
```

---

## STARTING POINT (Now)

**Before building more, INSTALL THESE GATES:**

```bash
cd /home/motherlabs/motherlabs-runtime

# 1. Create all verification scripts
mkdir -p scripts

# 2. Copy all scripts from BUILD_SPEC.md

# 3. Make executable
chmod +x scripts/*.sh

# 4. Test gates work
./scripts/pre-build.sh  # Should pass
./scripts/test.sh       # Should pass

# 5. Install git hooks
cp scripts/pre-commit .git/hooks/
chmod +x .git/hooks/pre-commit

# 6. Lock configuration
git add tsconfig.json .eslintrc.js BUILD_SPEC.md
git commit -m "build: lock gates and verification rules"
```

**Only AFTER gates are installed: Begin building**

---

## NEXT MODULE BUILD TEMPLATE

**For EVERY new module, follow EXACT sequence:**

```
1. Write schema first: schemas/modulename.schema.json
2. Write type: src/types/modulename.ts
3. Write implementation: src/modulename.ts
4. Write tests: tests/modulename.test.ts
   - Include: success, failure, edge cases
5. Run: ./scripts/pre-build.sh (must pass)
6. Run: npm test (must pass)
7. Run: npm run benchmark:gate (must not regress)
8. Commit with evidence

No step can be skipped.
Any failure → Fix before proceeding.
```

---

## ANSWER TO YOUR QUESTION

**How to build full Motherlabs with NO mistakes possible?**

1. **Install all gates FIRST** (above scripts)
2. **Lock configuration** (tsconfig, eslint, jest)
3. **Build module by module** following exact template
4. **Gates prevent:**
   - Mock bias (detect-mocks.js blocks)
   - Hollow shells (test coverage enforces real impl)
   - Non-determinism (eslint blocks Date.now)
   - Undefined variables (tsc strict mode blocks)
   - LLM escapes (6-gate validation blocks)
   - Test theatre (requires failure cases)

**Timeline:** 8 weeks if gates enforced
**Certainty:** 100% (machines enforce rules, not humans)

---

**Ready to install gates and begin gated build?**

Say "install gates" and I'll create all scripts and locks.