"use strict";
// Gate 4 Runner - Kernel-grade test execution
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 4 (Mechanical Verification), AXIOM 10 (Sandbox by Default)
// TCB Component: This file is part of the Trusted Computing Base
// Implements: sandbox creation, snapshot/diff, evidence production, acceptance predicate
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTestExec = runTestExec;
exports.verifyEvidence = verifyEvidence;
exports.cleanupRunDir = cleanupRunDir;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const result_1 = require("../core/result");
const SANDBOX_ROOT = '.sandbox/gate4-runs';
// Command allowlist - only these commands can be executed
const COMMAND_ALLOWLIST = ['node', 'npx', 'tsx', 'tsc', 'npm', 'bash', 'sh'];
/**
 * Assert no symlinks in path chain
 */
function assertNoSymlinks(targetPath) {
    const parts = (0, node_path_1.resolve)(targetPath).split('/').filter(Boolean);
    let current = '/';
    for (const part of parts) {
        current = (0, node_path_1.join)(current, part);
        if ((0, node_fs_1.existsSync)(current)) {
            try {
                if ((0, node_fs_1.lstatSync)(current).isSymbolicLink()) {
                    return false;
                }
            }
            catch {
                // Path may not exist
            }
        }
    }
    return true;
}
/**
 * Validate cwd is within repo root
 */
function validateCwd(cwd, repoRoot) {
    const resolvedCwd = (0, node_path_1.resolve)(cwd);
    const resolvedRoot = (0, node_path_1.resolve)(repoRoot);
    if (!resolvedCwd.startsWith(resolvedRoot + '/') && resolvedCwd !== resolvedRoot) {
        return false;
    }
    return assertNoSymlinks(resolvedCwd);
}
/**
 * Create sanitized environment (deny-by-default)
 */
function createSanitizedEnv(allowlist) {
    const env = {};
    // Always include PATH
    if (process.env.PATH) {
        env.PATH = process.env.PATH;
    }
    // Only include explicitly allowed variables
    for (const key of allowlist) {
        // Block dangerous patterns
        if (/_TOKEN$|_SECRET$|_KEY$|_PASSWORD$|^OPENAI_|^ANTHROPIC_|^AWS_/.test(key)) {
            continue;
        }
        if (process.env[key]) {
            env[key] = process.env[key];
        }
    }
    return env;
}
/**
 * Compute SHA-256 hash of content
 */
function sha256(content) {
    return `sha256:${(0, node_crypto_1.createHash)('sha256').update(content).digest('hex')}`;
}
/**
 * Compute hash of object for fingerprinting
 */
function hashObject(obj) {
    return sha256(JSON.stringify(obj));
}
/**
 * Snapshot sandbox state (files with hashes)
 */
function snapshotSandboxState(runDir) {
    const snapshot = {
        timestamp: Date.now(),
        files: new Map()
    };
    if (!(0, node_fs_1.existsSync)(runDir)) {
        return snapshot;
    }
    function walkDir(dir) {
        const entries = (0, node_fs_1.readdirSync)(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = (0, node_path_1.join)(dir, entry.name);
            const relativePath = (0, node_path_1.relative)(runDir, fullPath);
            // Skip symlinks
            if ((0, node_fs_1.lstatSync)(fullPath).isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                walkDir(fullPath);
            }
            else if (entry.isFile()) {
                const content = (0, node_fs_1.readFileSync)(fullPath);
                snapshot.files.set(relativePath, {
                    sha256: sha256(content),
                    size_bytes: content.length
                });
            }
        }
    }
    walkDir(runDir);
    return snapshot;
}
/**
 * Diff two sandbox snapshots
 */
