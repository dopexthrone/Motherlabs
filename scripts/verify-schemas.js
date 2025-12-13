#!/usr/bin/env node
// Verify every type has a schema - EXACT enforcement

const fs = require('fs')
const path = require('path')

function globSync(pattern, options = {}) {
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

function extractTypes(file) {
  const content = fs.readFileSync(file, 'utf-8')

  // Match: export type X = ... or export interface X
  const typeRegex = /export\s+(?:type|interface)\s+(\w+)/g
  const types = []
  let match

  while ((match = typeRegex.exec(content)) !== null) {
    types.push({
      name: match[1],
      file: file
    })
  }

  return types
}

function schemaExists(typeName) {
  const possiblePaths = [
    `schemas/${typeName.toLowerCase()}.schema.json`,
    `schemas/${typeName}.schema.json`,
    `../motherlabs-kernel/schemas/${typeName.toLowerCase()}.schema.json`
  ]

  for (const schemaPath of possiblePaths) {
    if (fs.existsSync(schemaPath)) {
      return { exists: true, path: schemaPath }
    }
  }

  return { exists: false, path: null }
}

// Find all type definition files
const typeFiles = globSync('src/**/*.ts')
  .filter(f => !f.includes('.test.ts'))

let errors = []

console.log('Checking schema coverage...\n')

for (const file of typeFiles) {
  const types = extractTypes(file)

  for (const type of types) {
    const schema = schemaExists(type.name)

    if (!schema.exists) {
      errors.push({
        type: type.name,
        file: file,
        expectedPath: `schemas/${type.name.toLowerCase()}.schema.json`
      })
    } else {
      console.log(`✓ ${type.name} → ${schema.path}`)
    }
  }
}

if (errors.length > 0) {
  console.error('\n✗ Types missing schemas:\n')
  errors.forEach(e => {
    console.error(`${e.file}`)
    console.error(`  Type: ${e.type}`)
    console.error(`  Missing: ${e.expectedPath}`)
    console.error('')
  })
  console.error('RULE VIOLATION: Schema-before-behavior')
  console.error('FIX: Create schema for each type before use')
  process.exit(1)
}

console.log(`\n✓ All ${typeFiles.length} files have complete schema coverage`)
process.exit(0)
