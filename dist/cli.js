#!/usr/bin/env node
"use strict";
// Motherlabs Runtime CLI
Object.defineProperty(exports, "__esModule", { value: true });
const decompose_1 = require("./decompose");
const evidence_1 = require("./evidence");
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    if (!command || command === 'help') {
        console.log('Motherlabs Runtime v0.1.0');
        console.log('');
        console.log('Commands:');
        console.log('  decompose <task>  - Break task into subtasks');
        console.log('  help              - Show this message');
        process.exit(0);
    }
    const config = {
        kernelPath: process.env.KERNEL_PATH || '/home/motherlabs/motherlabs-kernel',
        maxDepth: 3,
        maxSubtasks: 10
    };
    const ledger = new evidence_1.Ledger();
    if (command === 'decompose') {
        const taskInput = args.slice(1).join(' ');
        if (!taskInput) {
            console.error('Error: No task provided');
            process.exit(1);
        }
        const task = await (0, decompose_1.decomposeTask)(taskInput, 'task-0', ledger, config);
        console.log('\n=== Task Decomposition ===\n');
        (0, decompose_1.printTaskTree)(task);
        console.log(`\n=== Evidence: ${ledger.count()} records ===\n`);
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