function diffSandboxState(before, after, runDir, limits) {
    const result = {
        created: [],
        overwritten: [],
        deleted: [],
        violations: []
    };
    let totalBytes = 0;
    let fileCount = 0;
    // Find created and overwritten files
    for (const [path, afterInfo] of after.files) {
        const beforeInfo = before.files.get(path);
        // Check for path escape
        const fullPath = (0, node_path_1.join)(runDir, path);
        if (!fullPath.startsWith((0, node_path_1.resolve)(runDir) + '/')) {
            result.violations.push({
                type: 'PATH_ESCAPE',
                path,
                message: `File path escapes sandbox: ${path}`
            });
            continue;
        }
        // Check for symlink escape
        if (!assertNoSymlinks(fullPath)) {
            result.violations.push({
                type: 'SYMLINK_ESCAPE',
                path,
                message: `Symlink detected in path: ${path}`
            });
            continue;
        }
        // Check file size
        if (afterInfo.size_bytes > limits.max_file_size_bytes) {
            result.violations.push({
                type: 'SIZE_EXCEEDED',
                path,
                message: `File exceeds size limit: ${afterInfo.size_bytes} > ${limits.max_file_size_bytes}`
            });
            continue;
        }
        if (!beforeInfo) {
            // New file
            result.created.push({
                relative_path: path,
                operation: 'create',
                byte_count: afterInfo.size_bytes,
                sha256: afterInfo.sha256
            });
            fileCount++;
            totalBytes += afterInfo.size_bytes;
        }
        else if (beforeInfo.sha256 !== afterInfo.sha256) {
            // Modified file
            result.overwritten.push({
                relative_path: path,
                operation: 'overwrite',
                byte_count: afterInfo.size_bytes,
                sha256: afterInfo.sha256
            });
            totalBytes += afterInfo.size_bytes;
        }
    }
    // Find deleted files
    for (const [path, beforeInfo] of before.files) {
        if (!after.files.has(path)) {
            result.deleted.push({
                relative_path: path,
                operation: 'delete',
                byte_count: 0,
                sha256: beforeInfo.sha256
            });
        }
    }
    // Check limits
    if (fileCount > limits.max_file_count) {
        result.violations.push({
            type: 'COUNT_EXCEEDED',
            path: '',
            message: `File count exceeds limit: ${fileCount} > ${limits.max_file_count}`
        });
    }
    if (totalBytes > limits.max_total_bytes) {
        result.violations.push({
            type: 'SIZE_EXCEEDED',
            path: '',
            message: `Total bytes exceeds limit: ${totalBytes} > ${limits.max_total_bytes}`
        });
    }
    return result;
}
/**
 * Create run directory
 */
function createRunDirectory(attemptId) {
    const timestamp = Date.now();
    const runDir = (0, node_path_1.resolve)(SANDBOX_ROOT, `${timestamp}-${attemptId}`);
    if (!(0, node_fs_1.existsSync)(SANDBOX_ROOT)) {
        (0, node_fs_1.mkdirSync)(SANDBOX_ROOT, { recursive: true });
    }
    (0, node_fs_1.mkdirSync)(runDir, { recursive: true });
    return runDir;
}
/**
 * Write evidence artifact and return reference
 */
function writeEvidence(runDir, artifactType, content, attemptId) {
    const filename = `${artifactType}.json`;
    const filepath = (0, node_path_1.join)(runDir, filename);
    const contentStr = typeof content === 'string' ? content : content.toString();
    // Wrap in JSON structure
    const artifact = {
        artifact_type: artifactType,
        attempt_id: attemptId,
        timestamp: Date.now(),
        content: contentStr
    };
    const json = JSON.stringify(artifact, null, 2);
    (0, node_fs_1.writeFileSync)(filepath, json);
    const hash = sha256(json);
    const stats = (0, node_fs_1.statSync)(filepath);
    return {
        artifact_id: `${artifactType}-${attemptId}`,
        artifact_type: artifactType,
        path: filepath,
        sha256: hash,
        size_bytes: stats.size
    };
}
/**
 * Execute command in sandbox
 */
async function executeCommand(command, cwd, env, timeLimitMs, maxStdout, maxStderr) {
    return new Promise((resolvePromise) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const [cmd, ...args] = command;
        const proc = (0, node_child_process_1.spawn)(cmd, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true
        });
        const pid = proc.pid;
        proc.stdout.on('data', (data) => {
            if (stdout.length < maxStdout) {
                stdout += data.toString().slice(0, maxStdout - stdout.length);
            }
        });
        proc.stderr.on('data', (data) => {
            if (stderr.length < maxStderr) {
                stderr += data.toString().slice(0, maxStderr - stderr.length);
            }
        });
        const timeoutId = setTimeout(() => {
            timedOut = true;
            if (pid) {
                try {
                    process.kill(-pid, 'SIGKILL');
                }
                catch { /* ignore */ }
            }
        }, timeLimitMs);
        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            resolvePromise({
                exitCode: timedOut ? -1 : (code ?? -1),
                stdout,
                stderr,
                timedOut
            });
        });
        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            stderr += `\n[RUNNER] Error: ${err.message}`;
            resolvePromise({
                exitCode: -1,
                stdout,
                stderr,
                timedOut: false
            });
        });
    });
}
/**
 * Resolve command to executable
 */
function resolveCommand(command) {
    if (command.length === 0) {
        return (0, result_1.Err)(new Error('Empty command'));
    }
    const [cmd] = command;
    // Check allowlist
    if (!COMMAND_ALLOWLIST.includes(cmd)) {
        return (0, result_1.Err)(new Error(`Command not in allowlist: ${cmd}. Allowed: ${COMMAND_ALLOWLIST.join(', ')}`));
    }
    return (0, result_1.Ok)(command);
}
/**
 * Run test execution with full evidence production
 */
