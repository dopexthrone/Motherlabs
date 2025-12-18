// Constrained LLM - All code generation passes through 6 gates
// NO CODE ESCAPES WITHOUT VERIFICATION
// Supports Anthropic, OpenAI, and Ollama (local) providers

import { LLMAdapter } from '../llm'
import { OpenAIAdapter } from '../adapters/openaiAdapter'
import { AnthropicAdapter } from '../adapters/anthropicAdapter'
import { OllamaAdapter } from '../adapters/ollamaAdapter'
import { SixGateValidator, CodeValidationContext, CodeValidationResult } from '../validation/sixGates'
import { extractExportsFromCode } from '../validation/testQualityAnalyzer'
import { Result, Ok, Err } from '../core/result'
import { JSONLLedger } from '../persistence/jsonlLedger'
import { globalTimeProvider } from '../core/ids'
import { sanitizeInput, validateSanitized } from '../core/sanitize'
import { getRelevantTypes, getCoreProjectTypes, formatTypesForPrompt, getRelevantFunctions, formatFunctionsForPrompt, getRelevantClasses, formatClassesForPrompt } from './typeExtractor'
import type { CodeIssue } from '../analysis/codeAnalyzer'
import type { LLMProvider, LLMProviderType } from './types'

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2: Helper to extract identifiers from existing code
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract function/method/variable names from code
 * This helps the LLM know what's available to use
 */
