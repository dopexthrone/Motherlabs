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
  try {
    // Log task creation
    ledger.append(createEvidence(taskId, 'task_created', { input }))

    let subtaskStrings: string[]

    if (llm) {
      // LLM-based intelligent decomposition
      const result = await llm.decompose(input)

      if (result.ok) {
        subtaskStrings = result.value
        ledger.append(createEvidence(taskId, 'llm_decompose', {
          input,
          subtasks: subtaskStrings,
          count: subtaskStrings.length,
          model: 'claude-sonnet-4-5',
          success: true
        }))
      } else {
        // FIXED: Structured error handling instead of swallowing
        ledger.append(createEvidence(taskId, 'llm_decompose', {
          error: result.error.message,
          fallback: 'heuristic',
          success: false
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
  } catch (error) {
    ledger.append(createEvidence(taskId, 'task_error', {
      error: error instanceof Error ? error.message : String(error),
      input
    }))
    throw error
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