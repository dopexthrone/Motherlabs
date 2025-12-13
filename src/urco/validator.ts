// URCO v0.2 - Evidence Plan Validation (Real rules, no mocks)

import { EvidencePlan } from './types'

export type ValidationError = {
  code: string
  field: string
  message: string
}

export type ValidationResult = {
  valid: boolean
  errors: ValidationError[]
}

/**
 * Validate evidence plan according to strict rules
 */
export function validateEvidencePlan(plan: unknown): ValidationResult {
  const errors: ValidationError[] = []

  // Type check
  if (!plan || typeof plan !== 'object') {
    return {
      valid: false,
      errors: [{ code: 'EVIDENCE_NOT_OBJECT', field: 'plan', message: 'Evidence plan must be an object' }]
    }
  }

  const p = plan as Record<string, unknown>

  // Required: method
  if (!p.method || typeof p.method !== 'string') {
    errors.push({ code: 'EVIDENCE_NO_METHOD', field: 'method', message: 'Evidence plan must include method' })
  } else {
    const validMethods = ['static_analysis', 'unit_test', 'integration_test', 'property_test', 'golden_test', 'manual_check']
    if (!validMethods.includes(p.method as string)) {
      errors.push({
        code: 'EVIDENCE_INVALID_METHOD',
        field: 'method',
        message: `Method must be one of: ${validMethods.join(', ')}`
      })
    }
  }

  // Required: procedure (min 30 chars)
  if (!p.procedure || typeof p.procedure !== 'string') {
    errors.push({ code: 'EVIDENCE_NO_PROCEDURE', field: 'procedure', message: 'Evidence plan must include procedure' })
  } else if ((p.procedure as string).length < 30) {
    errors.push({
      code: 'EVIDENCE_PROCEDURE_TOO_SHORT',
      field: 'procedure',
      message: 'Procedure must be at least 30 characters (be specific)'
    })
  }

  // Required: artifacts (non-empty array)
  if (!p.artifacts || !Array.isArray(p.artifacts)) {
    errors.push({ code: 'EVIDENCE_NO_ARTIFACTS', field: 'artifacts', message: 'Evidence plan must include artifacts array' })
  } else if (p.artifacts.length === 0) {
    errors.push({ code: 'EVIDENCE_EMPTY_ARTIFACTS', field: 'artifacts', message: 'Artifacts array cannot be empty' })
  } else {
    // Validate each artifact
    for (let i = 0; i < p.artifacts.length; i++) {
      const artifact = p.artifacts[i]
      if (!artifact || typeof artifact !== 'object') {
        errors.push({
          code: 'EVIDENCE_INVALID_ARTIFACT',
          field: `artifacts[${i}]`,
          message: 'Artifact must be an object with kind and ref'
        })
        continue
      }

      const a = artifact as Record<string, unknown>
      const validKinds = ['file', 'log', 'snapshot', 'report', 'diff']

      if (!a.kind || !validKinds.includes(a.kind as string)) {
        errors.push({
          code: 'EVIDENCE_INVALID_ARTIFACT_KIND',
          field: `artifacts[${i}].kind`,
          message: `Artifact kind must be one of: ${validKinds.join(', ')}`
        })
      }

      if (!a.ref || typeof a.ref !== 'string' || (a.ref as string).length === 0) {
        errors.push({
          code: 'EVIDENCE_MISSING_ARTIFACT_REF',
          field: `artifacts[${i}].ref`,
          message: 'Artifact must have non-empty ref'
        })
      }
    }
  }

  // Required: acceptance
  if (!p.acceptance || typeof p.acceptance !== 'object') {
    errors.push({ code: 'EVIDENCE_NO_ACCEPTANCE', field: 'acceptance', message: 'Evidence plan must include acceptance criteria' })
  } else {
    const acc = p.acceptance as Record<string, unknown>
    const hasAsserts = acc.asserts && Array.isArray(acc.asserts) && acc.asserts.length > 0
    const hasThresholds = acc.thresholds && typeof acc.thresholds === 'object' && Object.keys(acc.thresholds).length > 0

    if (!hasAsserts && !hasThresholds) {
      errors.push({
        code: 'EVIDENCE_NO_ACCEPTANCE_CRITERIA',
        field: 'acceptance',
        message: 'Acceptance must include either asserts or thresholds'
      })
    }
  }

  // Method-specific validation
  const method = p.method as string
  const procedure = (p.procedure as string) || ''

  if (method && ['unit_test', 'integration_test', 'property_test', 'golden_test'].includes(method)) {
    // Must mention how to run tests
    if (!/\b(npm|pnpm|yarn)\s+test\b|node\b|\btsx\b|\bvitest\b|\bjest\b/i.test(procedure)) {
      errors.push({
        code: 'EVIDENCE_TEST_NO_RUNNER',
        field: 'procedure',
        message: 'Test methods must specify how to run tests (npm test, node, tsx, vitest, jest)'
      })
    }

    // Must have at least one file artifact
    const artifacts = (p.artifacts as Array<Record<string, unknown>>) || []
    if (!artifacts.some(a => a.kind === 'file')) {
      errors.push({
        code: 'EVIDENCE_TEST_NO_FILE',
        field: 'artifacts',
        message: 'Test methods must include at least one file artifact'
      })
    }
  }

  if (method === 'static_analysis') {
    // Must mention tool
    if (!/\b(tsc|eslint|typecheck|prettier|biome)\b/i.test(procedure)) {
      errors.push({
        code: 'EVIDENCE_STATIC_NO_TOOL',
        field: 'procedure',
        message: 'Static analysis must specify tool (tsc, eslint, typecheck, etc.)'
      })
    }
  }

  if (method === 'manual_check') {
    // Must have step-by-step procedure
    if (!/1\.\s.+\n2\.\s.+/i.test(procedure)) {
      errors.push({
        code: 'EVIDENCE_MANUAL_NO_STEPS',
        field: 'procedure',
        message: 'Manual check must include numbered steps (1. ... 2. ...)'
      })
    }

    // Must have explicit asserts
    const acc = p.acceptance as Record<string, unknown>
    if (!acc.asserts || !Array.isArray(acc.asserts) || acc.asserts.length === 0) {
      errors.push({
        code: 'EVIDENCE_MANUAL_NO_ASSERTS',
        field: 'acceptance.asserts',
        message: 'Manual check must include explicit assertions'
      })
    }
  }

  // Return frozen errors array to prevent mutation
  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors) as ValidationError[]
  }
}
