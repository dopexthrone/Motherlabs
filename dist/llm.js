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
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1024,
            temperature: 0.3, // Low temp for consistency
            messages: [{
                    role: 'user',
                    content: `Break this task into 3-7 concrete, actionable subtasks. Return ONLY a JSON array of strings, no other text:

"${input}"

Example format: ["subtask 1", "subtask 2", "subtask 3"]`
                }]
        });
        const text = message.content[0].type === 'text' ? message.content[0].text : '';
        // Extract JSON array from response
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
            throw new Error('LLM did not return valid JSON array');
        }
        return JSON.parse(match[0]);
    }
    async generateCode(task, context) {
        if (!this.client) {
            throw new Error('LLM adapter not configured (no API key)');
        }
        const prompt = context
            ? `Context:\n${context}\n\nTask: ${task}\n\nGenerate code:`
            : `Task: ${task}\n\nGenerate code:`;
        const message = await this.client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
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
