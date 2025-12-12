"use strict";
// Task Decomposition - QRPT simplified
Object.defineProperty(exports, "__esModule", { value: true });
exports.decomposeTask = decomposeTask;
exports.printTaskTree = printTaskTree;
const evidence_1 = require("./evidence");
async function decomposeTask(input, taskId, ledger, config, llm) {
    // Log task creation
    ledger.append((0, evidence_1.createEvidence)(taskId, 'task_created', { input }));
    let subtaskStrings;
    if (llm) {
        // LLM-based intelligent decomposition
        try {
            subtaskStrings = await llm.decompose(input);
            ledger.append((0, evidence_1.createEvidence)(taskId, 'llm_decompose', {
                input,
                subtasks: subtaskStrings,
                model: 'claude-3-5-sonnet'
            }));
        }
        catch (error) {
            // Fallback to heuristic on LLM failure
            ledger.append((0, evidence_1.createEvidence)(taskId, 'llm_decompose', {
                error: error instanceof Error ? error.message : 'Unknown error',
                fallback: 'heuristic'
            }));
            subtaskStrings = heuristicDecompose(input);
        }
    }
    else {
        // Fallback to simple heuristic
        subtaskStrings = heuristicDecompose(input);
    }
    const subtasks = subtaskStrings
        .slice(0, config.maxSubtasks)
        .map((line, i) => ({
        id: `${taskId}.${i}`,
        input: line,
        subtasks: [],
        status: 'pending',
        evidence: []
    }));
    return {
        id: taskId,
        input,
        subtasks,
        status: subtasks.length > 0 ? 'active' : 'done',
        evidence: ledger.query(taskId)
    };
}
function heuristicDecompose(input) {
    return input.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'))
        .slice(1); // Skip first line (often the main task)
}
function printTaskTree(task, indent = 0) {
    const prefix = '  '.repeat(indent);
    const statusIcon = {
        pending: '○',
        active: '●',
        done: '✓',
        blocked: '✗'
    }[task.status];
    console.log(`${prefix}${statusIcon} [${task.id}] ${task.input}`);
    task.subtasks.forEach(st => printTaskTree(st, indent + 1));
}
