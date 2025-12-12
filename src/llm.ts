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
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      temperature: 0.3,  // Low temp for consistency
      messages: [{
        role: 'user',
        content: `Break this task into 3-7 concrete, actionable subtasks. Return ONLY a JSON array of strings, no other text:

"${input}"

Example format: ["subtask 1", "subtask 2", "subtask 3"]`
      }]
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) {
      throw new Error('LLM did not return valid JSON array')
    }

    return JSON.parse(match[0])
  }

  async generateCode(task: string, context?: string): Promise<string> {
    if (!this.client) {
      throw new Error('LLM adapter not configured (no API key)')
    }

    const prompt = context
      ? `Context:\n${context}\n\nTask: ${task}\n\nGenerate code:`
      : `Task: ${task}\n\nGenerate code:`

    const message = await this.client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
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
