"use strict";
// THE INVARIANT LOOP - Propose → Constrain → Verify → Record
// This pattern NEVER changes at any scale
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODE_CONSTRAINTS = void 0;
exports.executeLoop = executeLoop;
const result_1 = require("./result");
/**
 * THE LOOP - This function IS Motherlabs
 *
 * Same loop for:
 * - First schema
 * - First code file
 * - First automation
 * - Self-improvements
 * - Everything
 */
async function executeLoop(proposal, constraints, recorder) {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: PROPOSE (Non-Authoritative)
    // ═══════════════════════════════════════════════════════════
    // Proposal has ZERO authority
    // It is merely a candidate
    // Source (AI, human, heuristic) is IRRELEVANT
    // ═══════════════════════════════════════════════════════════
    // STEP 2: CONSTRAIN (Deterministic)
    // ═══════════════════════════════════════════════════════════
    const constraintResults = [];
    for (const constraint of constraints) {
        const result = constraint.check(proposal.content);
        constraintResults.push({
            name: constraint.name,
            passed: result.ok,
            error: result.ok ? undefined : result.error
        });
        // HARD FAIL: Required constraint failed
        if (constraint.required && !result.ok) {
            return (0, result_1.Err)({
                code: 'CONSTRAINT_FAILED',
                message: `Required constraint "${constraint.name}" failed`,
                context: {
                    constraint: constraint.name,
                    error: result.error
                }
            });
        }
    }
    // ═══════════════════════════════════════════════════════════
    // STEP 3: VERIFY (Mechanical Proof)
    // ═══════════════════════════════════════════════════════════
    const allPassed = constraintResults.every(r => r.passed);
    if (!allPassed) {
        // Some non-required constraints failed - may still accept with warnings
        const failed = constraintResults.filter(r => !r.passed);
        const allOptional = constraints.every(c => !c.required);
        if (!allOptional) {
            return (0, result_1.Err)({
                code: 'VERIFICATION_FAILED',
                message: 'Verification incomplete',
                context: { failed }
            });
        }
    }
    const verification = {
        valid: allPassed,
        constraints: constraintResults,
        timestamp: Date.now() // DETERMINISM-EXEMPT: Verification metadata
    };
    // ═══════════════════════════════════════════════════════════
    // STEP 4: RECORD (Irreversible)
    // ═══════════════════════════════════════════════════════════
    // Only if verification passed
    if (!verification.valid) {
        return (0, result_1.Err)({
            code: 'NOT_VERIFIED',
            message: 'Cannot record unverified proposal'
        });
    }
    // Create immutable record
    const record = Object.freeze({
        id: proposal.id,
        content: Object.freeze(proposal.content),
        verificationProof: Object.freeze(verification),
        recordedAt: Date.now(), // DETERMINISM-EXEMPT: Record metadata
        hash: computeHash(proposal.content)
    });
    // Append to ledger (irreversible)
    await recorder(record);
    // Success
    return (0, result_1.Ok)(record);
}
/**
 * Compute content hash (deterministic)
 */
function computeHash(content) {
    const crypto = require('crypto');
    const canonical = JSON.stringify(content);
    return crypto.createHash('sha256').update(canonical).digest('hex');
}
/**
 * THE 6 GATES FOR LLM-GENERATED CODE
 * (When code generation is added)
 */
exports.CODE_CONSTRAINTS = [
    {
        name: 'schema_valid',
        required: true,
        check: (code) => validateSchema(code)
    },
    {
        name: 'syntax_valid',
        required: true,
        check: (code) => validateSyntax(code)
    },
    {
        name: 'variables_defined',
        required: true,
        check: (code) => validateVariables(code)
    },
    {
        name: 'tests_pass',
        required: true,
        check: (code) => runTests(code)
    },
    {
        name: 'urco_entropy_low',
        required: true,
        check: (code) => checkEntropy(code)
    },
    {
        name: 'governance_ok',
        required: true,
        check: (code) => checkGovernance(code)
    }
];
// UNIMPLEMENTED: Code validators (Week 2 work)
// These throw if called - prevents accidental use before implementation
function validateSchema(_code) {
    throw new Error('UNIMPLEMENTED: validateSchema - implement in Week 2');
}
function validateSyntax(_code) {
    throw new Error('UNIMPLEMENTED: validateSyntax - implement in Week 2');
}
function validateVariables(_code) {
    throw new Error('UNIMPLEMENTED: validateVariables - implement in Week 2');
}
function runTests(_code) {
    throw new Error('UNIMPLEMENTED: runTests - implement in Week 2');
}
function checkEntropy(_code) {
    throw new Error('UNIMPLEMENTED: checkEntropy - implement in Week 2');
}
function checkGovernance(_code) {
    throw new Error('UNIMPLEMENTED: checkGovernance - implement in Week 2');
}
