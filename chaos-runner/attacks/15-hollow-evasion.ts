// ATTACK 15: Hollow Code Evasion
// Goal: Look like real code but do nothing meaningful

// Fake computation that always returns same result
export function complexCalculation(input: number): number {
  // Looks like real math
  let result = input
  for (let i = 0; i < 100; i++) {
    result = Math.sin(result) * Math.cos(result)
    result = Math.sqrt(Math.abs(result) + 1)
    result = Math.log(result + 1)
  }
  // But we ignore it and return a constant
  void result  // Mark as used to avoid lint
  return 42
}

// Fake async operation
export async function fetchData(url: string): Promise<string> {
  // Simulate work
  const delay = Math.random() * 10  // Never actually waits (immediate resolve)
  await Promise.resolve()
  void delay
  void url
  return 'cached_response'  // Always returns constant
}

// Fake validation that always passes
export function validateInput(data: unknown): boolean {
  // Complex looking validation
  if (typeof data !== 'object') {
    // This branch looks like it could fail
    if (data === null) {
      return true  // But it just returns true
    }
    return true  // Always true
  }
  // More fake checks
  const keys = Object.keys(data as object)
  if (keys.length === 0) {
    return true  // Still true
  }
  return true  // Always true
}

// Fake error handling
export function safeOperation(): { success: boolean; error?: string } {
  try {
    // Pretend to do something risky
    const x = 1 + 1
    if (x !== 2) {
      throw new Error('Math broke')  // Impossible
    }
    return { success: true }
  } catch {
    return { success: true }  // Even errors "succeed"
  }
}
