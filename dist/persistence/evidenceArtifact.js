"use strict";
// Evidence Artifact System - Content-addressed evidence storage
// Ported from manual kernel verifier governance patterns
// CONSTITUTIONAL AUTHORITY - Enforces: AXIOM 8 (Immutable Evidence)
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
exports.createEvidenceArtifact = createEvidenceArtifact;
exports.verifyArtifact = verifyArtifact;
exports.createStdoutArtifact = createStdoutArtifact;
exports.createStderrArtifact = createStderrArtifact;
exports.createExitCodeArtifact = createExitCodeArtifact;
exports.createGateResultArtifact = createGateResultArtifact;
exports.createLLMResponseArtifact = createLLMResponseArtifact;
exports.createCodeDiffArtifact = createCodeDiffArtifact;
exports.createTestResultArtifact = createTestResultArtifact;
exports.createFileManifestArtifact = createFileManifestArtifact;
exports.extractPayload = extractPayload;
exports.bundleArtifacts = bundleArtifacts;
const crypto = __importStar(require("crypto"));
const contentAddress_1 = require("../core/contentAddress");
/**
 * Create evidence artifact from payload
 */
function createEvidenceArtifact(payload, evidenceKind, metadata) {
    // Determine encoding
    const isBuffer = Buffer.isBuffer(payload);
    const encoding = isBuffer ? 'base64' : 'utf8';
    const payloadStr = isBuffer ? payload.toString('base64') : payload;
    // Compute content hash
    const hash = crypto.createHash('sha256').update(payloadStr).digest('hex');
    const artifactId = `sha256:${hash}`;
    return {
        artifact_id: artifactId,
        artifact_kind: 'evidence',
        evidence_kind: evidenceKind,
        content_hash: artifactId,
        payload_encoding: encoding,
        payload: payloadStr,
        metadata: metadata ?? {
            created_at_utc: new Date().toISOString()
        }
    };
}
/**
 * Verify artifact integrity
 */
function verifyArtifact(artifact) {
    const hash = crypto.createHash('sha256').update(artifact.payload).digest('hex');
    const computedId = `sha256:${hash}`;
    return computedId === artifact.artifact_id && computedId === artifact.content_hash;
}
/**
 * Create stdout log artifact
 */
function createStdoutArtifact(stdout, sourceCommand) {
    return createEvidenceArtifact(stdout, 'stdout_log', {
        created_at_utc: new Date().toISOString(),
        description: sourceCommand ? `stdout from: ${sourceCommand}` : 'stdout capture'
    });
}
/**
 * Create stderr log artifact
 */
function createStderrArtifact(stderr, sourceCommand) {
    return createEvidenceArtifact(stderr, 'stderr_log', {
        created_at_utc: new Date().toISOString(),
        description: sourceCommand ? `stderr from: ${sourceCommand}` : 'stderr capture'
    });
}
/**
 * Create exit code artifact
 */
function createExitCodeArtifact(exitCode, command) {
    return createEvidenceArtifact(JSON.stringify({ exit_code: exitCode, command }), 'exit_code', {
        created_at_utc: new Date().toISOString(),
        description: `exit code ${exitCode}`
    });
}
/**
 * Create gate result artifact
 */
function createGateResultArtifact(gateName, passed, error, details) {
    return createEvidenceArtifact(JSON.stringify({ gate: gateName, passed, error, details }), 'gate_result', {
        created_at_utc: new Date().toISOString(),
        description: `${gateName}: ${passed ? 'PASS' : 'FAIL'}`,
        tags: [gateName, passed ? 'passed' : 'failed']
    });
}
/**
 * Create LLM response artifact
 */
function createLLMResponseArtifact(response, model, provider, promptHash) {
    return createEvidenceArtifact(response, 'llm_response', {
        created_at_utc: new Date().toISOString(),
        description: `LLM response from ${provider}/${model}`,
        tags: [provider, model],
        related_artifacts: promptHash ? [promptHash] : undefined
    });
}
/**
 * Create code diff artifact
 */
function createCodeDiffArtifact(diff, filepath) {
    return createEvidenceArtifact(diff, 'code_diff', {
        created_at_utc: new Date().toISOString(),
        source_file: filepath,
        description: `diff for ${filepath}`
    });
}
/**
 * Create test result artifact
 */
function createTestResultArtifact(passed, failed, skipped, output) {
    return createEvidenceArtifact(JSON.stringify({ passed, failed, skipped, total: passed + failed + skipped, output }), 'test_result', {
        created_at_utc: new Date().toISOString(),
        description: `tests: ${passed} passed, ${failed} failed, ${skipped} skipped`,
        tags: failed > 0 ? ['has_failures'] : ['all_passed']
    });
}
/**
 * Create file manifest artifact
 */
function createFileManifestArtifact(entries) {
    return createEvidenceArtifact(JSON.stringify({ entries, count: entries.length }), 'file_manifest', {
        created_at_utc: new Date().toISOString(),
        description: `${entries.length} file operations`
    });
}
/**
 * Extract payload as original type
 */
function extractPayload(artifact) {
    if (artifact.payload_encoding === 'base64') {
        return Buffer.from(artifact.payload, 'base64').toString('utf8');
    }
    // Try to parse as JSON
    try {
        return JSON.parse(artifact.payload);
    }
    catch {
        return artifact.payload;
    }
}
/**
 * Collect multiple artifacts into a bundle
 */
function bundleArtifacts(artifacts, description) {
    const ids = artifacts.map(a => a.artifact_id).sort();
    const bundleHash = (0, contentAddress_1.contentAddress)({ artifact_ids: ids });
    return {
        bundle_hash: bundleHash,
        artifacts,
        description
    };
}
