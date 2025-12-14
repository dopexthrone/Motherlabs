"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaAdapter = void 0;
exports.createCodeLlamaAdapter = createCodeLlamaAdapter;
exports.createDeepSeekCoderAdapter = createDeepSeekCoderAdapter;
exports.createQwenCoderAdapter = createQwenCoderAdapter;
exports.detectBestCodeModel = detectBestCodeModel;
const result_1 = require("../core/result");
const sanitize_1 = require("../core/sanitize");
const DEFAULT_CONFIG = {
    model: 'codellama:13b',
    baseUrl: 'http://localhost:11434',
    timeout: 120000, // 2 minutes for code generation
    temperature: 0.1, // Low temperature for deterministic code
    numPredict: 4096 // Max tokens
};
/**
 * Ollama Local LLM Adapter
 * Implements LLMProvider interface for use with ConstrainedLLM
 */
class OllamaAdapter {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Generate code using Ollama API
     * Implements LLMProvider interface
     */
    async generateCode(prompt) {
        const result = await this.generate(prompt);
        if (!result.ok) {
            throw result.error;
        }
        return result.value;
    }
    /**
     * Generate text using Ollama HTTP API
     */
    async generate(prompt) {
        try {
            // Sanitize input
            const sanitized = (0, sanitize_1.sanitizeInput)(prompt);
            if (sanitized.warnings.length > 0) {
                console.warn('[Ollama] Sanitization warnings:', sanitized.warnings);
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
            };
            // Make HTTP request to Ollama API
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
            try {
                const response = await fetch(`${this.config.baseUrl}/api/generate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const errorText = await response.text();
                    return (0, result_1.Err)(new Error(`Ollama API error: ${response.status} - ${errorText}`));
                }
                const data = await response.json();
                if (!data.response) {
                    return (0, result_1.Err)(new Error('Ollama returned empty response'));
                }
                return (0, result_1.Ok)(data.response);
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                    return (0, result_1.Err)(new Error(`Ollama timeout after ${this.config.timeout}ms`));
                }
                throw error;
            }
        }
        catch (error) {
            // Check if Ollama is not running
            if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
                return (0, result_1.Err)(new Error('Ollama is not running. Start with: ollama serve'));
            }
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Decompose task into subtasks
     * Compatible with LLMProvider interface
     */
    async decompose(input) {
        const prompt = `Break this task into 5-8 concrete subtasks. Return ONLY a JSON array of strings, no other text.

Task: "${input}"

Format: ["subtask 1", "subtask 2", ...]`;
        const result = await this.generate(prompt);
        if (!result.ok) {
            return (0, result_1.Err)(result.error);
        }
        // Parse JSON from response
        try {
            const text = result.value;
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) {
                return (0, result_1.Err)(new Error('No JSON array found in response'));
            }
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed)) {
                return (0, result_1.Err)(new Error('Response is not an array'));
            }
            const filtered = parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
            if (filtered.length === 0) {
                return (0, result_1.Err)(new Error('No valid subtasks extracted'));
            }
            return (0, result_1.Ok)(filtered);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error('JSON parse failed'));
        }
    }
    /**
     * Check if Ollama is available
     */
    async isAvailable() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetch(`${this.config.baseUrl}/api/tags`, {
                    method: 'GET',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                return (0, result_1.Ok)(response.ok);
            }
            catch (error) {
                clearTimeout(timeoutId);
                return (0, result_1.Ok)(false);
            }
        }
        catch (error) {
            return (0, result_1.Ok)(false);
        }
    }
    /**
     * List available models
     */
    async listModels() {
        try {
            const response = await fetch(`${this.config.baseUrl}/api/tags`, {
                method: 'GET'
            });
            if (!response.ok) {
                return (0, result_1.Err)(new Error(`Failed to list models: ${response.status}`));
            }
            const data = await response.json();
            return (0, result_1.Ok)(data.models.map(m => m.name));
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
                return (0, result_1.Err)(new Error('Ollama is not running. Start with: ollama serve'));
            }
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Check if a specific model is available
     */
    async hasModel(modelName) {
        const models = await this.listModels();
        if (!models.ok)
            return (0, result_1.Err)(models.error);
        const hasIt = models.value.some(m => m === modelName || m.startsWith(modelName + ':'));
        return (0, result_1.Ok)(hasIt);
    }
    /**
     * Get current model name
     */
    getModel() {
        return this.config.model;
    }
    /**
     * Set model
     */
    setModel(model) {
        this.config.model = model;
    }
    /**
     * Get base URL
     */
    getBaseUrl() {
        return this.config.baseUrl;
    }
}
exports.OllamaAdapter = OllamaAdapter;
/**
 * Create Ollama adapter with recommended code models
 */
function createCodeLlamaAdapter(size = '13b') {
    return new OllamaAdapter({
        model: `codellama:${size}`,
        temperature: 0.1
    });
}
/**
 * Create Ollama adapter for DeepSeek Coder
 */
function createDeepSeekCoderAdapter(size = '6.7b') {
    return new OllamaAdapter({
        model: `deepseek-coder:${size}`,
        temperature: 0.1
    });
}
/**
 * Create Ollama adapter for Qwen2.5 Coder
 */
function createQwenCoderAdapter(size = '7b') {
    return new OllamaAdapter({
        model: `qwen2.5-coder:${size}`,
        temperature: 0.1
    });
}
/**
 * Detect best available code model
 */
async function detectBestCodeModel(adapter) {
    const models = await adapter.listModels();
    if (!models.ok)
        return (0, result_1.Err)(models.error);
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
    ];
    for (const preferred of preferredModels) {
        const [name, size] = preferred.split(':');
        const found = models.value.find(m => m === preferred || m.startsWith(`${name}:${size}`));
        if (found) {
            return (0, result_1.Ok)(found);
        }
    }
    // Return first available model
    if (models.value.length > 0) {
        return (0, result_1.Ok)(models.value[0]);
    }
    return (0, result_1.Err)(new Error('No models available. Pull a model with: ollama pull codellama:13b'));
}
