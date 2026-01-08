/**
 * Test Generator
 * ==============
 *
 * Automatically generates unit tests for generated code.
 * Uses LLM to generate meaningful test cases.
 */

import type { ModelAdapter, TransformContext } from '../adapters/index.js';
import type { TestCase, GenerationRequest } from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Test generation options.
 */
export interface TestGenOptions {
  /**
   * Maximum number of test cases to generate.
   * @default 5
   */
  max_tests?: number;

  /**
   * Include edge case tests.
   * @default true
   */
  include_edge_cases?: boolean;

  /**
   * Include error/exception tests.
   * @default true
   */
  include_error_tests?: boolean;

  /**
   * Test framework to use.
   */
  framework?: 'pytest' | 'jest' | 'vitest' | 'unittest';
}

/**
 * Test type classification.
 */
export type TestType = 'unit' | 'edge_case' | 'error' | 'property';

/**
 * Generated test suite.
 */
export interface GeneratedTestSuite {
  /**
   * Test cases.
   */
  tests: TestCase[];

  /**
   * Full test file content.
   */
  code: string;

  /**
   * Test framework used.
   */
  framework: string;

  /**
   * Coverage estimate (0-1).
   */
  coverage_estimate: number;

  /**
   * Test types included.
   */
  test_types: TestType[];
}

// =============================================================================
// Test Generator
// =============================================================================

/**
 * Generates unit tests for code.
 */
export class TestGenerator {
  constructor(private readonly adapter: ModelAdapter) {}

  /**
   * Generate tests for code.
   */
  async generateTests(
    code: string,
    language: string,
    request: GenerationRequest,
    options: TestGenOptions = {}
  ): Promise<GeneratedTestSuite> {
    const maxTests = options.max_tests ?? 5;
    const includeEdgeCases = options.include_edge_cases ?? true;
    const includeErrorTests = options.include_error_tests ?? true;
    const framework = options.framework ?? this.getDefaultFramework(language);

    const prompt = this.buildTestGenPrompt(
      code,
      language,
      request,
      framework,
      maxTests,
      includeEdgeCases,
      includeErrorTests
    );

    const context: TransformContext = {
      intent_id: request.id ?? 'test_gen',
      run_id: `test_gen_${Date.now()}`,
      mode: 'execute',
      constraints: [],
      metadata: {
        language,
        framework,
        original_prompt: request.prompt.slice(0, 200),
        task: 'test-generation',
      },
    };

    const result = await this.adapter.transform(prompt, context);
    return this.parseTestResponse(result.content, language, framework);
  }

  /**
   * Generate quick sanity tests (faster, fewer tests).
   */
  async generateQuickTests(
    code: string,
    language: string,
    request: GenerationRequest
  ): Promise<TestCase[]> {
    const suite = await this.generateTests(code, language, request, {
      max_tests: 3,
      include_edge_cases: false,
      include_error_tests: false,
    });
    return suite.tests;
  }

  /**
   * Build the test generation prompt.
   */
  private buildTestGenPrompt(
    code: string,
    language: string,
    request: GenerationRequest,
    framework: string,
    maxTests: number,
    includeEdgeCases: boolean,
    includeErrorTests: boolean
  ): string {
    const sections: string[] = [];

    sections.push(`# Task: Generate Unit Tests

You are a test engineer. Generate unit tests for the following code.

## Original Requirement
${request.prompt}

## Code to Test
\`\`\`${language}
${code}
\`\`\`

## Requirements
- Language: ${language}
- Test Framework: ${framework}
- Generate ${maxTests} test cases maximum
- Tests must be complete and runnable
- Include docstrings/comments explaining each test`);

    if (includeEdgeCases) {
      sections.push(`- Include edge case tests (empty inputs, boundary values, null/undefined)`);
    }

    if (includeErrorTests) {
      sections.push(`- Include tests that verify proper error handling`);
    }

    sections.push(`
## Output Format
Respond ONLY with the test code. No explanations or markdown code blocks.
The test file should be complete and runnable.`);

    return sections.join('\n');
  }

  /**
   * Parse the LLM response into structured tests.
   */
  private parseTestResponse(
    response: string,
    language: string,
    framework: string
  ): GeneratedTestSuite {
    // Extract code from markdown if present
    let code = response;
    const codeBlockMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      code = codeBlockMatch[1].trim();
    }

    // Parse individual test cases
    const tests = this.extractTestCases(code, language, framework);

