// Ollama Local LLM Adapter - Full offline-first operation
// NON-AUTHORITATIVE - See docs/NAMING_AND_SCOPE.md
// Per AXIOM 2: LLMs propose only, never decide or execute
// This adapter generates candidates; authority resides in gates
//
// From ROADMAP Step 8:
// - Configure Ollama adapter for local model execution
// - Test with: codellama, deepseek-coder, etc.
// - Ensure all gates work with local LLM output
// - No external API dependency for core operation

import { Result, Ok, Err } from '../core/result'
import { sanitizeInput } from '../core/sanitize'
import type { LLMProvider } from '../llm/types'

/**
 * Ollama API response types
 */
type OllamaGenerateResponse = {
  model: string
  created_at: string
  response: string
  done: boolean
  context?: number[]
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  eval_count?: number
  eval_duration?: number
}

type OllamaListResponse = {
  models: Array<{
    name: string
    modified_at: string
    size: number
    digest: string
  }>
}

/**
 * Ollama adapter configuration
 */
export type OllamaConfig = {
  model: string
  baseUrl: string
  timeout: number
  temperature: number
  numPredict: number
}

const DEFAULT_CONFIG: OllamaConfig = {
  model: 'codellama:13b',
  baseUrl: 'http://localhost:11434',
  timeout: 120000,  // 2 minutes for code generation
  temperature: 0.1, // Low temperature for deterministic code
  numPredict: 4096  // Max tokens
}

/**
 * Ollama Local LLM Adapter
 * Implements LLMProvider interface for use with ConstrainedLLM
 */
export class OllamaAdapter implements LLMProvider {
  private config: OllamaConfig

  constructor(config: Partial<OllamaConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Generate code using Ollama API
   * Implements LLMProvider interface
   */
  async generateCode(prompt: string): Promise<string> {
    const result = await this.generate(prompt)
    if (!result.ok) {
      throw result.error
    }
    return result.value
  }

  /**
   * Generate text using Ollama HTTP API
   */
  async generate(prompt: string): Promise<Result<string, Error>> {
    try {
      // Sanitize input
      const sanitized = sanitizeInput(prompt)
      if (sanitized.warnings.length > 0) {
        console.warn('[Ollama] Sanitization warnings:', sanitized.warnings)
      }

      // Build request body
      const body = {
        model: this.config.model,
        prompt: sanitized.sanitized,
        stream: false,
        options: {
          temperature: this.config.temperature,
          num_predict: this.config.numPredict
        }
      }

      // Make HTTP request to Ollama API
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

      try {
        const response = await fetch(`${this.config.baseUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          return Err(new Error(`Ollama API error: ${response.status} - ${errorText}`))
        }

        const data = await response.json() as OllamaGenerateResponse

        if (!data.response) {
          return Err(new Error('Ollama returned empty response'))
        }

        return Ok(data.response)

      } catch (error) {
        clearTimeout(timeoutId)

        if (error instanceof Error && error.name === 'AbortError') {
          return Err(new Error(`Ollama timeout after ${this.config.timeout}ms`))
        }

        throw error
      }

    } catch (error) {
      // Check if Ollama is not running
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        return Err(new Error('Ollama is not running. Start with: ollama serve'))
      }

      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Decompose task into subtasks
   * Compatible with LLMProvider interface
   */
  async decompose(input: string): Promise<Result<string[], Error>> {
    const prompt = `Break this task into 5-8 concrete subtasks. Return ONLY a JSON array of strings, no other text.

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

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<Result<boolean, Error>> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      try {
        const response = await fetch(`${this.config.baseUrl}/api/tags`, {
          method: 'GET',
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        return Ok(response.ok)

      } catch (error) {
        clearTimeout(timeoutId)
        return Ok(false)
      }

    } catch (error) {
      return Ok(false)
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<Result<string[], Error>> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET'
      })

      if (!response.ok) {
        return Err(new Error(`Failed to list models: ${response.status}`))
      }

      const data = await response.json() as OllamaListResponse

      return Ok(data.models.map(m => m.name))

    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        return Err(new Error('Ollama is not running. Start with: ollama serve'))
      }
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Check if a specific model is available
   */
  async hasModel(modelName: string): Promise<Result<boolean, Error>> {
    const models = await this.listModels()
    if (!models.ok) return Err(models.error)

    const hasIt = models.value.some(m =>
      m === modelName || m.startsWith(modelName + ':')
    )

    return Ok(hasIt)
  }

  /**
   * Get current model name
   */
  getModel(): string {
    return this.config.model
  }

  /**
   * Set model
   */
  setModel(model: string): void {
    this.config.model = model
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.config.baseUrl
  }
}

/**
 * Create Ollama adapter with recommended code models
 */
export function createCodeLlamaAdapter(size: '7b' | '13b' | '34b' = '13b'): OllamaAdapter {
  return new OllamaAdapter({
    model: `codellama:${size}`,
    temperature: 0.1
  })
}

/**
 * Create Ollama adapter for DeepSeek Coder
 */
export function createDeepSeekCoderAdapter(size: '1.3b' | '6.7b' | '33b' = '6.7b'): OllamaAdapter {
  return new OllamaAdapter({
    model: `deepseek-coder:${size}`,
    temperature: 0.1
  })
}

/**
 * Create Ollama adapter for Qwen2.5 Coder
 */
export function createQwenCoderAdapter(size: '1.5b' | '7b' | '14b' | '32b' = '7b'): OllamaAdapter {
  return new OllamaAdapter({
    model: `qwen2.5-coder:${size}`,
    temperature: 0.1
  })
}

/**
 * Detect best available code model
 */
export async function detectBestCodeModel(adapter: OllamaAdapter): Promise<Result<string, Error>> {
  const models = await adapter.listModels()
  if (!models.ok) return Err(models.error)

  // Preference order for code generation
  const preferredModels = [
    'qwen2.5-coder:32b',
    'qwen2.5-coder:14b',
    'qwen2.5-coder:7b',
    'deepseek-coder:33b',
    'deepseek-coder:6.7b',
    'codellama:34b',
    'codellama:13b',
    'codellama:7b',
    'llama3.1:70b',
    'llama3.1:8b',
    'mistral:7b'
  ]

  for (const preferred of preferredModels) {
    const [name, size] = preferred.split(':')
    const found = models.value.find(m =>
      m === preferred || m.startsWith(`${name}:${size}`)
    )
    if (found) {
      return Ok(found)
    }
  }

  // Return first available model
  if (models.value.length > 0) {
    return Ok(models.value[0])
  }

  return Err(new Error('No models available. Pull a model with: ollama pull codellama:13b'))
}
