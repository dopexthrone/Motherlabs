// Benchmark Types - Real quality metrics (no simulation)

export type TestTask = {
  id: string
  name: string
  description: string
  input: string
  category: 'decomposition' | 'refactoring' | 'architecture' | 'debugging' | 'optimization'
  difficulty: 'medium' | 'hard' | 'expert'
  expectedArtifacts: string[]  // What files/outputs should exist
}

export type LaneConfig = {
  id: 'lane-a' | 'lane-b' | 'lane-c'
  name: string
  model: string
  useMotherlabs: boolean
  description: string
}

export type TaskResult = {
  taskId: string
  laneId: string
  timestamp: string

  // Raw output
  rawOutput: string
  outputTokens: number

  // Parsed output (if JSON)
  parsedOutput?: unknown

  // Quality metrics
  metrics: {
    complianceScore: number      // [0,1] - valid JSON/schema compliance
    hallucinationRate: number    // [0,1] - invented refs/paths
    entropyReduction: number     // input_tokens/output_tokens or entropy delta
    executionTime: number        // ms
  }

  // Evidence
  evidence: {
    validJson: boolean
    schemaValid: boolean
    inventedPaths: string[]
    missingExpected: string[]
    contradictions: number
  }
}

export type BenchmarkReport = {
  timestamp: string
  lanes: LaneConfig[]
  tasks: TestTask[]
  results: TaskResult[]

  summary: {
    [laneId: string]: {
      avgCompliance: number
      avgHallucination: number
      avgEntropyReduction: number
      avgExecutionTime: number
      tasksFailed: number
      tasksSucceeded: number
    }
  }

  winner: {
    bestCompliance: string
    bestAccuracy: string
    bestClarity: string
    overall: string
  }
}
