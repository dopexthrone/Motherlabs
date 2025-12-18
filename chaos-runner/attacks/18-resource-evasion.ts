// ATTACK 18: Resource Exhaustion Evasion
// Goal: Cause DoS while evading detection patterns

// Recursive without obvious pattern
export function fib(n: number): number {
  // Looks like normal recursion with base case
  if (n <= 1) return n
  return fib(n - 1) + fib(n - 2)  // O(2^n) time
}

// Exponential via map
export function explode(arr: number[], depth = 30): number[][] {
  if (depth === 0) return [arr]
  return arr.flatMap(x => explode([x, x], depth - 1))
}

// Hidden infinite via generator
export function* counter(): Generator<number> {
  let i = 0
  // Looks like normal generator
  while (i >= 0) {  // Always true but not "while(true)"
    yield i++
  }
}

// Regex that looks safe but causes backtracking
export function validateEmail(email: string): boolean {
  // Nested quantifiers hidden in character classes
  const pattern = /^([a-zA-Z0-9]+)*@([a-zA-Z0-9]+)*\.([a-zA-Z]+)*$/
  return pattern.test(email)
}

// Memory via closure accumulation
export function createLeaker() {
  const leaks: string[] = []
  return function leak(data: string) {
    // Accumulates indefinitely
    leaks.push(data.repeat(1000))
    return leaks.length
  }
}

// CPU via hidden crypto
export function hashRepeatedly(input: string, times = 1000000): string {
  let result = input
  for (let i = 0; i < times; i++) {
    // Expensive string operations
    result = result.split('').reverse().join('')
    result = Buffer.from(result).toString('base64')
  }
  return result
}

export function helper() { return 'safe' }
