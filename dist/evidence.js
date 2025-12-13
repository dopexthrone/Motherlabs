"use strict";
// Evidence Ledger - Append-only truth substrate
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ledger = void 0;
exports.createEvidence = createEvidence;
const ids_1 = require("./core/ids");
const MAX_LEDGER_SIZE = 10_000; // Prevent memory exhaustion
class Ledger {
    records = [];
    maxSize;
    constructor(maxSize = MAX_LEDGER_SIZE) {
        this.maxSize = maxSize;
    }
    append(evidence) {
        // FIXED: Enforce size limit to prevent memory exhaustion
        if (this.records.length >= this.maxSize) {
            throw new Error(`Ledger size limit reached (${this.maxSize}). Consider archiving old records.`);
        }
        // Deep freeze the record for true immutability
        const frozenEvidence = deepFreeze(evidence);
        this.records.push(frozenEvidence);
    }
    query(taskId) {
        // FIXED: Deep copy to prevent mutation of nested data
        return this.records
            .filter(r => r.taskId === taskId)
            .map(r => JSON.parse(JSON.stringify(r)));
    }
    all() {
        // FIXED: Deep copy to prevent mutation
        return this.records.map(r => JSON.parse(JSON.stringify(r)));
    }
    count() {
        return this.records.length;
    }
}
exports.Ledger = Ledger;
/**
 * Deep freeze object and all nested properties
 */
function deepFreeze(obj) {
    // Freeze the object itself
    Object.freeze(obj);
    // Recursively freeze all properties
    Object.getOwnPropertyNames(obj).forEach(prop => {
        // SAFETY: Using 'as any' here is safe because:
        // - We're only reading properties (no mutation)
        // - We type-check the value before recursion (typeof check)
        // - This is bounded to object property iteration only
        // - Alternative would be Record<string, unknown> but loses type info
        const value = obj[prop];
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    });
    return obj;
}
function createEvidence(taskId, type, data) {
    // FIXED: Use monotonic ID generator instead of Date.now() for determinism
    return {
        id: ids_1.globalIdGenerator.evidenceId(taskId, type),
        taskId,
        type,
        timestamp: ids_1.globalTimeProvider.now(),
        data
    };
}
