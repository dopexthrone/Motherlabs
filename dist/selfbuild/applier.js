"use strict";
// Auto-Applier - Apply changes with automatic rollback on failure
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
exports.AutoApplier = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const result_1 = require("../core/result");
const ids_1 = require("../core/ids");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class AutoApplier {
    repoPath;
    constructor(repoPath = '/home/motherlabs/motherlabs-runtime') {
        this.repoPath = repoPath;
    }
    /**
     * Apply proposal with automatic rollback on failure
     */
    async apply(proposal) {
        try {
            // 1. Get current commit (checkpoint for rollback)
            const beforeCommit = await this.getCurrentCommit();
            // 2. Apply the change
            const applied = await this.applyChange(proposal);
            if (!applied.ok) {
                return (0, result_1.Ok)({
                    success: false,
                    proposalId: proposal.id,
                    beforeCommit,
                    timestamp: ids_1.globalTimeProvider.now(),
                    rolledBack: false,
                    error: applied.error.message
                });
            }
            // 3. Commit the change
            await this.gitCommit(`self-improve: ${proposal.issue.type}`, proposal.rationale);
            // 4. Run all tests to verify
            const testResults = await this.runAllTests();
            // 5. If tests fail → AUTOMATIC ROLLBACK
            if (!testResults.allPass) {
                await this.rollback(beforeCommit);
                return (0, result_1.Ok)({
                    success: false,
                    proposalId: proposal.id,
                    beforeCommit,
                    timestamp: ids_1.globalTimeProvider.now(),
                    rolledBack: true,
                    testResults,
                    error: 'Tests failed after apply - rolled back'
                });
            }
            // 6. Success - get new commit
            const afterCommit = await this.getCurrentCommit();
            return (0, result_1.Ok)({
                success: true,
                proposalId: proposal.id,
                beforeCommit,
                afterCommit,
                timestamp: ids_1.globalTimeProvider.now(),
                rolledBack: false,
                testResults
            });
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Apply change to file system
     */
    async applyChange(proposal) {
        try {
            const { targetFile, proposedChange } = proposal;
            if (proposedChange.type === 'add_test') {
                // Create test file
                const testPath = targetFile.replace(/\.ts$/, '.test.ts').replace(/^src\//, 'tests/');
                fs.writeFileSync(testPath, proposedChange.code, 'utf-8');
            }
            else if (proposedChange.type === 'add_function') {
                // Append to existing file
                const existing = fs.readFileSync(targetFile, 'utf-8');
                fs.writeFileSync(targetFile, existing + '\n' + proposedChange.code, 'utf-8');
            }
            // Other types would be implemented here
            return (0, result_1.Ok)(void 0);
        }
        catch (error) {
            return (0, result_1.Err)(error instanceof Error ? error : new Error(String(error)));
        }
    }
    /**
     * Get current git commit hash
     */
    async getCurrentCommit() {
        const { stdout } = await execAsync('git rev-parse HEAD', { cwd: this.repoPath });
        return stdout.trim();
    }
    /**
     * Commit changes
     */
    async gitCommit(message, body) {
        const fullMessage = body ? `${message}\n\n${body}` : message;
        await execAsync(`git add -A && git commit -m "${fullMessage}"`, { cwd: this.repoPath });
    }
    /**
     * Rollback to previous commit
     */
    async rollback(commitHash) {
        await execAsync(`git reset --hard ${commitHash}`, { cwd: this.repoPath });
    }
    /**
     * Run all tests and return results
     */
    async runAllTests() {
        try {
            await execAsync('npm test', { cwd: this.repoPath, timeout: 60000 });
            return {
                passed: 198, // UNIMPLEMENTED: Parse actual test count
                failed: 0,
                allPass: true
            };
        }
        catch (error) {
            return {
                passed: 0,
                failed: 1, // UNIMPLEMENTED: Parse actual failure count
                allPass: false
            };
        }
    }
}
exports.AutoApplier = AutoApplier;
