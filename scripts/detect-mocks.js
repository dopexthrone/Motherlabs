#!/usr/bin/env node
// Detect mock/stub patterns in tests - EXACT matching

const fs = require('fs')
const path = require('path')

function globSync(pattern) {
  const results = []
  function walk(dir) {
    if (!fs.existsSync(dir)) return
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
  { pattern: /jest\.mock\(/g, message: 'jest.mock forbidden - use real implementations' },
  { pattern: /sinon\.stub\(/g, message: 'sinon.stub forbidden - use real implementations' },
  { pattern: /vi\.mock\(/g, message: 'vitest mock forbidden - use real implementations' },
  { pattern: /td\.replace\(/g, message: 'testdouble forbidden - use real implementations' },
  { pattern: /return true \/\/ mock/gi, message: 'Mock return detected' },
  { pattern: /return \{\} \/\/ stub/gi, message: 'Stub return detected' },
  { pattern: /return \[\] \/\/ mock/gi, message: 'Mock array detected' },
  { pattern: /\/\/ TODO: real implementation/gi, message: 'TODO placeholder in test' }
]

const ALLOWED_PATTERNS = [
  /FixtureLLMAdapter/,  // Fixture-based is OK
  /MockTimeProvider/,   // Time mocking is OK if deterministic
  /TestAdapter/         // Test adapters OK if they use real logic
]

const files = globSync('tests/**/*.ts')
  .filter(f => !f.includes('fixtures'))

let violations = []

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip allowed patterns
    if (ALLOWED_PATTERNS.some(p => p.test(line))) {
      continue
    }

    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
      const matches = line.match(pattern)
      if (matches) {
        violations.push({
          file,
          line: i + 1,
          message,
          code: line.trim()
        })
      }
    }
  }
}

if (violations.length > 0) {
  console.error('\n✗ Mock/Stub bias detected in tests:\n')
  violations.forEach(v => {
    console.error(`${v.file}:${v.line}`)
    console.error(`  ${v.message}`)
    console.error(`  ${v.code}`)
    console.error('')
  })
  console.error('FORBIDDEN: Mocks/stubs in production test paths')
  console.error('REQUIRED: Use real implementations or fixture-based tests')
  process.exit(1)
}

console.log('✓ No mock bias detected - all tests use real implementations')
process.exit(0)
