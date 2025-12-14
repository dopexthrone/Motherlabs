"use strict";
// Sandbox Module - Secure code execution
// Based on Motherlabs Kernel patterns
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSandboxRoot = exports.cleanupRunDirectory = exports.verifyCodeExecution = exports.executeCode = void 0;
var executor_1 = require("./executor");
Object.defineProperty(exports, "executeCode", { enumerable: true, get: function () { return executor_1.executeCode; } });
Object.defineProperty(exports, "verifyCodeExecution", { enumerable: true, get: function () { return executor_1.verifyCodeExecution; } });
Object.defineProperty(exports, "cleanupRunDirectory", { enumerable: true, get: function () { return executor_1.cleanupRunDirectory; } });
Object.defineProperty(exports, "ensureSandboxRoot", { enumerable: true, get: function () { return executor_1.ensureSandboxRoot; } });
