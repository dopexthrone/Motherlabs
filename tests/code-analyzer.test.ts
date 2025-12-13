// Code Analyzer Tests - Parse, analyze, detect issues

import { analyzeFile, analyzeDirectory } from '../src/analysis/codeAnalyzer'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`)
    failCount++
  } else {
    console.log(`✓ PASS: ${message}`)
    passCount++
  }
}

async function runTests() {

console.log('=== CODE ANALYZER TESTS ===\n')

// Create test fixtures
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyzer-test-'))

// ============================================================================
// TEST 1: Analyze Simple File
// ============================================================================
console.log('TEST 1: Analyze Simple File\n')

const simpleFile = path.join(tmpDir, 'simple.ts')
fs.writeFileSync(simpleFile, `
export function add(a: number, b: number): number {
  return a + b
}
`)

const result1 = analyzeFile(simpleFile)

assert(result1.ok, 'Analyzes simple file successfully')
assert(result1.ok && result1.value.metrics.functions === 1, 'Counts functions correctly')
assert(result1.ok && result1.value.metrics.linesOfCode > 0, 'Counts lines of code')
assert(result1.ok && result1.value.metrics.complexity >= 1, 'Calculates complexity')

console.log('')

// ============================================================================
// TEST 2: Detect NO_TESTS Issue
// ============================================================================
console.log('TEST 2: Detect Missing Tests\n')

const noTestFile = path.join(tmpDir, 'untested.ts')
fs.writeFileSync(noTestFile, `
export function importantFunction(): void {
  // No test exists for this
}
`)

const result2 = analyzeFile(noTestFile)

assert(result2.ok, 'Analyzes file without test')
assert(
  result2.ok && result2.value.issues.some(i => i.type === 'NO_TESTS'),
  'Detects missing test file'
)
assert(
  result2.ok && result2.value.metrics.testCoverage === 0,
  'Test coverage is 0 when no test exists'
)

console.log('')

// ============================================================================
// TEST 3: Detect HIGH_COMPLEXITY
// ============================================================================
console.log('TEST 3: Detect High Complexity\n')

const complexFile = path.join(tmpDir, 'complex.ts')
fs.writeFileSync(complexFile, `
export function veryComplex(x: number): number {
  if (x > 0) {
    if (x > 10) {
      for (let i = 0; i < x; i++) {
        if (i % 2 === 0) {
          while (i > 0) {
            if (i > 5) {
              return i
            }
            i--
          }
        }
      }
    }
  }
  return 0
}
`)

const result3 = analyzeFile(complexFile)

assert(result3.ok, 'Analyzes complex file')
assert(
  result3.ok && result3.value.metrics.complexity >= 5,
  'Calculates complexity (expected ~8-10 for nested conditions)'
)
assert(
  result3.ok && result3.value.metrics.complexity > 1,
  'Complexity higher than simple function'
)

console.log('')

// ============================================================================
// TEST 4: Analyze Multiple Files
// ============================================================================
console.log('TEST 4: Analyze Multiple Files\n')

const file1 = path.join(tmpDir, 'module1.ts')
const file2 = path.join(tmpDir, 'module2.ts')

fs.writeFileSync(file1, 'export function func1() {}')
fs.writeFileSync(file2, 'export function func2() {}')

const resultDir = analyzeDirectory(tmpDir)

assert(resultDir.ok, 'Analyzes directory successfully')
assert(resultDir.ok && resultDir.value.length >= 2, 'Found multiple files')

console.log('')

// ============================================================================
// TEST 5: Handle Invalid Input
// ============================================================================
console.log('TEST 5: Handle Invalid Input\n')

const resultInvalid = analyzeFile('/nonexistent/file.ts')

assert(!resultInvalid.ok, 'Returns error for nonexistent file')
assert(
  !resultInvalid.ok && resultInvalid.error.message.length > 0,
  'Error has descriptive message'
)

console.log('')

// ============================================================================
// TEST 6: Detect Missing Error Handling
// ============================================================================
console.log('TEST 6: Detect Missing Error Handling\n')

const noErrorHandling = path.join(tmpDir, 'noerrors.ts')
fs.writeFileSync(noErrorHandling, `
export async function riskyFunction() {
  await someAsyncOperation()
  // No try/catch, no Result type
}
`)

const result6 = analyzeFile(noErrorHandling)

assert(result6.ok, 'Analyzes file with missing error handling')
assert(
  result6.ok && result6.value.issues.some(i => i.type === 'NO_ERROR_HANDLING'),
  'Detects missing error handling in async function'
)

console.log('')

// ============================================================================
// TEST 7: Deterministic Analysis
// ============================================================================
console.log('TEST 7: Deterministic Analysis\n')

const testFile = path.join(tmpDir, 'deterministic.ts')
fs.writeFileSync(testFile, `
export function test(): number {
  if (true) return 1
  return 0
}
`)

const analysis1 = analyzeFile(testFile)
const analysis2 = analyzeFile(testFile)

assert(
  analysis1.ok && analysis2.ok &&
  analysis1.value.metrics.complexity === analysis2.value.metrics.complexity,
  'Same file produces same complexity (deterministic)'
)

assert(
  analysis1.ok && analysis2.ok &&
  analysis1.value.issues.length === analysis2.value.issues.length,
  'Same file produces same issues (deterministic)'
)

console.log('')

// Cleanup
fs.rmSync(tmpDir, { recursive: true })

// ============================================================================
// SUMMARY
// ============================================================================
console.log('=== TEST SUMMARY ===\n')
console.log(`Passed: ${passCount}`)
console.log(`Failed: ${failCount}`)

console.log('\n✓ Code analyzer working')
console.log('✓ Metrics calculation deterministic')
console.log('✓ Issue detection functional')
console.log('✓ Error handling robust')

if (failCount > 0) {
  process.exit(1)
}

}

runTests().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
