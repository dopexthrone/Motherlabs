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
        const result = await llm.decompose(input);
        if (result.ok) {
            subtaskStrings = result.value;
            ledger.append((0, evidence_1.createEvidence)(taskId, 'llm_decompose', {
                input,
                subtasks: subtaskStrings,
                count: subtaskStrings.length,
                model: 'claude-sonnet-4-5',
                success: true
            }));
        }
        else {
            // FIXED: Structured error handling instead of swallowing
            ledger.append((0, evidence_1.createEvidence)(taskId, 'llm_decompose', {
                error: result.error.message,
                fallback: 'heuristic',
                success: false
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
