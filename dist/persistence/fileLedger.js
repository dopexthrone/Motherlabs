"use strict";
// Persistent File-Based Ledger - Append-only, immutable, verifiable
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
exports.FileLedger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const result_1 = require("../core/result");
class FileLedger {
    ledgerPath;
    lastHash = null;
    entryCount = 0;
    constructor(ledgerPath) {
        this.ledgerPath = ledgerPath;
        // Ensure directory exists
        if (!fs.existsSync(ledgerPath)) {
            fs.mkdirSync(ledgerPath, { recursive: true });
        }
        // Load existing entries to get last hash
        this.initialize();
    }
    initialize() {
        const files = fs.readdirSync(this.ledgerPath)
            .filter(f => f.endsWith('.json'))
            .sort();
        if (files.length > 0) {
            const lastFile = files[files.length - 1];
            const content = fs.readFileSync(path.join(this.ledgerPath, lastFile), 'utf-8');
            const entry = JSON.parse(content);
            this.lastHash = entry.hash;
            this.entryCount = files.length;
        }
    }
    /**
     * Append entry to ledger (atomic, immutable)
     */
    async append(entry) {
        try {
            // Compute hash (deterministic)
            const canonical = JSON.stringify({
                id: entry.id,
                timestamp: entry.timestamp,
                type: entry.type,
                data: entry.data
            });
            const hash = crypto.createHash('sha256').update(canonical).digest('hex');
            // Create full entry with hash chain
            const fullEntry = {
                ...entry,
                hash,
                previousHash: this.lastHash || undefined
            };
            // Atomic write: write to .tmp, then rename
            const filename = `${String(this.entryCount).padStart(8, '0')}-${entry.id}.json`;
            const filepath = path.join(this.ledgerPath, filename);
            const tmpPath = `${filepath}.tmp`;
            // Write to temp file
            fs.writeFileSync(tmpPath, JSON.stringify(fullEntry, null, 2), 'utf-8');
            // Verify written correctly
            const written = fs.readFileSync(tmpPath, 'utf-8');
            const parsed = JSON.parse(written);
            if (parsed.hash !== hash) {
                fs.unlinkSync(tmpPath);
                return (0, result_1.Err)(new Error('Hash verification failed after write'));
            }
            // Atomic rename
            fs.renameSync(tmpPath, filepath);
            // Update state
            this.lastHash = hash;
            this.entryCount++;
            return (0, result_1.Ok)(fullEntry);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Query entries by type
     */
    query(type) {
        const files = fs.readdirSync(this.ledgerPath)
            .filter(f => f.endsWith('.json'))
            .sort();
        const entries = [];
        for (const file of files) {
            const content = fs.readFileSync(path.join(this.ledgerPath, file), 'utf-8');
            const entry = JSON.parse(content);
            if (!type || entry.type === type) {
                entries.push(entry);
            }
        }
        return entries;
    }
    /**
     * Verify hash chain integrity
     */
    verifyIntegrity() {
        const files = fs.readdirSync(this.ledgerPath)
            .filter(f => f.endsWith('.json'))
            .sort();
        let previousHash = null;
        for (const file of files) {
            const content = fs.readFileSync(path.join(this.ledgerPath, file), 'utf-8');
            const entry = JSON.parse(content);
            // Verify hash is correct
            const canonical = JSON.stringify({
                id: entry.id,
                timestamp: entry.timestamp,
                type: entry.type,
                data: entry.data
            });
            const computedHash = crypto.createHash('sha256').update(canonical).digest('hex');
            if (computedHash !== entry.hash) {
                return (0, result_1.Err)(new Error(`Hash mismatch in ${file}`));
            }
            // Verify chain
            if (previousHash !== null && entry.previousHash !== previousHash) {
                return (0, result_1.Err)(new Error(`Chain break in ${file}`));
            }
            previousHash = entry.hash;
        }
        return (0, result_1.Ok)(void 0);
    }
    count() {
        return this.entryCount;
    }
}
exports.FileLedger = FileLedger;
