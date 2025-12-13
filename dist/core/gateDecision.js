"use strict";
// Gate Decision Ledgering - All ALLOW/DENY decisions recorded
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGateDecision = createGateDecision;
exports.logGateDecision = logGateDecision;
const contentAddress_1 = require("./contentAddress");
const ids_1 = require("./ids");
/**
 * Create gate decision record (ledgered for audit trail)
 */
function createGateDecision(gate, decision, target, reason, details) {
    const targetId = typeof target === 'object' && target !== null && 'id' in target
        ? String(target.id)
        : 'unknown';
    const targetType = typeof target === 'object' && target !== null && 'type' in target
        ? String(target.type)
        : typeof target;
    return {
        gate_type: gate,
        decision,
        target: {
            type: targetType,
            id: targetId,
            contentAddress: (0, contentAddress_1.contentAddress)(target)
        },
        timestamp: ids_1.globalTimeProvider.now(),
        reason,
        details
    };
}
/**
 * Log gate decision to ledger
 */
async function logGateDecision(decision, ledger) {
    await ledger.append({
        id: (0, contentAddress_1.contentAddress)(decision),
        timestamp: decision.timestamp,
        type: 'gate_decision',
        data: decision,
        hash: (0, contentAddress_1.contentAddress)(decision)
    });
}
