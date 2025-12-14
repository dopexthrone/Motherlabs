"use strict";
// Result<T,E> - Structured error handling (no exceptions in business logic)
// CONSTITUTIONAL FOUNDATION - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 1 (Deterministic Authority) via explicit Ok/Err returns
// TCB Component: This file is part of the Trusted Computing Base
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ok = Ok;
exports.Err = Err;
exports.createError = createError;
exports.mapResult = mapResult;
exports.andThen = andThen;
exports.unwrap = unwrap;
exports.unwrapOr = unwrapOr;
exports.toErrors = toErrors;
exports.combineResults = combineResults;
/**
 * Create success result
 */
function Ok(value) {
    return { ok: true, value };
}
/**
 * Create error result
 */
function Err(error) {
    return { ok: false, error };
}
/**
 * Create structured error
 */
function createError(code, message, context, cause) {
    return { code, message, context, cause };
}
/**
 * Map Result value if ok
 */
function mapResult(result, fn) {
    if (result.ok) {
        return Ok(fn(result.value));
    }
    return result;
}
/**
 * Chain Result operations (flatMap)
 */
function andThen(result, fn) {
    if (result.ok) {
        return fn(result.value);
    }
    return result;
}
/**
 * Unwrap result or throw (use sparingly, only at boundaries)
 */
function unwrap(result) {
    if (result.ok) {
        return result.value;
    }
    if (result.error instanceof Error) {
        throw result.error;
    }
    throw new Error(String(result.error));
}
/**
 * Unwrap or provide default
 */
function unwrapOr(result, defaultValue) {
    return result.ok ? result.value : defaultValue;
}
/**
 * Convert Result to error array (for validation)
 */
function toErrors(result) {
    return result.ok ? [] : [result.error];
}
/**
 * Combine multiple Results (all must succeed)
 */
function combineResults(results) {
    const values = [];
    for (const result of results) {
        if (!result.ok) {
            return result;
        }
        values.push(result.value);
    }
    return Ok(values);
}
