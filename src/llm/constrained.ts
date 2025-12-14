// Constrained LLM - All code generation passes through 6 gates
// NO CODE ESCAPES WITHOUT VERIFICATION

import { LLMAdapter } from '../llm'
import { SixGateValidator, CodeValidationContext, CodeValidationResult } from '../validation/sixGates'
import { Result, Ok, Err } from '../core/result'
import { JSONLLedger } from '../persistence/jsonlLedger'
import { globalTimeProvider } from '../core/ids'
import { sanitizeInput, validateSanitized } from '../core/sanitize'
import type { CodeIssue } from '../analysis/codeAnalyzer'

export type GenerateCodeRequest = {
  issue: CodeIssue
  filepath: string
  existingCode: string
  context: CodeValidationContext
}

export type GenerateCodeResult = {
  code: string
  validation: CodeValidationResult
  attempts: number
  evidenceId: string
}

const MAX_ATTEMPTS = 3
const LLM_TIMEOUT_MS = 60_000

export class ConstrainedLLM {
  private llm: LLMAdapter
  private validator: SixGateValidator
  private ledger: JSONLLedger

  constructor(llm: LLMAdapter, ledgerPath: string = 'evidence/llm-generations.jsonl') {
    this.llm = llm
    this.validator = new SixGateValidator()
    this.ledger = new JSONLLedger(ledgerPath)
  }

  /**
   * Generate code that MUST pass all 6 gates
   * Retries up to MAX_ATTEMPTS times
   * Returns Err if all attempts fail gates
   */
  async generateCode(request: GenerateCodeRequest): Promise<Result<GenerateCodeResult, Error>> {
    const { issue, filepath, existingCode, context } = request

    // Sanitize inputs
    const sanitizedIssue = sanitizeInput(issue.message)
    try {
      validateSanitized(sanitizedIssue)
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Log attempt
      await this.ledger.append('generation_attempt', {
        attempt,
        issue: issue.type,
        filepath,
        timestamp: globalTimeProvider.now()
      })

      // Generate code via LLM
      const prompt = this.buildPrompt(issue, filepath, existingCode, attempt)

      let rawCode: string
      try {
        rawCode = await this.withTimeout(
          this.llm.generateCode(prompt),
          LLM_TIMEOUT_MS
        )
      } catch (error) {
        await this.logRejection('LLM_ERROR', attempt, error instanceof Error ? error.message : String(error))
        continue
      }

      // Extract code from response (handle markdown blocks)
      const code = this.extractCode(rawCode)

      if (!code || code.trim().length === 0) {
        await this.logRejection('EMPTY_CODE', attempt, 'LLM returned empty code')
        continue
      }

      // CRITICAL: Pass through 6 gates
      const validation = await this.validator.validate(code, context)

      if (!validation.ok) {
        await this.logRejection('VALIDATION_ERROR', attempt, validation.error.message)
        continue
      }

      if (!validation.value.valid) {
        await this.logRejection(
          validation.value.rejectedAt || 'GATE_FAILED',
          attempt,
          `Failed gates: ${validation.value.gateResults.filter(g => !g.passed).map(g => g.gateName).join(', ')}`
        )
        continue
      }

      // ALL GATES PASSED - Code is verified
      const evidenceId = await this.logAcceptance(code, validation.value, attempt)

      return Ok({
        code,
        validation: validation.value,
        attempts: attempt,
        evidenceId
      })
    }

    // All attempts failed
    await this.ledger.append('generation_failed', {
      issue: issue.type,
      filepath,
      maxAttempts: MAX_ATTEMPTS,
      timestamp: globalTimeProvider.now()
    })

    return Err(new Error(`Code generation failed after ${MAX_ATTEMPTS} attempts - all failed gates`))
  }

  /**
   * Build prompt for specific issue type
   */
  private buildPrompt(issue: CodeIssue, filepath: string, existingCode: string, attempt: number): string {
    // DETERMINISM-EXEMPT: Prompt strings reference forbidden patterns to instruct LLM what NOT to use
    const basePrompt = `You are generating TypeScript code for Motherlabs Runtime.

STRICT REQUIREMENTS:
- Must export at least one declaration (function, const, class, type, or interface)
- Must compile with strict TypeScript (no implicit any)
- Must use Result<T, Error> pattern for error handling
- Must NOT use non-deterministic time or random functions directly
- Must be clear and unambiguous (low entropy)
- Return ONLY valid TypeScript code, no markdown, no explanations

`

    const issuePrompts: Record<string, string> = {
      'NO_TESTS': `Generate a comprehensive test file for: ${filepath}

Existing code to test:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Import from the source file
- Include success cases
- Include failure/error cases
- Include edge cases
- Use expect() assertions
- Export test functions or use describe/test pattern`,

      'HIGH_COMPLEXITY': `Refactor this complex function to reduce cyclomatic complexity.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Break into smaller, focused functions
- Each function should have complexity < 10
- Maintain same external interface
- Add clear function names`,

      'NO_ERROR_HANDLING': `Add proper error handling to this async function.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Use Result<T, Error> pattern OR try/catch with proper error propagation
- Never silently swallow errors
- Return structured errors with context`,

      'DUPLICATE_CODE': `Refactor to eliminate duplicate code.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Extract common logic into reusable functions
- Maintain same external behavior
- Add proper type annotations`,

      'MISSING_TYPES': `Add proper TypeScript types to this code.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Replace any with specific types
- Add explicit return types
- Add parameter types
- Create type aliases where appropriate`
    }

    const issuePrompt = issuePrompts[issue.type] || `Fix the following issue: ${issue.message}\n\nFile: ${filepath}\n\nCode:\n${existingCode.slice(0, 2000)}`

    const attemptHint = attempt > 1
      ? `\n\nThis is attempt ${attempt}/${MAX_ATTEMPTS}. Previous attempts failed validation. Be more careful with exports and type safety.\n`
      : ''

    return basePrompt + issuePrompt + attemptHint
  }

  /**
   * Extract code from LLM response (handle markdown blocks)
   */
  private extractCode(raw: string): string {
    // Try to extract from typescript/ts code block
    const tsMatch = raw.match(/```(?:typescript|ts)\n([\s\S]*?)```/)
    if (tsMatch) {
      return tsMatch[1].trim()
    }

    // Try generic code block
    const codeMatch = raw.match(/```\n([\s\S]*?)```/)
    if (codeMatch) {
      return codeMatch[1].trim()
    }

    // No code block - return as-is (might be raw code)
    return raw.trim()
  }

  /**
   * Add timeout to promise
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM timeout')), ms)
      )
    ])
  }

  /**
   * Log rejection to evidence ledger
   */
  private async logRejection(reason: string, attempt: number, message: string): Promise<void> {
    await this.ledger.append('generation_rejected', {
      reason,
      attempt,
      message,
      timestamp: globalTimeProvider.now()
    })
  }

  /**
   * Log acceptance to evidence ledger
   */
  private async logAcceptance(code: string, validation: CodeValidationResult, attempt: number): Promise<string> {
    const result = await this.ledger.append('generation_accepted', {
      codeLength: code.length,
      gates: validation.gateResults.map(g => ({ name: g.gateName, passed: g.passed })),
      attempt,
      timestamp: globalTimeProvider.now()
    })
    // Return record_hash as the evidence ID
    return result.ok ? result.value.record_hash : `evidence-${globalTimeProvider.now()}`
  }
}
