// LLM Adapter - Controlled AI inference

import Anthropic from '@anthropic-ai/sdk'
import { Evidence } from './types'

export class LLMAdapter {
  private client: Anthropic | null = null

  constructor(apiKey?: string) {
    if (apiKey) {
      this.client = new Anthropic({ apiKey })
    }
  }

  async decompose(input: string): Promise<string[]> {
    if (!this.client) {
      throw new Error('LLM adapter not configured (no API key)')
    }

    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      temperature: 0.3,  // Low temp for consistency
      messages: [{
        role: 'user',
        content: `Break this task into 5-8 concrete, actionable subtasks.

Task: "${input}"

Requirements:
- Each subtask should be specific and implementable
- Order subtasks logically (dependencies first)
- Return ONLY valid JSON array format
- No markdown, no explanations

Format: ["subtask 1", "subtask 2", "subtask 3", ...]`
      }]
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''

    // Try to extract JSON array - be flexible with whitespace
    let parsed: string[]
    try {
      // First try: direct parse
      parsed = JSON.parse(text.trim())
    } catch {
      // Second try: extract array from text
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) {
        throw new Error(`LLM did not return valid JSON array. Got: ${text.substring(0, 100)}`)
      }
      parsed = JSON.parse(match[0])
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('LLM returned empty or invalid array')
    }

    return parsed.filter(item => typeof item === 'string' && item.trim().length > 0)
  }

  async generateCode(task: string, context?: string): Promise<string> {
    if (!this.client) {
      throw new Error('LLM adapter not configured (no API key)')
    }

    const prompt = context
      ? `Context:\n${context}\n\nTask: ${task}\n\nGenerate code:`
      : `Task: ${task}\n\nGenerate code:`

    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })

    return message.content[0].type === 'text' ? message.content[0].text : ''
  }
}
