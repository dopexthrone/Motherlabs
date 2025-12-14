"use strict";
// Gate 4 Types - Kernel-grade test execution
// Based on Motherlabs Kernel specification
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNNER_VERSION = exports.DEFAULT_SANDBOX_LIMITS = void 0;
/**
 * Default sandbox limits
 */
exports.DEFAULT_SANDBOX_LIMITS = {
    max_file_size_bytes: 10 * 1024 * 1024, // 10 MB per file
    max_total_bytes: 100 * 1024 * 1024, // 100 MB total
    max_file_count: 1000, // Max 1000 files
    max_stdout_bytes: 5 * 1024 * 1024, // 5 MB stdout
    max_stderr_bytes: 5 * 1024 * 1024 // 5 MB stderr
};
/**
 * Runner version for fingerprinting
 */
exports.RUNNER_VERSION = '1.0.0';
