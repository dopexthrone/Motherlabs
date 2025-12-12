"use strict";
// Task Decomposition - QRPT simplified
Object.defineProperty(exports, "__esModule", { value: true });
exports.decomposeTask = decomposeTask;
exports.printTaskTree = printTaskTree;
const evidence_1 = require("./evidence");
async function decomposeTask(input, taskId, ledger, config) {
    // Log task creation
    ledger.append((0, evidence_1.createEvidence)(taskId, 'task_created', { input }));
    // Simple heuristic decomposition (no LLM yet)
    const lines = input.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'));
    const subtasks = lines.slice(1, config.maxSubtasks + 1).map((line, i) => ({
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
