/**
 * Self-Consistency Testing
 * ========================
 *
 * Generate multiple implementations, run same inputs, check agreement.
 */

import { spawn } from 'node:child_process';
import type { EvalResult, TestResult, ConsistencyConfig, Generation } from './types.js';

// =============================================================================
// Self-Consistency Evaluator
// =============================================================================

/**
 * Run self-consistency testing across multiple generations.
 */
export async function runConsistencyTest(
  generations: Generation[],
  functionName: string,
  config: ConsistencyConfig
): Promise<EvalResult> {
  const startTime = performance.now();
  const tests: TestResult[] = [];
  let totalAgreements = 0;
  let totalComparisons = 0;

  // For each input, collect outputs from all generations
  for (let inputIdx = 0; inputIdx < config.inputs.length; inputIdx++) {
    const input = config.inputs[inputIdx];
    const outputs: unknown[] = [];

    // Get output from each generation
    for (const gen of generations) {
      const output = gen.outputs[inputIdx];
      outputs.push(output);
    }

    // Count pairwise agreements
    const agreements = countAgreements(outputs);
    const possiblePairs = (outputs.length * (outputs.length - 1)) / 2;

    totalAgreements += agreements;
    totalComparisons += possiblePairs;

    // Create test result
    const agreementRatio = possiblePairs > 0 ? agreements / possiblePairs : 1;
    tests.push({
      name: `Input ${inputIdx + 1}: ${JSON.stringify(input).slice(0, 50)}`,
      passed: agreementRatio >= config.min_agreement,
      input,
      expected: `>= ${(config.min_agreement * 100).toFixed(0)}% agreement`,
      actual: `${(agreementRatio * 100).toFixed(1)}% agreement (${agreements}/${possiblePairs} pairs)`,
    });
  }

  const overallAgreement = totalComparisons > 0 ? totalAgreements / totalComparisons : 1;
  const passed = tests.filter((t) => t.passed).length;
  const score = tests.length > 0 ? passed / tests.length : 0;

  return {
    method: 'self_consistency',
    passed: overallAgreement >= config.min_agreement,
    score,
    details: `${(overallAgreement * 100).toFixed(1)}% overall agreement across ${generations.length} generations`,
    tests,
    duration_ms: Math.round(performance.now() - startTime),
  };
}

/**
 * Count pairwise agreements in outputs.
 */
function countAgreements(outputs: unknown[]): number {
  let count = 0;
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      if (deepEqual(outputs[i], outputs[j])) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Deep equality check for outputs.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  // Handle null/undefined
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;

  // Handle primitives
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') {
    // Handle floating point comparison
    if (typeof a === 'number' && typeof b === 'number') {
      if (Number.isNaN(a) && Number.isNaN(b)) return true;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
      return Math.abs(a - b) < 1e-9;
    }
    return a === b;
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Handle objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Execute code and collect outputs for inputs.
 */
export async function executeGeneration(
  code: string,
  functionName: string,
  inputs: unknown[]
): Promise<Generation> {
  const outputs: unknown[] = [];

  for (const input of inputs) {
    const output = await executeFunction(code, functionName, input);
    outputs.push(output);
  }

  return { code, outputs };
}

/**
 * Execute a function with a single input.
 */
async function executeFunction(
  code: string,
  functionName: string,
  input: unknown
): Promise<unknown> {
  const inputStr = JSON.stringify(input);
  const callExpr = typeof input === 'object' && Array.isArray(input)
    ? `${functionName}(*${inputStr})`
    : `${functionName}(${inputStr})`;

  const script = `
import json

${code}

try:
    result = ${callExpr}
    # Handle non-JSON-serializable types
    if hasattr(result, '__iter__') and not isinstance(result, (str, list, dict)):
        result = list(result)
    print(json.dumps({"success": True, "result": result}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

  try {
    const result = await runPython(script);
    const parsed = JSON.parse(result.stdout);
    if (parsed.success) {
      return parsed.result;
    }
    return `ERROR: ${parsed.error}`;
  } catch {
    return 'ERROR: Execution failed';
  }
}

/**
 * Find majority output for voting.
 */
export function findMajorityOutput(outputs: unknown[]): { output: unknown; confidence: number } {
  const counts = new Map<string, { output: unknown; count: number }>();

  for (const output of outputs) {
    const key = JSON.stringify(output);
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { output, count: 1 });
    }
  }

  let maxCount = 0;
  let majorityOutput: unknown = outputs[0];

  for (const { output, count } of counts.values()) {
    if (count > maxCount) {
      maxCount = count;
      majorityOutput = output;
    }
  }

  return {
    output: majorityOutput,
    confidence: outputs.length > 0 ? maxCount / outputs.length : 0,
  };
}

/**
 * Check if generations are consistent enough to trust.
 */
export function assessConsistency(generations: Generation[], minAgreement: number = 0.7): {
  consistent: boolean;
  confidence: number;
  divergentInputs: number[];
} {
  const divergentInputs: number[] = [];
  let totalConfidence = 0;
  const numInputs = generations[0]?.outputs.length ?? 0;

  for (let i = 0; i < numInputs; i++) {
    const outputs = generations.map((g) => g.outputs[i]);
    const { confidence } = findMajorityOutput(outputs);
    totalConfidence += confidence;

    if (confidence < minAgreement) {
      divergentInputs.push(i);
    }
  }

  const avgConfidence = numInputs > 0 ? totalConfidence / numInputs : 0;

  return {
    consistent: divergentInputs.length === 0,
    confidence: avgConfidence,
    divergentInputs,
  };
}

// =============================================================================
// Python Runner
// =============================================================================

interface PythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runPython(script: string): Promise<PythonResult> {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', script], {
      timeout: 10000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (error) => {
      resolve({
        stdout: '',
        stderr: error.message,
        exitCode: 1,
      });
    });
  });
}
