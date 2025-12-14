// Evidence Artifact System - Content-addressed evidence storage
// Ported from manual kernel verifier governance patterns
// CONSTITUTIONAL AUTHORITY - Enforces: AXIOM 8 (Immutable Evidence)

import * as crypto from 'crypto'
import { contentAddress } from '../core/contentAddress'

/**
 * Kind of evidence captured
 */
export type EvidenceKind =
  | 'stdout_log'        // Command stdout capture
  | 'stderr_log'        // Command stderr capture
  | 'exit_code'         // Process exit code
  | 'file_manifest'     // File operation manifest
  | 'gate_result'       // Gate validation result
  | 'llm_response'      // LLM generated response
  | 'code_diff'         // Code change diff
  | 'test_result'       // Test execution result
  | 'proposal_content'  // Proposal full content
  | 'rollback_snapshot' // Pre-change snapshot for rollback

/**
 * Evidence artifact - content-addressed evidence record
 */
export type EvidenceArtifact = {
  /** Content-addressed ID (sha256:...) */
  artifact_id: string
  /** Always 'evidence' for this type */
  artifact_kind: 'evidence'
  /** Specific kind of evidence */
  evidence_kind: EvidenceKind
  /** Same as artifact_id (for verification) */
  content_hash: string
  /** How the payload is encoded */
  payload_encoding: 'utf8' | 'base64'
  /** The actual evidence payload */
  payload: string
  /** Optional metadata */
  metadata?: {
    created_at_utc: string
    source_file?: string
    description?: string
    related_artifacts?: string[]  // Links to other artifacts
    tags?: string[]
  }
}

/**
 * Create evidence artifact from payload
 */
export function createEvidenceArtifact(
  payload: string | Buffer,
  evidenceKind: EvidenceKind,
  metadata?: EvidenceArtifact['metadata']
): EvidenceArtifact {
  // Determine encoding
  const isBuffer = Buffer.isBuffer(payload)
  const encoding: 'utf8' | 'base64' = isBuffer ? 'base64' : 'utf8'
  const payloadStr = isBuffer ? payload.toString('base64') : payload

  // Compute content hash
  const hash = crypto.createHash('sha256').update(payloadStr).digest('hex')
  const artifactId = `sha256:${hash}`

  return {
    artifact_id: artifactId,
    artifact_kind: 'evidence',
    evidence_kind: evidenceKind,
    content_hash: artifactId,
    payload_encoding: encoding,
    payload: payloadStr,
    metadata: metadata ?? {
      created_at_utc: new Date().toISOString()
    }
  }
}

/**
 * Verify artifact integrity
 */
export function verifyArtifact(artifact: EvidenceArtifact): boolean {
  const hash = crypto.createHash('sha256').update(artifact.payload).digest('hex')
  const computedId = `sha256:${hash}`
  return computedId === artifact.artifact_id && computedId === artifact.content_hash
}

/**
 * Create stdout log artifact
 */
export function createStdoutArtifact(
  stdout: string,
  sourceCommand?: string
): EvidenceArtifact {
  return createEvidenceArtifact(stdout, 'stdout_log', {
    created_at_utc: new Date().toISOString(),
    description: sourceCommand ? `stdout from: ${sourceCommand}` : 'stdout capture'
  })
}

/**
 * Create stderr log artifact
 */
export function createStderrArtifact(
  stderr: string,
  sourceCommand?: string
): EvidenceArtifact {
  return createEvidenceArtifact(stderr, 'stderr_log', {
    created_at_utc: new Date().toISOString(),
    description: sourceCommand ? `stderr from: ${sourceCommand}` : 'stderr capture'
  })
}

/**
 * Create exit code artifact
 */
export function createExitCodeArtifact(
  exitCode: number,
  command?: string
): EvidenceArtifact {
  return createEvidenceArtifact(
    JSON.stringify({ exit_code: exitCode, command }),
    'exit_code',
    {
      created_at_utc: new Date().toISOString(),
      description: `exit code ${exitCode}`
    }
  )
}

/**
 * Create gate result artifact
 */
export function createGateResultArtifact(
  gateName: string,
  passed: boolean,
  error?: string,
  details?: Record<string, unknown>
): EvidenceArtifact {
  return createEvidenceArtifact(
    JSON.stringify({ gate: gateName, passed, error, details }),
    'gate_result',
    {
      created_at_utc: new Date().toISOString(),
      description: `${gateName}: ${passed ? 'PASS' : 'FAIL'}`,
      tags: [gateName, passed ? 'passed' : 'failed']
    }
  )
}

/**
 * Create LLM response artifact
 */
export function createLLMResponseArtifact(
  response: string,
  model: string,
  provider: string,
  promptHash?: string
): EvidenceArtifact {
  return createEvidenceArtifact(response, 'llm_response', {
    created_at_utc: new Date().toISOString(),
    description: `LLM response from ${provider}/${model}`,
    tags: [provider, model],
    related_artifacts: promptHash ? [promptHash] : undefined
  })
}

/**
 * Create code diff artifact
 */
export function createCodeDiffArtifact(
  diff: string,
  filepath: string
): EvidenceArtifact {
  return createEvidenceArtifact(diff, 'code_diff', {
    created_at_utc: new Date().toISOString(),
    source_file: filepath,
    description: `diff for ${filepath}`
  })
}

/**
 * Create test result artifact
 */
export function createTestResultArtifact(
  passed: number,
  failed: number,
  skipped: number,
  output?: string
): EvidenceArtifact {
  return createEvidenceArtifact(
    JSON.stringify({ passed, failed, skipped, total: passed + failed + skipped, output }),
    'test_result',
    {
      created_at_utc: new Date().toISOString(),
      description: `tests: ${passed} passed, ${failed} failed, ${skipped} skipped`,
      tags: failed > 0 ? ['has_failures'] : ['all_passed']
    }
  )
}

/**
 * Create file manifest artifact
 */
export function createFileManifestArtifact(
  entries: Array<{
    path: string
    operation: 'create' | 'overwrite' | 'delete' | 'read'
    byte_count: number
    sha256: string
  }>
): EvidenceArtifact {
  return createEvidenceArtifact(
    JSON.stringify({ entries, count: entries.length }),
    'file_manifest',
    {
      created_at_utc: new Date().toISOString(),
      description: `${entries.length} file operations`
    }
  )
}

/**
 * Extract payload as original type
 */
export function extractPayload<T>(artifact: EvidenceArtifact): T | string {
  if (artifact.payload_encoding === 'base64') {
    return Buffer.from(artifact.payload, 'base64').toString('utf8') as unknown as T
  }

  // Try to parse as JSON
  try {
    return JSON.parse(artifact.payload) as T
  } catch {
    return artifact.payload as unknown as T
  }
}

/**
 * Collect multiple artifacts into a bundle
 */
export function bundleArtifacts(
  artifacts: EvidenceArtifact[],
  description: string
): { bundle_hash: string; artifacts: EvidenceArtifact[]; description: string } {
  const ids = artifacts.map(a => a.artifact_id).sort()
  const bundleHash = contentAddress({ artifact_ids: ids })

  return {
    bundle_hash: bundleHash,
    artifacts,
    description
  }
}
