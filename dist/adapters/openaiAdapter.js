"use strict";
// OpenAI Adapter - Controlled AI inference via OpenAI models
// NON-AUTHORITATIVE - See docs/NAMING_AND_SCOPE.md
// Per AXIOM 2: LLMs propose only, never decide or execute
// This adapter generates candidates; authority resides in gates
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIAdapter = void 0;
const openai_1 = __importDefault(require("openai"));
const sanitize_1 = require("../core/sanitize");
const result_1 = require("../core/result");
const LLM_TIMEOUT_MS = 60_000; // 60 second timeout
class OpenAIAdapter {
    client = null;
    model;
    constructor(apiKey, model = 'gpt-4o') {
        if (apiKey) {
            this.client = new openai_1.default({ apiKey });
        }
        this.model = model;
    }
    /**
     * Check if adapter is configured
     */
    isConfigured() {
        return this.client !== null;
    }
    /**
     * Decompose task into subtasks
     */
    async decompose(input) {
        if (!this.client) {
            return (0, result_1.Err)(new Error('OpenAI adapter not configured (no API key)'));
        }
        try {
            const sanitizeResult = (0, sanitize_1.sanitizeInput)(input);
            (0, sanitize_1.validateSanitized)(sanitizeResult);
            if (sanitizeResult.warnings.length > 0) {
                console.warn('[OpenAI] Input sanitization warnings:', sanitizeResult.warnings);
            }
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('OpenAI timeout')), LLM_TIMEOUT_MS);
            });
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
            ]);
            const text = completion.choices[0]?.message?.content || '';
            let parsed;
            try {
                parsed = JSON.parse(text.trim());
            }
            catch {
                const match = text.match(/\[[\s\S]*\]/);
                if (!match) {
                    return (0, result_1.Err)(new Error(`OpenAI did not return valid JSON array. Got: ${text.substring(0, 100)}`));
                }
                try {
                    parsed = JSON.parse(match[0]);
                }
                catch {
                    return (0, result_1.Err)(new Error('Failed to parse JSON from OpenAI response'));
                }
            }
            if (!Array.isArray(parsed) || parsed.length === 0) {
                return (0, result_1.Err)(new Error('OpenAI returned empty or invalid array'));
            }
            const filtered = parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
            return (0, result_1.Ok)(filtered);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Generate code for a given task
     */
    async generateCode(prompt) {
        if (!this.client) {
            throw new Error('OpenAI adapter not configured (no API key)');
        }
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('OpenAI timeout')), LLM_TIMEOUT_MS);
        });
        // Handle different model parameter requirements
        const isReasoningModel = this.model.startsWith('o1') || this.model.startsWith('o3') || this.model.startsWith('o4');
        const params = {
            model: this.model,
            messages: [{
                    role: 'user',
                    content: prompt
                }]
        };
        // Reasoning models use max_completion_tokens, others use max_tokens
        if (isReasoningModel) {
            params.max_completion_tokens = 4096;
        }
        else {
            params.max_tokens = 4096;
            params.temperature = 0.3;
        }
        const completion = await Promise.race([
            this.client.chat.completions.create(params),
            timeoutPromise
        ]);
        return completion.choices[0]?.message?.content || '';
    }
}
exports.OpenAIAdapter = OpenAIAdapter;
