// URCO v0.2 - Core Types (No simulation, real schema)

export type CandidateType =
  | 'AND_SPLIT'    // Parallel components
  | 'OR_SPLIT'     // Alternative paths
  | 'SEQ_SPLIT'    // Ordered steps
  | 'CLARIFICATION' // Missing variable question
  | 'HYPOTHESIS'    // Conditional branch
  | 'RETRIEVAL'     // Evidence acquisition

export type Candidate = {
  id: string
  type: CandidateType
  parentId: string
  statement: string  // One sentence, clear
  requiredInputs: string[]
  expectedOutputs: string[]
  invariants: string[]
  evidencePlan?: EvidencePlan
}

export type EvidencePlan = {
  method: 'static_analysis' | 'unit_test' | 'integration_test' | 'property_test' | 'golden_test' | 'manual_check'
  procedure: string  // Min 30 chars
  artifacts: Array<{
    kind: 'file' | 'log' | 'snapshot' | 'report' | 'diff'
    ref: string
  }>
  acceptance: {
    asserts?: string[]
    thresholds?: Record<string, number>
  }
  risks?: string[]
  rollback?: string
}

export type Entity = {
  raw: string
  kind: 'tag' | 'quote' | 'identifier' | 'path' | 'url' | 'phrase'
  span: [number, number]
}

export type Action = {
  verb: string
  object?: string
  span: [number, number]
  source: 'imperative' | 'verb_object'
}

export type MissingVar = {
  key: string
  hint: string
  severity: 'error' | 'warn'
}

export type Contradiction = {
  type: string
  leftSpan: [number, number]
  rightSpan: [number, number]
  explanation: string
  confidence: 'high' | 'medium'
}

export type ScoredCandidate = {
  candidate: Candidate
  score: number
  breakdown: {
    executability: number    // E(c)
    coverage: number         // C(c)
    novelty: number          // N(c)
    coherence: number        // K(c)
    riskPenalty: number      // RP(c) = 1-R(c)
    evidenceAlign: number    // A(c)
  }
}

export type EntropyBreakdown = {
  unknowns: number          // U(P)
  ambiguity: number         // Amb(P)
  contradiction: number     // Con(P)
  specificityDeficit: number // SpecDef(P)
  dependencyUncertainty: number // Dep(P)
  verifiabilityDeficit: number  // Ver(P)
}

export type NodeEntropy = {
  value: number  // [0,1]
  breakdown: EntropyBreakdown
}
