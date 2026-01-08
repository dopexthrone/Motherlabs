/**
 * Differential Testing
 * ====================
 *
 * Compare generated code output against reference implementations.
 */

import { spawn } from 'node:child_process';
import type {
  EvalResult,
  TestResult,
  DifferentialConfig,
  ReferenceImpl,
} from './types.js';

// =============================================================================
// Default References
// =============================================================================

/**
 * Built-in reference implementations for common functions.
 */
export const STDLIB_REFERENCES: Record<string, ReferenceImpl> = {
  sort: {
    name: 'Python sorted()',
    code: 'sorted({input})',
    imports: [],
  },
  reverse: {
    name: 'Python reversed()',
    code: 'list(reversed({input}))',
    imports: [],
  },
  sum: {
    name: 'Python sum()',
    code: 'sum({input})',
    imports: [],
  },
  min: {
    name: 'Python min()',
    code: 'min({input})',
    imports: [],
  },
  max: {
    name: 'Python max()',
    code: 'max({input})',
    imports: [],
  },
  len: {
    name: 'Python len()',
    code: 'len({input})',
    imports: [],
  },
  factorial: {
    name: 'math.factorial()',
    code: 'math.factorial({input})',
    imports: ['import math'],
  },
  gcd: {
    name: 'math.gcd()',
    code: 'math.gcd(*{input})',
    imports: ['import math'],
  },
  sqrt: {
    name: 'math.sqrt()',
    code: 'math.sqrt({input})',
    imports: ['import math'],
  },
  abs: {
    name: 'Python abs()',
    code: 'abs({input})',
    imports: [],
  },
  is_prime: {
    name: 'sympy.isprime()',
    code: 'sympy.isprime({input})',
    imports: ['import sympy'],
  },
};

// =============================================================================
// Differential Evaluator
// =============================================================================

/**
 * Run differential testing.
 */
export async function runDifferentialTest(
  code: string,
  functionName: string,
  config: DifferentialConfig
): Promise<EvalResult> {
  const startTime = performance.now();
  const tests: TestResult[] = [];
  let passed = 0;

  for (const ref of config.references) {
    for (const input of config.inputs) {
      const testResult = await compareWithReference(
        code,
        functionName,
        ref,
        input,
        config.tolerance ?? 1e-9
      );
      tests.push(testResult);
      if (testResult.passed) passed++;
    }
  }

  const totalTests = tests.length;
  const score = totalTests > 0 ? passed / totalTests : 0;

  return {
    method: 'differential',
    passed: score >= 0.9, // 90% agreement required
    score,
    details: `${passed}/${totalTests} tests passed against reference implementations`,
    tests,
    duration_ms: Math.round(performance.now() - startTime),
  };
}

/**
 * Compare generated code output with reference.
 */
async function compareWithReference(
  code: string,
  functionName: string,
  ref: ReferenceImpl,
  input: unknown,
  tolerance: number
): Promise<TestResult> {
  const inputStr = JSON.stringify(input);

  // Build comparison script
  const script = `
${ref.imports.join('\n')}
import json

# Generated code
${code}

# Run generated function
try:
    gen_result = ${functionName}(${typeof input === 'object' ? '*' + inputStr : inputStr})
except Exception as e:
    gen_result = f"ERROR: {e}"

# Run reference
try:
    ref_result = ${ref.code.replace('{input}', inputStr)}
except Exception as e:
    ref_result = f"ERROR: {e}"

# Compare
def compare(a, b, tol=${tolerance}):
    if isinstance(a, float) and isinstance(b, float):
        return abs(a - b) < tol
    return a == b

match = compare(gen_result, ref_result)
print(json.dumps({"match": match, "generated": str(gen_result), "reference": str(ref_result)}))
`;

  try {
    const result = await runPython(script);
    const parsed = JSON.parse(result.stdout);

    return {
      name: `${functionName}(${inputStr}) vs ${ref.name}`,
      passed: parsed.match,
      input,
      expected: parsed.reference,
      actual: parsed.generated,
    };
  } catch (error) {
    return {
      name: `${functionName}(${inputStr}) vs ${ref.name}`,
      passed: false,
      input,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Auto-detect reference implementation for common functions.
 */
export function detectReference(functionName: string): ReferenceImpl | undefined {
  const normalized = functionName.toLowerCase().replace(/_/g, '');

  // Check direct matches
  if (STDLIB_REFERENCES[normalized]) {
    return STDLIB_REFERENCES[normalized];
  }

  // Check partial matches
  for (const [key, ref] of Object.entries(STDLIB_REFERENCES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return ref;
    }
  }

  return undefined;
}

/**
 * Generate test inputs for a function based on its signature.
 */
export function generateTestInputs(
  signature: string,
  count: number = 10
): unknown[] {
  const inputs: unknown[] = [];

  // Parse signature to determine input types
  const intPattern = /:\s*int/i;
  const floatPattern = /:\s*float/i;
  const strPattern = /:\s*str/i;
  const listPattern = /:\s*list/i;

  if (intPattern.test(signature)) {
    // Integer inputs
    for (let i = 0; i < count; i++) {
      inputs.push(Math.floor(Math.random() * 100));
    }
    // Add edge cases
    inputs.push(0, 1, -1, 100, -100);
  } else if (floatPattern.test(signature)) {
    // Float inputs
    for (let i = 0; i < count; i++) {
      inputs.push(Math.random() * 100);
    }
    inputs.push(0.0, 1.0, -1.0, 0.5);
  } else if (strPattern.test(signature)) {
    // String inputs
    inputs.push('', 'a', 'hello', 'Hello World', '12345', 'abc123');
  } else if (listPattern.test(signature)) {
    // List inputs
    inputs.push([], [1], [1, 2, 3], [3, 1, 2], [1, 1, 1], [-1, 0, 1]);
  } else {
    // Default to integers
    for (let i = 0; i < count; i++) {
      inputs.push(Math.floor(Math.random() * 100));
    }
  }

  return inputs;
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
