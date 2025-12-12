"use strict";
// LLM Adapter - Controlled AI inference
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMAdapter = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
class LLMAdapter {
    client = null;
    constructor(apiKey) {
        if (apiKey) {
            this.client = new sdk_1.default({ apiKey });
        }
    }
    async decompose(input) {
        if (!this.client) {
            throw new Error('LLM adapter not configured (no API key)');
        }
        const message = await this.client.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 2048,
            temperature: 0.3, // Low temp for consistency
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
        });
        const text = message.content[0].type === 'text' ? message.content[0].text : '';
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
                throw new Error(`LLM did not return valid JSON array. Got: ${text.substring(0, 100)}`);
            }
            parsed = JSON.parse(match[0]);
        }
        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error('LLM returned empty or invalid array');
        }
        return parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
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
