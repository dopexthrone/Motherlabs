// Provider Manifests - Metadata about LLM providers
// Ported from manual kernel verifier governance patterns

import { EffectType } from '../core/effects'
import { EvidenceKind } from '../persistence/evidenceArtifact'

/**
 * Determinism claim for a provider
 */
export type DeterminismClaim =
  | 'DETERMINISTIC'      // Output is deterministic given same input
  | 'BEST_EFFORT'        // Mostly deterministic but may vary
  | 'NONDETERMINISTIC'   // Output will vary between calls

/**
 * Provider manifest - describes a provider's capabilities and constraints
 */
export type ProviderManifest = {
  /** Provider identifier */
  provider_id: string
  /** Manifest version */
  version: string
  /** Human-readable description */
  description: string
  /** Effects this provider is allowed to exercise */
  allowed_effects: EffectType[]
  /** Evidence kinds this provider must produce */
  required_evidence_kinds: EvidenceKind[]
  /** Determinism claim for this provider */
  determinism_claim: DeterminismClaim
  /** Optional rate limits */
  rate_limits?: {
    requests_per_minute?: number
    tokens_per_minute?: number
  }
  /** Optional model information */
  models?: {
    default: string
    available: string[]
    recommended_for_code?: string
  }
}

/**
 * Standard provider manifests
 */
export const PROVIDER_MANIFESTS: Record<string, ProviderManifest> = {
  anthropic: {
    provider_id: 'anthropic',
    version: '1.0',
    description: 'Claude API via Anthropic',
    allowed_effects: ['LLM_GENERATE', 'LEDGER_APPEND'],
    required_evidence_kinds: ['llm_response'],
    determinism_claim: 'NONDETERMINISTIC',
    models: {
      default: 'claude-sonnet-4-5-20250929',
      available: [
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929',
        'claude-3-5-haiku-20241022'
      ],
      recommended_for_code: 'claude-sonnet-4-5-20250929'
    }
  },

  openai: {
    provider_id: 'openai',
    version: '1.0',
    description: 'OpenAI GPT API',
    allowed_effects: ['LLM_GENERATE', 'LEDGER_APPEND'],
    required_evidence_kinds: ['llm_response'],
    determinism_claim: 'NONDETERMINISTIC',
    models: {
      default: 'gpt-4o',
      available: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
      recommended_for_code: 'gpt-4o'
    }
  },

  ollama: {
    provider_id: 'ollama',
    version: '1.0',
    description: 'Local LLM via Ollama',
    allowed_effects: ['LLM_GENERATE', 'LEDGER_APPEND'],
    required_evidence_kinds: ['llm_response'],
    determinism_claim: 'BEST_EFFORT',  // Can be more deterministic with temperature=0
    models: {
      default: 'codellama:13b',
      available: [
        'codellama:7b',
        'codellama:13b',
        'codellama:34b',
        'deepseek-coder:1.3b',
        'deepseek-coder:6.7b',
        'deepseek-coder:33b',
        'qwen2.5-coder:1.5b',
        'qwen2.5-coder:7b',
        'qwen2.5-coder:14b',
        'qwen2.5-coder:32b',
        'llama3.1:8b'
      ],
      recommended_for_code: 'qwen2.5-coder:14b'
    }
  },

  deterministic: {
    provider_id: 'deterministic',
    version: '1.0',
    description: 'Deterministic code analyzer (no LLM)',
    allowed_effects: ['NONE', 'LEDGER_APPEND'],
    required_evidence_kinds: ['gate_result'],
    determinism_claim: 'DETERMINISTIC'
  }
}

/**
 * Get provider manifest by ID
 */
export function getProviderManifest(providerId: string): ProviderManifest | undefined {
  return PROVIDER_MANIFESTS[providerId]
}

/**
 * Check if provider is allowed to exercise an effect
 */
export function isEffectAllowedForProvider(
  providerId: string,
  effect: EffectType
): boolean {
  const manifest = PROVIDER_MANIFESTS[providerId]
  if (!manifest) return false
  return manifest.allowed_effects.includes(effect)
}

/**
 * Check if provider has required evidence kinds
 */
export function hasRequiredEvidence(
  providerId: string,
  presentKinds: EvidenceKind[]
): { ok: boolean; missing: EvidenceKind[] } {
  const manifest = PROVIDER_MANIFESTS[providerId]
  if (!manifest) {
    return { ok: false, missing: [] }
  }

  const presentSet = new Set(presentKinds)
  const missing: EvidenceKind[] = []

  for (const required of manifest.required_evidence_kinds) {
    if (!presentSet.has(required)) {
      missing.push(required)
    }
  }

  return {
    ok: missing.length === 0,
    missing
  }
}

/**
 * Get recommended code model for a provider
 */
export function getRecommendedCodeModel(providerId: string): string | undefined {
  const manifest = PROVIDER_MANIFESTS[providerId]
  if (!manifest) return undefined
  return manifest.models?.recommended_for_code
}

/**
 * Check if provider claims determinism
 */
export function isDeterministic(providerId: string): boolean {
  const manifest = PROVIDER_MANIFESTS[providerId]
  if (!manifest) return false
  return manifest.determinism_claim === 'DETERMINISTIC'
}

/**
 * Create custom provider manifest
 */
export function createProviderManifest(
  providerId: string,
  description: string,
  allowedEffects: EffectType[],
  requiredEvidence: EvidenceKind[],
  determinismClaim: DeterminismClaim
): ProviderManifest {
  return {
    provider_id: providerId,
    version: '1.0',
    description,
    allowed_effects: allowedEffects,
    required_evidence_kinds: requiredEvidence,
    determinism_claim: determinismClaim
  }
}

/**
 * Register a custom provider manifest
 */
export function registerProviderManifest(manifest: ProviderManifest): void {
  PROVIDER_MANIFESTS[manifest.provider_id] = manifest
}

/**
 * Get all registered providers
 */
export function getAllProviders(): string[] {
  return Object.keys(PROVIDER_MANIFESTS)
}

/**
 * Format manifest for display
 */
export function formatManifest(manifest: ProviderManifest): string {
  const lines: string[] = []

  lines.push(`Provider: ${manifest.provider_id} (v${manifest.version})`)
  lines.push(`  ${manifest.description}`)
  lines.push(`  Determinism: ${manifest.determinism_claim}`)
  lines.push(`  Allowed effects: ${manifest.allowed_effects.join(', ')}`)
  lines.push(`  Required evidence: ${manifest.required_evidence_kinds.join(', ')}`)

  if (manifest.models) {
    lines.push(`  Default model: ${manifest.models.default}`)
    if (manifest.models.recommended_for_code) {
      lines.push(`  Recommended for code: ${manifest.models.recommended_for_code}`)
    }
  }

  return lines.join('\n')
}
