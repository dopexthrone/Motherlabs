#!/usr/bin/env node
/**
 * Pack Export CLI
 * ===============
 *
 * Exports a harness run as a PACK_SPEC-compliant directory.
 *
 * Usage:
 *   npm run pack-export -- --intent <intent.json> --out <dir> [options]
 *
 * Options:
 *   --intent <path>       Path to intent JSON file (required)
 *   --out <dir>           Output directory path (required)
 *   --policy <name>       Policy: strict|default|dev (default: default)
 *   --mode <mode>         Mode: plan|exec (default: plan)
 *   --model-mode <mode>   Model mode: none|record|replay (default: none)
 *   --model-recording <path>  Path to model recording file
 *   --help, -h            Show this help message
 *
 * Exit codes:
 *   0 - Success (pack exported and verified)
 *   1 - IO/runtime error
 *   2 - Validation error (args invalid OR pack-verify failed)
 *
 * Output (canonical JSON):
 *   { "ok": true, "out_dir": "...", "files_written": [...], "pack_verify": {...}, "run_outcome": "..." }
 */

import { resolve } from 'node:path';
import { exportPack } from '../harness/pack_export.js';
import { canonicalize } from '../utils/canonical.js';
import type { ExportPackArgs, PackExportMode } from '../harness/pack_export.js';
import type { PolicyProfileName, ModelMode } from '../harness/types.js';

// Exit codes
const EXIT_OK = 0;
const EXIT_IO_ERROR = 1;
const EXIT_VALIDATION_ERROR = 2;

/**
 * Print usage and exit.
 */
function printUsage(): never {
  console.log(`Usage: npm run pack-export -- --intent <intent.json> --out <dir> [options]

Exports a harness run as a PACK_SPEC-compliant directory.

Required arguments:
  --intent <path>         Path to intent JSON file
  --out <dir>             Output directory path

Options:
  --policy <name>         Policy profile: strict | default | dev (default: default)
  --mode <mode>           Export mode: plan | exec (default: plan)
  --model-mode <mode>     Model mode: none | record | replay (default: none)
  --model-recording <path>  Path to model recording file (for record/replay)
  --help, -h              Show this help message

Exit codes:
  0 - Success (pack exported and verified)
  1 - IO/runtime error
  2 - Validation error (args invalid OR pack-verify failed)

Examples:
  npm run pack-export -- --intent intents/real/a_blueprints/intent_001_api_spec.json --out /tmp/pack_test --mode plan
  npm run pack-export -- --intent my_intent.json --out ./packs/run_001 --policy strict
  npm run pack-export -- --intent intent.json --out /tmp/pack --mode exec --policy dev`);
  process.exit(EXIT_VALIDATION_ERROR);
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): ExportPackArgs {
  let intentPath: string | undefined;
  let outDir: string | undefined;
  let policyName: PolicyProfileName = 'default';
  let mode: PackExportMode = 'plan';
  let modelMode: ModelMode | undefined;
  let modelRecordingPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      printUsage();
    } else if (arg === '--intent' && args[i + 1]) {
      intentPath = args[i + 1];
      i++;
    } else if (arg === '--out' && args[i + 1]) {
      outDir = args[i + 1];
      i++;
    } else if (arg === '--policy' && args[i + 1]) {
      const p = args[i + 1]!;
      if (p !== 'strict' && p !== 'default' && p !== 'dev') {
        console.error(`ERROR: Invalid policy: ${p}. Must be strict, default, or dev.`);
        process.exit(EXIT_VALIDATION_ERROR);
      }
      policyName = p;
      i++;
    } else if (arg === '--mode' && args[i + 1]) {
      const m = args[i + 1]!;
      if (m !== 'plan' && m !== 'exec') {
        console.error(`ERROR: Invalid mode: ${m}. Must be plan or exec.`);
        process.exit(EXIT_VALIDATION_ERROR);
      }
      mode = m;
      i++;
    } else if (arg === '--model-mode' && args[i + 1]) {
      const mm = args[i + 1]!;
      if (mm !== 'none' && mm !== 'record' && mm !== 'replay') {
        console.error(`ERROR: Invalid model-mode: ${mm}. Must be none, record, or replay.`);
        process.exit(EXIT_VALIDATION_ERROR);
      }
      modelMode = mm;
      i++;
    } else if (arg === '--model-recording' && args[i + 1]) {
      modelRecordingPath = args[i + 1];
      i++;
    } else if (arg.startsWith('-')) {
      console.error(`ERROR: Unknown option: ${arg}`);
      process.exit(EXIT_VALIDATION_ERROR);
    }
  }

  // Validate required arguments
  if (!intentPath) {
    console.error('ERROR: --intent is required');
    printUsage();
  }

  if (!outDir) {
    console.error('ERROR: --out is required');
    printUsage();
  }

  // Don't resolve out_dir here - let exportPack check for traversal first
  const exportArgs: ExportPackArgs = {
    intent_path: resolve(intentPath),
    out_dir: outDir,  // Keep original path for traversal check
    policy_name: policyName,
    mode,
  };

  if (modelMode) {
    exportArgs.model_mode = modelMode;
  }

  if (modelRecordingPath) {
    exportArgs.model_recording_path = resolve(modelRecordingPath);
  }

  return exportArgs;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
  }

  const exportArgs = parseArgs(args);

  try {
    const result = await exportPack(exportArgs);

    // Output canonical JSON
    console.log(canonicalize(result));

    if (result.ok) {
      process.exit(EXIT_OK);
    } else {
      process.exit(EXIT_VALIDATION_ERROR);
    }
  } catch (error) {
    console.error(`IO_ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_IO_ERROR);
  }
}

main().catch((err) => {
  console.error(`IO_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(EXIT_IO_ERROR);
});