    // Collect test types
    const testTypes = new Set<TestType>();
    for (const test of tests) {
      if (test.description) {
        testTypes.add(test.description as TestType);
      }
    }

    return {
      tests,
      code,
      framework,
      coverage_estimate: this.estimateCoverage(tests, code),
      test_types: Array.from(testTypes),
    };
  }

  /**
   * Extract individual test cases from test code.
   */
  private extractTestCases(
    code: string,
    language: string,
    _framework: string
  ): TestCase[] {
    const tests: TestCase[] = [];

    if (language === 'python') {
      // Match pytest/unittest test functions
      const testFnRegex = /def (test_\w+)\s*\([^)]*\):[^]*?(?=\ndef |\n\nclass |$)/g;
      let match;
      while ((match = testFnRegex.exec(code)) !== null) {
        if (match[1]) {
          const testCase: TestCase = {
            name: match[1],
            inputs: { code: this.extractInput(match[0], language) },
            expected: this.extractExpected(match[0], language),
          };
          testCase.description = this.categorizeTest(match[1]);
          tests.push(testCase);
        }
      }
    } else if (language === 'typescript' || language === 'javascript') {
      // Match jest/vitest test functions
      const testFnRegex = /(?:it|test)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:async\s*)?\(\)\s*=>\s*\{[^}]*\}/g;
      let match;
      while ((match = testFnRegex.exec(code)) !== null) {
        if (match[1]) {
          const testCase: TestCase = {
            name: match[1],
            inputs: { code: this.extractInput(match[0], language) },
            expected: this.extractExpected(match[0], language),
          };
          testCase.description = this.categorizeTest(match[1]);
          tests.push(testCase);
        }
      }
    }

    // If no tests parsed, create a placeholder
    if (tests.length === 0) {
      const placeholder: TestCase = {
        name: 'generated_test_suite',
        inputs: { code: 'See test code' },
        expected: 'Tests should pass',
      };
      placeholder.description = 'Generated test suite';
      tests.push(placeholder);
    }

    return tests;
  }

  /**
   * Extract input from test code.
   */
  private extractInput(testCode: string, _language: string): string {
    // Simple heuristic: look for assignment or function call
    const inputMatch = testCode.match(/(?:input|data|value|arg)\s*=\s*([^\n;]+)/i);
    if (inputMatch && inputMatch[1]) {
      return inputMatch[1].trim();
    }
    return 'See test code';
  }

  /**
   * Extract expected value from test code.
   */
  private extractExpected(testCode: string, _language: string): string {
    // Look for assert statements
    const assertMatch = testCode.match(/assert.*?==\s*([^\n;]+)/i);
    if (assertMatch && assertMatch[1]) {
      return assertMatch[1].trim();
    }
    const expectMatch = testCode.match(/expect.*?(?:toBe|toEqual)\s*\(\s*([^)]+)\)/i);
    if (expectMatch && expectMatch[1]) {
      return expectMatch[1].trim();
    }
    return 'See assertion';
  }

  /**
   * Categorize test type based on name.
   */
  private categorizeTest(name: string): TestType {
    const nameLower = name.toLowerCase();
    if (nameLower.includes('edge') || nameLower.includes('boundary')) {
      return 'edge_case';
    }
    if (nameLower.includes('error') || nameLower.includes('exception') || nameLower.includes('invalid')) {
      return 'error';
    }
    if (nameLower.includes('property') || nameLower.includes('invariant')) {
      return 'property';
    }
    return 'unit';
  }

  /**
   * Estimate test coverage based on test count and variety.
   */
  private estimateCoverage(tests: TestCase[], code: string): number {
    if (tests.length === 0) return 0;

    // Count functions/methods in code
    const fnCount = (code.match(/\bdef\s+\w+|function\s+\w+|\w+\s*[:=]\s*(?:async\s*)?\(/g) || []).length;
    const coverage = Math.min(1, tests.length / Math.max(fnCount * 2, 1));

    // Bonus for variety of test types (stored in description)
    const types = new Set(tests.map((t) => t.description).filter(Boolean));
    const varietyBonus = types.size * 0.05;

    return Math.min(1, coverage + varietyBonus);
  }

  /**
   * Get default test framework for language.
   */
  private getDefaultFramework(language: string): string {
    switch (language) {
      case 'python':
        return 'pytest';
      case 'typescript':
        return 'vitest';
      case 'javascript':
        return 'jest';
      default:
        return 'generic';
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a test generator.
 */
export function createTestGenerator(adapter: ModelAdapter): TestGenerator {
  return new TestGenerator(adapter);
}
