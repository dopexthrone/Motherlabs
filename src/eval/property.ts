/**
 * Property-Based Testing
 * ======================
 *
 * Hypothesis-style testing: generate random inputs, verify properties hold.
 */

import { spawn } from 'node:child_process';
import type { EvalResult, TestResult, PropertyConfig, Property } from './types.js';

// =============================================================================
// Common Properties
// =============================================================================

/**
 * Built-in properties for common function types.
 */
export const COMMON_PROPERTIES: Record<string, Property[]> = {
  // Sorting functions
  sort: [
    {
      name: 'idempotent',
      description: 'Sorting twice gives same result',
      check: 'f({input}) == f(f({input}))',
    },
    {
      name: 'length_preserved',
      description: 'Output has same length as input',
      check: 'len({result}) == len({input})',
    },
    {
      name: 'elements_preserved',
      description: 'Same elements in output',
      check: 'sorted({result}) == sorted({input})',
    },
    {
      name: 'ordered',
      description: 'Output is sorted',
      check: '{result} == sorted({result})',
    },
  ],

  // Mathematical functions
  factorial: [
    {
      name: 'non_negative',
      description: 'Result is always non-negative',
      check: '{result} >= 0',
    },
    {
      name: 'base_case',
      description: 'f(0) = 1 and f(1) = 1',
      check: '({input} > 1) or {result} == 1',
    },
    {
      name: 'monotonic',
      description: 'f(n) < f(n+1) for n > 0',
      check: '({input} == 0) or f({input}) < f({input} + 1)',
    },
  ],

  // GCD functions
  gcd: [
    {
      name: 'commutative',
      description: 'gcd(a,b) = gcd(b,a)',
      check: 'f({input}[0], {input}[1]) == f({input}[1], {input}[0])',
    },
    {
      name: 'divides_both',
      description: 'Result divides both inputs',
      check: '({input}[0] % {result} == 0) and ({input}[1] % {result} == 0)',
    },
    {
      name: 'identity',
      description: 'gcd(a, 0) = a',
      check: '({input}[1] != 0) or {result} == abs({input}[0])',
    },
  ],

  // String functions
  reverse: [
    {
      name: 'involutory',
      description: 'Reversing twice gives original',
      check: 'f(f({input})) == {input}',
    },
    {
      name: 'length_preserved',
      description: 'Same length',
      check: 'len({result}) == len({input})',
    },
  ],

  // List functions
  sum: [
    {
      name: 'empty_is_zero',
      description: 'Sum of empty list is 0',
      check: '(len({input}) > 0) or {result} == 0',
    },
    {
      name: 'single_element',
      description: 'Sum of single element is that element',
      check: '(len({input}) != 1) or {result} == {input}[0]',
    },
  ],

  // Generic numeric
  numeric: [
    {
      name: 'deterministic',
      description: 'Same input gives same output',
      check: 'f({input}) == f({input})',
    },
  ],
};

// =============================================================================
// Input Generators
// =============================================================================

/**
 * Generate random inputs based on strategy.
 */
export function generateInputs(config: PropertyConfig): unknown[] {
  const inputs: unknown[] = [];
  const { num_tests, input_strategy, input_range } = config;
  const min = input_range?.min ?? 0;
  const max = input_range?.max ?? 100;

  switch (input_strategy) {
    case 'random_int':
      for (let i = 0; i < num_tests; i++) {
        inputs.push(Math.floor(Math.random() * (max - min + 1)) + min);
      }
      // Add edge cases
      inputs.push(min, max, 0, 1, -1);
      break;

    case 'random_float':
      for (let i = 0; i < num_tests; i++) {
        inputs.push(Math.random() * (max - min) + min);
      }
      inputs.push(0.0, 1.0, -1.0, 0.5, min, max);
      break;

    case 'random_string':
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      for (let i = 0; i < num_tests; i++) {
        const len = Math.floor(Math.random() * 20);
        let s = '';
        for (let j = 0; j < len; j++) {
          s += chars[Math.floor(Math.random() * chars.length)];
        }
        inputs.push(s);
      }
      inputs.push('', 'a', 'hello', 'Hello World');
      break;

    case 'custom':
      // Custom generator should be handled by caller
      break;
  }

  return inputs;
}

