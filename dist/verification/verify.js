"use strict";
// Fail-Closed Ledger Verification System
// Ported from manual kernel verifier governance patterns
// 7-Layer verification: envelope, seq, prev_hash, record_hash, schema, gate auth, effects
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyLedger = verifyLedger;
exports.verifyLedgerFromFile = verifyLedgerFromFile;
exports.formatVerificationResult = formatVerificationResult;
const jsonlLedger_1 = require("../persistence/jsonlLedger");
const contentAddress_1 = require("../core/contentAddress");
const effects_1 = require("../core/effects");
/**
 * Verify entire ledger with 7-layer fail-closed verification
 */
function verifyLedger(records) {
    const errors = [];
    const warnings = [];
    let gateDecisions = 0;
    let artifacts = 0;
    let effectsVerified = 0;
    if (records.length === 0) {
        return {
            pass: false,
            errors: [{ seq: null, check: 'envelope_schema', message: 'Ledger is empty', severity: 'error' }],
            warnings: [],
            stats: { records_checked: 0, gate_decisions: 0, artifacts: 0, effects_verified: 0 }
        };
    }
    let expectedSeq = 0;
    let expectedPrevHash = 'genesis';
    for (const record of records) {
        // Layer 1: Envelope schema validation
        const envelopeErrors = verifyEnvelopeSchema(record);
        for (const err of envelopeErrors) {
            errors.push({ seq: record.seq, check: 'envelope_schema', message: err, severity: 'error' });
        }
        // Layer 2: seq increment
        if (record.seq !== expectedSeq) {
            errors.push({
                seq: record.seq,
                check: 'seq_increment',
                message: `Expected seq ${expectedSeq}, got ${record.seq}`,
                severity: 'error'
            });
        }
        // Layer 3: prev_hash chain
        if (record.prev_hash !== expectedPrevHash) {
            errors.push({
                seq: record.seq,
                check: 'prev_hash_chain',
                message: `Expected prev_hash ${expectedPrevHash}, got ${record.prev_hash}`,
                severity: 'error'
            });
        }
        // Layer 4: record_hash verification
        const hashVerification = verifyRecordHash(record);
        if (!hashVerification.valid) {
            errors.push({
                seq: record.seq,
                check: 'record_hash_verify',
                message: hashVerification.error,
                severity: 'error'
            });
        }
        // Layer 5: Record-type specific schema
        const schemaErrors = verifyRecordSchema(record);
        for (const err of schemaErrors) {
            errors.push({ seq: record.seq, check: 'record_schema', message: err, severity: 'error' });
        }
        // Track statistics
        if (record.record_type === 'GATE_DECISION') {
            gateDecisions++;
        }
        if (record.record_type === 'EVIDENCE_ARTIFACT') {
            artifacts++;
        }
        expectedSeq++;
        expectedPrevHash = record.record_hash;
    }
    // Layer 6: Gate authorization for protected operations
    const authErrors = verifyGateAuthorization(records);
    for (const err of authErrors) {
        errors.push(err);
    }
    // Layer 7: Effect bounds checking
    const effectErrors = verifyEffectBounds(records);
    for (const err of effectErrors) {
        errors.push(err);
        effectsVerified++;
    }
    return {
        pass: errors.length === 0,
        errors,
        warnings,
        stats: {
            records_checked: records.length,
            gate_decisions: gateDecisions,
            artifacts,
            effects_verified: effectsVerified
        }
    };
}
/**
 * Layer 1: Verify envelope schema
 */
function verifyEnvelopeSchema(record) {
    const errors = [];
    if (typeof record.record_type !== 'string' || record.record_type.length === 0) {
        errors.push('record_type must be non-empty string');
    }
    if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq < 0) {
        errors.push('seq must be non-negative integer');
    }
    if (typeof record.timestamp !== 'number' || record.timestamp <= 0) {
        errors.push('timestamp must be positive number');
    }
    if (typeof record.prev_hash !== 'string') {
        errors.push('prev_hash must be string');
    }
    if (typeof record.record_hash !== 'string' || !record.record_hash.startsWith('sha256:')) {
        errors.push('record_hash must be sha256: prefixed string');
    }
    if (record.record === undefined) {
        errors.push('record field is required');
    }
    return errors;
}
/**
 * Layer 4: Verify record hash by recomputation
 */
function verifyRecordHash(record) {
    const recordForHash = {
        record_type: record.record_type,
        seq: record.seq,
        timestamp: record.timestamp,
        prev_hash: record.prev_hash,
        record: record.record
    };
    const computed = (0, contentAddress_1.contentAddress)(recordForHash);
    if (computed !== record.record_hash) {
        return {
            valid: false,
            error: `Hash mismatch: stored=${record.record_hash}, computed=${computed}`
        };
    }
    return { valid: true };
}
/**
 * Layer 5: Verify record-type specific schema
 */