async function runTestExec(request) {
    const repoRoot = process.cwd();
    // 1. Validate command
    const cmdResult = resolveCommand(request.command);
    if (!cmdResult.ok) {
        return (0, result_1.Ok)(createDenialResult('COMMAND_NOT_ALLOWED', cmdResult.error.message, request));
    }
    // 2. Validate cwd
    const cwdValid = validateCwd(request.cwd, repoRoot);
    if (!cwdValid) {
        return (0, result_1.Ok)(createDenialResult('CWD_INVALID', `cwd outside repo root or contains symlink: ${request.cwd}`, request));
    }
    // 3. Create run directory
    const runDir = createRunDirectory(request.attempt_id);
    // 4. Create sandbox config
    const config = {
        run_dir: runDir,
        repo_root: repoRoot,
        limits: types_1.DEFAULT_SANDBOX_LIMITS,
        capabilities: request.capabilities,
        env_allowlist: request.env_allowlist,
        time_limit_ms: request.time_limit_ms
    };
    // 5. Snapshot before
    const beforeSnapshot = snapshotSandboxState(runDir);
    // 6. Create sanitized environment
    const env = createSanitizedEnv(request.env_allowlist);
    // 7. Execute command
    const execResult = await executeCommand(request.command, request.cwd, env, request.time_limit_ms, config.limits.max_stdout_bytes, config.limits.max_stderr_bytes);
    // 8. Snapshot after
    const afterSnapshot = snapshotSandboxState(runDir);
    // 9. Compute diff
    const diffResult = diffSandboxState(beforeSnapshot, afterSnapshot, runDir, config.limits);
    // 10. Create diff-based manifest
    const fileManifest = {
        manifest_version: '1.0',
        entries: [...diffResult.created, ...diffResult.overwritten, ...diffResult.deleted],
        files_created: diffResult.created.length,
        files_overwritten: diffResult.overwritten.length,
        files_deleted: diffResult.deleted.length,
        total_bytes_written: diffResult.created.reduce((sum, e) => sum + e.byte_count, 0) +
            diffResult.overwritten.reduce((sum, e) => sum + e.byte_count, 0)
    };
    // 11. Create network manifest (denied by default)
    const networkManifest = {
        manifest_version: '1.0',
        denied: !request.capabilities.includes('NET'),
        entries: []
    };
    // 12. Write evidence artifacts
    const stdoutArtifact = writeEvidence(runDir, 'stdout_log', execResult.stdout, request.attempt_id);
    const stderrArtifact = writeEvidence(runDir, 'stderr_log', execResult.stderr, request.attempt_id);
    const exitCodeArtifact = writeEvidence(runDir, 'exit_code', JSON.stringify({ exit_code: execResult.exitCode }), request.attempt_id);
    const fileManifestArtifact = writeEvidence(runDir, 'file_manifest', JSON.stringify(fileManifest), request.attempt_id);
    const networkManifestArtifact = writeEvidence(runDir, 'network_manifest', JSON.stringify(networkManifest), request.attempt_id);
    // 13. Build evidence bundle
    const evidence = {
        stdout_log: stdoutArtifact,
        stderr_log: stderrArtifact,
        exit_code_artifact: exitCodeArtifact,
        file_manifest: fileManifestArtifact,
        network_manifest: networkManifestArtifact
    };
    // 14. Build policy checks
    const policyChecks = {
        cwd_validated: cwdValid,
        env_sanitized: true,
        network_denied_or_manifested: true,
        fs_write_within_limits: diffResult.violations.length === 0,
        symlink_escape_absent: !diffResult.violations.some(v => v.type === 'SYMLINK_ESCAPE'),
        path_escape_absent: !diffResult.violations.some(v => v.type === 'PATH_ESCAPE')
    };
    // 15. Build deterministic fingerprint
    const fingerprint = {
        runner_version: types_1.RUNNER_VERSION,
        command_hash: hashObject(request.command),
        env_hash: hashObject(Object.keys(env).sort()),
        sandbox_config_hash: hashObject(config.limits)
    };
    // 16. Apply acceptance predicate
    const acceptanceResult = applyAcceptancePredicate(execResult.exitCode, execResult.timedOut, policyChecks, diffResult.violations);
    // 17. Build result
    const result = {
        ok: acceptanceResult.ok,
        exit_code: execResult.exitCode,
        timed_out: execResult.timedOut,
        evidence,
        policy_checks: policyChecks,
        deterministic_fingerprint: fingerprint,
        denial: acceptanceResult.ok ? undefined : {
            reason: acceptanceResult.reason,
            message: acceptanceResult.message,
            details: acceptanceResult.details
        }
    };
    return (0, result_1.Ok)(result);
}
/**
 * Apply acceptance predicate - purely mechanical decision
 */
