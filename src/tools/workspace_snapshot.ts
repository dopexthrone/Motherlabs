#!/usr/bin/env node
/**
 * Workspace Snapshot CLI
 * ======================
 *
 * Captures deterministic workspace state for reproducibility auditing.
 * Ensures no secrets or absolute paths leak into the snapshot.
 *
 * Usage:
 *   npm run workspace-snapshot -- --out <file> [options]
 *   npm run workspace-snapshot -- --verify <file>
 *
 * Options:
 *   --out <file>        Write output to file
 *   --intent <file>     Reference intent file (required for pack-export)
 *   --pack <dir>        Reference pack directory (required for pack-apply/git-apply)
 *   --model-io <file>   Reference model IO recording
 *   --repo-state <file> Reference repo state file
 *   --policy <name>     Policy profile (strict|default|dev)
 *   --mode <mode>       Execution mode (plan|exec)
 *   --tool <id>         Tool ID (pack-export|pack-apply|git-apply|repo-state|workspace-snapshot)
 *   --dry-run           Dry run mode
 *   --env-allow <name>  Add env var to allowlist (repeatable)
 *   --verify <file>     Verify an existing workspace snapshot
 *
 * Exit codes:
 *   0 - Success
 *   1 - I/O error
 *   2 - Parse error
 *   3 - Validation error
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type {
  WorkspaceSnapshot,
  WorkspaceRefs,
  WorkspaceEnv,
  EnvHashedEntry,
  ToolId,
} from '../consumer/workspace_types.js';
import {
  WORKSPACE_SCHEMA_VERSION,
  VALID_TOOL_IDS,
  DEFAULT_ENV_ALLOWLIST,
  FORBIDDEN_ENV_NAMES,
  FORBIDDEN_ENV_PREFIXES,
} from '../consumer/workspace_types.js';
import {
  verifyWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
} from '../consumer/workspace_verify.js';
import { canonicalize, canonicalHash } from '../utils/canonical.js';
import { loadPolicy } from '../harness/policy.js';
import { verifyPack } from '../consumer/pack_verify.js';

// Exit codes
const EXIT_OK = 0;
const EXIT_IO_ERROR = 1;
const EXIT_PARSE_ERROR = 2;
const EXIT_VALIDATION_ERROR = 3;

/**
 * Get the project root directory.
 */
function getProjectRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), '..', '..');
}

/**
 * Get the package version.
 */
