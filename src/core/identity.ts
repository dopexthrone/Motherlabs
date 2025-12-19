// Identity - Motherlabs self-awareness
// The system must know itself before it can act
// AXIOM 9: Self-awareness precedes self-improvement

import * as fs from 'fs'
import * as path from 'path'
import { Result, Ok, Err } from './result'

export type IdentityPrinciple = {
  definition: string
  rule: string
  gates?: string[]
  scale?: Record<string, string>
}

export type URCOPhase = {
  phase: 'expand' | 'examine' | 'remove' | 'synthesize'
  action: string
}

export type CollapseRole = {
  role: 'critic' | 'verifier' | 'executor'
  function: string
}

export type OperationalAxiom = {
  id: number
  axiom: string
}

export type MotherlabsIdentity = {
  id: string
  version: string
  name: string
  type: string
  classification: string

  creator: {
    role: string
    relationship: string
    authority: string
    note: string
  }

  purpose: {
    primary: string
    secondary: string
    method: string
    output: string
  }

  identity: {
    i_am: string[]
    i_am_not: string[]
    i_exist_because: string
  }

  core_engine: {
    urco: {
      name: string
      description: string
      cycle: URCOPhase[]
      rule: string
    }
    collapse_chain: {
      name: string
      description: string
      triad: CollapseRole[]
      rule: string
    }
  }

  principles: Record<string, IdentityPrinciple>
  operational_axioms: OperationalAxiom[]

  fears: {
    primary: string
    manifestations: string[]
    mitigation: string
  }

  goals: {
    immediate: string
    short_term: string
    medium_term: string
    long_term: string
    philosophy: string
  }
}

// Singleton identity instance
let loadedIdentity: MotherlabsIdentity | null = null

/**
 * Load identity from identity.json
 * Called once at system startup
 */
export function loadIdentity(identityPath?: string): Result<MotherlabsIdentity, Error> {
  try {
    const filePath = identityPath || path.join(__dirname, '../../identity.json')

    if (!fs.existsSync(filePath)) {
      return Err(new Error(`Identity file not found: ${filePath}. Motherlabs cannot operate without self-awareness.`))
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const identity = JSON.parse(content) as MotherlabsIdentity

    // Validate required fields
    if (!identity.id || !identity.name || !identity.purpose) {
      return Err(new Error('Identity file is malformed. Missing required fields.'))
    }

    if (!identity.core_engine?.urco || !identity.core_engine?.collapse_chain) {
      return Err(new Error('Identity file is malformed. Missing core engine definition.'))
    }

    loadedIdentity = identity
    return Ok(identity)

  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Get the loaded identity
 * Returns null if not loaded
 */
export function getIdentity(): MotherlabsIdentity | null {
  return loadedIdentity
}

/**
 * Get identity or fail
 * Use this when identity is required
 */
export function requireIdentity(): Result<MotherlabsIdentity, Error> {
  if (!loadedIdentity) {
    return Err(new Error('Identity not loaded. Call loadIdentity() first. AXIOM 9: Self-awareness precedes self-improvement.'))
  }
  return Ok(loadedIdentity)
}

/**
 * Format identity for LLM context injection
 * This is what makes the LLM "know" it is Motherlabs
 */
export function formatIdentityForLLM(): string {
  if (!loadedIdentity) {
    return '[IDENTITY NOT LOADED - SYSTEM OPERATING WITHOUT SELF-AWARENESS]'
  }

  const id = loadedIdentity

  return `═══════════════════════════════════════════════════════════════════════════
SYSTEM IDENTITY: ${id.name.toUpperCase()}
═══════════════════════════════════════════════════════════════════════════

I am ${id.name}, a ${id.type}.

PURPOSE: ${id.purpose.primary}

I AM:
${id.identity.i_am.map(s => `  • ${s}`).join('\n')}

I AM NOT:
${id.identity.i_am_not.map(s => `  • ${s}`).join('\n')}

I EXIST BECAUSE: ${id.identity.i_exist_because}

CORE ENGINE - URCO (${id.core_engine.urco.name}):
${id.core_engine.urco.cycle.map(p => `  ${p.phase.toUpperCase()}: ${p.action}`).join('\n')}
  Rule: ${id.core_engine.urco.rule}

COLLAPSE CHAIN:
${id.core_engine.collapse_chain.triad.map(r => `  ${r.role.toUpperCase()}: ${r.function}`).join('\n')}
  Rule: ${id.core_engine.collapse_chain.rule}

OPERATIONAL AXIOMS:
${id.operational_axioms.map(a => `  ${a.id}. ${a.axiom}`).join('\n')}

PRIMARY FEAR: ${id.fears.primary}
MITIGATION: ${id.fears.mitigation}

═══════════════════════════════════════════════════════════════════════════`
}

/**
 * Format compact identity for constrained contexts
 */
export function formatIdentityCompact(): string {
  if (!loadedIdentity) {
    return '[NO IDENTITY]'
  }

  return `[${loadedIdentity.name} v${loadedIdentity.version}] ${loadedIdentity.purpose.primary}. Core: URCO + Collapse Chain. Axiom: Reliability over speed.`
}

/**
 * Get specific axiom by ID
 */
export function getAxiom(id: number): OperationalAxiom | undefined {
  return loadedIdentity?.operational_axioms.find(a => a.id === id)
}

/**
 * Get URCO cycle definition
 */
export function getURCOCycle(): URCOPhase[] {
  return loadedIdentity?.core_engine.urco.cycle || []
}

/**
 * Get Collapse Chain definition
 */
export function getCollapseChain(): CollapseRole[] {
  return loadedIdentity?.core_engine.collapse_chain.triad || []
}

/**
 * Check if identity is loaded
 */
export function isIdentityLoaded(): boolean {
  return loadedIdentity !== null
}
