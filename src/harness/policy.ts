/**
 * Policy Profiles
 * ===============
 *
 * Defines sandbox policy profiles that control execution limits.
 * Policies are JSON-serializable and included in execution evidence.
 */

import type { PolicyProfile, PolicyProfileName } from './types.js';

// =============================================================================
// Policy Definitions
// =============================================================================

/**
 * Strict policy - default for CI.
 * Most restrictive settings.
 */
const STRICT_POLICY: PolicyProfile = {
  name: 'strict',
  allow_network: false,
  timeout_ms: 30_000,
  max_output_files: 200,
  max_total_output_bytes: 10 * 1024 * 1024, // 10 MB
  allowed_commands: ['node', 'npm'],
  allowed_write_roots: ['out', 'dist', 'build'],
};

/**
 * Default policy - balanced settings.
 * Same as strict but with higher limits.
 */
const DEFAULT_POLICY: PolicyProfile = {
  name: 'default',
  allow_network: false,
  timeout_ms: 60_000,
  max_output_files: 500,
  max_total_output_bytes: 50 * 1024 * 1024, // 50 MB
  allowed_commands: ['node', 'npm', 'npx'],
  allowed_write_roots: ['out', 'dist', 'build', 'tmp'],
};

/**
 * Dev policy - relaxed for local development.
 * Still no network by default.
 */
const DEV_POLICY: PolicyProfile = {
  name: 'dev',
  allow_network: false,
  timeout_ms: 300_000, // 5 minutes
  max_output_files: 1000,
  max_total_output_bytes: 100 * 1024 * 1024, // 100 MB
  allowed_commands: [], // Empty = all allowed in dev
  allowed_write_roots: [], // Empty = all allowed in dev
};

/**
 * All available policies.
 */
const POLICIES: Record<PolicyProfileName, PolicyProfile> = {
  strict: STRICT_POLICY,
  default: DEFAULT_POLICY,
  dev: DEV_POLICY,
};

// =============================================================================
// Policy Loading
// =============================================================================

/**
 * Load a policy profile by name.
 *
 * @param name - Policy profile name
 * @returns Policy profile
 * @throws Error if policy not found
 */
export function loadPolicy(name: PolicyProfileName): PolicyProfile {
  const policy = POLICIES[name];
  if (!policy) {
    throw new Error(`Unknown policy profile: ${name}`);
  }
  // Return a copy to prevent mutation
  return { ...policy, allowed_commands: [...policy.allowed_commands], allowed_write_roots: [...policy.allowed_write_roots] };
}

/**
 * Get the default policy profile.
 */
export function getDefaultPolicy(): PolicyProfile {
  return loadPolicy('default');
}

/**
 * Validate that a command is allowed by the policy.
 *
 * @param cmd - Command to check (first element of command array)
 * @param policy - Policy to check against
 * @returns true if allowed
 */
export function isCommandAllowed(cmd: string, policy: PolicyProfile): boolean {
  // Dev policy with empty list allows all
  if (policy.name === 'dev' && policy.allowed_commands.length === 0) {
    return true;
  }
  return policy.allowed_commands.includes(cmd);
}

/**
 * Validate that a write path is allowed by the policy.
 *
 * @param path - Relative path from sandbox root
 * @param policy - Policy to check against
 * @returns true if allowed
 */
export function isWritePathAllowed(path: string, policy: PolicyProfile): boolean {
  // Dev policy with empty list allows all
  if (policy.name === 'dev' && policy.allowed_write_roots.length === 0) {
    return true;
  }

  // Check if path starts with any allowed root
  const normalizedPath = path.replace(/\\/g, '/');
  for (const root of policy.allowed_write_roots) {
    if (normalizedPath === root || normalizedPath.startsWith(root + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * List all available policy names.
 */
export function listPolicies(): PolicyProfileName[] {
  return Object.keys(POLICIES) as PolicyProfileName[];
}
