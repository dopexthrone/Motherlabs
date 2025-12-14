"use strict";
// JSONL Ledger - Single file, append-only, hash-chained
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 8 (Immutable Evidence)
// TCB Component: This file is part of the Trusted Computing Base
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JSONLLedger = void 0;
const fs = __importStar(require("fs"));
const result_1 = require("../core/result");
const contentAddress_1 = require("../core/contentAddress");
class JSONLLedger {
    filepath;
    lastHash;
    seq;
    constructor(filepath) {
        this.filepath = filepath;
        this.lastHash = 'genesis';
        this.seq = 0;
        // Initialize if file doesn't exist
        if (!fs.existsSync(filepath)) {
            this.createGenesis();
        }
        else {
            this.loadState();
        }
    }
    /**
     * Create genesis record (first entry)
     */
    createGenesis() {
        const genesis = {
            record_type: 'GENESIS',
            seq: 0,
            timestamp: Date.now(), // DETERMINISM-EXEMPT: Genesis timestamp
            prev_hash: 'genesis',
            record: {
                kernel_version: '1.0.0',
                purpose: 'Foundation bootstrap',
                timestamp: new Date().toISOString() // DETERMINISM-EXEMPT: Genesis metadata
            },
            record_hash: '' // Computed below
        };
        // Compute hash WITHOUT record_hash field (same as append)
        const genesisForHash = {
            record_type: genesis.record_type,
            seq: genesis.seq,
            timestamp: genesis.timestamp,
            prev_hash: genesis.prev_hash,
            record: genesis.record
        };
        genesis.record_hash = (0, contentAddress_1.contentAddress)(genesisForHash);
        // Write genesis
        fs.writeFileSync(this.filepath, (0, contentAddress_1.canonicalJSON)(genesis) + '\n', 'utf-8');
        this.lastHash = genesis.record_hash;
        this.seq = 0;
    }
    /**
     * Load state from existing ledger
     */
    loadState() {
        const content = fs.readFileSync(this.filepath, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l.length > 0);
        if (lines.length === 0) {
            this.createGenesis();
            return;
        }
        // Get last record
        const lastLine = lines[lines.length - 1];
        const lastRecord = JSON.parse(lastLine);
        this.lastHash = lastRecord.record_hash;
        this.seq = lastRecord.seq;
    }
    /**
     * Append record to JSONL ledger (atomic)
     */
    async append(record_type, record) {
        try {
            this.seq++;
            const entry = {
                record_type,
                seq: this.seq,
                timestamp: Date.now(), // DETERMINISM-EXEMPT: Record timestamp
                prev_hash: this.lastHash,
                record,
                record_hash: '' // Computed below
            };
            // Compute hash of entry WITHOUT record_hash field
            const entryForHash = {
                record_type: entry.record_type,
                seq: entry.seq,
                timestamp: entry.timestamp,
                prev_hash: entry.prev_hash,
                record: entry.record
            };
            entry.record_hash = (0, contentAddress_1.contentAddress)(entryForHash);
            // Append to file (atomic line write)
            const line = (0, contentAddress_1.canonicalJSON)(entry) + '\n';
            fs.appendFileSync(this.filepath, line, 'utf-8');
            // Verify written correctly
            const written = this.readLast();
            if (!written.ok || written.value.record_hash !== entry.record_hash) {
                return (0, result_1.Err)(new Error('Write verification failed'));
            }
            this.lastHash = entry.record_hash;
            return (0, result_1.Ok)(entry);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Read all records
     */
    readAll() {
        try {
            const content = fs.readFileSync(this.filepath, 'utf-8');
            const lines = content.trim().split('\n').filter(l => l.length > 0);
            const records = [];
            for (const line of lines) {
                const record = JSON.parse(line);
                records.push(record);
            }
            return (0, result_1.Ok)(records);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Read last record
     */
    readLast() {
        const all = this.readAll();
        if (!all.ok)
            return (0, result_1.Err)(all.error);
        if (all.value.length === 0) {
            return (0, result_1.Err)(new Error('Ledger is empty'));
        }
        return (0, result_1.Ok)(all.value[all.value.length - 1]);
    }
    /**
     * Verify entire hash chain
     */
    verifyChain() {
        const all = this.readAll();
        if (!all.ok)
            return (0, result_1.Err)(all.error);
        if (all.value.length === 0) {
            return (0, result_1.Err)(new Error('Ledger is empty'));
        }
        let expectedPrev = 'genesis';
        for (const record of all.value) {
            // Verify prev_hash
            if (record.prev_hash !== expectedPrev) {
                return (0, result_1.Err)(new Error(`Hash chain break at seq ${record.seq}: expected prev=${expectedPrev}, got=${record.prev_hash}`));
            }
            // Verify record_hash by recomputing
            // Need to compute hash of record WITHOUT record_hash field
            const recordForHash = {
                record_type: record.record_type,
                seq: record.seq,
                timestamp: record.timestamp,
                prev_hash: record.prev_hash,
                record: record.record
            };
            const computed = (0, contentAddress_1.contentAddress)(recordForHash);
            if (computed !== record.record_hash) {
                return (0, result_1.Err)(new Error(`Hash mismatch at seq ${record.seq}: expected=${record.record_hash}, computed=${computed}`));
            }
            expectedPrev = record.record_hash;
        }
        return (0, result_1.Ok)(void 0);
    }
    count() {
        return this.seq;
    }
}
exports.JSONLLedger = JSONLLedger;
