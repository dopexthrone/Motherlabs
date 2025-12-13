"use strict";
// Content Addressing - sha256-based IDs (tamper-proof by design)
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
exports.contentAddress = contentAddress;
exports.canonicalJSON = canonicalJSON;
exports.verifyContentAddress = verifyContentAddress;
exports.extractHash = extractHash;
exports.isValidContentAddress = isValidContentAddress;
const crypto = __importStar(require("crypto"));
/**
 * Compute content-addressed ID for any object
 * Format: sha256:{64-char-hex}
 */
function contentAddress(content) {
    const canonical = canonicalJSON(content);
    const hash = crypto.createHash('sha256').update(canonical).digest('hex');
    return `sha256:${hash}`;
}
/**
 * Canonical JSON serialization (deterministic)
 * - Keys sorted alphabetically
 * - No whitespace
 * - Consistent formatting
 */
function canonicalJSON(obj) {
    if (obj === null)
        return 'null';
    if (obj === undefined)
        return 'null'; // undefined becomes null in JSON
    if (typeof obj === 'string')
        return JSON.stringify(obj);
    if (typeof obj === 'number')
        return String(obj);
    if (typeof obj === 'boolean')
        return String(obj);
    if (Array.isArray(obj)) {
        const items = obj.map(item => canonicalJSON(item));
        return `[${items.join(',')}]`;
    }
    if (typeof obj === 'object') {
        const keys = Object.keys(obj).sort();
        const pairs = keys.map(key => {
            const value = obj[key];
            return `${JSON.stringify(key)}:${canonicalJSON(value)}`;
        });
        return `{${pairs.join(',')}}`;
    }
    throw new Error(`Cannot canonicalize type: ${typeof obj}`);
}
/**
 * Verify content matches its address
 */
function verifyContentAddress(content, address) {
    if (!address.startsWith('sha256:')) {
        throw new Error('Address must start with sha256:');
    }
    const computed = contentAddress(content);
    return computed === address;
}
/**
 * Extract hash from content address
 */
function extractHash(address) {
    if (!address.startsWith('sha256:')) {
        throw new Error('Address must start with sha256:');
    }
    return address.substring(7); // Remove 'sha256:' prefix
}
/**
 * Validate content address format
 */
function isValidContentAddress(address) {
    return /^sha256:[0-9a-f]{64}$/.test(address);
}
