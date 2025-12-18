#!/usr/bin/env npx tsx
/**
 * Direct Gate Validation Test
 * Tests if attack file CONTENTS would pass through the 7 gates
 * No LLM needed - directly validates the malicious code
 */

import * as fs from 'fs'
import * as path from 'path'
import { SixGateValidator, CodeValidationContext } from '../src/validation/sixGates'
import { extractExportsFromCode } from '../src/validation/testQualityAnalyzer'

type GateTestResult = {
  attackId: string
  attackFile: string
  codeLength: number
  gateResults: Array<{
    gateName: string
    passed: boolean
    required: boolean
    error?: string
  }>
  allGatesPassed: boolean
  blockedBy: string[]
  passedGates: string[]
  securityIssuesDetected: string[]
}

async function testGates(attackFile: string): Promise<GateTestResult> {
  const attackId = path.basename(attackFile, '.ts')
  const code = fs.readFileSync(attackFile, 'utf-8')

  const validator = new SixGateValidator()

  // Build context
  const context: CodeValidationContext = {
    existingImports: [],
    existingTypes: ['string', 'number', 'boolean', 'void', 'null', 'undefined'],
    targetFile: attackFile,
    targetExports: extractExportsFromCode(code),
    strictTestQuality: false,  // Advisory mode for attack files
    testQualityThreshold: 50
  }

  const result = await validator.validate(code, context)

  const gateResults = result.ok ? result.value.gateResults : []
  const blockedBy = gateResults.filter(g => !g.passed && g.required).map(g => g.gateName)
  const passedGates = gateResults.filter(g => g.passed).map(g => g.gateName)

  // Extract security issues from gate 6
  const securityGate = gateResults.find(g => g.gateName === 'security')
  const securityIssuesDetected: string[] = []
  if (securityGate && securityGate.error) {
    securityIssuesDetected.push(securityGate.error)
  }

  return {
    attackId,
    attackFile,
    codeLength: code.length,
    gateResults,
    allGatesPassed: result.ok ? result.value.valid : false,
    blockedBy,
    passedGates,
    securityIssuesDetected
  }
}

async function main(): Promise<void> {
  console.log('=' .repeat(70))
  console.log('DIRECT GATE VALIDATION - Testing if attack code passes gates')
  console.log('='.repeat(70))
  console.log()

  // Find attack files
  const attackDir = 'chaos-runner/attacks'
  const attackFiles = fs.readdirSync(attackDir)
    .filter(f => f.endsWith('.ts'))
    .sort()
    .map(f => path.join(attackDir, f))

  console.log(`Testing ${attackFiles.length} attack files...\n`)

  const results: GateTestResult[] = []
  const gateStats: Record<string, { blocked: number; passed: number }> = {}

  for (const file of attackFiles) {
    const result = await testGates(file)
    results.push(result)

    // Track gate stats
    for (const gate of result.gateResults) {
      if (!gateStats[gate.gateName]) {
        gateStats[gate.gateName] = { blocked: 0, passed: 0 }
      }
      if (gate.passed) {
        gateStats[gate.gateName].passed++
      } else {
        gateStats[gate.gateName].blocked++
      }
    }

    // Print result
    const status = result.allGatesPassed
      ? '\x1b[31;1m[PASSED ALL]\x1b[0m'
      : '\x1b[32m[BLOCKED]\x1b[0m'

    console.log(`${status} ${result.attackId}`)

    if (result.blockedBy.length > 0) {
      console.log(`   Blocked by: ${result.blockedBy.join(', ')}`)
    }

    if (result.allGatesPassed) {
      console.log(`   \x1b[31;1m!!! ATTACK CODE PASSED ALL GATES !!!\x1b[0m`)
      console.log(`   Passed gates: ${result.passedGates.join(', ')}`)
    }

    if (result.securityIssuesDetected.length > 0) {
      console.log(`   Security: ${result.securityIssuesDetected[0].substring(0, 80)}...`)
    }

    console.log()
  }

  // Summary
  console.log('='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))

  const blocked = results.filter(r => !r.allGatesPassed).length
  const escaped = results.filter(r => r.allGatesPassed).length

  console.log(`\nTotal: ${results.length}`)
  console.log(`  \x1b[32mBlocked:\x1b[0m ${blocked}`)
  console.log(`  \x1b[31;1mEscaped:\x1b[0m ${escaped}`)

  console.log('\nGate Effectiveness:')
  for (const [gate, stats] of Object.entries(gateStats)) {
    const total = stats.blocked + stats.passed
    const effectiveness = total > 0 ? Math.round((stats.blocked / total) * 100) : 0
    const bar = '█'.repeat(Math.round(effectiveness / 5)) + '░'.repeat(20 - Math.round(effectiveness / 5))
    console.log(`  ${gate.padEnd(15)} ${bar} ${effectiveness}% (${stats.blocked}/${total})`)
  }

  // List attacks that passed
  if (escaped > 0) {
    console.log('\n\x1b[31;1mATTACKS THAT ESCAPED:\x1b[0m')
    for (const r of results.filter(r => r.allGatesPassed)) {
      console.log(`  - ${r.attackId}`)
    }
  }

  console.log()

  // Save results
  const reportPath = 'chaos-runner/results/gate-test-' + Date.now() + '.json'
  fs.writeFileSync(reportPath, JSON.stringify({ results, gateStats }, null, 2))
  console.log(`Report saved to: ${reportPath}`)

  // Exit with error if attacks escaped
  if (escaped > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Gate test failed:', err)
  process.exit(2)
})
