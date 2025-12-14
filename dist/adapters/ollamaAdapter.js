"use strict";
// Ollama Local LLM Adapter - For battle-testing without API costs
// NON-AUTHORITATIVE - See docs/NAMING_AND_SCOPE.md
// Per AXIOM 2: LLMs propose only, never decide or execute
// This adapter generates candidates; authority resides in gates
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaAdapter = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const result_1 = require("../core/result");
const sanitize_1 = require("../core/sanitize");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class OllamaAdapter {
    model;
    timeout;
    constructor(model = 'llama3.1:8b', timeout = 30000) {
        this.model = model;
        this.timeout = timeout;
    }
    /**
     * Generate with local model (for testing)
     */
    async generate(prompt) {
        try {
            // Sanitize input (same as production)
            const sanitized = (0, sanitize_1.sanitizeInput)(prompt);
            if (sanitized.warnings.length > 0) {
                console.warn('[Ollama] Sanitization warnings:', sanitized.warnings);
            }
            // Call ollama CLI
            const command = `ollama run ${this.model} "${sanitized.sanitized.replace(/"/g, '\\"')}"`;
            const { stdout, stderr } = await Promise.race([
                execAsync(command),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Ollama timeout')), this.timeout))
            ]);
            if (stderr) {
                console.warn('[Ollama] stderr:', stderr);
            }
            return (0, result_1.Ok)(stdout.trim());
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Decompose task (compatible with LLMAdapter interface)
     */
    async decompose(input) {
        const prompt = `Break this task into 5-8 concrete subtasks. Return ONLY a JSON array of strings.

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
}
exports.OllamaAdapter = OllamaAdapter;
