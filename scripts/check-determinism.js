#!/usr/bin/env node
// Check for non-deterministic code (EXACT patterns)

const fs = require('fs')
const path = require('path')

function globSync(pattern) {
  const results = []
  function walk(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true })
    for (const file of files) {
      const fullPath = path.join(dir, file.name)
      if (file.isDirectory() && !file.name.includes('node_modules')) {
        walk(fullPath)
      } else if (file.isFile() && fullPath.endsWith('.ts')) {
        results.push(fullPath)
      }
    }
  }
  walk(pattern.replace('/**/*.ts', ''))
  return results
}

const FORBIDDEN_PATTERNS = [
  { pattern: /Date\.now\(\)/, message: 'Date.now() breaks determinism - use globalTimeProvider.now()' },
  { pattern: /Math\.random\(\)/, message: 'Math.random() breaks determinism - use seeded RNG' },
  { pattern: /new Date\(\)(?!\s*\()/, message: 'new Date() breaks determinism - use injected time' },
  { pattern: /Math\.floor\(Math\.random/, message: 'Random number generation forbidden' },
  { pattern: /process\.hrtime/, message: 'hrtime breaks determinism' },
  { pattern: /performance\.now/, message: 'performance.now breaks determinism' },
  { pattern: /crypto\.randomBytes/, message: 'randomBytes breaks determinism - use seeded generator' }
]

const files = globSync('src/**/*.ts')

let errors = 0

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip if line has SAFETY: comment (justified exception)
    if (line.includes('// SAFETY:') || line.includes('// DETERMINISM-EXEMPT:')) {
      continue
    }

    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        console.error(`\n${file}:${i + 1}`)
        console.error(`  ERROR: ${message}`)
        console.error(`  ${line.trim()}`)
        console.error(`  Fix: Use injected dependencies (globalTimeProvider, seededRNG)`)
        errors++
      }
    }
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} determinism violations found`)
  console.error('\nDeterminism is MANDATORY. Fix before proceeding.')
  process.exit(1)
}

console.log('✓ No determinism violations detected')
process.exit(0)
