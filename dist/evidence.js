"use strict";
// Evidence Ledger - Append-only truth substrate
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ledger = void 0;
exports.createEvidence = createEvidence;
class Ledger {
    records = [];
    append(evidence) {
        // Deep freeze the record for true immutability
        const frozenEvidence = deepFreeze(evidence);
        this.records.push(frozenEvidence);
    }
    query(taskId) {
        // Return defensive copy to prevent external mutation
        return this.records
            .filter(r => r.taskId === taskId)
            .map(r => ({ ...r }));
    }
    all() {
        // Return defensive copy
        return [...this.records];
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
        const value = obj[prop];
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    });
    return obj;
}
function createEvidence(taskId, type, data) {
    return {
        id: `${taskId}-${type}-${Date.now()}`,
        taskId,
        type,
        timestamp: Date.now(),
        data
    };
}
