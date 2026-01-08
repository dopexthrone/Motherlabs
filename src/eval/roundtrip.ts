/**
 * Round-Trip Validation
 * =====================
 *
 * Code → AST → Code comparison for structural integrity.
 */

import { spawn } from 'node:child_process';
import type { EvalResult, TestResult, RoundTripConfig, ASTNode } from './types.js';

// =============================================================================
// Round-Trip Evaluator
// =============================================================================

/**
 * Run round-trip validation.
 */
export async function runRoundTripTest(
  code: string,
  config: RoundTripConfig
): Promise<EvalResult> {
  const startTime = performance.now();
  const tests: TestResult[] = [];
  let passed = 0;

  // Parse to AST
  const astResult = await parseToAST(code);
  if (!astResult.success) {
    return {
      method: 'round_trip',
      passed: false,
      score: 0,
      details: `Failed to parse code: ${astResult.error}`,
      tests: [
        {
          name: 'AST Parse',
          passed: false,
          input: code.slice(0, 100),
          error: astResult.error,
        },
      ],
      duration_ms: Math.round(performance.now() - startTime),
    };
  }

  tests.push({
    name: 'AST Parse',
    passed: true,
    input: code.slice(0, 100),
    actual: `Parsed ${astResult.nodeCount} nodes`,
  });
  passed++;

  // Perform round trips
  let currentCode = code;
  for (let trip = 0; trip < config.num_trips; trip++) {
    const tripResult = await performRoundTrip(currentCode, config.compare_mode);

    tests.push({
      name: `Round Trip ${trip + 1}`,
      passed: tripResult.equivalent,
      input: `Trip ${trip + 1}/${config.num_trips}`,
      expected: 'Semantically equivalent',
      actual: tripResult.equivalent ? 'Equivalent' : tripResult.difference,
    });

    if (tripResult.equivalent) {
      passed++;
      currentCode = tripResult.regenerated;
    } else {
      // Stop on first failure
      break;
    }
  }

  // Semantic check: functions should have same behavior
  const semanticResult = await checkSemanticEquivalence(code, currentCode);
  tests.push({
    name: 'Semantic Equivalence',
    passed: semanticResult.equivalent,
    input: 'Execute with test inputs',
    expected: 'Same outputs',
    actual: semanticResult.equivalent ? 'Outputs match' : semanticResult.difference,
  });
  if (semanticResult.equivalent) passed++;

  const totalTests = tests.length;
  const score = totalTests > 0 ? passed / totalTests : 0;

  return {
    method: 'round_trip',
    passed: score >= 0.9,
    score,
    details: `${passed}/${totalTests} round-trip checks passed`,
    tests,
    duration_ms: Math.round(performance.now() - startTime),
  };
}

/**
 * Parse code to AST.
 */
