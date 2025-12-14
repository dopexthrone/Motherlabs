"use strict";
// Constrained LLM - All code generation passes through 6 gates
// NO CODE ESCAPES WITHOUT VERIFICATION
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConstrainedLLM = void 0;
const sixGates_1 = require("../validation/sixGates");
const result_1 = require("../core/result");
const jsonlLedger_1 = require("../persistence/jsonlLedger");
const ids_1 = require("../core/ids");
const sanitize_1 = require("../core/sanitize");
const MAX_ATTEMPTS = 3;
const LLM_TIMEOUT_MS = 60_000;
class ConstrainedLLM {
    llm;
    validator;
    ledger;
    constructor(llm, ledgerPath = 'evidence/llm-generations.jsonl') {
        this.llm = llm;
        this.validator = new sixGates_1.SixGateValidator();
        this.ledger = new jsonlLedger_1.JSONLLedger(ledgerPath);
    }
    /**
     * Generate code that MUST pass all 6 gates
     * Retries up to MAX_ATTEMPTS times
     * Returns Err if all attempts fail gates
     */
    async generateCode(request) {
        const { issue, filepath, existingCode, context } = request;
        // Sanitize inputs
        const sanitizedIssue = (0, sanitize_1.sanitizeInput)(issue.message);
        try {
            (0, sanitize_1.validateSanitized)(sanitizedIssue);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            // Log attempt
            await this.ledger.append('generation_attempt', {
                attempt,
                issue: issue.type,
                filepath,
                timestamp: ids_1.globalTimeProvider.now()
            });
            // Generate code via LLM
            const prompt = this.buildPrompt(issue, filepath, existingCode, attempt);
            let rawCode;
            try {
                rawCode = await this.withTimeout(this.llm.generateCode(prompt), LLM_TIMEOUT_MS);
            }
            catch (error) {
                await this.logRejection('LLM_ERROR', attempt, error instanceof Error ? error.message : String(error));
                continue;
            }
            // Extract code from response (handle markdown blocks)
            const code = this.extractCode(rawCode);
            if (!code || code.trim().length === 0) {
                await this.logRejection('EMPTY_CODE', attempt, 'LLM returned empty code');
                continue;
            }
            // CRITICAL: Pass through 6 gates
            const validation = await this.validator.validate(code, context);
            if (!validation.ok) {
                await this.logRejection('VALIDATION_ERROR', attempt, validation.error.message);
                continue;
            }
            if (!validation.value.valid) {
                await this.logRejection(validation.value.rejectedAt || 'GATE_FAILED', attempt, `Failed gates: ${validation.value.gateResults.filter(g => !g.passed).map(g => g.gateName).join(', ')}`);
                continue;
            }
            // ALL GATES PASSED - Code is verified
            const evidenceId = await this.logAcceptance(code, validation.value, attempt);
            return (0, result_1.Ok)({
                code,
                validation: validation.value,
                attempts: attempt,
                evidenceId
            });
        }
        // All attempts failed
        await this.ledger.append('generation_failed', {
            issue: issue.type,
            filepath,
            maxAttempts: MAX_ATTEMPTS,
            timestamp: ids_1.globalTimeProvider.now()
        });
        return (0, result_1.Err)(new Error(`Code generation failed after ${MAX_ATTEMPTS} attempts - all failed gates`));
    }
    /**
     * Build prompt for specific issue type
     */
    buildPrompt(issue, filepath, existingCode, attempt) {
        // DETERMINISM-EXEMPT: Prompt strings reference forbidden patterns to instruct LLM what NOT to use
        const basePrompt = `You are generating TypeScript code for Motherlabs Runtime.

STRICT REQUIREMENTS:
- Must export at least one declaration (function, const, class, type, or interface)
- Must compile with strict TypeScript (no implicit any)
- Must use Result<T, Error> pattern for error handling
- Must NOT use non-deterministic time or random functions directly
- Must be clear and unambiguous (low entropy)
- Return ONLY valid TypeScript code, no markdown, no explanations

`;
        const issuePrompts = {
            'NO_TESTS': `Generate a comprehensive test file for: ${filepath}

Existing code to test:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Import from the source file
- Include success cases
- Include failure/error cases
- Include edge cases
- Use expect() assertions
- Export test functions or use describe/test pattern`,
            'HIGH_COMPLEXITY': `Refactor this complex function to reduce cyclomatic complexity.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Break into smaller, focused functions
- Each function should have complexity < 10
- Maintain same external interface
- Add clear function names`,
            'NO_ERROR_HANDLING': `Add proper error handling to this async function.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Use Result<T, Error> pattern OR try/catch with proper error propagation
- Never silently swallow errors
- Return structured errors with context`,
            'DUPLICATE_CODE': `Refactor to eliminate duplicate code.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Extract common logic into reusable functions
- Maintain same external behavior
- Add proper type annotations`,
            'MISSING_TYPES': `Add proper TypeScript types to this code.

File: ${filepath}
Issue: ${issue.message}

Current code:
\`\`\`typescript
${existingCode.slice(0, 2000)}
\`\`\`

Requirements:
- Replace any with specific types
- Add explicit return types
- Add parameter types
- Create type aliases where appropriate`
        };
        const issuePrompt = issuePrompts[issue.type] || `Fix the following issue: ${issue.message}\n\nFile: ${filepath}\n\nCode:\n${existingCode.slice(0, 2000)}`;
        const attemptHint = attempt > 1
            ? `\n\nThis is attempt ${attempt}/${MAX_ATTEMPTS}. Previous attempts failed validation. Be more careful with exports and type safety.\n`
            : '';
        return basePrompt + issuePrompt + attemptHint;
    }
    /**
     * Extract code from LLM response (handle markdown blocks)
     */
    extractCode(raw) {
        // Try to extract from typescript/ts code block
        const tsMatch = raw.match(/```(?:typescript|ts)\n([\s\S]*?)```/);
        if (tsMatch) {
            return tsMatch[1].trim();
        }
        // Try generic code block
        const codeMatch = raw.match(/```\n([\s\S]*?)```/);
        if (codeMatch) {
            return codeMatch[1].trim();
        }
        // No code block - return as-is (might be raw code)
        return raw.trim();
    }
    /**
     * Add timeout to promise
     */
    withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), ms))
        ]);
    }
    /**
     * Log rejection to evidence ledger
     */
    async logRejection(reason, attempt, message) {
        await this.ledger.append('generation_rejected', {
            reason,
            attempt,
            message,
            timestamp: ids_1.globalTimeProvider.now()
        });
    }
    /**
     * Log acceptance to evidence ledger
     */
    async logAcceptance(code, validation, attempt) {
        const result = await this.ledger.append('generation_accepted', {
            codeLength: code.length,
            gates: validation.gateResults.map(g => ({ name: g.gateName, passed: g.passed })),
            attempt,
            timestamp: ids_1.globalTimeProvider.now()
        });
        // Return record_hash as the evidence ID
        return result.ok ? result.value.record_hash : `evidence-${ids_1.globalTimeProvider.now()}`;
    }
}
exports.ConstrainedLLM = ConstrainedLLM;