function getPackageVersion(): string {
  try {
    const pkgPath = resolve(getProjectRoot(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run workspace-snapshot -- [options]

Captures deterministic workspace state for reproducibility auditing.

Options:
  --out <file>        Write output to file (default: stdout)
  --intent <file>     Reference intent file
  --pack <dir>        Reference pack directory
  --model-io <file>   Reference model IO recording
  --repo-state <file> Reference repo state file
  --policy <name>     Policy profile (strict|default|dev) (default: default)
  --mode <mode>       Execution mode (plan|exec)
  --tool <id>         Tool ID (default: workspace-snapshot)
  --dry-run           Dry run mode
  --env-allow <name>  Add env var to allowlist (repeatable)
  --verify <file>     Verify an existing workspace snapshot
  --help, -h          Show this help message

Exit codes:
  0 - Success
  1 - I/O error
  2 - Parse error
  3 - Validation error

Examples:
  npm run workspace-snapshot -- --out snapshot.json --intent intent.json --policy strict
  npm run workspace-snapshot -- --verify snapshot.json`);
  process.exit(EXIT_IO_ERROR);
}

/**
 * Compute SHA256 hash of a file.
 */
function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

/**
 * Compute SHA256 hash of a string.
 */
function hashString(value: string): string {
  const hash = createHash('sha256').update(value, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Sanitize path to relative form.
 */
function sanitizePath(filePath: string, workRoot: string): string {
  const absPath = resolve(filePath);
  const relPath = relative(workRoot, absPath);

  // Reject traversal
  if (relPath.startsWith('..') || relPath.includes('/..')) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }

  // Reject absolute paths
  if (relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)) {
    throw new Error(`Absolute path detected: ${filePath}`);
  }

  return relPath;
}

/**
 * Check if env var name is forbidden.
 */
function isForbiddenEnvName(name: string): boolean {
  if ((FORBIDDEN_ENV_NAMES as readonly string[]).includes(name)) {
    return true;
  }
  for (const prefix of FORBIDDEN_ENV_PREFIXES) {
    if (name.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Parsed command line arguments.
 */
interface ParsedArgs {
  mode: 'generate' | 'verify';
  outFile?: string;
  verifyFile?: string;
  intentFile?: string;
  packDir?: string;
  modelIOFile?: string;
  repoStateFile?: string;
  policyProfile: string;
  execMode?: string;
  toolId: ToolId;
  dryRun: boolean;
  envAllow: string[];
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    mode: 'generate',
    policyProfile: 'default',
    toolId: 'workspace-snapshot',
    dryRun: false,
    envAllow: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      printUsage();
    } else if (arg === '--out' && args[i + 1]) {
      result.outFile = args[i + 1]!;
      i++;
    } else if (arg === '--verify' && args[i + 1]) {
      result.verifyFile = args[i + 1]!;
      result.mode = 'verify';
      i++;
    } else if (arg === '--intent' && args[i + 1]) {
      result.intentFile = args[i + 1]!;
      i++;
    } else if (arg === '--pack' && args[i + 1]) {
      result.packDir = args[i + 1]!;
      i++;
    } else if (arg === '--model-io' && args[i + 1]) {
      result.modelIOFile = args[i + 1]!;
      i++;
    } else if (arg === '--repo-state' && args[i + 1]) {
      result.repoStateFile = args[i + 1]!;
      i++;
    } else if (arg === '--policy' && args[i + 1]) {
      result.policyProfile = args[i + 1]!;
      i++;
    } else if (arg === '--mode' && args[i + 1]) {
      result.execMode = args[i + 1]!;
      i++;
    } else if (arg === '--tool' && args[i + 1]) {
      const toolId = args[i + 1]!;
      if ((VALID_TOOL_IDS as readonly string[]).includes(toolId)) {
        result.toolId = toolId as ToolId;
      }
      i++;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--env-allow' && args[i + 1]) {
      const envName = args[i + 1]!;
      if (!isForbiddenEnvName(envName)) {
        result.envAllow.push(envName);
      }
      i++;
    }
  }

  return result;
}

/**
 * Verify an existing workspace snapshot file.
 */
function verifyFile(filePath: string): number {
  const fullPath = resolve(filePath);

  if (!existsSync(fullPath)) {
    console.error(canonicalize({
      ok: false,
      error: `File not found: ${filePath}`,
    }));
    return EXIT_IO_ERROR;
  }

  let content: string;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch (err) {
    console.error(canonicalize({
      ok: false,
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    }));
    return EXIT_IO_ERROR;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error(canonicalize({
      ok: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }));
    return EXIT_PARSE_ERROR;
  }

  const result = verifyWorkspaceSnapshot(parsed);

  if (result.valid) {
    console.log(canonicalize({
      ok: true,
      file: filePath,
      workspace_hash: result.workspace_hash,
    }));
    return EXIT_OK;
  } else {
    console.log(canonicalize({
      ok: false,
      file: filePath,
      violations: result.violations,
    }));
    return EXIT_VALIDATION_ERROR;
  }
}

/**
 * Generate workspace snapshot.
 */
function generateSnapshot(parsedArgs: ParsedArgs): WorkspaceSnapshot | null {
  const workRoot = process.cwd();

  // Build args object (sorted keys, sorted arrays)
  const argsMap: Record<string, string | boolean | string[]> = {};

  if (parsedArgs.dryRun) {
    argsMap.dry_run = true;
  }
  if (parsedArgs.execMode) {
    argsMap.mode = parsedArgs.execMode;
  }
  argsMap.policy = parsedArgs.policyProfile;

  // Build refs
  const refs: WorkspaceRefs = {
    policy: {
      profile: parsedArgs.policyProfile,
      policy_hash: '',
    },
  };

  // Compute policy hash
  try {
    const policy = loadPolicy(parsedArgs.policyProfile as 'strict' | 'default' | 'dev');
    refs.policy.policy_hash = `sha256:${canonicalHash(policy)}`;
  } catch (err) {
    console.error(canonicalize({
      ok: false,
      error: `Failed to load policy: ${err instanceof Error ? err.message : String(err)}`,
    }));
    return null;
  }

  // Intent ref
  if (parsedArgs.intentFile) {
    const intentPath = resolve(parsedArgs.intentFile);
    if (!existsSync(intentPath)) {
      console.error(canonicalize({
        ok: false,
        error: `Intent file not found: ${parsedArgs.intentFile}`,
      }));
      return null;
    }

    try {
      const relPath = sanitizePath(intentPath, workRoot);
      refs.intent = {
        rel_path: relPath,
        sha256: hashFile(intentPath),
      };
    } catch (err) {
      console.error(canonicalize({
        ok: false,
        error: `Invalid intent path: ${err instanceof Error ? err.message : String(err)}`,
      }));
      return null;
    }
  }

  // Pack ref
  if (parsedArgs.packDir) {
    const packPath = resolve(parsedArgs.packDir);
    if (!existsSync(packPath) || !statSync(packPath).isDirectory()) {
      console.error(canonicalize({
        ok: false,
        error: `Pack directory not found: ${parsedArgs.packDir}`,
      }));
      return null;
    }

    try {
      const relPath = sanitizePath(packPath, workRoot);

      // Verify pack and get hash (skip deep validation and reference checks for workspace snapshot)
      const packResult = verifyPack(packPath, { deepValidation: false, verifyReferences: false });
      if (!packResult.ok) {
        console.error(canonicalize({
          ok: false,
          error: 'Pack verification failed',
          violations: packResult.violations,
        }));
        return null;
      }

      // Compute pack hash from files_verified list
      const packHash = `sha256:${canonicalHash({ files: packResult.files_verified.sort() })}`;

      refs.pack = {
        rel_path: relPath,
        pack_hash: packHash,
      };
    } catch (err) {
      console.error(canonicalize({
        ok: false,
        error: `Invalid pack path: ${err instanceof Error ? err.message : String(err)}`,
      }));
      return null;
    }
  }

  // Model IO ref
  if (parsedArgs.modelIOFile) {
    const modelIOPath = resolve(parsedArgs.modelIOFile);
    if (!existsSync(modelIOPath)) {
      console.error(canonicalize({
        ok: false,
        error: `Model IO file not found: ${parsedArgs.modelIOFile}`,
      }));
      return null;
    }

    try {
      const relPath = sanitizePath(modelIOPath, workRoot);
      refs.model_io = {
        rel_path: relPath,
        sha256: hashFile(modelIOPath),
      };
    } catch (err) {
      console.error(canonicalize({
        ok: false,
        error: `Invalid model IO path: ${err instanceof Error ? err.message : String(err)}`,
      }));
      return null;
    }
  }

  // Repo state ref
  if (parsedArgs.repoStateFile) {
    const repoStatePath = resolve(parsedArgs.repoStateFile);
    if (!existsSync(repoStatePath)) {
      console.error(canonicalize({
        ok: false,
        error: `Repo state file not found: ${parsedArgs.repoStateFile}`,
      }));
      return null;
    }

    try {
      const relPath = sanitizePath(repoStatePath, workRoot);
      refs.repo_state = {
        rel_path: relPath,
        sha256: hashFile(repoStatePath),
      };
    } catch (err) {
      console.error(canonicalize({
        ok: false,
        error: `Invalid repo state path: ${err instanceof Error ? err.message : String(err)}`,
      }));
      return null;
    }
  }

  // Build env
  const allowlistSet = new Set<string>([...DEFAULT_ENV_ALLOWLIST]);
  for (const name of parsedArgs.envAllow) {
    if (!isForbiddenEnvName(name)) {
      allowlistSet.add(name);
    }
  }

  const allowlist = [...allowlistSet].sort();
  const hashed: EnvHashedEntry[] = [];

  for (const name of allowlist) {
    const value = process.env[name];
    if (value !== undefined) {
      hashed.push({
        name,
        sha256: hashString(value),
      });
    }
  }

  // Sort hashed by name
  hashed.sort((a, b) => a.name.localeCompare(b.name));

  const env: WorkspaceEnv = {
    allowlist,
    hashed,
  };

  // Build snapshot
  const snapshot: WorkspaceSnapshot = {
    workspace_schema_version: WORKSPACE_SCHEMA_VERSION,
    tool_id: parsedArgs.toolId,
    args: argsMap,
    refs,
    env,
    safety: {
      work_root_rel: '.',
      denies_absolute: true,
      denies_traversal: true,
    },
    ephemeral: {
      generated_at: new Date().toISOString(),
      tool_version: getPackageVersion(),
    },
  };

  return snapshot;
}

/**
 * Main entry point.
 */
function main(): never {
  const args = process.argv.slice(2);
  const parsedArgs = parseArgs(args);

  // Verify mode
  if (parsedArgs.mode === 'verify' && parsedArgs.verifyFile) {
    const code = verifyFile(parsedArgs.verifyFile);
    process.exit(code);
  }

  // Generate mode
  const snapshot = generateSnapshot(parsedArgs);

  if (!snapshot) {
    process.exit(EXIT_IO_ERROR);
  }

  // Verify the generated snapshot
  const verification = verifyWorkspaceSnapshot(snapshot);

  if (!verification.valid) {
    console.error(canonicalize({
      ok: false,
      error: 'Generated snapshot has violations',
      violations: verification.violations,
    }));
    process.exit(EXIT_VALIDATION_ERROR);
  }

  // Serialize to canonical JSON
  const output = serializeWorkspaceSnapshot(snapshot);

  // Write to file or stdout
  if (parsedArgs.outFile) {
    try {
      writeFileSync(resolve(parsedArgs.outFile), output + '\n', 'utf-8');
      console.log(canonicalize({
        ok: true,
        file: parsedArgs.outFile,
        workspace_hash: verification.workspace_hash,
      }));
    } catch (err) {
      console.error(canonicalize({
        ok: false,
        error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
      }));
      process.exit(EXIT_IO_ERROR);
    }
  } else {
    console.log(output);
  }

  process.exit(EXIT_OK);
}

main();
