// LLM Types - Common interface for all LLM providers

import { Result } from '../core/result'

/**
 * Common interface for LLM adapters
 * Both Anthropic and OpenAI adapters implement this
 */
export type LLMProvider = {
  generateCode(prompt: string): Promise<string>
  decompose?(input: string): Promise<Result<string[], Error>>
}

export type LLMProviderType = 'anthropic' | 'openai' | 'ollama'
