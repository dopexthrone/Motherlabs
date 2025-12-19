// URCO Code Processor - URCO for code generation and improvement
// Integrates with the analysis and validation systems
//
// EXPAND:     Analyze code, gather context, identify issues
// EXAMINE:    Validate structure, check types, assess quality
// REMOVE:     Strip noise, simplify complexity, remove duplication
// SYNTHESIZE: Generate improved code, verify gates, produce output

import { Result, Ok, Err } from './result'
import { globalTimeProvider } from './ids'
import { URCOEngine, PhaseProcessor, PhaseResult, PhaseArtifact, Entropy, createURCO } from './urco'
import { analyzeFile, CodeAnalysis, CodeIssue } from '../analysis/codeAnalyzer'
import { SixGateValidator, CodeValidationContext } from '../validation/sixGates'
import * as fs from 'fs'
import * as path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type CodeURCOInput = {
  filepath: string
  code: string
  issue?: CodeIssue
  context?: CodeValidationContext
}

export type CodeURCOOutput = {
  filepath: string
  originalCode: string
  improvedCode: string
  analysis: CodeAnalysis | null
  issues: CodeIssue[]
  gatesPassed: boolean
  gateResults: Array<{ gateName: string; passed: boolean; error?: string }>
}

// ═══════════════════════════════════════════════════════════════════════════
// CODE PHASE PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

function createArtifact(phase: 'expand' | 'examine' | 'remove' | 'synthesize', observation: string, entropy: Entropy): PhaseArtifact {
  return {
    phase,
    observation,
    entropy,
    timestamp: globalTimeProvider.now()
  }
}

