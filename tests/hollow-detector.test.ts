// Hollow Detector Tests - Verifies AST-based hollow code detection
// Tests Step 4 of ROADMAP_NEXT_10.md: Enhance Hollow Code Detection

import {
  detectHollowPatterns,
  formatHollowResult,
  passesHollowDetection,
  HollowPattern
} from '../src/validation/hollowDetector'

let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`\u2717 FAIL: ${message}`)
    failCount++
  } else {
    console.log(`\u2713 PASS: ${message}`)
    passCount++
  }
}

async function runTests() {

console.log('=== HOLLOW DETECTOR TESTS ===\n')

// ============================================================================
// TEST 1: Empty Function Detection
// ============================================================================
console.log('TEST 1: Empty Function Detection\n')

const emptyFunctionCode = `
export function doNothing() {
}

export function alsoEmpty(): void {
}
`

const emptyResult = detectHollowPatterns(emptyFunctionCode)
assert(emptyResult.ok, 'Empty function detection succeeds')
if (emptyResult.ok) {
  assert(emptyResult.value.hasHollowPatterns, 'Detects hollow patterns')
  assert(emptyResult.value.patterns.some(p => p.type === 'EMPTY_FUNCTION'),
         'Identifies EMPTY_FUNCTION type')
  assert(emptyResult.value.patterns.length >= 2, 'Finds both empty functions')
}

console.log('')

// ============================================================================
// TEST 2: Return-Only Function Detection
// ============================================================================
console.log('TEST 2: Return-Only Function Detection\n')

const returnOnlyCode = `
export function alwaysTrue(): boolean {
  return true
}

export function alwaysFalse(): boolean {
  return false
}

export function constantNumber(): number {
  return 42
}
`

const returnOnlyResult = detectHollowPatterns(returnOnlyCode)
assert(returnOnlyResult.ok, 'Return-only detection succeeds')
if (returnOnlyResult.ok) {
  assert(returnOnlyResult.value.hasHollowPatterns, 'Detects return-only patterns')
  assert(returnOnlyResult.value.patterns.some(p => p.type === 'RETURN_ONLY'),
         'Identifies RETURN_ONLY type')
}

console.log('')

// ============================================================================
// TEST 3: Not Implemented Error Detection
// ============================================================================
console.log('TEST 3: Not Implemented Error Detection\n')

const notImplementedCode = `
export function futureFeature() {
  throw new Error('Not implemented yet')
}

export function todoMethod(): string {
  throw new Error('TODO: implement this')
}
`

const notImplementedResult = detectHollowPatterns(notImplementedCode)
assert(notImplementedResult.ok, 'Not implemented detection succeeds')
if (notImplementedResult.ok) {
  assert(notImplementedResult.value.hasHollowPatterns, 'Detects not implemented patterns')
  assert(notImplementedResult.value.patterns.some(p => p.type === 'NOT_IMPLEMENTED'),
         'Identifies NOT_IMPLEMENTED type')
}

console.log('')

// ============================================================================
// TEST 4: Stub Implementation Detection
// ============================================================================
console.log('TEST 4: Stub Implementation Detection\n')

const stubCode = `
export function getUser(): User | undefined {
  return undefined
}

export function getData(): Data | null {
  return null
}
`

const stubResult = detectHollowPatterns(stubCode)
assert(stubResult.ok, 'Stub detection succeeds')
if (stubResult.ok) {
  assert(stubResult.value.hasHollowPatterns, 'Detects stub patterns')
  assert(stubResult.value.patterns.some(p => p.type === 'STUB_IMPLEMENTATION'),
         'Identifies STUB_IMPLEMENTATION type')
}

console.log('')

// ============================================================================
// TEST 5: TODO Placeholder Detection
// ============================================================================
console.log('TEST 5: TODO Placeholder Detection\n')

const todoCode = `
export function processData(data: string): string {
  // TODO: implement actual processing
  return data
}

export function validateInput(input: unknown): boolean {
  // FIXME: add real validation
  return true
}
`

const todoResult = detectHollowPatterns(todoCode)
assert(todoResult.ok, 'TODO placeholder detection succeeds')
if (todoResult.ok) {
  assert(todoResult.value.hasHollowPatterns, 'Detects TODO patterns')
  assert(todoResult.value.patterns.some(p => p.type === 'TODO_PLACEHOLDER'),
         'Identifies TODO_PLACEHOLDER type')
}

console.log('')

// ============================================================================
// TEST 6: Empty Class Detection
// ============================================================================
console.log('TEST 6: Empty Class Detection\n')

const emptyClassCode = `
export class EmptyService {
}

export class AnotherEmpty {
}
`

const emptyClassResult = detectHollowPatterns(emptyClassCode)
assert(emptyClassResult.ok, 'Empty class detection succeeds')
if (emptyClassResult.ok) {
  assert(emptyClassResult.value.hasHollowPatterns, 'Detects empty class patterns')
  assert(emptyClassResult.value.patterns.some(p => p.type === 'EMPTY_CLASS'),
         'Identifies EMPTY_CLASS type')
}

console.log('')

// ============================================================================
// TEST 7: Empty Catch Block Detection
// ============================================================================
console.log('TEST 7: Empty Catch Block Detection\n')

const emptyCatchCode = `
export function riskyOperation() {
  try {
    doSomethingDangerous()
  } catch (e) {
  }
}
`

const emptyCatchResult = detectHollowPatterns(emptyCatchCode)
assert(emptyCatchResult.ok, 'Empty catch detection succeeds')
if (emptyCatchResult.ok) {
  assert(emptyCatchResult.value.hasHollowPatterns, 'Detects empty catch patterns')
  assert(emptyCatchResult.value.patterns.some(p => p.type === 'EMPTY_CATCH'),
         'Identifies EMPTY_CATCH type')
}

console.log('')

// ============================================================================
// TEST 8: Mock Test Detection
// ============================================================================
console.log('TEST 8: Mock Test Detection\n')

const mockTestCode = `
function testSomething() {
  const x = 1
  const y = 2
}

function testAnotherThing(): boolean {
  return true
}
`

const mockTestResult = detectHollowPatterns(mockTestCode)
assert(mockTestResult.ok, 'Mock test detection succeeds')
if (mockTestResult.ok) {
  assert(mockTestResult.value.hasHollowPatterns, 'Detects mock test patterns')
  assert(mockTestResult.value.patterns.some(p => p.type === 'MOCK_TEST'),
         'Identifies MOCK_TEST type')
}

console.log('')

// ============================================================================
// TEST 9: Arrow Function Detection
// ============================================================================
console.log('TEST 9: Arrow Function Detection\n')

const arrowCode = `
export const emptyArrow = () => {}
export const nullArrow = () => null
export const undefinedArrow = () => undefined
`

const arrowResult = detectHollowPatterns(arrowCode)
assert(arrowResult.ok, 'Arrow function detection succeeds')
if (arrowResult.ok) {
  assert(arrowResult.value.hasHollowPatterns, 'Detects arrow function hollow patterns')
  assert(arrowResult.value.patterns.some(p => p.type === 'EMPTY_FUNCTION'),
         'Identifies empty arrow function')
}

console.log('')

// ============================================================================
// TEST 10: Clean Code Passes
// ============================================================================
console.log('TEST 10: Clean Code Passes\n')

const cleanCode = `
export function calculateSum(a: number, b: number): number {
  const result = a + b
  if (result < 0) {
    throw new Error('Negative sum not allowed')
  }
  return result
}

export class UserService {
  private users: User[] = []

  addUser(user: User): void {
    this.users.push(user)
  }

  getUser(id: string): User | undefined {
    return this.users.find(u => u.id === id)
  }
}
`

const cleanResult = detectHollowPatterns(cleanCode)
assert(cleanResult.ok, 'Clean code detection succeeds')
if (cleanResult.ok) {
  assert(!cleanResult.value.hasHollowPatterns || cleanResult.value.hollowScore >= 80,
         'Clean code has high hollow score')
  assert(passesHollowDetection(cleanResult.value), 'Clean code passes hollow detection')
}

console.log('')

// ============================================================================
// TEST 11: Multi-line Pattern Detection (Key Feature)
// ============================================================================
console.log('TEST 11: Multi-line Pattern Detection\n')

const multiLineCode = `
export function complexButHollow(
  param1: string,
  param2: number,
  param3: boolean
): ComplexResult {
  // This is a multi-line function
  // with comments and parameters
  // but ultimately does nothing
  throw new Error('Not implemented')
}
`

const multiLineResult = detectHollowPatterns(multiLineCode)
assert(multiLineResult.ok, 'Multi-line detection succeeds')
if (multiLineResult.ok) {
  assert(multiLineResult.value.hasHollowPatterns, 'Detects multi-line hollow pattern')
  assert(multiLineResult.value.patterns.some(p =>
    p.type === 'NOT_IMPLEMENTED' && p.location.endLine - p.location.startLine > 3),
         'Captures multi-line span correctly')
}

console.log('')

// ============================================================================
// TEST 12: Location Information
// ============================================================================
console.log('TEST 12: Location Information\n')

const locationCode = `
// Line 1
// Line 2
export function lineThree() {
}
// Line 5
`

const locationResult = detectHollowPatterns(locationCode)
assert(locationResult.ok, 'Location detection succeeds')
if (locationResult.ok) {
  const pattern = locationResult.value.patterns[0]
  assert(pattern && pattern.location.startLine === 4, 'Correct start line')
  assert(pattern && pattern.location.endLine === 5, 'Correct end line')
}

console.log('')

// ============================================================================
// TEST 13: Hollow Score Calculation
// ============================================================================
console.log('TEST 13: Hollow Score Calculation\n')

// Needs substantial code to get full penalty (size normalization)
const veryHollowCode = `
// File with multiple hollow patterns
// Demonstrating hollow code detection

export function emptyOne() {}
export function emptyTwo() {}
export function emptyThree() {}

export function returnTrue(): boolean { return true }
export function returnFalse(): boolean { return false }

export function notImpl1() { throw new Error('Not implemented') }
export function notImpl2() { throw new Error('TODO: implement') }

// Filler to pass size threshold
export const CONFIG = { enabled: true };
`

const veryHollowResult = detectHollowPatterns(veryHollowCode)
assert(veryHollowResult.ok, 'Very hollow detection succeeds')
if (veryHollowResult.ok) {
  assert(veryHollowResult.value.hollowScore < 80, 'Very hollow code has low score')
  assert(!passesHollowDetection(veryHollowResult.value), 'Very hollow code fails detection')
}

console.log('')

// ============================================================================
// TEST 14: Format Output
// ============================================================================
console.log('TEST 14: Format Output\n')

const formatCode = `
export function placeholder() {
  throw new Error('Not implemented')
}
`

const formatResult = detectHollowPatterns(formatCode)
assert(formatResult.ok, 'Format detection succeeds')
if (formatResult.ok) {
  const formatted = formatHollowResult(formatResult.value)
  assert(formatted.includes('HOLLOW CODE DETECTION'), 'Format includes header')
  assert(formatted.includes('Status:'), 'Format includes status')
  assert(formatted.includes('Hollow Score:'), 'Format includes score')
  assert(formatted.includes('DETECTED PATTERNS:'), 'Format includes patterns section')
}

console.log('')

// ============================================================================
// TEST 15: Test with Assertions Passes
// ============================================================================
console.log('TEST 15: Test with Assertions Passes\n')

const realTestCode = `
function testCalculation() {
  const result = calculate(2, 3)
  expect(result).toBe(5)
}

function testValidation() {
  const valid = validate('test')
  assert(valid === true, 'Should be valid')
}
`

const realTestResult = detectHollowPatterns(realTestCode)
assert(realTestResult.ok, 'Real test detection succeeds')
if (realTestResult.ok) {
  const mockTests = realTestResult.value.patterns.filter(p => p.type === 'MOCK_TEST')
  assert(mockTests.length === 0, 'Tests with assertions are not flagged as mock')
}

console.log('')

// ============================================================================
// SUMMARY
// ============================================================================
console.log('='.repeat(60))
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed\n`)

if (failCount > 0) {
  console.log('HOLLOW DETECTOR TESTS FAILED')
  process.exit(1)
} else {
  console.log('ALL HOLLOW DETECTOR TESTS PASSED')
}

}

runTests().catch(err => {
  console.error('Test execution error:', err)
  process.exit(1)
})