function verifyRecordSchema(record) {
    const errors = [];
    switch (record.record_type) {
        case 'GENESIS':
            if (!record.record || typeof record.record !== 'object') {
                errors.push('GENESIS record must be object');
            }
            break;
        case 'GATE_DECISION':
            const decision = record.record;
            if (!decision.gate_type)
                errors.push('GATE_DECISION requires gate_type');
            if (!decision.decision || !['ALLOW', 'DENY'].includes(decision.decision)) {
                errors.push('GATE_DECISION decision must be ALLOW or DENY');
            }
            if (!decision.scope)
                errors.push('GATE_DECISION requires scope');
            if (!decision.authorizer)
                errors.push('GATE_DECISION requires authorizer');
            break;
        case 'EVIDENCE_ARTIFACT':
            const artifact = record.record;
            if (!artifact.artifact_id)
                errors.push('EVIDENCE_ARTIFACT requires artifact_id');
            if (!artifact.evidence_kind)
                errors.push('EVIDENCE_ARTIFACT requires evidence_kind');
            if (artifact.payload === undefined)
                errors.push('EVIDENCE_ARTIFACT requires payload');
            break;
        // Additional record types can be validated here
    }
    return errors;
}
/**
 * Layer 6: Verify gate authorization for protected operations
 */
function verifyGateAuthorization(records) {
    const errors = [];
    const gateDecisions = new Map();
    // First pass: collect all gate decisions
    for (const record of records) {
        if (record.record_type === 'GATE_DECISION') {
            const decision = record.record;
            const targetId = decision.scope.target_id;
            if (!gateDecisions.has(targetId)) {
                gateDecisions.set(targetId, []);
            }
            gateDecisions.get(targetId).push(decision);
        }
    }
    // Second pass: verify protected operations have prior authorization
    for (const record of records) {
        if (record.record_type === 'CHANGE_APPLIED') {
            const change = record.record;
            if (change.proposal_id) {
                const decisions = gateDecisions.get(change.proposal_id) || [];
                const hasAllow = decisions.some(d => d.gate_type === 'change_application' && d.decision === 'ALLOW');
                if (!hasAllow) {
                    errors.push({
                        seq: record.seq,
                        check: 'gate_authorization',
                        message: `CHANGE_APPLIED without prior change_application ALLOW for ${change.proposal_id}`,
                        severity: 'error'
                    });
                }
            }
        }
        if (record.record_type === 'PROPOSAL_ADMITTED') {
            const proposal = record.record;
            if (proposal.proposal_id) {
                const decisions = gateDecisions.get(proposal.proposal_id) || [];
                const hasAllow = decisions.some(d => d.gate_type === 'proposal_admission' && d.decision === 'ALLOW');
                if (!hasAllow) {
                    errors.push({
                        seq: record.seq,
                        check: 'gate_authorization',
                        message: `PROPOSAL_ADMITTED without prior proposal_admission ALLOW for ${proposal.proposal_id}`,
                        severity: 'error'
                    });
                }
            }
        }
    }
    return errors;
}
/**
 * Layer 7: Verify effect bounds
 */
function verifyEffectBounds(records) {
    const errors = [];
    for (const record of records) {
        if (record.record_type === 'CHANGE_APPLIED') {
            const change = record.record;
            if (change.granted_effects && change.exercised_effects) {
                const bounds = (0, effects_1.checkEffectBounds)(change.granted_effects, change.exercised_effects);
                if (!bounds.valid) {
                    errors.push({
                        seq: record.seq,
                        check: 'effect_bounds',
                        message: `Effect bounds exceeded: ${bounds.violations.join(', ')}`,
                        severity: 'error'
                    });
                }
            }
        }
    }
    return errors;
}
/**
 * Verify ledger from file path
 */
function verifyLedgerFromFile(filepath) {
    try {
        const ledger = new jsonlLedger_1.JSONLLedger(filepath);
        const records = ledger.readAll();
        if (!records.ok) {
            return {
                pass: false,
                errors: [{
                        seq: null,
                        check: 'envelope_schema',
                        message: `Failed to read ledger: ${records.error.message}`,
                        severity: 'error'
                    }],
                warnings: [],
                stats: { records_checked: 0, gate_decisions: 0, artifacts: 0, effects_verified: 0 }
            };
        }
        return verifyLedger(records.value);
    }
    catch (error) {
        return {
            pass: false,
            errors: [{
                    seq: null,
                    check: 'envelope_schema',
                    message: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
                    severity: 'error'
                }],
            warnings: [],
            stats: { records_checked: 0, gate_decisions: 0, artifacts: 0, effects_verified: 0 }
        };
    }
}
/**
 * Format verification result for display
 */
function formatVerificationResult(result) {
    const lines = [];
    lines.push('═══════════════════════════════════════');
    lines.push('  LEDGER VERIFICATION RESULT');
    lines.push('═══════════════════════════════════════');
    lines.push('');
    lines.push(`  Status: ${result.pass ? '✓ PASS' : '✗ FAIL'}`);
    lines.push('');
    lines.push('  Statistics:');
    lines.push(`    Records checked: ${result.stats.records_checked}`);
    lines.push(`    Gate decisions: ${result.stats.gate_decisions}`);
    lines.push(`    Artifacts: ${result.stats.artifacts}`);
    lines.push('');
    if (result.errors.length > 0) {
        lines.push('  Errors:');
        for (const err of result.errors) {
            const seqInfo = err.seq !== null ? `[seq ${err.seq}]` : '[global]';
            lines.push(`    ✗ ${seqInfo} ${err.check}: ${err.message}`);
        }
        lines.push('');
    }
    if (result.warnings.length > 0) {
        lines.push('  Warnings:');
        for (const warn of result.warnings) {
            const seqInfo = warn.seq !== null ? `[seq ${warn.seq}]` : '[global]';
            lines.push(`    ⚠ ${seqInfo} ${warn.check}: ${warn.message}`);
        }
        lines.push('');
    }
    lines.push('═══════════════════════════════════════');
    return lines.join('\n');
}