function extractCodeIdentifiers(code: string): {
  functions: string[]
  variables: string[]
  imports: string[]
} {
  const functions: string[] = []
  const variables: string[] = []
  const imports: string[] = []

  // Extract function names: function foo(...) or async function foo(...)
  const funcMatches = code.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)
  for (const match of funcMatches) {
    functions.push(match[1])
  }

  // Extract arrow functions: const foo = (...) => or const foo = async (...) =>
  const arrowMatches = code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)
  for (const match of arrowMatches) {
    functions.push(match[1])
  }

  // Extract method calls that might be available: this.method or obj.method
  const methodMatches = code.matchAll(/(?:this|await\s+this)\.(\w+)\s*\(/g)
  for (const match of methodMatches) {
    if (!functions.includes(match[1])) {
      functions.push(match[1])
    }
  }

  // Extract const/let declarations
  const varMatches = code.matchAll(/(?:const|let)\s+(\w+)\s*[=:]/g)
  for (const match of varMatches) {
    if (!functions.includes(match[1])) {
      variables.push(match[1])
    }
  }

  // Extract import names
  const importMatches = code.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from/g)
  for (const match of importMatches) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim())
    imports.push(...names)
  }

  return {
    functions: [...new Set(functions)],
    variables: [...new Set(variables)],
    imports: [...new Set(imports)]
  }
}

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

      // CRITICAL: Pass through all gates (including Gate 7 for test quality)
      // Enhance context with target exports for coverage analysis
      const enhancedContext: CodeValidationContext = {
        ...context,
        targetExports: context.targetExports ?? extractExportsFromCode(existingCode)
      }
      const validation = await this.validator.validate(code, enhancedContext)

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
   * FIX 2: Enhanced with better context injection
   */
  private buildPrompt(issue: CodeIssue, filepath: string, existingCode: string, attempt: number): string {
    // Extract type definitions from imports and core project types
    const relevantTypes = getRelevantTypes(filepath, 8)
    const coreTypes = getCoreProjectTypes('src')
    const allTypes = [...relevantTypes, ...coreTypes.slice(0, 5)]
    const typeContext = formatTypesForPrompt(allTypes)

    // Extract function signatures from imports
    const relevantFunctions = getRelevantFunctions(filepath, 8)
    const funcContext = formatFunctionsForPrompt(relevantFunctions)

    // Extract class definitions from imports
    const relevantClasses = getRelevantClasses(filepath, 5)
    const classContext = formatClassesForPrompt(relevantClasses)

    // FIX 2: Extract identifiers from existing code
    const identifiers = extractCodeIdentifiers(existingCode)
    const identifierContext = this.formatIdentifierContext(identifiers)

    // DETERMINISM-EXEMPT: Prompt strings reference forbidden patterns to instruct LLM what NOT to use
    const basePrompt = `You are generating TypeScript code for Motherlabs Runtime.

CRITICAL: Return ONLY raw TypeScript code. NO markdown code blocks. NO \`\`\`typescript. Just the code.

MANDATORY REQUIREMENTS:
1. MUST use 'export' keyword - e.g. 'export function', 'export const', 'export class'
2. MUST compile with strict TypeScript (no implicit any)
3. MUST be clear and unambiguous
4. MUST use ONLY the identifiers listed below - do NOT invent new function/method names

═══════════════════════════════════════════════════════════════════════════
IDENTIFIERS FROM EXISTING CODE (use these EXACTLY):
═══════════════════════════════════════════════════════════════════════════
${identifierContext}

═══════════════════════════════════════════════════════════════════════════
SECURITY PATTERNS (code WILL BE REJECTED if you violate these):
═══════════════════════════════════════════════════════════════════════════

✗ FORBIDDEN - Will fail Gate 6:
  - JSON.parse(untrustedInput)
  - eval(), new Function()
  - exec(), spawn() with string concatenation

✓ SAFE PATTERNS - Use these instead:
  // Safe JSON parsing:
  function safeJsonParse<T>(input: string): Result<T, Error> {
    try {
      const data = JSON.parse(input) as T;
      return Ok(data);
    } catch (e) {
      return Err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // Safe async operations:
  try {
    const result = await operation();
    return Ok(result);
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }

═══════════════════════════════════════════════════════════════════════════
PATTERNS THAT WILL FAIL VALIDATION:
═══════════════════════════════════════════════════════════════════════════
- Using undefined variables/functions (Gate 3 fails)
- Using JSON.parse without try/catch (Gate 6 fails)
- Missing 'export' keyword (Gate 1 fails)
- Type errors (Gate 2 fails)

${typeContext}
${funcContext}
${classContext}
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
- Test actual return values, not just that functions exist
- Use ONLY types that exist (see AVAILABLE TYPE DEFINITIONS above)
- For union types like Evidence.type, use ONLY the valid values listed`,

      'HIGH_COMPLEXITY': `Refactor this complex function to reduce cyclomatic complexity.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

CRITICAL CONSTRAINTS:
- Do NOT add new properties to existing types (like Config, Evidence, etc.)
- Do NOT change the types of existing variables
- Use ONLY the types shown in AVAILABLE TYPE DEFINITIONS above
- If a type doesn't have a property, you CANNOT add it

Requirements:
- Break into smaller, focused functions
- Each function should have complexity < 10
- Maintain same external interface (same parameters, same return type)
- Add clear function names
- Keep all existing imports and type usage`,

      'NO_ERROR_HANDLING': `Add proper error handling to this async function.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

IMPORTANT: This project uses the Result<T, Error> pattern from '../core/result'.

COMPLETE THE CODE BELOW - Keep the EXACT same function name and logic:
\`\`\`typescript
import { Result, Ok, Err } from '../core/result';

// SAFE JSON PARSING - Use this pattern instead of raw JSON.parse:
function safeJsonParse<T>(input: string): Result<T, Error> {
  try {
    const data = JSON.parse(input) as T;
    return Ok(data);
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)));
  }
}

// SAFE ASYNC FUNCTION TEMPLATE:
export async function yourFunction(param: ParamType): Promise<Result<ReturnType, Error>> {
  try {
    // Your logic here
    // If parsing JSON, use: const parsed = safeJsonParse<YourType>(jsonString);
    // If parsed.ok is false, return parsed (propagates error)

    return Ok(result);
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}
\`\`\`

CRITICAL REQUIREMENTS:
1. Import Result, Ok, Err from '../core/result'
2. Change return type to Promise<Result<T, Error>>
3. Wrap ALL async operations in try/catch
4. If the code uses JSON.parse, wrap it in a helper like safeJsonParse shown above
5. Return Ok(value) on success, Err(error) on failure
6. Use ONLY the function names from the IDENTIFIERS section above
7. MUST export the function`,

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

    // No code block - strip common preambles and return
    let code = raw.trim()

    // Strip common LLM preamble patterns
    const preamblePatterns = [
      /^Here (?:is|are) (?:the |a )?(?:TypeScript|code|utility|function|implementation)[^:]*:\s*/i,
      /^(?:Sure|Certainly|Of course)[,!]?\s*(?:here (?:is|are)[^:]*:)?\s*/i,
      /^(?:The following|Below is)[^:]*:\s*/i,
      /^I'?(?:ll|ve) (?:create|generate|write)[^:]*:\s*/i,
    ]

    for (const pattern of preamblePatterns) {
      code = code.replace(pattern, '')
    }

    // If code still doesn't start with import/export/type/const/function, try to find where it starts
    if (!/^(?:import|export|type|interface|const|let|var|function|class|\/\/|\/\*)/.test(code)) {
      const codeStart = code.search(/(?:^|\n)(import|export|type|interface|const|let|function|class)\s/)
      if (codeStart > 0) {
        code = code.slice(codeStart).trim()
      }
    }

    return code
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

  /**
   * FIX 2: Format extracted identifiers for prompt context
   */
  private formatIdentifierContext(identifiers: {
    functions: string[]
    variables: string[]
    imports: string[]
  }): string {
    const lines: string[] = []

    if (identifiers.functions.length > 0) {
      lines.push(`Functions available: ${identifiers.functions.join(', ')}`)
    }

    if (identifiers.variables.length > 0) {
      lines.push(`Variables defined: ${identifiers.variables.join(', ')}`)
    }

    if (identifiers.imports.length > 0) {
      lines.push(`Imports available: ${identifiers.imports.join(', ')}`)
    }

    if (lines.length === 0) {
      return '(No identifiers extracted - define your own)'
    }

    return lines.join('\n')
  }
}
