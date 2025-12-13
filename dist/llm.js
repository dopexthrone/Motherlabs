"use strict";
// LLM Adapter - Controlled AI inference
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMAdapter = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const sanitize_1 = require("./core/sanitize");
const result_1 = require("./core/result");
const LLM_TIMEOUT_MS = 30_000; // 30 second timeout
class LLMAdapter {
    client = null;
    constructor(apiKey) {
        if (apiKey) {
            this.client = new sdk_1.default({ apiKey });
        }
    }
    async decompose(input) {
        if (!this.client) {
            return (0, result_1.Err)(new Error('LLM adapter not configured (no API key)'));
        }
        // FIXED: Sanitize input to prevent injection/DoS
        try {
            const sanitizeResult = (0, sanitize_1.sanitizeInput)(input);
            (0, sanitize_1.validateSanitized)(sanitizeResult);
            if (sanitizeResult.warnings.length > 0) {
                console.warn('[LLM] Input sanitization warnings:', sanitizeResult.warnings);
            }
            // FIXED: Add timeout to prevent hanging
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT_MS);
            });
            const message = await Promise.race([
                this.client.messages.create({
                    model: 'claude-sonnet-4-5-20250929',
                    max_tokens: 2048,
                    temperature: 0.3, // Low temp for consistency
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
            const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
            // Try to extract JSON array - be flexible with whitespace
            let parsed;
            try {
                // First try: direct parse
                parsed = JSON.parse(text.trim());
            }
            catch {
                // Second try: extract array from text
                const match = text.match(/\[[\s\S]*\]/);
                if (!match) {
                    return (0, result_1.Err)(new Error(`LLM did not return valid JSON array. Got: ${text.substring(0, 100)}`));
                }
                try {
                    parsed = JSON.parse(match[0]);
                }
                catch (parseErr) {
                    return (0, result_1.Err)(new Error('Failed to parse JSON from LLM response'));
                }
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
    async generateCode(task, context) {
        if (!this.client) {
            throw new Error('LLM adapter not configured (no API key)');
        }
        const prompt = context
            ? `Context:\n${context}\n\nTask: ${task}\n\nGenerate code:`
            : `Task: ${task}\n\nGenerate code:`;
        const message = await this.client.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4096,
            temperature: 0.3,
            messages: [{
                    role: 'user',
                    content: prompt
                }]
        });
        return message.content[0].type === 'text' ? message.content[0].text : '';
    }
}
exports.LLMAdapter = LLMAdapter;
