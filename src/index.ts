// Motherlabs Runtime - Main Entry Point
// AXIOM 9: Self-awareness precedes self-improvement

// ═══════════════════════════════════════════════════════════════════════════
// IDENTITY - The system must know itself
// ═══════════════════════════════════════════════════════════════════════════
export {
  loadIdentity,
  getIdentity,
  requireIdentity,
  formatIdentityForLLM,
  formatIdentityCompact,
  getAxiom,
  getURCOCycle,
  getCollapseChain,
  isIdentityLoaded,
  type MotherlabsIdentity,
  type URCOPhase as IdentityURCOPhase,
  type CollapseRole,
  type OperationalAxiom
} from './core/identity'

// ═══════════════════════════════════════════════════════════════════════════
// CORE - Foundational primitives
// ═══════════════════════════════════════════════════════════════════════════
export { Result, Ok, Err } from './core/result'
export { contentAddress, verifyContentAddress } from './core/contentAddress'
export { globalTimeProvider } from './core/ids'
export { sanitizeInput, validateSanitized } from './core/sanitize'

// ═══════════════════════════════════════════════════════════════════════════
// URCO - Universal Recursive Clarity Operator (The Core Engine)
// ═══════════════════════════════════════════════════════════════════════════
export {
  URCOEngine,
  createURCO,
  createTextURCO,
  urcoText,
  textPhaseProcessor,
  type URCOInput,
  type URCOCycleResult,
  type PhaseProcessor,
  type PhaseResult,
  type PhaseArtifact,
  type Entropy,
  type URCOPhase
} from './core/urco'

export {
  createCodeURCO,
  urcoCode,
  codePhaseProcessor,
  type CodeURCOInput,
  type CodeURCOOutput
} from './core/urcoCode'

// ═══════════════════════════════════════════════════════════════════════════
// COLLAPSE CHAIN - Final reduction of uncertainty before action
// ═══════════════════════════════════════════════════════════════════════════
export {
  CollapseChain,
  createCollapseChain,
  createDefaultCollapseChain,
  createDefaultCritic,
  createDefaultVerifier,
  createDefaultExecutor,
  collapse,
  collapseURCO,
  type CriticRole,
  type VerifierRole,
  type ExecutorRole,
  type CritiqueResult,
  type VerificationResult,
  type ExecutionOutcome,
  type CollapseChainResult,
  type CollapseArtifact,
  type Weakness,
  type VerificationCheck,
  type Severity
} from './core/collapseChain'

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS - Code understanding
// ═══════════════════════════════════════════════════════════════════════════
export { analyzeFile, analyzeDirectory, type CodeAnalysis, type CodeIssue, type CodeMetrics } from './analysis/codeAnalyzer'

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION - Gate system
// ═══════════════════════════════════════════════════════════════════════════
export { SixGateValidator, type CodeValidationContext, type CodeValidationResult } from './validation/sixGates'

// ═══════════════════════════════════════════════════════════════════════════
// LLM - Constrained code generation
// ═══════════════════════════════════════════════════════════════════════════
export { ConstrainedLLM, type GenerateCodeRequest, type GenerateCodeResult } from './llm/constrained'

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTERS - LLM providers
// ═══════════════════════════════════════════════════════════════════════════
export { AnthropicAdapter } from './adapters/anthropicAdapter'
export { OpenAIAdapter } from './adapters/openaiAdapter'
export { OllamaAdapter } from './adapters/ollamaAdapter'

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE - Evidence and ledger
// ═══════════════════════════════════════════════════════════════════════════
export { JSONLLedger } from './persistence/jsonlLedger'

// ═══════════════════════════════════════════════════════════════════════════
// SELF-BUILD - Self-improvement system
// ═══════════════════════════════════════════════════════════════════════════
export { SelfImprovementProposer, type ImprovementProposal } from './selfbuild/proposer'
export { AutoApplier, type ApplyResult } from './selfbuild/applier'

// ═══════════════════════════════════════════════════════════════════════════
// DOGFOOD - Self-improvement loop
// ═══════════════════════════════════════════════════════════════════════════
export { DogfoodingLoop, type DogfoodingConfig } from './dogfood/loop'

// ═══════════════════════════════════════════════════════════════════════════
// Initialize identity on import
// The system must know itself before any operation
// ═══════════════════════════════════════════════════════════════════════════
import { loadIdentity, isIdentityLoaded } from './core/identity'

if (!isIdentityLoaded()) {
  const result = loadIdentity()
  if (result.ok) {
    console.log(`[Motherlabs v${result.value.version}] Identity loaded`)
  }
}
