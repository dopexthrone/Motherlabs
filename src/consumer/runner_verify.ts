/**
 * Runner Verification
 * ===================
 *
 * Non-authoritative verification of runner records against RUNNER_SPEC.md.
 * Returns violations deterministically without throwing.
 *
 * Rule IDs align with RUNNER_SPEC.md invariants:
 * - RN1: Schema version present and equals "1.0.0"
 * - RN2: Runner identity valid (runner_id pattern, runner_version)
 * - RN3: Platform complete (os, arch, node_version, npm_version)
 * - RN4: Sandbox configuration valid
 * - RN5: Limits within bounds
 * - RN6: Commands canonical (sorted, no overlap)
 * - RN7: Write roots valid (sorted, relative, no traversal)
 * - RN8: Context safe (working_dir, env_allowlist, locale, timezone)
 * - RN9: Timing consistent
 * - RN10: Exit status valid
 * - RN11: Core hash excludes ephemeral and timing
 * - RN12: Canonical round-trip stable
 */

import type {
  Runner,
  RunnerCore,
  RunnerViolation,
  RunnerVerificationResult,
  RunnerVerifyOptions,
} from './runner_types.js';
import {
  RUNNER_SCHEMA_VERSION,
  VALID_OS,
  VALID_ARCH,
  VALID_SANDBOX_BACKENDS,
  VALID_ISOLATION_LEVELS,
  FORBIDDEN_ENV_PREFIXES,
  LIMIT_BOUNDS,
} from './runner_types.js';
import { canonicalize, canonicalHash, verifyRoundTrip } from '../utils/canonical.js';

/**
 * Rule IDs matching RUNNER_SPEC.md.
 */
const RULES = {
  RN1: 'RN1',
  RN2: 'RN2',
  RN3: 'RN3',
  RN4: 'RN4',
  RN5: 'RN5',
  RN6: 'RN6',
  RN7: 'RN7',
  RN8: 'RN8',
  RN9: 'RN9',
  RN10: 'RN10',
  RN12: 'RN12',
  SCHEMA: 'SCHEMA',
} as const;

/**
 * Runner ID pattern: runner_{YYYYMMDD}_{HHMMSS}_{random}
 */
const RUNNER_ID_PATTERN = /^runner_\d{8}_\d{6}_[a-z0-9]+$/;

/**
 * Check if value is a plain object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check if path is absolute (Unix or Windows).
 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path);
}

/**
 * Check if path has traversal.
 */
function hasPathTraversal(path: string): boolean {
  return path.includes('..');
}

/**
 * Check if array is sorted lexicographically.
 */
function isSorted(arr: string[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1]! > arr[i]!) {
      return false;
    }
  }
  return true;
}

/**
 * Check if two arrays overlap.
 */
function arraysOverlap(a: string[], b: string[]): boolean {
  const setB = new Set(b);
  return a.some((item) => setB.has(item));
}

/**
 * Check if env var name has forbidden prefix.
 */
