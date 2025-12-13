"use strict";
// Deterministic ID Generation - Monotonic, reproducible // DETERMINISM-EXEMPT: comment only
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalTimeProvider = exports.DeterministicTimeProvider = exports.RealTimeProvider = exports.globalIdGenerator = exports.IdGenerator = void 0;
exports.setTimeProvider = setTimeProvider;
/**
 * ID generator with monotonic counter (deterministic)
 * Replaces timestamp generation which breaks determinism/replay // DETERMINISM-EXEMPT: comment
 */
class IdGenerator {
    counters = new Map();
    /**
     * Generate deterministic ID for evidence
     * Format: {taskId}-{type}-{sequence}
     */
    evidenceId(taskId, type) {
        const key = `${taskId}:${type}`;
        const current = this.counters.get(key) || 0;
        const next = current + 1;
        this.counters.set(key, next);
        return `${taskId}-${type}-${next}`;
    }
    /**
     * Generate deterministic ID for any entity
     * Format: {prefix}-{sequence}
     */
    generate(prefix) {
        const current = this.counters.get(prefix) || 0;
        const next = current + 1;
        this.counters.set(prefix, next);
        return `${prefix}-${next}`;
    }
    /**
     * Reset counter (for testing)
     */
    reset() {
        this.counters.clear();
    }
    /**
     * Get current state (for replay/serialization)
     */
    getState() {
        return Object.fromEntries(this.counters.entries());
    }
    /**
     * Restore state (for replay/deserialization)
     */
    setState(state) {
        this.counters = new Map(Object.entries(state));
    }
}
exports.IdGenerator = IdGenerator;
/**
 * Global ID generator instance
 * Note: For true determinism in tests, inject IdGenerator as dependency
 */
exports.globalIdGenerator = new IdGenerator();
/**
 * Real time provider (uses Date.now)
 */
class RealTimeProvider {
    now() {
        return Date.now(); // DETERMINISM-EXEMPT: TimeProvider abstraction - isolates non-determinism
    }
}
exports.RealTimeProvider = RealTimeProvider;
/**
 * Deterministic time provider (for testing/replay)
 */
class DeterministicTimeProvider {
    currentTime;
    constructor(startTime = 0) {
        this.currentTime = startTime;
    }
    now() {
        return this.currentTime;
    }
    advance(ms) {
        this.currentTime += ms;
    }
    set(time) {
        this.currentTime = time;
    }
}
exports.DeterministicTimeProvider = DeterministicTimeProvider;
/**
 * Global time provider (injectable for tests)
 */
exports.globalTimeProvider = new RealTimeProvider();
function setTimeProvider(provider) {
    exports.globalTimeProvider = provider;
}
