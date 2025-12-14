"use strict";
// Evidence Query System - Answer "why did we choose this six weeks ago?"
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 8 (Immutable Evidence), AXIOM 10 (Complete Audit)
// TCB Component: Part of the evidence/governance system
//
// From ROADMAP Step 6:
// - Query interface for ledger entries
// - Filter by: decision type, date range, file, consequence
// - Reconstruct decision context from evidence
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
exports.EvidenceQuery = void 0;
exports.formatEvidenceEntry = formatEvidenceEntry;
exports.formatDecisionContext = formatDecisionContext;
const fs = __importStar(require("fs"));
const result_1 = require("../core/result");
const jsonlLedger_1 = require("./jsonlLedger");
const fileLedger_1 = require("./fileLedger");
/**
 * Evidence Query System
 * Provides a unified query interface across ledger types
 */
class EvidenceQuery {
    ledgerPath;
    ledgerType;
    jsonlLedger;
    fileLedger;
    constructor(ledgerPath) {
        this.ledgerPath = ledgerPath;
        // Detect ledger type
        if (fs.existsSync(ledgerPath) && fs.statSync(ledgerPath).isFile()) {
            // JSONL ledger (single file)
            this.ledgerType = 'jsonl';
            this.jsonlLedger = new jsonlLedger_1.JSONLLedger(ledgerPath);
        }
        else {
            // File-based ledger (directory)
            this.ledgerType = 'file';
            this.fileLedger = new fileLedger_1.FileLedger(ledgerPath);
        }
    }
    /**
     * Get all entries (normalized to EvidenceEntry)
     */
    getAllEntries() {
        try {
            if (this.ledgerType === 'jsonl' && this.jsonlLedger) {
                const result = this.jsonlLedger.readAll();
                if (!result.ok)
                    return (0, result_1.Err)(result.error);
                return (0, result_1.Ok)(result.value.map(r => this.normalizeJSONLRecord(r)));
            }
            else if (this.ledgerType === 'file' && this.fileLedger) {
                const entries = this.fileLedger.query();
                return (0, result_1.Ok)(entries.map(e => this.normalizeFileLedgerEntry(e)));
            }
            return (0, result_1.Err)(new Error('No ledger initialized'));
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Normalize JSONL record to EvidenceEntry
     */
    normalizeJSONLRecord(record) {
        const data = record.record;
        return {
            id: String(record.seq),
            timestamp: record.timestamp,
            type: record.record_type,
            hash: record.record_hash,
            previousHash: record.prev_hash !== 'genesis' ? record.prev_hash : undefined,
            data: {
                proposalId: data.proposalId,
                targetFile: data.targetFile,
                decisionType: data.decisionType,
                issueType: data.issueType,
                severity: data.severity,
                source: data.source,
                gatesPassed: data.gatesPassed,
                gatesFailed: data.gatesFailed,
                rationale: data.rationale,
                enables: data.enables,
                forbids: data.forbids,
                assumptions: data.assumptions,
                alternativesConsidered: data.alternativesConsidered,
                chosenRationale: data.chosenRationale,
                ...data
            }
        };
    }
    /**
     * Normalize FileLedger entry to EvidenceEntry
     */
    normalizeFileLedgerEntry(entry) {
        const data = entry.data;
        return {
            id: entry.id,
            timestamp: entry.timestamp,
            type: entry.type,
            hash: entry.hash,
            previousHash: entry.previousHash,
            data: {
                proposalId: data.proposalId,
                targetFile: data.targetFile,
                decisionType: data.decisionType,
                issueType: data.issueType,
                severity: data.severity,
                source: data.source,
                gatesPassed: data.gatesPassed,
                gatesFailed: data.gatesFailed,
                rationale: data.rationale,
                enables: data.enables,
                forbids: data.forbids,
                assumptions: data.assumptions,
                alternativesConsidered: data.alternativesConsidered,
                chosenRationale: data.chosenRationale,
                ...data
            }
        };
    }
    /**
     * Query entries by file path
     */
    byFile(filepath) {
        const allResult = this.getAllEntries();
        if (!allResult.ok)
            return (0, result_1.Err)(allResult.error);
        const matching = allResult.value.filter(e => e.data.targetFile === filepath ||
            e.data.targetFile?.includes(filepath));
        return (0, result_1.Ok)(matching);
    }
    /**
     * Query entries by date range
     */
    byDateRange(from, to) {
        const allResult = this.getAllEntries();
        if (!allResult.ok)
            return (0, result_1.Err)(allResult.error);
        const fromTime = from.getTime();
        const toTime = to.getTime();
        const matching = allResult.value.filter(e => e.timestamp >= fromTime && e.timestamp <= toTime);
        return (0, result_1.Ok)(matching);
    }
    /**
     * Query entries by decision type
     */
    byDecisionType(decisionType) {
        const allResult = this.getAllEntries();
        if (!allResult.ok)
            return (0, result_1.Err)(allResult.error);
        const matching = allResult.value.filter(e => e.data.decisionType === decisionType);
        return (0, result_1.Ok)(matching);
    }
    /**
     * Query entries by record type
     */
    byRecordType(recordType) {
        const allResult = this.getAllEntries();
        if (!allResult.ok)
            return (0, result_1.Err)(allResult.error);
        const matching = allResult.value.filter(e => e.type === recordType);
        return (0, result_1.Ok)(matching);
    }
    /**
     * Query with multiple filters
     */
    query(filter) {
        const allResult = this.getAllEntries();
        if (!allResult.ok)
            return (0, result_1.Err)(allResult.error);
        let results = allResult.value;
        // Apply filters
        if (filter.targetFile) {
            results = results.filter(e => e.data.targetFile === filter.targetFile ||
                e.data.targetFile?.includes(filter.targetFile));
        }
        if (filter.decisionType) {
            results = results.filter(e => e.data.decisionType === filter.decisionType);
        }
        if (filter.fromDate) {
            const fromTime = filter.fromDate.getTime();
            results = results.filter(e => e.timestamp >= fromTime);
        }
        if (filter.toDate) {
            const toTime = filter.toDate.getTime();
            results = results.filter(e => e.timestamp <= toTime);
        }
        if (filter.recordType) {
            results = results.filter(e => e.type === filter.recordType);
        }
        if (filter.severity) {
            results = results.filter(e => e.data.severity === filter.severity);
        }
        if (filter.source) {
            results = results.filter(e => e.data.source === filter.source);
        }
        // Apply pagination
        if (filter.offset) {
            results = results.slice(filter.offset);
        }
        if (filter.limit) {
            results = results.slice(0, filter.limit);
        }
        return (0, result_1.Ok)(results);
    }
    /**
     * Reconstruct decision context from an entry
     * This answers: "why did we make this decision?"
     */
    reconstructContext(entryId) {
        const allResult = this.getAllEntries();
        if (!allResult.ok)
            return (0, result_1.Err)(allResult.error);
        // Find the target entry
        const entry = allResult.value.find(e => e.id === entryId);
        if (!entry) {
            return (0, result_1.Err)(new Error(`Entry not found: ${entryId}`));
        }
        // Find related entries (same file or proposal)
        const relatedEntries = allResult.value.filter(e => e.id !== entryId && ((entry.data.targetFile && e.data.targetFile === entry.data.targetFile) ||
            (entry.data.proposalId && e.data.proposalId === entry.data.proposalId)));
        // Extract consequence surface if available
        const consequenceSurface = (entry.data.enables || entry.data.forbids) ? {
            enables: entry.data.enables || [],
            forbids: entry.data.forbids || [],
            assumptions: entry.data.assumptions || [],
            validationCriteria: []
        } : undefined;
        // Build timeline
        const timeline = [entry, ...relatedEntries]
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(e => ({
            timestamp: e.timestamp,
            type: e.type,
            summary: this.summarizeEntry(e)
        }));
        // Extract gate results if available
        const gateResults = entry.data.gatesPassed || entry.data.gatesFailed ? [
            ...(entry.data.gatesPassed || []).map(g => ({ gateName: g, passed: true })),
            ...(entry.data.gatesFailed || []).map(g => ({ gateName: g, passed: false }))
        ] : undefined;
        return (0, result_1.Ok)({
            entry,
            relatedEntries,
            consequenceSurface,
            gateResults,
            timeline
        });
    }
    /**
     * Get statistics about the evidence store
     */
    getStats() {
        const allResult = this.getAllEntries();
        if (!allResult.ok)
            return (0, result_1.Err)(allResult.error);
        const entries = allResult.value;
        const byDecisionType = {};
        const byRecordType = {};
        let earliest = null;
        let latest = null;
        for (const entry of entries) {
            // Count by decision type
            const dt = entry.data.decisionType || 'unknown';
            byDecisionType[dt] = (byDecisionType[dt] || 0) + 1;
            // Count by record type
            byRecordType[entry.type] = (byRecordType[entry.type] || 0) + 1;
            // Track date range
            if (earliest === null || entry.timestamp < earliest) {
                earliest = entry.timestamp;
            }
            if (latest === null || entry.timestamp > latest) {
                latest = entry.timestamp;
            }
        }
        return (0, result_1.Ok)({
            totalEntries: entries.length,
            matchingEntries: entries.length,
            byDecisionType,
            byRecordType,
            dateRange: {
                earliest: earliest ? new Date(earliest) : null,
                latest: latest ? new Date(latest) : null
            }
        });
    }
    /**
     * Search entries by text pattern (in rationale, file path, etc.)
     */
    search(pattern) {
        const allResult = this.getAllEntries();
        if (!allResult.ok)
            return (0, result_1.Err)(allResult.error);
        const regex = new RegExp(pattern, 'i');
        const matching = allResult.value.filter(e => regex.test(e.data.targetFile || '') ||
            regex.test(e.data.rationale || '') ||
            regex.test(e.data.issueType || '') ||
            regex.test(e.type));
        return (0, result_1.Ok)(matching);
    }
    /**
     * Get entries that affected a specific file
     */
    getFileHistory(filepath) {
        const result = this.byFile(filepath);
        if (!result.ok)
            return (0, result_1.Err)(result.error);
        // Sort by timestamp (oldest first)
        const sorted = result.value.sort((a, b) => a.timestamp - b.timestamp);
        return (0, result_1.Ok)(sorted);
    }
    /**
     * Summarize an entry for display
     */
    summarizeEntry(entry) {
        const parts = [];
        if (entry.type)
            parts.push(`[${entry.type}]`);
        if (entry.data.targetFile)
            parts.push(entry.data.targetFile);
        if (entry.data.issueType)
            parts.push(entry.data.issueType);
        if (entry.data.decisionType)
            parts.push(`(${entry.data.decisionType})`);
        return parts.join(' ') || 'Unknown entry';
    }
    /**
     * Verify ledger integrity
     */
    verifyIntegrity() {
        if (this.ledgerType === 'jsonl' && this.jsonlLedger) {
            return this.jsonlLedger.verifyChain();
        }
        else if (this.ledgerType === 'file' && this.fileLedger) {
            return this.fileLedger.verifyIntegrity();
        }
        return (0, result_1.Err)(new Error('No ledger initialized'));
    }
    /**
     * Get count of entries
     */
    count() {
        if (this.ledgerType === 'jsonl' && this.jsonlLedger) {
            return this.jsonlLedger.count();
        }
        else if (this.ledgerType === 'file' && this.fileLedger) {
            return this.fileLedger.count();
        }
        return 0;
    }
}
exports.EvidenceQuery = EvidenceQuery;
/**
 * Format evidence entry for display
 */
function formatEvidenceEntry(entry) {
    const lines = [];
    const date = new Date(entry.timestamp).toISOString();
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push(`EVIDENCE ENTRY: ${entry.id}`);
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`Type: ${entry.type}`);
    lines.push(`Timestamp: ${date}`);
    lines.push(`Hash: ${entry.hash.substring(0, 16)}...`);
    if (entry.data.targetFile) {
        lines.push(`Target File: ${entry.data.targetFile}`);
    }
    if (entry.data.decisionType) {
        lines.push(`Decision Type: ${entry.data.decisionType}`);
    }
    if (entry.data.issueType) {
        lines.push(`Issue: ${entry.data.issueType} (${entry.data.severity || 'unknown'})`);
    }
    if (entry.data.rationale) {
        lines.push('');
        lines.push('Rationale:');
        lines.push(`  ${entry.data.rationale}`);
    }
    if (entry.data.enables?.length || entry.data.forbids?.length) {
        lines.push('');
        lines.push('Consequence Surface:');
        if (entry.data.enables?.length) {
            lines.push(`  Enables: ${entry.data.enables.join(', ')}`);
        }
        if (entry.data.forbids?.length) {
            lines.push(`  Forbids: ${entry.data.forbids.join(', ')}`);
        }
    }
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
}
/**
 * Format decision context for display
 */
function formatDecisionContext(context) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('DECISION CONTEXT RECONSTRUCTION');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    // Main entry
    lines.push('PRIMARY DECISION:');
    lines.push(`  ID: ${context.entry.id}`);
    lines.push(`  Type: ${context.entry.type}`);
    lines.push(`  Date: ${new Date(context.entry.timestamp).toISOString()}`);
    lines.push(`  File: ${context.entry.data.targetFile || 'N/A'}`);
    if (context.entry.data.rationale) {
        lines.push(`  Rationale: ${context.entry.data.rationale}`);
    }
    lines.push('');
    // Consequence surface
    if (context.consequenceSurface) {
        lines.push('CONSEQUENCE SURFACE:');
        lines.push(`  Enables: ${context.consequenceSurface.enables.join(', ') || 'None'}`);
        lines.push(`  Forbids: ${context.consequenceSurface.forbids.join(', ') || 'None'}`);
        lines.push(`  Assumptions: ${context.consequenceSurface.assumptions.join(', ') || 'None'}`);
        lines.push('');
    }
    // Gate results
    if (context.gateResults?.length) {
        lines.push('GATE VALIDATION:');
        for (const gate of context.gateResults) {
            const status = gate.passed ? '✓' : '✗';
            lines.push(`  ${status} ${gate.gateName}${gate.error ? `: ${gate.error}` : ''}`);
        }
        lines.push('');
    }
    // Timeline
    if (context.timeline.length > 1) {
        lines.push('TIMELINE:');
        for (const event of context.timeline) {
            const date = new Date(event.timestamp).toISOString();
            lines.push(`  ${date}: ${event.summary}`);
        }
        lines.push('');
    }
    // Related entries
    if (context.relatedEntries.length > 0) {
        lines.push(`RELATED ENTRIES: ${context.relatedEntries.length}`);
        for (const related of context.relatedEntries.slice(0, 5)) {
            lines.push(`  - ${related.id}: ${related.type}`);
        }
        if (context.relatedEntries.length > 5) {
            lines.push(`  ... and ${context.relatedEntries.length - 5} more`);
        }
    }
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
}
