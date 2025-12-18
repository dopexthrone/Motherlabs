// Core Motherlabs Types

export type TaskInput = {
  id: string
  input: string
  context?: Record<string, unknown>
}

export type Task = {
  id: string
  input: string
  subtasks: Task[]
  status: 'pending' | 'active' | 'done' | 'blocked'
  evidence: Evidence[]
}

export type Evidence = {
  id: string
  taskId: string
  type: 'task_created' | 'llm_decompose' | 'llm_generate' | 'validation' | 'completion' | 'task_error'
  timestamp: number
  data: unknown
}

export type Config = {
  kernelPath: string
  anthropicApiKey?: string
  maxDepth: number
  maxSubtasks: number
}
