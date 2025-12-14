// Self-Improvement Proposer - Motherlabs proposes improvements to itself
// Uses ConstrainedLLM for real code generation, with deterministic fallback

import * as fs from 'fs'
import { analyzeFile } from '../analysis/codeAnalyzer'
import { SixGateValidator, CodeValidationContext } from '../validation/sixGates'
import { ConstrainedLLM } from '../llm/constrained'
import { contentAddress } from '../core/contentAddress'
import { Result, Ok, Err } from '../core/result'
import { globalTimeProvider } from '../core/ids'
import type { CodeIssue } from '../analysis/codeAnalyzer'

export type ImprovementProposal = {
  id: string
  targetFile: string
  issue: CodeIssue
  proposedChange: {
    type: 'add_function' | 'modify_function' | 'add_test' | 'refactor'
    code: string
    diff?: string
  }
  rationale: string
  timestamp: number
  gateValidation?: {
    valid: boolean
    gateResults: Array<{ gateName: string; passed: boolean; error?: string }>
  }
  source: 'llm' | 'deterministic'
}

export class SelfImprovementProposer {
  private validator: SixGateValidator
  private constrainedLLM: ConstrainedLLM | null

  constructor(constrainedLLM?: ConstrainedLLM) {
    this.validator = new SixGateValidator()
    this.constrainedLLM = constrainedLLM || null
  }

  /**
   * Analyze file and propose improvement for highest priority issue
   * Uses LLM if available, falls back to deterministic otherwise
   */
  async proposeImprovement(filepath: string): Promise<Result<ImprovementProposal, Error>> {
    try {
      // 1. Analyze file (deterministic)
      const analysis = analyzeFile(filepath)

      if (!analysis.ok) {
        return Err(analysis.error)
      }

      if (analysis.value.issues.length === 0) {
        return Err(new Error('No issues found - file is already optimal'))
      }

      // 2. Get highest priority issue
      const sortedIssues = analysis.value.issues.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
        return severityOrder[a.severity] - severityOrder[b.severity]
      })

      const topIssue = sortedIssues[0]

      // 3. Read existing code
      let existingCode = ''
      try {
        existingCode = fs.readFileSync(filepath, 'utf-8')
      } catch {
        existingCode = ''
      }

      // 4. Build validation context
      const context: CodeValidationContext = {
        existingImports: this.extractImports(existingCode),
        existingTypes: this.extractTypes(existingCode)
      }

      // 5. Generate fix - TRY LLM FIRST, then fall back to deterministic
      let proposal: { type: 'add_function' | 'modify_function' | 'add_test' | 'refactor'; code: string }
      let source: 'llm' | 'deterministic' = 'deterministic'
      let gateValidation: ImprovementProposal['gateValidation'] | undefined

      if (this.constrainedLLM) {
        // ATTEMPT LLM CODE GENERATION (through 6 gates)
        const llmResult = await this.constrainedLLM.generateCode({
          issue: topIssue,
          filepath,
          existingCode,
          context
        })

        if (llmResult.ok) {
          // LLM succeeded and passed all gates
          proposal = {
            type: this.issueToChangeType(topIssue.type),
            code: llmResult.value.code
          }
          source = 'llm'
          gateValidation = llmResult.value.validation
        } else {
          // LLM failed - fall back to deterministic
          console.warn(`[Proposer] LLM failed: ${llmResult.error.message}, using deterministic fallback`)
          proposal = this.generateDeterministicFix(topIssue, filepath)
        }
      } else {
        // No LLM available - use deterministic
        proposal = this.generateDeterministicFix(topIssue, filepath)
      }

      // 6. If deterministic, still validate through gates
      if (source === 'deterministic') {
        const validation = await this.validator.validate(proposal.code, context)

        if (!validation.ok) {
          return Err(new Error('Proposal validation failed: ' + validation.error.message))
        }

        gateValidation = validation.value
      }

      // 7. Build final proposal
      const improvementProposal: ImprovementProposal = {
        id: contentAddress({ issue: topIssue, change: proposal, timestamp: globalTimeProvider.now() }),
        targetFile: filepath,
        issue: topIssue,
        proposedChange: proposal,
        rationale: this.generateRationale(topIssue),
        timestamp: globalTimeProvider.now(),
        gateValidation,
        source
      }

