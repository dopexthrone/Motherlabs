// Constrained LLM - All code generation passes through 6 gates
// NO CODE ESCAPES WITHOUT VERIFICATION
// Supports Anthropic, OpenAI, and Ollama (local) providers

import { LLMAdapter } from '../llm'
import { OpenAIAdapter } from '../adapters/openaiAdapter'
import { AnthropicAdapter } from '../adapters/anthropicAdapter'
import { OllamaAdapter } from '../adapters/ollamaAdapter'
import { SixGateValidator, CodeValidationContext, CodeValidationResult } from '../validation/sixGates'
import { Result, Ok, Err } from '../core/result'
import { JSONLLedger } from '../persistence/jsonlLedger'
import { globalTimeProvider } from '../core/ids'
import { sanitizeInput, validateSanitized } from '../core/sanitize'
import type { CodeIssue } from '../analysis/codeAnalyzer'
import type { LLMProvider, LLMProviderType } from './types'

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
  provider: LLMProviderType
}

const MAX_ATTEMPTS = 3
const LLM_TIMEOUT_MS = 60_000

export class ConstrainedLLM {
  private llm: LLMProvider
  private providerType: LLMProviderType
  private validator: SixGateValidator
  private ledger: JSONLLedger

  constructor(llm: LLMAdapter | OpenAIAdapter | AnthropicAdapter | OllamaAdapter, ledgerPath: string = 'evidence/llm-generations.jsonl') {
    this.llm = llm
    this.providerType = llm instanceof OllamaAdapter ? 'ollama' : llm instanceof OpenAIAdapter ? 'openai' : 'anthropic'
    this.validator = new SixGateValidator()
    this.ledger = new JSONLLedger(ledgerPath)
  }

  /**
   * Get the LLM provider type
   */
  getProviderType(): LLMProviderType {
    return this.providerType
  }

  /**
   * Get the model name if available
   */
  getModel(): string {
    if (this.llm instanceof OllamaAdapter) {
      return this.llm.getModel()
    }
    // For other adapters, return a default
    return this.providerType === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-5-20250929'
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
        evidenceId,
        provider: this.providerType
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

CRITICAL: Return ONLY raw TypeScript code. NO markdown code blocks. NO \`\`\`typescript. Just the code.

MANDATORY REQUIREMENTS:
1. MUST use 'export' keyword - e.g. 'export function', 'export const', 'export class'
2. MUST compile with strict TypeScript (no implicit any)
3. MUST be clear and unambiguous

`

    const issuePrompts: Record<string, string> = {
      'NO_TESTS': `Generate a comprehensive test file for: ${filepath}

Existing code to test:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

IMPORTANT: This project uses a CUSTOM test pattern, NOT Jest/Mocha. Use this exact pattern:

\`\`\`typescript
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(\`✗ FAIL: \${message}\`);
    failCount++;
  } else {
    console.log(\`✓ PASS: \${message}\`);
    passCount++;
  }
}

async function runTests() {
  // Your tests here using assert(condition, 'message')
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
\`\`\`

Requirements:
- Use the assert(condition, message) pattern shown above
- Import from the source file using relative paths like '../src/...'
- Include success cases with meaningful assertions
- Include failure/error cases
- Test actual return values, not just that functions exist`,

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

IMPORTANT: This project uses the Result<T, Error> pattern from '../core/result':
\`\`\`typescript
import { Result, Ok, Err } from '../core/result';

// Success: return Ok(value)
// Failure: return Err(new Error('message'))

export async function example(): Promise<Result<string, Error>> {
  try {
    const result = await someOperation();
    return Ok(result);
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}
\`\`\`

Requirements:
- Import Result, Ok, Err from '../core/result'
- Change return type to Promise<Result<T, Error>> where T is the success type
- Wrap async operations in try/catch
- Return Ok(value) on success, Err(error) on failure
- Preserve the original function signature and exports`,

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