/**
 * Generate list inputs for list-based functions.
 */
export function generateListInputs(count: number, elementRange: { min: number; max: number }): unknown[][] {
  const inputs: unknown[][] = [];

  for (let i = 0; i < count; i++) {
    const len = Math.floor(Math.random() * 20);
    const list: number[] = [];
    for (let j = 0; j < len; j++) {
      list.push(
        Math.floor(Math.random() * (elementRange.max - elementRange.min + 1)) + elementRange.min
      );
    }
    inputs.push(list);
  }

  // Edge cases
  inputs.push([]);
  inputs.push([0]);
  inputs.push([1]);
  inputs.push([1, 2, 3]);
  inputs.push([3, 2, 1]);
  inputs.push([1, 1, 1]);
  inputs.push([-1, 0, 1]);

  return inputs;
}

/**
 * Generate pair inputs for two-argument functions.
 */
export function generatePairInputs(
  count: number,
  range: { min: number; max: number }
): Array<[number, number]> {
  const inputs: Array<[number, number]> = [];

  for (let i = 0; i < count; i++) {
    const a = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
    const b = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
    inputs.push([a, b]);
  }

  // Edge cases
  inputs.push([0, 0]);
  inputs.push([1, 1]);
  inputs.push([0, 1]);
  inputs.push([1, 0]);
  inputs.push([range.max, range.max]);

  return inputs;
}

// =============================================================================
// Property Evaluator
// =============================================================================

/**
 * Run property-based testing.
 */
export async function runPropertyTest(
  code: string,
  functionName: string,
  config: PropertyConfig
): Promise<EvalResult> {
  const startTime = performance.now();
  const tests: TestResult[] = [];
  let passed = 0;

  // Generate inputs
  const inputs = generateInputs(config);

  // Test each property against each input
  for (const property of config.properties) {
    for (const input of inputs) {
      const testResult = await checkProperty(code, functionName, property, input);
      tests.push(testResult);
      if (testResult.passed) passed++;
    }
  }

  const totalTests = tests.length;
  const score = totalTests > 0 ? passed / totalTests : 0;

  return {
    method: 'property',
    passed: score >= 0.95, // 95% of properties must hold
    score,
    details: `${passed}/${totalTests} property checks passed`,
    tests,
    duration_ms: Math.round(performance.now() - startTime),
  };
}

/**
 * Check a single property for a single input.
 */
async function checkProperty(
  code: string,
  functionName: string,
  property: Property,
  input: unknown
): Promise<TestResult> {
  const inputStr = JSON.stringify(input);

  // Build check expression
  const checkExpr = property.check
    .replace(/\{input\}/g, inputStr)
    .replace(/\{result\}/g, `f(${typeof input === 'object' ? '*' + inputStr : inputStr})`)
    .replace(/f\(/g, `${functionName}(`);

  const script = `
import json

# Generated code
${code}

# Alias for property checks
f = ${functionName}

# Run property check
try:
    result = ${checkExpr}
    print(json.dumps({"passed": bool(result), "error": None}))
except Exception as e:
    print(json.dumps({"passed": False, "error": str(e)}))
`;

  try {
    const result = await runPython(script);
    const parsed = JSON.parse(result.stdout);

    return {
      name: `${property.name}: ${property.description}`,
      passed: parsed.passed,
      input,
      expected: true,
      actual: parsed.passed,
      error: parsed.error ?? undefined,
    };
  } catch (error) {
    return {
      name: `${property.name}: ${property.description}`,
      passed: false,
      input,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Auto-detect properties for a function based on its name.
 */
export function detectProperties(functionName: string): Property[] {
  const normalized = functionName.toLowerCase().replace(/_/g, '');

  // Check direct matches
  if (COMMON_PROPERTIES[normalized]) {
    return COMMON_PROPERTIES[normalized];
  }

  // Check partial matches
  for (const [key, props] of Object.entries(COMMON_PROPERTIES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return props;
    }
  }

  // Default to generic numeric properties
  return COMMON_PROPERTIES['numeric'] ?? [
    { name: 'deterministic', description: 'Same input gives same output', check: 'f({input}) == f({input})' },
  ];
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
