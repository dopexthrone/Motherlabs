#!/usr/bin/env node
// Motherlabs Runtime CLI

import { decomposeTask, printTaskTree } from './decompose'
import { Ledger } from './evidence'
import { LLMAdapter } from './llm'
import { Config } from './types'

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === 'help') {
    console.log('Motherlabs Runtime v0.2.0')
    console.log('')
    console.log('Commands:')
    console.log('  decompose <task>  - Break task into subtasks (uses LLM if ANTHROPIC_API_KEY set)')
    console.log('  help              - Show this message')
    console.log('')
    console.log('Environment:')
    console.log('  ANTHROPIC_API_KEY  - Required for LLM-powered decomposition')
    console.log('  KERNEL_PATH        - Path to kernel repo (default: /home/motherlabs/motherlabs-kernel)')
    process.exit(0)
  }

  const config: Config = {
    kernelPath: process.env.KERNEL_PATH || '/home/motherlabs/motherlabs-kernel',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    maxDepth: 3,
    maxSubtasks: 10
  }

  const ledger = new Ledger()
  const llm = config.anthropicApiKey ? new LLMAdapter(config.anthropicApiKey) : undefined

  if (command === 'decompose') {
    const taskInput = args.slice(1).join(' ')
    if (!taskInput) {
      console.error('Error: No task provided')
      process.exit(1)
    }

    console.log(llm ? '🤖 Using LLM decomposition...' : '📝 Using heuristic decomposition (set ANTHROPIC_API_KEY for LLM)')

    const task = await decomposeTask(taskInput, 'task-0', ledger, config, llm)

    console.log('\n=== Task Decomposition ===\n')
    printTaskTree(task)
    console.log(`\n=== Evidence: ${ledger.count()} records ===\n`)
  } else {
    console.error(`Unknown command: ${command}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