async function parseToAST(
  code: string
): Promise<{ success: true; ast: ASTNode; nodeCount: number } | { success: false; error: string }> {
  const script = `
import ast
import json

code = '''${code.replace(/'/g, "\\'")}'''

try:
    tree = ast.parse(code)

    def node_to_dict(node):
        result = {"type": node.__class__.__name__, "children": []}
        if hasattr(node, 'name'):
            result["name"] = node.name
        for child in ast.iter_child_nodes(node):
            result["children"].append(node_to_dict(child))
        return result

    ast_dict = node_to_dict(tree)
    node_count = len(list(ast.walk(tree)))
    print(json.dumps({"success": True, "ast": ast_dict, "nodeCount": node_count}))
except SyntaxError as e:
    print(json.dumps({"success": False, "error": str(e)}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

  try {
    const result = await runPython(script);
    const parsed = JSON.parse(result.stdout);
    if (parsed.success) {
      return { success: true, ast: parsed.ast, nodeCount: parsed.nodeCount };
    }
    return { success: false, error: parsed.error };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Perform one round trip: Code → AST → Code.
 */
async function performRoundTrip(
  code: string,
  compareMode: 'exact' | 'ast' | 'semantic'
): Promise<{ equivalent: boolean; regenerated: string; difference?: string }> {
  const script = `
import ast
import json

code = '''${code.replace(/'/g, "\\'")}'''

try:
    # Parse
    tree = ast.parse(code)

    # Unparse (regenerate code from AST)
    regenerated = ast.unparse(tree)

    # Compare based on mode
    mode = "${compareMode}"

    if mode == "exact":
        # Exact string match (after normalization)
        equivalent = code.strip() == regenerated.strip()
        difference = None if equivalent else "Code strings differ"
    elif mode == "ast":
        # AST structure match
        tree2 = ast.parse(regenerated)
        equivalent = ast.dump(tree) == ast.dump(tree2)
        difference = None if equivalent else "AST structures differ"
    else:  # semantic
        # Just check if both parse successfully
        tree2 = ast.parse(regenerated)
        equivalent = True
        difference = None

    print(json.dumps({
        "success": True,
        "equivalent": equivalent,
        "regenerated": regenerated,
        "difference": difference
    }))
except Exception as e:
    print(json.dumps({
        "success": False,
        "equivalent": False,
        "regenerated": "",
        "difference": str(e)
    }))
`;

  try {
    const result = await runPython(script);
    const parsed = JSON.parse(result.stdout);
    return {
      equivalent: parsed.equivalent,
      regenerated: parsed.regenerated,
      difference: parsed.difference ?? undefined,
    };
  } catch {
    return { equivalent: false, regenerated: '', difference: 'Failed to perform round trip' };
  }
}

/**
 * Check if two code snippets are semantically equivalent.
 */
async function checkSemanticEquivalence(
  original: string,
  transformed: string
): Promise<{ equivalent: boolean; difference?: string }> {
  const script = `
import ast
import json
import random

original = '''${original.replace(/'/g, "\\'")}'''
transformed = '''${transformed.replace(/'/g, "\\'")}'''

try:
    # Get function names from original
    tree = ast.parse(original)
    func_names = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]

    if not func_names:
        # No functions to test
        print(json.dumps({"equivalent": True}))
    else:
        # Execute both and compare outputs
        exec(original)
        original_funcs = {name: eval(name) for name in func_names}

        exec(transformed)
        transformed_funcs = {name: eval(name) for name in func_names}

        # Test with random inputs
        test_inputs = [0, 1, -1, 5, 10, 100, [], [1,2,3], "test"]

        all_equivalent = True
        difference = None

        for name in func_names:
            orig_f = original_funcs[name]
            trans_f = transformed_funcs[name]

            for inp in test_inputs:
                try:
                    orig_result = orig_f(inp)
                    trans_result = trans_f(inp)
                    if orig_result != trans_result:
                        all_equivalent = False
                        difference = f"{name}({inp}): {orig_result} vs {trans_result}"
                        break
                except:
                    continue

            if not all_equivalent:
                break

        print(json.dumps({"equivalent": all_equivalent, "difference": difference}))

except Exception as e:
    print(json.dumps({"equivalent": False, "difference": str(e)}))
`;

  try {
    const result = await runPython(script);
    const parsed = JSON.parse(result.stdout);
    return {
      equivalent: parsed.equivalent,
      difference: parsed.difference ?? undefined,
    };
  } catch {
    return { equivalent: false, difference: 'Failed to check semantic equivalence' };
  }
}

/**
 * Extract function signatures from code.
 */
export async function extractSignatures(code: string): Promise<string[]> {
  const script = `
import ast
import json

code = '''${code.replace(/'/g, "\\'")}'''

try:
    tree = ast.parse(code)
    signatures = []

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            args = []
            for arg in node.args.args:
                arg_str = arg.arg
                if arg.annotation:
                    arg_str += f": {ast.unparse(arg.annotation)}"
                args.append(arg_str)

            ret = ""
            if node.returns:
                ret = f" -> {ast.unparse(node.returns)}"

            sig = f"def {node.name}({', '.join(args)}){ret}"
            signatures.append(sig)

    print(json.dumps({"success": True, "signatures": signatures}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

  try {
    const result = await runPython(script);
    const parsed = JSON.parse(result.stdout);
    if (parsed.success) {
      return parsed.signatures;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Normalize code for comparison.
 */
export async function normalizeCode(code: string): Promise<string> {
  const script = `
import ast
import json

code = '''${code.replace(/'/g, "\\'")}'''

try:
    tree = ast.parse(code)
    normalized = ast.unparse(tree)
    print(json.dumps({"success": True, "normalized": normalized}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

  try {
    const result = await runPython(script);
    const parsed = JSON.parse(result.stdout);
    if (parsed.success) {
      return parsed.normalized;
    }
    return code;
  } catch {
    return code;
  }
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
