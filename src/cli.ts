#!/usr/bin/env node
// Motherlabs Runtime CLI

import * as fs from 'fs'
import { decomposeTask, printTaskTree } from './decompose'
import { Ledger } from './evidence'
import { LLMAdapter } from './llm'
import { Config } from './types'
import { DogfoodingLoop } from './dogfood/loop'
import { JSONLLedger } from './persistence/jsonlLedger'
import { createAdmissionService } from './proposal/admissionService'
import { validateProposalV0 } from './validation/proposalV0Validator'
import type { AnthropicModel } from './adapters/anthropicAdapter'
import type { OpenAIModel } from './adapters/openaiAdapter'

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === 'help') {
    console.log('Motherlabs Runtime v0.2.0')
    console.log('')
    console.log('Commands:')
    console.log('  propose <json|file> - Submit a proposal to the ledger')
    console.log('    --ledger <path>   - Ledger path (default: evidence/proposals.jsonl)')
    console.log('    --validate-only   - Validate without submitting')
    console.log('  decompose <task>    - Break task into subtasks (uses LLM if ANTHROPIC_API_KEY set)')
    console.log('  dogfood [once]      - Run self-improvement cycle')
    console.log('    --anthropic       - Use Anthropic Claude (default: claude-sonnet-4-5)')
    console.log('    --openai          - Use OpenAI GPT (default: gpt-4o)')
    console.log('    --model <name>    - Specify model name')
    console.log('  help                - Show this message')
    console.log('')
    console.log('Environment:')
    console.log('  ANTHROPIC_API_KEY  - Required for Anthropic provider')
    console.log('  OPENAI_API_KEY     - Required for OpenAI provider')
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

    console.log(llm ? 'Using LLM decomposition...' : 'Using heuristic decomposition (set ANTHROPIC_API_KEY for LLM)')

    const task = await decomposeTask(taskInput, 'task-0', ledger, config, llm)

    console.log('\n=== Task Decomposition ===\n')
    printTaskTree(task)
    console.log(`\n=== Evidence: ${ledger.count()} records ===\n`)

  } else if (command === 'propose') {
    // Parse propose options
    const ledgerIdx = args.indexOf('--ledger')
    const ledgerPath = ledgerIdx >= 0 ? args[ledgerIdx + 1] : 'evidence/proposals.jsonl'
    const validateOnly = args.includes('--validate-only')

    // Get proposal input (JSON string or file path)
    const proposalArg = args.find(a => !a.startsWith('--') && a !== 'propose' && a !== (ledgerIdx >= 0 ? args[ledgerIdx + 1] : ''))

    if (!proposalArg) {
      console.error('Error: No proposal provided')
      console.error('')
      console.error('Usage:')
      console.error('  propose \'{"version":"v0",...}\'  - Inline JSON')
      console.error('  propose proposal.json           - From file')
      process.exit(1)
    }

    // Parse proposal
    let proposalData: unknown
    try {
      if (fs.existsSync(proposalArg)) {
        // Read from file
        const content = fs.readFileSync(proposalArg, 'utf8')
        proposalData = JSON.parse(content)
        console.log(`Read proposal from: ${proposalArg}`)
      } else {
        // Parse as inline JSON
        proposalData = JSON.parse(proposalArg)
      }
    } catch (parseErr) {
      console.error('Error: Failed to parse proposal')
      console.error(parseErr instanceof Error ? parseErr.message : String(parseErr))
      process.exit(1)
    }

    // Validate proposal
    console.log('')
    console.log('Validating proposal...')
    const validationResult = validateProposalV0(proposalData)

    if (!validationResult.ok) {
      console.error('')
      console.error('Validation FAILED:')
      for (const err of validationResult.error) {
        console.error(`  [${err.code}] ${err.message}`)
      }
      process.exit(1)
    }

    const proposal = validationResult.value
    console.log(`  Version:   ${proposal.version}`)
    console.log(`  ID:        ${proposal.proposal_id}`)
    console.log(`  Action:    ${proposal.requested_action}`)
    console.log(`  Targets:   ${proposal.targets.length} target(s)`)
    console.log('')
    console.log('Validation PASSED')

    if (validateOnly) {
      console.log('')
      console.log('(--validate-only: skipping submission)')
      process.exit(0)
    }

    // Submit to admission service
    console.log('')
    console.log(`Submitting to ledger: ${ledgerPath}`)

    const proposalLedger = new JSONLLedger(ledgerPath)
    const admissionService = createAdmissionService(proposalLedger, 'cli')

    const admissionResult = await admissionService.admitValidatedProposal(proposal)

    if (!admissionResult.ok) {
      console.error('')
      console.error('Admission ERROR:')
      console.error(`  ${admissionResult.error.message}`)
      process.exit(1)
    }

    const admission = admissionResult.value

    if (admission.admitted) {
      console.log('')
      console.log('=== PROPOSAL ADMITTED ===')
      console.log(`  Gate Decision:  ${admission.gateDecision.decision}`)
      console.log(`  Gate Record:    seq ${admission.gateDecisionRecord.seq}`)
      console.log(`  Proposal Record: seq ${admission.proposalRecord?.seq}`)
      console.log('')
      console.log(`Ledger: ${ledgerPath} (${proposalLedger.count()} records)`)
    } else {
      console.error('')
      console.error('=== PROPOSAL REJECTED ===')
      console.error(`  Gate Decision: ${admission.gateDecision.decision}`)
      console.error(`  Reason: ${admission.gateDecision.reason}`)
      process.exit(1)
    }

  } else if (command === 'dogfood') {
    // Parse dogfood options
    const useOnce = args.includes('once')
    const useAnthropic = args.includes('--anthropic')
    const useOpenAI = args.includes('--openai')
    const modelIdx = args.indexOf('--model')
    const customModel = modelIdx >= 0 ? args[modelIdx + 1] : undefined

    // Determine provider
    let anthropicKey: string | undefined
    let openaiKey: string | undefined
    let anthropicModel: AnthropicModel | undefined
    let openaiModel: OpenAIModel | undefined

    if (useAnthropic && process.env.ANTHROPIC_API_KEY) {
      anthropicKey = process.env.ANTHROPIC_API_KEY
      anthropicModel = (customModel as AnthropicModel) || 'claude-sonnet-4-5-20250929'
    } else if (useOpenAI && process.env.OPENAI_API_KEY) {
      openaiKey = process.env.OPENAI_API_KEY
      openaiModel = (customModel as OpenAIModel) || 'gpt-4o'
    } else if (process.env.ANTHROPIC_API_KEY) {
      // Default to Anthropic if available
      anthropicKey = process.env.ANTHROPIC_API_KEY
      anthropicModel = (customModel as AnthropicModel) || 'claude-sonnet-4-5-20250929'
    } else if (process.env.OPENAI_API_KEY) {
      // Fall back to OpenAI
      openaiKey = process.env.OPENAI_API_KEY
      openaiModel = (customModel as OpenAIModel) || 'gpt-4o'
    }

    if (!anthropicKey && !openaiKey) {
      console.error('Error: No LLM API key found')
      console.error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable')
      process.exit(1)
    }

    const loop = new DogfoodingLoop({
      cycleInterval: 60_000,
      requireHumanApproval: false,  // Bootstrap mode
      maxImprovementsPerCycle: 1,
      ledgerPath: 'evidence/dogfood-cli.jsonl',
      anthropicApiKey: anthropicKey,
      anthropicModel,
      openaiApiKey: openaiKey,
      openaiModel
    })

    if (useOnce) {
      // Run once and exit
      console.log('')
      console.log('Running single dogfood cycle...')
      console.log('')

      const result = await loop.runOnce()

      if (result.success) {
        console.log('')
        console.log('=== SUCCESS ===')
        if (result.proposal) {
          console.log(`Issue: ${result.proposal.issue.type}`)
          console.log(`File: ${result.proposal.targetFile}`)
          console.log(`Source: ${result.proposal.source}`)
          if (result.proposal.gateValidation) {
            console.log('')
            console.log('Gate results:')
            result.proposal.gateValidation.gateResults.forEach(g => {
              console.log(`  ${g.passed ? 'PASS' : 'FAIL'} ${g.gateName}${g.error ? ': ' + g.error : ''}`)
            })
          }
        } else {
          console.log('No improvements needed - system is optimal')
        }
      } else {
        console.log('')
        console.log('=== FAILED ===')
        console.log(`Error: ${result.error}`)
        process.exit(1)
      }
    } else {
      // Run continuous loop (Ctrl+C to stop)
      console.log('Starting continuous dogfooding loop...')
      console.log('Press Ctrl+C to stop')

      process.on('SIGINT', () => {
        console.log('')
        console.log('Stopping...')
        loop.stop()
        process.exit(0)
      })

      await loop.start()
    }

  } else {
    console.error(`Unknown command: ${command}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
