"use strict";
// Evidence Ledger - Append-only truth substrate
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ledger = void 0;
exports.createEvidence = createEvidence;
class Ledger {
    records = [];
    append(evidence) {
        // Append-only: freeze the record
        this.records.push(Object.freeze(evidence));
    }
    query(taskId) {
        return this.records.filter(r => r.taskId === taskId);
    }
    all() {
        return this.records;
    }
    count() {
        return this.records.length;
    }
}
exports.Ledger = Ledger;
function createEvidence(taskId, type, data) {
    return {
        id: `${taskId}-${type}-${Date.now()}`,
        taskId,
        type,
        timestamp: Date.now(),
        data
    };
}
