// Ollama Local LLM Adapter - For battle-testing without API costs
// NON-AUTHORITATIVE - See docs/NAMING_AND_SCOPE.md
// Per AXIOM 2: LLMs propose only, never decide or execute
// This adapter generates candidates; authority resides in gates

import { exec } from 'child_process'
import { promisify } from 'util'
import { Result, Ok, Err } from '../core/result'
import { sanitizeInput } from '../core/sanitize'

const execAsync = promisify(exec)

export class OllamaAdapter {
  private model: string
  private timeout: number

  constructor(model: string = 'llama3.1:8b', timeout: number = 30000) {
    this.model = model
    this.timeout = timeout
  }

  /**
   * Generate with local model (for testing)
   */
  async generate(prompt: string): Promise<Result<string, Error>> {
    try {
      // Sanitize input (same as production)
      const sanitized = sanitizeInput(prompt)
      if (sanitized.warnings.length > 0) {
        console.warn('[Ollama] Sanitization warnings:', sanitized.warnings)
      }

      // Call ollama CLI
      const command = `ollama run ${this.model} "${sanitized.sanitized.replace(/"/g, '\\"')}"`

      const { stdout, stderr } = await Promise.race([
        execAsync(command),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Ollama timeout')), this.timeout)
        )
      ])

      if (stderr) {
        console.warn('[Ollama] stderr:', stderr)
      }

      return Ok(stdout.trim())

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Decompose task (compatible with LLMAdapter interface)
   */
  async decompose(input: string): Promise<Result<string[], Error>> {
    const prompt = `Break this task into 5-8 concrete subtasks. Return ONLY a JSON array of strings.

Task: "${input}"

Format: ["subtask 1", "subtask 2", ...]`

    const result = await this.generate(prompt)

    if (!result.ok) {
      return Err(result.error)
    }

    // Parse JSON from response
    try {
      const text = result.value
      const match = text.match(/\[[\s\S]*\]/)

      if (!match) {
        return Err(new Error('No JSON array found in response'))
      }

      const parsed = JSON.parse(match[0])

      if (!Array.isArray(parsed)) {
        return Err(new Error('Response is not an array'))
      }

      const filtered = parsed.filter(item => typeof item === 'string' && item.trim().length > 0)

      if (filtered.length === 0) {
        return Err(new Error('No valid subtasks extracted'))
      }

      return Ok(filtered)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error('JSON parse failed'))
    }
  }
}