export const codePhaseProcessor: PhaseProcessor<CodeURCOInput> = {
  /**
   * EXPAND: Analyze code, gather context, identify issues
   * - Read the file
   * - Run static analysis
   * - Identify all issues
   * - Gather type information
   */
  async expand(input: CodeURCOInput, context: Record<string, unknown>): Promise<PhaseResult<CodeURCOInput>> {
    const artifacts: PhaseArtifact[] = []

    // Read current code if not provided
    let code = input.code
    if (!code && input.filepath && fs.existsSync(input.filepath)) {
      code = fs.readFileSync(input.filepath, 'utf-8')
      artifacts.push(createArtifact('expand', `Read ${code.length} characters from ${path.basename(input.filepath)}`, 0.8))
    }

    // Run static analysis
    let analysis: CodeAnalysis | null = null
    let issues: CodeIssue[] = []

    if (input.filepath && fs.existsSync(input.filepath)) {
      const analysisResult = analyzeFile(input.filepath)
      if (analysisResult.ok) {
        analysis = analysisResult.value
        issues = analysis.issues
        artifacts.push(createArtifact('expand', `Found ${issues.length} issues: ${issues.map(i => i.type).join(', ') || 'none'}`, issues.length > 0 ? 0.7 : 0.3))
      } else {
        artifacts.push(createArtifact('expand', `Analysis failed: ${analysisResult.error.message}`, 0.9))
      }
    }

    // Calculate expansion entropy based on what we found
    const entropy = issues.length > 3 ? 0.8 : issues.length > 0 ? 0.6 : 0.3

    return {
      output: {
        ...input,
        code,
        issue: input.issue || issues[0]
      },
      entropy,
      artifacts,
      metadata: {
        analysis,
        issues,
        codeLength: code.length
      }
    }
  },

  /**
   * EXAMINE: Validate structure, check types, assess quality
   * - Run gate validation on current code
   * - Check for type errors
   * - Assess code quality metrics
   */
  async examine(input: CodeURCOInput, context: Record<string, unknown>): Promise<PhaseResult<CodeURCOInput>> {
    const artifacts: PhaseArtifact[] = []
    const validator = new SixGateValidator()

    // Only validate if we have code
    if (!input.code) {
      return {
        output: input,
        entropy: 0.9,
        artifacts: [createArtifact('examine', 'No code to examine', 0.9)],
        metadata: {}
      }
    }

    // Run validation
    const validationContext: CodeValidationContext = input.context || {
      existingImports: [],
      existingTypes: []
    }

    const validationResult = await validator.validate(input.code, validationContext)

    if (!validationResult.ok) {
      artifacts.push(createArtifact('examine', `Validation error: ${validationResult.error.message}`, 0.9))
      return {
        output: input,
        entropy: 0.9,
        artifacts,
        metadata: { validationError: validationResult.error.message }
      }
    }

    const validation = validationResult.value
    const passedGates = validation.gateResults.filter(g => g.passed).length
    const totalGates = validation.gateResults.length

    artifacts.push(createArtifact(
      'examine',
      `Gates: ${passedGates}/${totalGates} passed${validation.valid ? '' : ` - Failed at ${validation.rejectedAt}`}`,
      validation.valid ? 0.3 : 0.7
    ))

    // Add specific gate failures
    for (const gate of validation.gateResults) {
      if (!gate.passed) {
        artifacts.push(createArtifact('examine', `Gate ${gate.gateName} failed: ${gate.error || 'unknown'}`, 0.8))
      }
    }

    return {
      output: input,
      entropy: validation.valid ? 0.3 : 0.7,
      artifacts,
      metadata: {
        gatesPassed: validation.valid,
        gateResults: validation.gateResults,
        passedCount: passedGates,
        totalCount: totalGates
      }
    }
  },

  /**
   * REMOVE: Strip noise, simplify complexity, remove duplication
   * - Remove unnecessary whitespace
   * - Remove dead code (if detected)
   * - Simplify overly complex constructs
   */
  async remove(input: CodeURCOInput, context: Record<string, unknown>): Promise<PhaseResult<CodeURCOInput>> {
    const artifacts: PhaseArtifact[] = []

    if (!input.code) {
      return {
        output: input,
        entropy: 0.5,
        artifacts: [createArtifact('remove', 'No code to process', 0.5)],
        metadata: {}
      }
    }

    let cleaned = input.code

    // Remove trailing whitespace
    const beforeLength = cleaned.length
    cleaned = cleaned.split('\n').map(line => line.trimEnd()).join('\n')

    // Remove multiple blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

    // Remove commented-out code blocks (simple heuristic)
    const commentedCodePattern = /\/\/\s*(const|let|var|function|class|import|export)\s+/g
    const commentedMatches = cleaned.match(commentedCodePattern)
    if (commentedMatches && commentedMatches.length > 0) {
      artifacts.push(createArtifact('remove', `Found ${commentedMatches.length} potentially commented-out code lines`, 0.5))
    }

    const removed = beforeLength - cleaned.length
    if (removed > 0) {
      artifacts.push(createArtifact('remove', `Removed ${removed} characters of whitespace noise`, 0.4))
    } else {
      artifacts.push(createArtifact('remove', 'Code is clean, no noise to remove', 0.2))
    }

    return {
      output: {
        ...input,
        code: cleaned
      },
      entropy: 0.3,
      artifacts,
      metadata: { removed }
    }
  },

  /**
   * SYNTHESIZE: Structure the final output
   * - Ensure consistent formatting
   * - Verify final structure
   * - Package for output
   */
  async synthesize(input: CodeURCOInput, context: Record<string, unknown>): Promise<PhaseResult<CodeURCOInput>> {
    const artifacts: PhaseArtifact[] = []

    if (!input.code) {
      return {
        output: input,
        entropy: 0.5,
        artifacts: [createArtifact('synthesize', 'No code to synthesize', 0.5)],
        metadata: {}
      }
    }

    // Ensure file ends with newline
    let final = input.code
    if (!final.endsWith('\n')) {
      final = final + '\n'
    }

    // Get metadata from previous phases
    const issues = (context.expandArtifacts as PhaseArtifact[] | undefined)
      ?.filter(a => a.observation.includes('issues'))
      || []

    const gatesPassed = (context.examineArtifacts as PhaseArtifact[] | undefined)
      ?.some(a => a.observation.includes('passed') && !a.observation.includes('Failed'))
      ?? false

    artifacts.push(createArtifact(
      'synthesize',
      `Synthesized ${final.length} characters, gates: ${gatesPassed ? 'PASSED' : 'NEEDS WORK'}`,
      gatesPassed ? 0.1 : 0.4
    ))

    return {
      output: {
        ...input,
        code: final
      },
      entropy: gatesPassed ? 0.1 : 0.4,
      artifacts,
      metadata: {
        finalLength: final.length,
        gatesPassed
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CODE URCO ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a code URCO engine
 */
export function createCodeURCO(options?: {
  maxDepth?: number
  entropyThreshold?: number
}): URCOEngine<CodeURCOInput> {
  return createURCO(codePhaseProcessor, {
    maxDepth: options?.maxDepth ?? 3,
    entropyThreshold: options?.entropyThreshold ?? 0.2
  })
}

/**
 * Quick URCO process for code file
 */
export async function urcoCode(
  filepath: string,
  context: Record<string, unknown> = {}
): Promise<Result<CodeURCOOutput, Error>> {
  if (!fs.existsSync(filepath)) {
    return Err(new Error(`File not found: ${filepath}`))
  }

  const code = fs.readFileSync(filepath, 'utf-8')
  const engine = createCodeURCO()

  const result = await engine.process({
    subject: { filepath, code },
    context
  })

  if (!result.ok) {
    return Err(result.error)
  }

  const r = result.value

  // Extract metadata from phases
  const analysis = r.phases.expand.metadata.analysis as CodeAnalysis | null
  const issues = (r.phases.expand.metadata.issues as CodeIssue[]) || []
  const gatesPassed = (r.phases.examine.metadata.gatesPassed as boolean) ?? false
  const gateResults = (r.phases.examine.metadata.gateResults as Array<{ gateName: string; passed: boolean; error?: string }>) || []

  return Ok({
    filepath,
    originalCode: code,
    improvedCode: r.output.code,
    analysis,
    issues,
    gatesPassed,
    gateResults
  })
}
