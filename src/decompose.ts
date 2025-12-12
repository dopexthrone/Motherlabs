// Task Decomposition - QRPT simplified

import { Task, Evidence, Config } from './types'
import { Ledger, createEvidence } from './evidence'
import { LLMAdapter } from './llm'

export async function decomposeTask(
  input: string,
  taskId: string,
  ledger: Ledger,
  config: Config,
  llm?: LLMAdapter
): Promise<Task> {

  // Log task creation
  ledger.append(createEvidence(taskId, 'task_created', { input }))

  let subtaskStrings: string[]

  if (llm) {
    // LLM-based intelligent decomposition
    try {
      subtaskStrings = await llm.decompose(input)
      console.log(`[DEBUG] LLM returned ${subtaskStrings.length} subtasks`)
      ledger.append(createEvidence(taskId, 'llm_decompose', {
        input,
        subtasks: subtaskStrings,
        count: subtaskStrings.length,
        model: 'claude-3-5-sonnet'
      }))
    } catch (error) {
      // Fallback to heuristic on LLM failure
      console.error('[DEBUG] LLM failed:', error instanceof Error ? error.message : error)
      ledger.append(createEvidence(taskId, 'llm_decompose', {
        error: error instanceof Error ? error.message : 'Unknown error',
        fallback: 'heuristic'
      }))
      subtaskStrings = heuristicDecompose(input)
    }
  } else {
    // Fallback to simple heuristic
    subtaskStrings = heuristicDecompose(input)
  }

  const subtasks: Task[] = subtaskStrings
    .slice(0, config.maxSubtasks)
    .map((line, i) => ({
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

function heuristicDecompose(input: string): string[] {
  return input.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
    .slice(1) // Skip first line (often the main task)
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
