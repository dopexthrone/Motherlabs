// Anthropic Adapter - Controlled AI inference via Claude models

import Anthropic from '@anthropic-ai/sdk'
import { sanitizeInput, validateSanitized } from '../core/sanitize'
import { Result, Ok, Err } from '../core/result'

const LLM_TIMEOUT_MS = 60_000  // 60 second timeout

export type AnthropicModel =
  | 'claude-opus-4-5-20251101'      // Most capable, best for complex reasoning
  | 'claude-sonnet-4-5-20250929'    // Balanced performance/cost
  | 'claude-3-5-sonnet-20241022'    // Previous generation, stable
  | 'claude-3-5-haiku-20241022'     // Fast, cost-effective

export class AnthropicAdapter {
  private client: Anthropic | null = null
  private model: AnthropicModel

  constructor(apiKey?: string, model: AnthropicModel = 'claude-sonnet-4-5-20250929') {
    if (apiKey) {
      this.client = new Anthropic({ apiKey })
    }
    this.model = model
  }

  /**
   * Generate code from a prompt
   * Returns raw code string (handles markdown extraction internally)
   */
  async generateCode(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('Anthropic adapter not configured (no API key)')
    }

    const response = await this.withTimeout(
      this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        temperature: 0.3,  // Low temp for consistent code generation
        messages: [{
          role: 'user',
          content: prompt
        }]
      }),
      LLM_TIMEOUT_MS
    )

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    return text
  }

  /**
   * Decompose a task into subtasks
   */
  async decompose(input: string): Promise<Result<string[], Error>> {
    if (!this.client) {
      return Err(new Error('Anthropic adapter not configured (no API key)'))
    }

    try {
      const sanitizeResult = sanitizeInput(input)
      validateSanitized(sanitizeResult)

      const response = await this.withTimeout(
        this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          temperature: 0.3,
          messages: [{
            role: 'user',
            content: `Break this task into 5-8 concrete, actionable subtasks.

Task: "${sanitizeResult.sanitized}"

Requirements:
- Each subtask should be specific and implementable
- Order subtasks logically (dependencies first)
- Return ONLY valid JSON array format
- No markdown, no explanations

Format: ["subtask 1", "subtask 2", "subtask 3", ...]`
          }]
        }),
        LLM_TIMEOUT_MS
      )

      const text = response.content[0]?.type === 'text' ? response.content[0].text : ''

      // Parse JSON array from response
      let parsed: string[]
      try {
        parsed = JSON.parse(text.trim())
      } catch {
        const match = text.match(/\[[\s\S]*\]/)
        if (!match) {
          return Err(new Error(`LLM did not return valid JSON array. Got: ${text.substring(0, 100)}`))
        }
        parsed = JSON.parse(match[0])
      }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        return Err(new Error('LLM returned empty or invalid array'))
      }

      const filtered = parsed.filter(item => typeof item === 'string' && item.trim().length > 0)
      return Ok(filtered)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Add timeout to promise
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Anthropic API timeout')), ms)
      )
    ])
  }
}
