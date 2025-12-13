"use strict";
// Execution Engine - Sandboxed code execution with timeout
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
exports.ExecutionEngine = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const result_1 = require("../core/result");
class ExecutionEngine {
    sandboxDir;
    constructor(config) {
        this.sandboxDir = config.sandboxDir;
        // Ensure sandbox directory exists
        if (!fs.existsSync(this.sandboxDir)) {
            fs.mkdirSync(this.sandboxDir, { recursive: true });
        }
    }
    /**
     * Execute plan in sandbox with timeout
     */
    async execute(plan) {
        const startTime = Date.now(); // DETERMINISM-EXEMPT: Measuring execution time
        try {
            // Validate plan
            if (!plan.code || plan.code.trim().length === 0) {
                return (0, result_1.Err)(new Error('Code is empty'));
            }
            if (!plan.sandbox) {
                return (0, result_1.Err)(new Error('Only sandboxed execution allowed'));
            }
            // Create temp file for code
            const codeFile = path.join(this.sandboxDir, `exec-${Date.now()}.ts`); // DETERMINISM-EXEMPT: Temp file name
            fs.writeFileSync(codeFile, plan.code, 'utf-8');
            // Execute with timeout
            const result = await this.executeWithTimeout(codeFile, plan.type, plan.timeout);
            // Cleanup
            try {
                fs.unlinkSync(codeFile);
            }
            catch {
                // Ignore cleanup errors
            }
            const endTime = Date.now(); // DETERMINISM-EXEMPT: Measuring execution time
            return (0, result_1.Ok)({
                planId: plan.id,
                success: result.exitCode === 0 && !result.timedOut,
                startTime,
                endTime,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                error: result.error,
                evidence: {
                    timedOut: result.timedOut,
                    killed: result.killed,
                    sandboxed: true
                }
            });
        }
        catch (error) {
            const endTime = Date.now(); // DETERMINISM-EXEMPT: Measuring execution time
            return (0, result_1.Ok)({
                planId: plan.id,
                success: false,
                startTime,
                endTime,
                exitCode: 1,
                error: error instanceof Error ? error.message : String(error),
                evidence: {
                    timedOut: false,
                    killed: false,
                    sandboxed: true
                }
            });
        }
    }
    /**
     * Execute with timeout enforcement
     */
    executeWithTimeout(filepath, type, timeout) {
        return new Promise((resolve) => {
            let timedOut = false;
            let killed = false;
            // Determine command based on type
            const command = type === 'typescript' ? 'npx' : 'node';
            const args = type === 'typescript' ? ['tsx', filepath] : [filepath];
            const proc = (0, child_process_1.spawn)(command, args, {
                cwd: this.sandboxDir,
                timeout,
                killSignal: 'SIGTERM'
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            // Timeout handler
            const timeoutId = setTimeout(() => {
                timedOut = true;
                killed = true;
                proc.kill('SIGTERM');
            }, timeout);
            proc.on('close', (code) => {
                clearTimeout(timeoutId);
                resolve({
                    exitCode: code ?? 1,
                    stdout,
                    stderr,
                    error: timedOut ? 'TIMEOUT: Execution exceeded time limit' : undefined,
                    timedOut,
                    killed
                });
            });
            proc.on('error', (err) => {
                clearTimeout(timeoutId);
                resolve({
                    exitCode: 1,
                    stdout,
                    stderr,
                    error: err.message,
                    timedOut: false,
                    killed: false
                });
            });
        });
    }
}
exports.ExecutionEngine = ExecutionEngine;