function hasForbiddenEnvPrefix(name: string): boolean {
  for (const prefix of FORBIDDEN_ENV_PREFIXES) {
    if (name.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate ISO 8601 UTC timestamp using regex only.
 * Does not use Date constructor to avoid banned API issues.
 */
function isValidISO8601UTC(timestamp: string): boolean {
  // Full ISO 8601 UTC pattern with date/time component validation
  const iso8601Pattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{3})?Z$/;
  return iso8601Pattern.test(timestamp);
}

/**
 * Parse ISO 8601 UTC timestamp to milliseconds.
 * Uses Date.parse which is deterministic for ISO 8601 strings.
 */
function parseISO8601ToMs(timestamp: string): number {
  // Date.parse is deterministic for ISO 8601 strings
  return Date.parse(timestamp);
}

/**
 * Sort violations deterministically.
 */
function sortViolations(violations: RunnerViolation[]): RunnerViolation[] {
  return [...violations].sort((a, b) => {
    const ruleCompare = a.rule_id.localeCompare(b.rule_id);
    if (ruleCompare !== 0) return ruleCompare;

    const pathA = a.path ?? '';
    const pathB = b.path ?? '';
    return pathA.localeCompare(pathB);
  });
}

/**
 * Compute RunnerCore from Runner (excludes ephemeral and timing).
 */
export function computeRunnerCore(runner: Runner): RunnerCore {
  return {
    runner_schema_version: runner.runner_schema_version,
    runner_id: runner.runner_id,
    runner_version: runner.runner_version,
    platform: runner.platform,
    sandbox: runner.sandbox,
    limits: runner.limits,
    commands: runner.commands,
    write_roots: runner.write_roots,
    context: runner.context,
    exit: runner.exit,
    ...(runner.warnings ? { warnings: runner.warnings } : {}),
  };
}

/**
 * Compute hash of RunnerCore.
 */
export function computeRunnerHash(runner: Runner): string {
  const core = computeRunnerCore(runner);
  return `sha256:${canonicalHash(core)}`;
}

/**
 * Verify runner record against RUNNER_SPEC.md invariants.
 */
export function verifyRunner(
  input: unknown,
  options: RunnerVerifyOptions = {}
): RunnerVerificationResult {
  const violations: RunnerViolation[] = [];

  // Schema check: must be object
  if (!isObject(input)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: `Expected object, got ${input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input}`,
    });
    return { valid: false, violations: sortViolations(violations) };
  }

  const runner = input as Record<string, unknown>;

  // RN1: Schema version present and equals "1.0.0"
  if (typeof runner.runner_schema_version !== 'string') {
    violations.push({
      rule_id: RULES.RN1,
      message: 'Missing or invalid runner_schema_version',
    });
  } else if (runner.runner_schema_version === '') {
    violations.push({
      rule_id: RULES.RN1,
      message: 'runner_schema_version cannot be empty',
    });
  } else if (runner.runner_schema_version !== RUNNER_SCHEMA_VERSION) {
    violations.push({
      rule_id: RULES.RN1,
      message: `Invalid schema version: expected "${RUNNER_SCHEMA_VERSION}", got "${runner.runner_schema_version}"`,
    });
  }

  // RN2: Runner identity valid
  if (typeof runner.runner_id !== 'string') {
    violations.push({
      rule_id: RULES.RN2,
      message: 'Missing or invalid runner_id',
    });
  } else if (runner.runner_id === '') {
    violations.push({
      rule_id: RULES.RN2,
      message: 'runner_id cannot be empty',
    });
  } else if (!RUNNER_ID_PATTERN.test(runner.runner_id)) {
    violations.push({
      rule_id: RULES.RN2,
      message: `Invalid runner_id format: expected pattern runner_YYYYMMDD_HHMMSS_random, got "${runner.runner_id}"`,
    });
  }

  if (typeof runner.runner_version !== 'string') {
    violations.push({
      rule_id: RULES.RN2,
      message: 'Missing or invalid runner_version',
    });
  } else if (runner.runner_version === '') {
    violations.push({
      rule_id: RULES.RN2,
      message: 'runner_version cannot be empty',
    });
  }

  // RN3: Platform complete
  if (!isObject(runner.platform)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid platform: expected object',
    });
  } else {
    const platform = runner.platform as Record<string, unknown>;

    if (typeof platform.os !== 'string') {
      violations.push({
        rule_id: RULES.RN3,
        message: 'Missing or invalid platform.os',
        path: 'platform.os',
      });
    } else if (!(VALID_OS as readonly string[]).includes(platform.os)) {
      violations.push({
        rule_id: RULES.RN3,
        message: `Invalid platform.os: expected one of ${VALID_OS.join(', ')}, got "${platform.os}"`,
        path: 'platform.os',
      });
    }

    if (typeof platform.arch !== 'string') {
      violations.push({
        rule_id: RULES.RN3,
        message: 'Missing or invalid platform.arch',
        path: 'platform.arch',
      });
    } else if (!(VALID_ARCH as readonly string[]).includes(platform.arch)) {
      violations.push({
        rule_id: RULES.RN3,
        message: `Invalid platform.arch: expected one of ${VALID_ARCH.join(', ')}, got "${platform.arch}"`,
        path: 'platform.arch',
      });
    }

    if (typeof platform.node_version !== 'string') {
      violations.push({
        rule_id: RULES.RN3,
        message: 'Missing or invalid platform.node_version',
        path: 'platform.node_version',
      });
    } else if (!platform.node_version.startsWith('v')) {
      violations.push({
        rule_id: RULES.RN3,
        message: `platform.node_version must start with "v", got "${platform.node_version}"`,
        path: 'platform.node_version',
      });
    }

    if (typeof platform.npm_version !== 'string') {
      violations.push({
        rule_id: RULES.RN3,
        message: 'Missing or invalid platform.npm_version',
        path: 'platform.npm_version',
      });
    }
  }

  // RN4: Sandbox configuration valid
  if (!isObject(runner.sandbox)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid sandbox: expected object',
    });
  } else {
    const sandbox = runner.sandbox as Record<string, unknown>;

    if (typeof sandbox.backend !== 'string') {
      violations.push({
        rule_id: RULES.RN4,
        message: 'Missing or invalid sandbox.backend',
        path: 'sandbox.backend',
      });
    } else if (!(VALID_SANDBOX_BACKENDS as readonly string[]).includes(sandbox.backend)) {
      violations.push({
        rule_id: RULES.RN4,
        message: `Invalid sandbox.backend: expected one of ${VALID_SANDBOX_BACKENDS.join(', ')}, got "${sandbox.backend}"`,
        path: 'sandbox.backend',
      });
    }

    if (typeof sandbox.isolation_level !== 'string') {
      violations.push({
        rule_id: RULES.RN4,
        message: 'Missing or invalid sandbox.isolation_level',
        path: 'sandbox.isolation_level',
      });
    } else if (!(VALID_ISOLATION_LEVELS as readonly string[]).includes(sandbox.isolation_level)) {
      violations.push({
        rule_id: RULES.RN4,
        message: `Invalid sandbox.isolation_level: expected one of ${VALID_ISOLATION_LEVELS.join(', ')}, got "${sandbox.isolation_level}"`,
        path: 'sandbox.isolation_level',
      });
    }

    // If isolation_level is none, backend must be none
    if (sandbox.isolation_level === 'none' && sandbox.backend !== 'none') {
      violations.push({
        rule_id: RULES.RN4,
        message: 'When isolation_level is "none", backend must also be "none"',
        path: 'sandbox',
      });
    }

    if (typeof sandbox.network_blocked !== 'boolean') {
      violations.push({
        rule_id: RULES.RN4,
        message: 'sandbox.network_blocked must be boolean',
        path: 'sandbox.network_blocked',
      });
    }

    if (typeof sandbox.filesystem_readonly !== 'boolean') {
      violations.push({
        rule_id: RULES.RN4,
        message: 'sandbox.filesystem_readonly must be boolean',
        path: 'sandbox.filesystem_readonly',
      });
    }
  }

  // RN5: Limits within bounds
  if (!isObject(runner.limits)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid limits: expected object',
    });
  } else {
    const limits = runner.limits as Record<string, unknown>;

    // timeout_ms
    if (typeof limits.timeout_ms !== 'number') {
      violations.push({
        rule_id: RULES.RN5,
        message: 'Missing or invalid limits.timeout_ms',
        path: 'limits.timeout_ms',
      });
    } else if (
      limits.timeout_ms < LIMIT_BOUNDS.timeout_ms.min ||
      limits.timeout_ms > LIMIT_BOUNDS.timeout_ms.max
    ) {
      violations.push({
        rule_id: RULES.RN5,
        message: `limits.timeout_ms must be in range [${LIMIT_BOUNDS.timeout_ms.min}, ${LIMIT_BOUNDS.timeout_ms.max}], got ${limits.timeout_ms}`,
        path: 'limits.timeout_ms',
      });
    }

    // max_output_files
    if (typeof limits.max_output_files !== 'number') {
      violations.push({
        rule_id: RULES.RN5,
        message: 'Missing or invalid limits.max_output_files',
        path: 'limits.max_output_files',
      });
    } else if (
      limits.max_output_files < LIMIT_BOUNDS.max_output_files.min ||
      limits.max_output_files > LIMIT_BOUNDS.max_output_files.max
    ) {
      violations.push({
        rule_id: RULES.RN5,
        message: `limits.max_output_files must be in range [${LIMIT_BOUNDS.max_output_files.min}, ${LIMIT_BOUNDS.max_output_files.max}], got ${limits.max_output_files}`,
        path: 'limits.max_output_files',
      });
    }

    // max_total_output_bytes
    if (typeof limits.max_total_output_bytes !== 'number') {
      violations.push({
        rule_id: RULES.RN5,
        message: 'Missing or invalid limits.max_total_output_bytes',
        path: 'limits.max_total_output_bytes',
      });
    } else if (
      limits.max_total_output_bytes < LIMIT_BOUNDS.max_total_output_bytes.min ||
      limits.max_total_output_bytes > LIMIT_BOUNDS.max_total_output_bytes.max
    ) {
      violations.push({
        rule_id: RULES.RN5,
        message: `limits.max_total_output_bytes must be in range [${LIMIT_BOUNDS.max_total_output_bytes.min}, ${LIMIT_BOUNDS.max_total_output_bytes.max}], got ${limits.max_total_output_bytes}`,
        path: 'limits.max_total_output_bytes',
      });
    }

    // Optional: max_memory_bytes
    if (limits.max_memory_bytes !== undefined) {
      if (typeof limits.max_memory_bytes !== 'number') {
        violations.push({
          rule_id: RULES.RN5,
          message: 'limits.max_memory_bytes must be a number',
          path: 'limits.max_memory_bytes',
        });
      } else if (limits.max_memory_bytes <= 0) {
        violations.push({
          rule_id: RULES.RN5,
          message: 'limits.max_memory_bytes must be positive',
          path: 'limits.max_memory_bytes',
        });
      }
    }

    // Optional: max_cpu_seconds
    if (limits.max_cpu_seconds !== undefined) {
      if (typeof limits.max_cpu_seconds !== 'number') {
        violations.push({
          rule_id: RULES.RN5,
          message: 'limits.max_cpu_seconds must be a number',
          path: 'limits.max_cpu_seconds',
        });
      } else if (limits.max_cpu_seconds <= 0) {
        violations.push({
          rule_id: RULES.RN5,
          message: 'limits.max_cpu_seconds must be positive',
          path: 'limits.max_cpu_seconds',
        });
      }
    }
  }

  // RN6: Commands canonical
  if (!isObject(runner.commands)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid commands: expected object',
    });
  } else {
    const commands = runner.commands as Record<string, unknown>;

    if (!Array.isArray(commands.allowlist)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'commands.allowlist must be an array',
        path: 'commands.allowlist',
      });
    } else {
      const allowlist = commands.allowlist as unknown[];
      const stringAllowlist = allowlist.filter((v): v is string => typeof v === 'string');

      if (!isSorted(stringAllowlist)) {
        violations.push({
          rule_id: RULES.RN6,
          message: 'commands.allowlist is not sorted lexicographically',
          path: 'commands.allowlist',
        });
      }
    }

    if (!Array.isArray(commands.blocklist)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'commands.blocklist must be an array',
        path: 'commands.blocklist',
      });
    } else {
      const blocklist = commands.blocklist as unknown[];
      const stringBlocklist = blocklist.filter((v): v is string => typeof v === 'string');

      if (!isSorted(stringBlocklist)) {
        violations.push({
          rule_id: RULES.RN6,
          message: 'commands.blocklist is not sorted lexicographically',
          path: 'commands.blocklist',
        });
      }
    }

    // Check for overlap between allowlist and blocklist
    if (Array.isArray(commands.allowlist) && Array.isArray(commands.blocklist)) {
      const allowlist = (commands.allowlist as unknown[]).filter(
        (v): v is string => typeof v === 'string'
      );
      const blocklist = (commands.blocklist as unknown[]).filter(
        (v): v is string => typeof v === 'string'
      );
      if (arraysOverlap(allowlist, blocklist)) {
        violations.push({
          rule_id: RULES.RN6,
          message: 'commands.allowlist and commands.blocklist must not overlap',
          path: 'commands',
        });
      }
    }

    if (typeof commands.shell !== 'string') {
      violations.push({
        rule_id: RULES.RN6,
        message: 'Missing or invalid commands.shell',
        path: 'commands.shell',
      });
    } else if (commands.shell === '') {
      violations.push({
        rule_id: RULES.RN6,
        message: 'commands.shell cannot be empty',
        path: 'commands.shell',
      });
    }
  }

  // RN7: Write roots valid
  if (!Array.isArray(runner.write_roots)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid write_roots: expected array',
    });
  } else {
    const writeRoots = runner.write_roots as unknown[];
    const stringRoots = writeRoots.filter((v): v is string => typeof v === 'string');

    if (!isSorted(stringRoots)) {
      violations.push({
        rule_id: RULES.RN7,
        message: 'write_roots is not sorted lexicographically',
        path: 'write_roots',
      });
    }

    for (let i = 0; i < writeRoots.length; i++) {
      const root = writeRoots[i];
      if (typeof root !== 'string') {
        violations.push({
          rule_id: RULES.SCHEMA,
          message: `write_roots[${i}] is not a string`,
          path: `write_roots[${i}]`,
        });
      } else {
        if (isAbsolutePath(root)) {
          violations.push({
            rule_id: RULES.RN7,
            message: `write_roots[${i}] contains absolute path`,
            path: `write_roots[${i}]`,
          });
        }
        if (hasPathTraversal(root)) {
          violations.push({
            rule_id: RULES.RN7,
            message: `write_roots[${i}] contains path traversal`,
            path: `write_roots[${i}]`,
          });
        }
      }
    }
  }

  // RN8: Context safe
  if (!isObject(runner.context)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid context: expected object',
    });
  } else {
    const context = runner.context as Record<string, unknown>;

    if (context.working_dir !== '.') {
      violations.push({
        rule_id: RULES.RN8,
        message: 'context.working_dir must be "."',
        path: 'context.working_dir',
      });
    }

    if (!Array.isArray(context.env_allowlist)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'context.env_allowlist must be an array',
        path: 'context.env_allowlist',
      });
    } else {
      const envAllowlist = context.env_allowlist as unknown[];
      const stringEnvAllowlist = envAllowlist.filter((v): v is string => typeof v === 'string');

      if (!isSorted(stringEnvAllowlist)) {
        violations.push({
          rule_id: RULES.RN8,
          message: 'context.env_allowlist is not sorted lexicographically',
          path: 'context.env_allowlist',
        });
      }

      for (let i = 0; i < envAllowlist.length; i++) {
        const name = envAllowlist[i];
        if (typeof name === 'string' && hasForbiddenEnvPrefix(name)) {
          violations.push({
            rule_id: RULES.RN8,
            message: `context.env_allowlist[${i}] has forbidden prefix: "${name}"`,
            path: `context.env_allowlist[${i}]`,
          });
        }
      }
    }

    if (typeof context.locale !== 'string') {
      violations.push({
        rule_id: RULES.RN8,
        message: 'Missing or invalid context.locale',
        path: 'context.locale',
      });
    }

    if (typeof context.timezone !== 'string') {
      violations.push({
        rule_id: RULES.RN8,
        message: 'Missing or invalid context.timezone',
        path: 'context.timezone',
      });
    }
  }

  // RN9: Timing consistent
  if (!options.skipTimingValidation) {
    if (!isObject(runner.timing)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'Missing or invalid timing: expected object',
      });
    } else {
      const timing = runner.timing as Record<string, unknown>;

      if (typeof timing.started_at !== 'string') {
        violations.push({
          rule_id: RULES.RN9,
          message: 'Missing or invalid timing.started_at',
          path: 'timing.started_at',
        });
      } else if (!isValidISO8601UTC(timing.started_at)) {
        violations.push({
          rule_id: RULES.RN9,
          message: 'timing.started_at must be valid ISO 8601 UTC',
          path: 'timing.started_at',
        });
      }

      if (typeof timing.completed_at !== 'string') {
        violations.push({
          rule_id: RULES.RN9,
          message: 'Missing or invalid timing.completed_at',
          path: 'timing.completed_at',
        });
      } else if (!isValidISO8601UTC(timing.completed_at)) {
        violations.push({
          rule_id: RULES.RN9,
          message: 'timing.completed_at must be valid ISO 8601 UTC',
          path: 'timing.completed_at',
        });
      }

      // Check completed_at >= started_at
      if (
        typeof timing.started_at === 'string' &&
        typeof timing.completed_at === 'string' &&
        isValidISO8601UTC(timing.started_at) &&
        isValidISO8601UTC(timing.completed_at)
      ) {
        const start = parseISO8601ToMs(timing.started_at);
        const end = parseISO8601ToMs(timing.completed_at);
        if (end < start) {
          violations.push({
            rule_id: RULES.RN9,
            message: 'timing.completed_at must be >= timing.started_at',
            path: 'timing',
          });
        }

        // Check duration_ms consistency (within 1ms tolerance)
        if (typeof timing.duration_ms === 'number') {
          const expectedDuration = end - start;
          if (Math.abs(timing.duration_ms - expectedDuration) > 1) {
            violations.push({
              rule_id: RULES.RN9,
              message: `timing.duration_ms (${timing.duration_ms}) does not match completed_at - started_at (${expectedDuration})`,
              path: 'timing.duration_ms',
            });
          }
        }
      }

      if (typeof timing.duration_ms !== 'number') {
        violations.push({
          rule_id: RULES.RN9,
          message: 'Missing or invalid timing.duration_ms',
          path: 'timing.duration_ms',
        });
      }

      // Optional phases
      if (timing.phases !== undefined) {
        if (!Array.isArray(timing.phases)) {
          violations.push({
            rule_id: RULES.SCHEMA,
            message: 'timing.phases must be an array',
            path: 'timing.phases',
          });
        } else {
          const phases = timing.phases as unknown[];
          let lastStarted = '';

          for (let i = 0; i < phases.length; i++) {
            const phase = phases[i];
            if (!isObject(phase)) {
              violations.push({
                rule_id: RULES.SCHEMA,
                message: `timing.phases[${i}] is not an object`,
                path: `timing.phases[${i}]`,
              });
            } else {
              const p = phase as Record<string, unknown>;

              if (typeof p.name !== 'string') {
                violations.push({
                  rule_id: RULES.SCHEMA,
                  message: `timing.phases[${i}].name is not a string`,
                  path: `timing.phases[${i}].name`,
                });
              }

              if (typeof p.started_at !== 'string') {
                violations.push({
                  rule_id: RULES.SCHEMA,
                  message: `timing.phases[${i}].started_at is not a string`,
                  path: `timing.phases[${i}].started_at`,
                });
              } else if (!isValidISO8601UTC(p.started_at)) {
                violations.push({
                  rule_id: RULES.RN9,
                  message: `timing.phases[${i}].started_at must be valid ISO 8601 UTC`,
                  path: `timing.phases[${i}].started_at`,
                });
              } else {
                // Check sorted by started_at
                if (lastStarted && p.started_at < lastStarted) {
                  violations.push({
                    rule_id: RULES.RN9,
                    message: 'timing.phases must be sorted by started_at',
                    path: 'timing.phases',
                  });
                }
                lastStarted = p.started_at;
              }

              if (typeof p.duration_ms !== 'number') {
                violations.push({
                  rule_id: RULES.SCHEMA,
                  message: `timing.phases[${i}].duration_ms is not a number`,
                  path: `timing.phases[${i}].duration_ms`,
                });
              }
            }
          }
        }
      }
    }
  }

  // RN10: Exit status valid
  if (!isObject(runner.exit)) {
    violations.push({
      rule_id: RULES.SCHEMA,
      message: 'Missing or invalid exit: expected object',
    });
  } else {
    const exit = runner.exit as Record<string, unknown>;

    if (typeof exit.code !== 'number') {
      violations.push({
        rule_id: RULES.RN10,
        message: 'Missing or invalid exit.code',
        path: 'exit.code',
      });
    } else if (!Number.isInteger(exit.code) || exit.code < 0 || exit.code > 255) {
      violations.push({
        rule_id: RULES.RN10,
        message: `exit.code must be integer in range [0, 255], got ${exit.code}`,
        path: 'exit.code',
      });
    }

    // Optional signal
    if (exit.signal !== undefined) {
      if (typeof exit.signal !== 'string') {
        violations.push({
          rule_id: RULES.RN10,
          message: 'exit.signal must be a string',
          path: 'exit.signal',
        });
      } else if (exit.signal !== exit.signal.toUpperCase()) {
        violations.push({
          rule_id: RULES.RN10,
          message: 'exit.signal must be uppercase',
          path: 'exit.signal',
        });
      }
    }

    if (typeof exit.oom_killed !== 'boolean') {
      violations.push({
        rule_id: RULES.RN10,
        message: 'exit.oom_killed must be boolean',
        path: 'exit.oom_killed',
      });
    }

    if (typeof exit.timeout_killed !== 'boolean') {
      violations.push({
        rule_id: RULES.RN10,
        message: 'exit.timeout_killed must be boolean',
        path: 'exit.timeout_killed',
      });
    }
  }

  // Warnings validation
  if (runner.warnings !== undefined) {
    if (!Array.isArray(runner.warnings)) {
      violations.push({
        rule_id: RULES.SCHEMA,
        message: 'warnings is not an array',
        path: 'warnings',
      });
    } else {
      const warnings = runner.warnings as unknown[];
      const stringWarnings = warnings.filter((v): v is string => typeof v === 'string');
      if (!isSorted(stringWarnings)) {
        violations.push({
          rule_id: RULES.SCHEMA,
          message: 'warnings is not sorted',
          path: 'warnings',
        });
      }
    }
  }

  // RN12: Canonical round-trip
  const hasSchemaViolations = violations.some(
    (v) => v.rule_id === RULES.SCHEMA || v.rule_id === RULES.RN1
  );
  if (!hasSchemaViolations) {
    try {
      if (!verifyRoundTrip(input)) {
        violations.push({
          rule_id: RULES.RN12,
          message: 'Runner record does not round-trip through canonicalization',
        });
      }
    } catch {
      violations.push({
        rule_id: RULES.RN12,
        message: 'Failed to canonicalize runner record',
      });
    }
  }

  // Sort violations
  const sortedViolations = sortViolations(violations);

  // Compute hash if valid
  const valid = sortedViolations.length === 0;
  const result: RunnerVerificationResult = {
    valid,
    violations: sortedViolations,
  };

  if (valid) {
    try {
      result.runner_hash = computeRunnerHash(input as unknown as Runner);
    } catch {
      // Should not happen if validation passed
    }
  }

  return result;
}

/**
 * Serialize Runner to canonical JSON.
 */
export function serializeRunner(runner: Runner): string {
  return canonicalize(runner);
}