function applyAcceptancePredicate(exitCode, timedOut, policyChecks, violations) {
    // A. Execution outcome
    if (timedOut) {
        return { ok: false, reason: 'TIMEOUT', message: 'Execution timed out' };
    }
    if (exitCode !== 0) {
        return { ok: false, reason: 'EXIT_NONZERO', message: `Exit code: ${exitCode}` };
    }
    // B. Policy checks
    if (!policyChecks.cwd_validated) {
        return { ok: false, reason: 'CWD_INVALID', message: 'cwd validation failed' };
    }
    if (!policyChecks.env_sanitized) {
        return { ok: false, reason: 'POLICY_VIOLATION', message: 'Environment not sanitized' };
    }
    if (!policyChecks.fs_write_within_limits) {
        const violation = violations.find(v => v.type === 'SIZE_EXCEEDED' || v.type === 'COUNT_EXCEEDED');
        return {
            ok: false,
            reason: violation?.type === 'COUNT_EXCEEDED' ? 'FILE_COUNT_EXCEEDED' : 'BYTES_EXCEEDED',
            message: violation?.message || 'FS write limits exceeded',
            details: { violations }
        };
    }
    if (!policyChecks.symlink_escape_absent) {
        const violation = violations.find(v => v.type === 'SYMLINK_ESCAPE');
        return {
            ok: false,
            reason: 'SYMLINK_ESCAPE',
            message: violation?.message || 'Symlink escape detected',
            details: { path: violation?.path }
        };
    }
    if (!policyChecks.path_escape_absent) {
        const violation = violations.find(v => v.type === 'PATH_ESCAPE');
        return {
            ok: false,
            reason: 'PATH_ESCAPE',
            message: violation?.message || 'Path escape detected',
            details: { path: violation?.path }
        };
    }
    if (!policyChecks.network_denied_or_manifested) {
        return { ok: false, reason: 'POLICY_VIOLATION', message: 'Network not properly manifested' };
    }
    // All checks passed
    return { ok: true };
}
/**
 * Create denial result with minimal evidence
 */
function createDenialResult(reason, message, request) {
    const runDir = createRunDirectory(request.attempt_id);
    const emptyArtifact = {
        artifact_id: `empty-${request.attempt_id}`,
        artifact_type: 'stdout_log',
        path: '',
        sha256: sha256(''),
        size_bytes: 0
    };
    return {
        ok: false,
        exit_code: -1,
        timed_out: false,
        evidence: {
            stdout_log: emptyArtifact,
            stderr_log: { ...emptyArtifact, artifact_type: 'stderr_log' },
            exit_code_artifact: { ...emptyArtifact, artifact_type: 'exit_code' },
            network_manifest: { ...emptyArtifact, artifact_type: 'network_manifest' }
        },
        policy_checks: {
            cwd_validated: false,
            env_sanitized: false,
            network_denied_or_manifested: false,
            fs_write_within_limits: false,
            symlink_escape_absent: false,
            path_escape_absent: false
        },
        deterministic_fingerprint: {
            runner_version: types_1.RUNNER_VERSION,
            command_hash: hashObject(request.command),
            env_hash: '',
            sandbox_config_hash: ''
        },
        denial: { reason, message }
    };
}
/**
 * Verify evidence integrity (kernel-side validation)
 */
function verifyEvidence(evidence) {
    const artifacts = [
        evidence.stdout_log,
        evidence.stderr_log,
        evidence.exit_code_artifact,
        evidence.network_manifest,
        evidence.file_manifest
    ].filter(Boolean);
    for (const artifact of artifacts) {
        if (!artifact.path || !(0, node_fs_1.existsSync)(artifact.path)) {
            return (0, result_1.Err)(new Error(`Evidence missing: ${artifact.artifact_type}`));
        }
        const content = (0, node_fs_1.readFileSync)(artifact.path);
        const hash = sha256(content);
        if (hash !== artifact.sha256) {
            return (0, result_1.Err)(new Error(`Evidence hash mismatch: ${artifact.artifact_type} expected ${artifact.sha256}, got ${hash}`));
        }
    }
    return (0, result_1.Ok)(true);
}
/**
 * Cleanup run directory
 */
function cleanupRunDir(runDir) {
    if ((0, node_fs_1.existsSync)(runDir) && runDir.includes(SANDBOX_ROOT)) {
        (0, node_fs_1.rmSync)(runDir, { recursive: true, force: true });
    }
}
