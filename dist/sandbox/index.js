"use strict";
// Sandbox Module - Secure code execution
// Based on Motherlabs Kernel patterns
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNNER_VERSION = exports.DEFAULT_SANDBOX_LIMITS = exports.cleanupRunDir = exports.verifyEvidence = exports.runTestExec = exports.ensureSandboxRoot = exports.cleanupRunDirectory = exports.verifyCodeExecution = exports.executeCode = void 0;
// Legacy executor (for backward compatibility)
var executor_1 = require("./executor");
Object.defineProperty(exports, "executeCode", { enumerable: true, get: function () { return executor_1.executeCode; } });
Object.defineProperty(exports, "verifyCodeExecution", { enumerable: true, get: function () { return executor_1.verifyCodeExecution; } });
Object.defineProperty(exports, "cleanupRunDirectory", { enumerable: true, get: function () { return executor_1.cleanupRunDirectory; } });
Object.defineProperty(exports, "ensureSandboxRoot", { enumerable: true, get: function () { return executor_1.ensureSandboxRoot; } });
// Kernel-grade runner (new)
var runner_1 = require("./runner");
Object.defineProperty(exports, "runTestExec", { enumerable: true, get: function () { return runner_1.runTestExec; } });
Object.defineProperty(exports, "verifyEvidence", { enumerable: true, get: function () { return runner_1.verifyEvidence; } });
Object.defineProperty(exports, "cleanupRunDir", { enumerable: true, get: function () { return runner_1.cleanupRunDir; } });
var types_1 = require("./types");
Object.defineProperty(exports, "DEFAULT_SANDBOX_LIMITS", { enumerable: true, get: function () { return types_1.DEFAULT_SANDBOX_LIMITS; } });
Object.defineProperty(exports, "RUNNER_VERSION", { enumerable: true, get: function () { return types_1.RUNNER_VERSION; } });
