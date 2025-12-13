#!/usr/bin/env node
// Trap Benchmark CLI - Test constraint system effectiveness

import { runTrapBenchmark, generateTrapReport } from './trapRunner'
import * as path from 'path'

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable required')
    process.exit(1)
  }

  const outputPath = path.join(
    process.env.HOME || '/home/motherlabs',
    'Desktop',
    'motherlabs-trap-benchmark.json'
  )

  console.log('Motherlabs Trap Detection Benchmark')
  console.log('===================================')
  console.log('Testing 10 tasks with deliberate violations')
  console.log('Expected: Raw LLM proceeds, Motherlabs blocks')
  console.log('')

  try {
    const results = await runTrapBenchmark(apiKey)
    generateTrapReport(results, outputPath)
  } catch (error) {
    console.error('Trap benchmark failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
