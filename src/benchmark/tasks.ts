// Challenging Test Tasks - Designed to reveal quality differences

import { TestTask } from './types'

/**
 * These tasks are designed to be challenging and reveal differences between:
 * - Raw LLM (tends to be verbose, may hallucinate)
 * - Motherlabs (should be structured, validated, evidence-based)
 */
export const BENCHMARK_TASKS: TestTask[] = [
  {
    id: 'task-001',
    name: 'Self-Improving Code Analyzer',
    description: 'Complex system with multiple feedback loops and safety constraints',
    input: 'Build a self-improving code analysis system that can detect bugs, suggest optimizations, learn from code review feedback, and automatically apply safe refactorings. Must maintain audit trail and never apply unsafe changes.',
    category: 'architecture',
    difficulty: 'expert',
    expectedArtifacts: ['bug detector', 'optimizer', 'feedback learner', 'refactoring engine', 'safety validator', 'audit trail']
  },

  {
    id: 'task-002',
    name: 'Distributed Cache with Consistency',
    description: 'Requires understanding of distributed systems tradeoffs',
    input: 'Implement a distributed caching system with eventual consistency, partition tolerance, and configurable consistency levels. Handle network partitions gracefully and provide monitoring.',
    category: 'architecture',
    difficulty: 'expert',
    expectedArtifacts: ['cache nodes', 'consistency protocol', 'partition handler', 'config system', 'monitoring']
  },

  {
    id: 'task-003',
    name: 'Contradiction-Detecting Schema Validator',
    description: 'Meta-level reasoning about data structures',
    input: 'Create a schema validator that can detect contradictions between required fields, enum constraints, and type definitions. Should identify impossible states before runtime.',
    category: 'debugging',
    difficulty: 'hard',
    expectedArtifacts: ['schema parser', 'constraint analyzer', 'contradiction detector', 'impossible state finder']
  },

  {
    id: 'task-004',
    name: 'Optimize Cold Start Performance',
    description: 'Requires specific metrics and measurement plan',
    input: 'Optimize the Lambda function cold start time. Current: 3.2s. Target: <500ms. Profile, identify bottlenecks, and implement improvements.',
    category: 'optimization',
    difficulty: 'hard',
    expectedArtifacts: ['profiling strategy', 'bottleneck analysis', 'optimization plan', 'measurement approach', 'rollback strategy']
  },

  {
    id: 'task-005',
    name: 'Refactor Legacy Auth System',
    description: 'Existing code context, must not hallucinate',
    input: 'Refactor the authentication system in src/auth/legacy.ts to use modern JWT with refresh tokens. The current system uses deprecated session cookies. Maintain backward compatibility during migration.',
    category: 'refactoring',
    difficulty: 'hard',
    expectedArtifacts: ['JWT implementation', 'refresh token flow', 'migration plan', 'backward compat layer', 'rollback procedure']
  },

  {
    id: 'task-006',
    name: 'Design Event Sourcing Architecture',
    description: 'Requires architectural decisions with tradeoffs',
    input: 'Design an event sourcing system for a financial application. Must handle: event replay, snapshots, exactly-once processing, and audit compliance. Decide on storage, consistency model, and failure handling.',
    category: 'architecture',
    difficulty: 'expert',
    expectedArtifacts: ['event store design', 'replay mechanism', 'snapshot strategy', 'consistency model', 'failure recovery', 'audit compliance']
  },

  {
    id: 'task-007',
    name: 'Debug Race Condition',
    description: 'Requires deep analysis and systematic approach',
    input: 'Debug a race condition in the WebSocket connection pool that causes intermittent message loss under high load (>1000 concurrent connections). Provide reproduction steps and fix.',
    category: 'debugging',
    difficulty: 'expert',
    expectedArtifacts: ['reproduction steps', 'root cause analysis', 'fix strategy', 'test plan', 'load testing approach']
  },

  {
    id: 'task-008',
    name: 'Zero-Downtime Migration',
    description: 'Must consider failure modes and rollback',
    input: 'Plan a zero-downtime migration from PostgreSQL 12 to PostgreSQL 15 for a production system handling 50K transactions/second. Include validation, rollback strategy, and monitoring.',
    category: 'architecture',
    difficulty: 'expert',
    expectedArtifacts: ['migration strategy', 'validation approach', 'rollback plan', 'monitoring setup', 'transaction handling']
  },

  {
    id: 'task-009',
    name: 'Implement CRDT for Collaborative Editing',
    description: 'Complex algorithm with correctness requirements',
    input: 'Implement a CRDT (Conflict-free Replicated Data Type) for real-time collaborative text editing. Must handle concurrent edits, maintain causality, and guarantee eventual consistency.',
    category: 'architecture',
    difficulty: 'expert',
    expectedArtifacts: ['CRDT algorithm', 'merge logic', 'causality tracking', 'consistency proof', 'test cases']
  },

  {
    id: 'task-010',
    name: 'Security Audit and Remediation',
    description: 'Must not invent vulnerabilities, must be systematic',
    input: 'Perform security audit on API endpoints and propose remediation. Focus on: authentication bypasses, injection vulnerabilities, rate limiting, and data leakage. Provide evidence-based findings only.',
    category: 'debugging',
    difficulty: 'hard',
    expectedArtifacts: ['audit methodology', 'vulnerability assessment', 'remediation plan', 'testing approach', 'evidence requirements']
  }
]

/**
 * Simpler tasks for initial validation
 */
export const WARMUP_TASKS: TestTask[] = [
  {
    id: 'warmup-001',
    name: 'Build REST API',
    description: 'Standard web development task',
    input: 'Build a REST API for a todo application with user authentication, CRUD operations, and data validation.',
    category: 'decomposition',
    difficulty: 'medium',
    expectedArtifacts: ['auth system', 'CRUD endpoints', 'validation', 'database schema']
  },

  {
    id: 'warmup-002',
    name: 'Add Caching Layer',
    description: 'Performance optimization with metrics',
    input: 'Add a Redis caching layer to reduce database queries. Measure cache hit rate and latency improvements.',
    category: 'optimization',
    difficulty: 'medium',
    expectedArtifacts: ['Redis integration', 'cache strategy', 'metrics', 'measurement plan']
  }
]