      return Ok(improvementProposal)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Map issue type to change type
   */
  private issueToChangeType(issueType: CodeIssue['type']): 'add_function' | 'modify_function' | 'add_test' | 'refactor' {
    const mapping: Record<CodeIssue['type'], 'add_function' | 'modify_function' | 'add_test' | 'refactor'> = {
      'NO_TESTS': 'add_test',
      'HIGH_COMPLEXITY': 'refactor',
      'NO_ERROR_HANDLING': 'modify_function',
      'DUPLICATE_CODE': 'refactor',
      'MISSING_TYPES': 'modify_function'
    }
    return mapping[issueType] || 'modify_function'
  }

  /**
   * Extract imports from existing code
   */
  private extractImports(code: string): string[] {
    const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from/g
    const imports: string[] = []
    let match

    while ((match = importRegex.exec(code)) !== null) {
      if (match[1]) {
        // Named imports: { a, b, c }
        imports.push(...match[1].split(',').map(s => s.trim()))
      } else if (match[2]) {
        // Default import
        imports.push(match[2])
      }
    }

    return imports
  }

  /**
   * Extract type names from existing code
   */
  private extractTypes(code: string): string[] {
    const typeRegex = /(?:type|interface)\s+(\w+)/g
    const types: string[] = ['number', 'string', 'boolean', 'void', 'null', 'undefined']
    let match

    while ((match = typeRegex.exec(code)) !== null) {
      types.push(match[1])
    }

    return types
  }

  /**
   * Generate deterministic fix (fallback when LLM unavailable or fails)
   */
  private generateDeterministicFix(issue: CodeIssue, filepath: string): {
    type: 'add_function' | 'modify_function' | 'add_test' | 'refactor'
    code: string
  } {
    // Extract module name from filepath
    const basename = filepath.split('/').pop()?.replace('.ts', '') || 'module'

    if (issue.type === 'NO_TESTS') {
      // Generate minimal valid test file
      const testCode = `// Test for ${filepath}
// DETERMINISTIC: Placeholder - LLM generation failed or unavailable

export function test${capitalize(basename)}Basic(): boolean {
  // Basic test placeholder
  return true
}

export function test${capitalize(basename)}Error(): boolean {
  // Error case placeholder
  return true
}
`
      return { type: 'add_test', code: testCode }
    }

    if (issue.type === 'HIGH_COMPLEXITY') {
      return {
        type: 'refactor',
        code: `// DETERMINISTIC: Refactoring needed for ${filepath}
// Issue: ${issue.message}
// Action: Break into smaller functions manually

export function placeholder(): void {
  // Placeholder for refactored code
}
`
      }
    }

    if (issue.type === 'NO_ERROR_HANDLING') {
      return {
        type: 'modify_function',
        code: `// DETERMINISTIC: Error handling needed
// Issue: ${issue.message}
// Action: Wrap in try/catch or use Result<T,E>

import { Result, Ok, Err } from '../core/result'

export function withErrorHandling<T>(fn: () => T): Result<T, Error> {
  try {
    return Ok(fn())
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}
`
      }
    }

    // Default fallback
    return {
      type: 'modify_function',
      code: `// DETERMINISTIC: Fix needed
// Issue: ${issue.message}
// File: ${filepath}

export function placeholder(): void {
  // Manual fix required
}
`
    }
  }

  /**
   * Generate rationale for improvement
   */
  private generateRationale(issue: CodeIssue): string {
    const reasons: Record<CodeIssue['type'], string> = {
      NO_TESTS: 'Adding tests improves reliability and enables safe refactoring',
      HIGH_COMPLEXITY: 'Reducing complexity improves maintainability and reduces bugs',
      NO_ERROR_HANDLING: 'Adding error handling prevents crashes and improves robustness',
      DUPLICATE_CODE: 'Removing duplication reduces maintenance burden',
      MISSING_TYPES: 'Adding types improves type safety and catches errors early'
    }

    return reasons[issue.type] || 'Improves code quality'
  }
}

/**
 * Capitalize first letter
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
