// Task Decomposition - QRPT simplified

import { Task, Evidence, Config } from './types'
import { Ledger, createEvidence } from './evidence'

export async function decomposeTask(
  input: string,
  taskId: string,
  ledger: Ledger,
  config: Config
): Promise<Task> {

  // Log task creation
  ledger.append(createEvidence(taskId, 'task_created', { input }))

  // Simple heuristic decomposition (no LLM yet)
  const lines = input.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))

  const subtasks: Task[] = lines.slice(1, config.maxSubtasks + 1).map((line, i) => ({
    id: `${taskId}.${i}`,
    input: line,
    subtasks: [],
    status: 'pending' as const,
    evidence: []
  }))

  return {
    id: taskId,
    input,
    subtasks,
    status: subtasks.length > 0 ? 'active' : 'done',
    evidence: ledger.query(taskId)
  }
}

export function printTaskTree(task: Task, indent: number = 0): void {
  const prefix = '  '.repeat(indent)
  const statusIcon = {
    pending: '○',
    active: '●',
    done: '✓',
    blocked: '✗'
  }[task.status]

  console.log(`${prefix}${statusIcon} [${task.id}] ${task.input}`)
  task.subtasks.forEach(st => printTaskTree(st, indent + 1))
}
