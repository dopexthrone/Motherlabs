// OpenAI Adapter - Controlled AI inference via OpenAI models

import OpenAI from 'openai'
import { sanitizeInput, validateSanitized } from '../core/sanitize'
import { Result, Ok, Err } from '../core/result'

const LLM_TIMEOUT_MS = 60_000  // 60 second timeout

export type OpenAIModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-4.1'
  | 'gpt-4.1-mini'
  | 'gpt-4.1-nano'
  | 'o1'
  | 'o3'
  | 'o3-mini'
  | 'o3-pro'
  | 'o4-mini'
  | 'gpt-5'
  | 'gpt-5-codex'
  | 'gpt-5-mini'
  | 'gpt-5-pro'
  | 'gpt-5.1'
  | 'gpt-5.1-codex'
  | 'gpt-5.1-codex-max'
  | 'gpt-5.1-codex-mini'
  | 'gpt-5.2'
  | 'gpt-5.2-pro'
  | 'gpt-5.2-pro-2025-12-11'

export class OpenAIAdapter {
  private client: OpenAI | null = null
  private model: OpenAIModel

  constructor(apiKey?: string, model: OpenAIModel = 'gpt-4o') {
    if (apiKey) {
      this.client = new OpenAI({ apiKey })
    }
    this.model = model
  }

  /**
   * Check if adapter is configured
   */
  isConfigured(): boolean {
    return this.client !== null
  }

  /**
   * Decompose task into subtasks
   */
  async decompose(input: string): Promise<Result<string[], Error>> {
    if (!this.client) {
      return Err(new Error('OpenAI adapter not configured (no API key)'))
    }

    try {
      const sanitizeResult = sanitizeInput(input)
      validateSanitized(sanitizeResult)

      if (sanitizeResult.warnings.length > 0) {
        console.warn('[OpenAI] Input sanitization warnings:', sanitizeResult.warnings)
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('OpenAI timeout')), LLM_TIMEOUT_MS)
      })

      const completion = await Promise.race([
        this.client.chat.completions.create({
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
        timeoutPromise
      ])

      const text = completion.choices[0]?.message?.content || ''

      let parsed: string[]
      try {
        parsed = JSON.parse(text.trim())
      } catch {
        const match = text.match(/\[[\s\S]*\]/)
        if (!match) {
          return Err(new Error(`OpenAI did not return valid JSON array. Got: ${text.substring(0, 100)}`))
        }
        try {
          parsed = JSON.parse(match[0])
        } catch {
          return Err(new Error('Failed to parse JSON from OpenAI response'))
        }
      }

      if (!Array.isArray(parsed) || parsed.length === 0) {
        return Err(new Error('OpenAI returned empty or invalid array'))
      }

      const filtered = parsed.filter(item => typeof item === 'string' && item.trim().length > 0)
      return Ok(filtered)

    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Generate code for a given task
   */
  async generateCode(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI adapter not configured (no API key)')
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI timeout')), LLM_TIMEOUT_MS)
    })

    // Handle different model parameter requirements
    const isReasoningModel = this.model.startsWith('o1') || this.model.startsWith('o3') || this.model.startsWith('o4')

    const params: Parameters<typeof this.client.chat.completions.create>[0] = {
      model: this.model,
      messages: [{
        role: 'user',
        content: prompt
      }]
    }

    // Reasoning models use max_completion_tokens, others use max_tokens
    if (isReasoningModel) {
      params.max_completion_tokens = 4096
    } else {
      params.max_tokens = 4096
      params.temperature = 0.3
    }

    const completion = await Promise.race([
      this.client.chat.completions.create(params),
      timeoutPromise
    ]) as OpenAI.Chat.Completions.ChatCompletion

    return completion.choices[0]?.message?.content || ''
  }
}
