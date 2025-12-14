"use strict";
// Anthropic Adapter - Controlled AI inference via Claude models
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicAdapter = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const sanitize_1 = require("../core/sanitize");
const result_1 = require("../core/result");
const LLM_TIMEOUT_MS = 60_000; // 60 second timeout
class AnthropicAdapter {
    client = null;
    model;
    constructor(apiKey, model = 'claude-sonnet-4-5-20250929') {
        if (apiKey) {
            this.client = new sdk_1.default({ apiKey });
        }
        this.model = model;
    }
    /**
     * Generate code from a prompt
     * Returns raw code string (handles markdown extraction internally)
     */
    async generateCode(prompt) {
        if (!this.client) {
            throw new Error('Anthropic adapter not configured (no API key)');
        }
        const response = await this.withTimeout(this.client.messages.create({
            model: this.model,
            max_tokens: 4096,
            temperature: 0.3, // Low temp for consistent code generation
            messages: [{
                    role: 'user',
                    content: prompt
                }]
        }), LLM_TIMEOUT_MS);
        const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
        return text;
    }
    /**
     * Decompose a task into subtasks
     */
    async decompose(input) {
        if (!this.client) {
            return (0, result_1.Err)(new Error('Anthropic adapter not configured (no API key)'));
        }
        try {
            const sanitizeResult = (0, sanitize_1.sanitizeInput)(input);
            (0, sanitize_1.validateSanitized)(sanitizeResult);
            const response = await this.withTimeout(this.client.messages.create({
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
            }), LLM_TIMEOUT_MS);
            const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
            // Parse JSON array from response
            let parsed;
            try {
                parsed = JSON.parse(text.trim());
            }
            catch {
                const match = text.match(/\[[\s\S]*\]/);
                if (!match) {
                    return (0, result_1.Err)(new Error(`LLM did not return valid JSON array. Got: ${text.substring(0, 100)}`));
                }
                parsed = JSON.parse(match[0]);
            }
            if (!Array.isArray(parsed) || parsed.length === 0) {
                return (0, result_1.Err)(new Error('LLM returned empty or invalid array'));
            }
            const filtered = parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
            return (0, result_1.Ok)(filtered);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Add timeout to promise
     */
    withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Anthropic API timeout')), ms))
        ]);
    }
}
exports.AnthropicAdapter = AnthropicAdapter;
