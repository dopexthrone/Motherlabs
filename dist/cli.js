#!/usr/bin/env node
"use strict";
// Motherlabs Runtime CLI
Object.defineProperty(exports, "__esModule", { value: true });
const decompose_1 = require("./decompose");
const evidence_1 = require("./evidence");
const llm_1 = require("./llm");
const loop_1 = require("./dogfood/loop");
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    if (!command || command === 'help') {
        console.log('Motherlabs Runtime v0.2.0');
        console.log('');
        console.log('Commands:');
        console.log('  decompose <task>  - Break task into subtasks (uses LLM if ANTHROPIC_API_KEY set)');
        console.log('  dogfood [once]    - Run self-improvement cycle');
        console.log('    --anthropic     - Use Anthropic Claude (default: claude-sonnet-4-5)');
        console.log('    --openai        - Use OpenAI GPT (default: gpt-4o)');
        console.log('    --model <name>  - Specify model name');
        console.log('  help              - Show this message');
        console.log('');
        console.log('Environment:');
        console.log('  ANTHROPIC_API_KEY  - Required for Anthropic provider');
        console.log('  OPENAI_API_KEY     - Required for OpenAI provider');
        console.log('  KERNEL_PATH        - Path to kernel repo (default: /home/motherlabs/motherlabs-kernel)');
        process.exit(0);
    }
    const config = {
        kernelPath: process.env.KERNEL_PATH || '/home/motherlabs/motherlabs-kernel',
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        maxDepth: 3,
        maxSubtasks: 10
    };
    const ledger = new evidence_1.Ledger();
    const llm = config.anthropicApiKey ? new llm_1.LLMAdapter(config.anthropicApiKey) : undefined;
    if (command === 'decompose') {
        const taskInput = args.slice(1).join(' ');
        if (!taskInput) {
            console.error('Error: No task provided');
            process.exit(1);
        }
        console.log(llm ? 'Using LLM decomposition...' : 'Using heuristic decomposition (set ANTHROPIC_API_KEY for LLM)');
        const task = await (0, decompose_1.decomposeTask)(taskInput, 'task-0', ledger, config, llm);
        console.log('\n=== Task Decomposition ===\n');
        (0, decompose_1.printTaskTree)(task);
        console.log(`\n=== Evidence: ${ledger.count()} records ===\n`);
    }
    else if (command === 'dogfood') {
        // Parse dogfood options
        const useOnce = args.includes('once');
        const useAnthropic = args.includes('--anthropic');
        const useOpenAI = args.includes('--openai');
        const modelIdx = args.indexOf('--model');
        const customModel = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
        // Determine provider
        let anthropicKey;
        let openaiKey;
        let anthropicModel;
        let openaiModel;
        if (useAnthropic && process.env.ANTHROPIC_API_KEY) {
            anthropicKey = process.env.ANTHROPIC_API_KEY;
            anthropicModel = customModel || 'claude-sonnet-4-5-20250929';
        }
        else if (useOpenAI && process.env.OPENAI_API_KEY) {
            openaiKey = process.env.OPENAI_API_KEY;
            openaiModel = customModel || 'gpt-4o';
        }
        else if (process.env.ANTHROPIC_API_KEY) {
            // Default to Anthropic if available
            anthropicKey = process.env.ANTHROPIC_API_KEY;
            anthropicModel = customModel || 'claude-sonnet-4-5-20250929';
        }
        else if (process.env.OPENAI_API_KEY) {
            // Fall back to OpenAI
            openaiKey = process.env.OPENAI_API_KEY;
            openaiModel = customModel || 'gpt-4o';
        }
        if (!anthropicKey && !openaiKey) {
            console.error('Error: No LLM API key found');
            console.error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable');
            process.exit(1);
        }
        const loop = new loop_1.DogfoodingLoop({
            cycleInterval: 60_000,
            requireHumanApproval: false, // Bootstrap mode
            maxImprovementsPerCycle: 1,
            ledgerPath: 'evidence/dogfood-cli.jsonl',
            anthropicApiKey: anthropicKey,
            anthropicModel,
            openaiApiKey: openaiKey,
            openaiModel
        });
        if (useOnce) {
            // Run once and exit
            console.log('');
            console.log('Running single dogfood cycle...');
            console.log('');
            const result = await loop.runOnce();
            if (result.success) {
                console.log('');
                console.log('=== SUCCESS ===');
                if (result.proposal) {
                    console.log(`Issue: ${result.proposal.issue.type}`);
                    console.log(`File: ${result.proposal.targetFile}`);
                    console.log(`Source: ${result.proposal.source}`);
                    if (result.proposal.gateValidation) {
                        console.log('');
                        console.log('Gate results:');
                        result.proposal.gateValidation.gateResults.forEach(g => {
                            console.log(`  ${g.passed ? 'PASS' : 'FAIL'} ${g.gateName}${g.error ? ': ' + g.error : ''}`);
                        });
                    }
                }
                else {
                    console.log('No improvements needed - system is optimal');
                }
            }
            else {
                console.log('');
                console.log('=== FAILED ===');
                console.log(`Error: ${result.error}`);
                process.exit(1);
            }
        }
        else {
            // Run continuous loop (Ctrl+C to stop)
            console.log('Starting continuous dogfooding loop...');
            console.log('Press Ctrl+C to stop');
            process.on('SIGINT', () => {
                console.log('');
                console.log('Stopping...');
                loop.stop();
                process.exit(0);
            });
            await loop.start();
        }
    }
    else {
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
}
main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
