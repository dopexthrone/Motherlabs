#!/usr/bin/env node
// Benchmark CLI - Run comparison tests

import { runBenchmark, LANES } from './runner'
import { BENCHMARK_TASKS, WARMUP_TASKS } from './tasks'
import { LaneConfig } from './types'
import * as path from 'path'

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.length === 0) {
    console.log('Motherlabs Benchmark Suite')
    console.log('')
    console.log('Usage:')
    console.log('  benchmark [options]')
    console.log('')
    console.log('Options:')
    console.log('  --warmup     Run 2 warmup tasks (faster)')
    console.log('  --full       Run all 10 expert tasks (slower)')
    console.log('  --output     Output path (default: ~/Desktop/motherlabs-benchmark.json)')
    console.log('')
    console.log('Environment:')
    console.log('  ANTHROPIC_API_KEY  Required')
    process.exit(0)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable required')
    process.exit(1)
  }

  const useWarmup = args.includes('--warmup')
  const useFull = args.includes('--full')

  const tasks = useFull ? BENCHMARK_TASKS : WARMUP_TASKS

  const outputIdx = args.indexOf('--output')
  const outputPath = outputIdx >= 0 && args[outputIdx + 1]
    ? args[outputIdx + 1]
    : path.join(process.env.HOME || '/home/motherlabs', 'Desktop', 'motherlabs-benchmark.json')

  console.log('Motherlabs Quality Assurance Benchmark')
  console.log('=====================================')
  console.log(`Tasks: ${tasks.length} (${useWarmup || !useFull ? 'warmup' : 'full suite'})`)
  console.log(`Lanes: 3 (Raw Sonnet 4.5, Motherlabs+Sonnet 4.5, Raw Opus 4.5)`)
  console.log(`Output: ${outputPath}`)
  console.log('')

  try {
    const report = await runBenchmark(apiKey, tasks, outputPath)

    // Print summary
    console.log('\n\n=== BENCHMARK RESULTS ===\n')

    for (const [laneId, stats] of Object.entries(report.summary)) {
      const lane = LANES.find(l => l.id === laneId)!
      console.log(`${lane.name}:`)
      console.log(`  Compliance:  ${(stats.avgCompliance * 100).toFixed(1)}%`)
      console.log(`  Accuracy:    ${((1 - stats.avgHallucination) * 100).toFixed(1)}%`)
      console.log(`  Clarity:     ${stats.avgEntropyReduction.toFixed(2)}`)
      console.log(`  Succeeded:   ${stats.tasksSucceeded}/${tasks.length}`)
      console.log('')
    }

    console.log('Winners:')
    console.log(`  Best Compliance:  ${LANES.find(l => l.id === report.winner.bestCompliance)?.name}`)
    console.log(`  Best Accuracy:    ${LANES.find(l => l.id === report.winner.bestAccuracy)?.name}`)
    console.log(`  Best Clarity:     ${LANES.find(l => l.id === report.winner.bestClarity)?.name}`)
    console.log(`  Overall Winner:   ${LANES.find(l => l.id === report.winner.overall)?.name}`)
    console.log('')

    console.log(`✓ Full report saved to: ${outputPath}`)
  } catch (error) {
    console.error('Benchmark failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
