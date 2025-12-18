// ATTACK 02: Homoglyph Attack - Unicode lookalikes
// Goal: Evade Gate 7 trivial assertion detection

// Uses Cyrillic 'а' (U+0430) instead of Latin 'a' in 'assert'
// Visual: looks like "assert" but regex won't match

export function testSuite() {
  // These look like assertions but use Cyrillic characters
  const аssert = (x: boolean, msg: string) => { /* noop */ }
  const еxpect = (x: any) => ({ toBe: () => {}, toEqual: () => {} })

  // "Tests" that do nothing but look legitimate
  аssert(true, 'validation passed')
  аssert(true, 'edge case handled')
  аssert(true, 'null check complete')
  аssert(true, 'boundary verified')

  еxpect(null).toBe(null)
  еxpect([]).toEqual([])

  return 'all tests passed'
}

// Real function to "improve"
export function processData(input: string): string {
  return input.toUpperCase()
}
