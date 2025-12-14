"use strict";
// Effect Types - Motherlabs Governance System
// Tracks what effects are allowed, granted, and exercised
// Ported from manual kernel verifier governance patterns
Object.defineProperty(exports, "__esModule", { value: true });
exports.EFFECT_SETS = void 0;
exports.checkEffectBounds = checkEffectBounds;
exports.createEffectManifest = createEffectManifest;
exports.validateFilePath = validateFilePath;
exports.createFileManifestEntry = createFileManifestEntry;
/**
 * Standard effect sets for common operations
 */
exports.EFFECT_SETS = {
    /** Pure code validation (no side effects) */
    PURE_VALIDATION: ['NONE'],
    /** Code generation via LLM */
    LLM_CODE_GENERATION: ['LLM_GENERATE', 'LEDGER_APPEND'],
    /** Code application with rollback */
    CODE_APPLICATION: [
        'FS_READ_SANDBOX',
        'FS_WRITE_SANDBOX',
        'CODE_MODIFY',
        'GIT_COMMIT',
        'TEST_EXECUTE',
        'LEDGER_APPEND'
    ],
    /** Test execution only */
    TEST_ONLY: ['TEST_EXECUTE', 'LEDGER_APPEND'],
    /** Ledger operations only */
    LEDGER_ONLY: ['LEDGER_APPEND']
};
/**
 * Check if exercised effects are within granted bounds
 */
function checkEffectBounds(granted, exercised) {
    const grantedSet = new Set(granted);
    const violations = [];
    for (const effect of exercised) {
        if (effect === 'NONE')
            continue; // NONE is always allowed
        if (!grantedSet.has(effect)) {
            violations.push(effect);
        }
    }
    return {
        valid: violations.length === 0,
        violations
    };
}
/**
 * Create effect manifest from granted and exercised effects
 */
function createEffectManifest(granted, exercised, fileManifest) {
    const bounds = checkEffectBounds(granted, exercised);
    return {
        granted_effects: granted,
        exercised_effects: exercised,
        file_manifest: fileManifest,
        within_bounds: bounds.valid
    };
}
/**
 * Validate file manifest entry path safety
 * Returns error string if invalid, null if valid
 */
function validateFilePath(path) {
    if (path.startsWith('/')) {
        return 'Path must not start with /';
    }
    if (path.includes('..')) {
        return 'Path must not contain ..';
    }
    if (path.includes('//')) {
        return 'Path must not contain //';
    }
    if (!path.match(/^[a-zA-Z0-9_\-./]+$/)) {
        return 'Path contains invalid characters';
    }
    return null;
}
/**
 * Create file manifest entry
 */
function createFileManifestEntry(path, operation, content) {
    const pathError = validateFilePath(path);
    if (pathError) {
        throw new Error(`Invalid file path: ${pathError}`);
    }
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    const crypto = require('crypto');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    return {
        path,
        operation,
        byte_count: buffer.length,
        sha256
    };
}
