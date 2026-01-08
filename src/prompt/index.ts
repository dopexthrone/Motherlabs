/**
 * Prompt Augmentation
 * ===================
 *
 * Utilities for enhancing prompts with RAG context,
 * few-shot examples, and extracted code patterns.
 */

import type { ContextItem } from '../agent/types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * A few-shot example for the prompt.
 */
export interface FewShotExample {
  /**
   * Description of what the example does.
   */
  description: string;

  /**
   * The input/request for this example.
   */
  input: string;

  /**
   * The expected output/code.
   */
  output: string;

  /**
   * Source file for attribution.
   */
  source?: string;

  /**
   * Relevance score (0-1).
   */
  relevance?: number;
}

/**
 * Extracted code patterns from context.
 */
export interface CodePatterns {
  /**
   * Naming conventions detected.
   */
  naming: {
    functions: 'snake_case' | 'camelCase' | 'PascalCase' | 'unknown';
    variables: 'snake_case' | 'camelCase' | 'SCREAMING_SNAKE' | 'unknown';
    classes: 'PascalCase' | 'snake_case' | 'unknown';
  };

  /**
   * Common imports seen.
   */
  imports: string[];

  /**
   * Error handling style.
   */
  errorHandling: 'try-catch' | 'result-type' | 'assert' | 'none' | 'unknown';

  /**
   * Documentation style.
   */
  docStyle: 'jsdoc' | 'docstring' | 'inline' | 'none' | 'unknown';

  /**
   * Type annotation style (TypeScript/Python).
   */
  typeStyle: 'full' | 'partial' | 'none' | 'unknown';

  /**
   * Async style.
   */
  asyncStyle: 'async-await' | 'promises' | 'callbacks' | 'none' | 'unknown';
}

/**
 * Augmented prompt with all components.
 */
export interface AugmentedPrompt {
  /**
   * System instruction portion.
   */
  system: string;

  /**
   * Few-shot examples section.
   */
  examples: string;

  /**
   * Pattern hints section.
   */
  patterns: string;

  /**
   * Main task section.
   */
  task: string;

  /**
   * Full combined prompt.
   */
  full: string;

  /**
   * Metadata about the augmentation.
   */
  metadata: {
    num_examples: number;
    patterns_detected: boolean;
    total_tokens_estimate: number;
  };
}

/**
 * Options for prompt augmentation.
 */
export interface AugmentOptions {
  /**
   * Maximum number of few-shot examples.
   */
  maxExamples?: number;

  /**
   * Maximum tokens for context (approximate).
   */
  maxContextTokens?: number;

  /**
   * Include pattern analysis.
   */
  includePatterns?: boolean;

  /**
   * Include style hints.
   */
  includeStyleHints?: boolean;

  /**
   * Minimum relevance for examples.
   */
  minRelevance?: number;
}

// =============================================================================
// Few-Shot Example Extraction
// =============================================================================

/**
 * Extract few-shot examples from RAG context items.
 */
export function extractFewShot(
  context: ContextItem[],
  targetTask: string,
  language: string,
  options: AugmentOptions = {}
): FewShotExample[] {
  const maxExamples = options.maxExamples ?? 3;
  const minRelevance = options.minRelevance ?? 0.5;

  const examples: FewShotExample[] = [];

  for (const item of context) {
    // Skip low-relevance items
    if (item.relevance !== undefined && item.relevance < minRelevance) {
      continue;
    }

    // Only use code items for few-shot
    if (item.type !== 'file' && item.type !== 'snippet') {
      continue;
    }

    // Extract function/class definitions as examples
    const extracted = extractCodeExample(item.content, language);
    if (extracted) {
      const example: FewShotExample = {
        description: extracted.description,
        input: extracted.signature || 'Implement the function',
        output: extracted.code,
      };
      if (item.source) example.source = item.source;
      if (item.relevance !== undefined) example.relevance = item.relevance;
      examples.push(example);
    }

    if (examples.length >= maxExamples) break;
  }

  // Sort by relevance
  examples.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

  return examples.slice(0, maxExamples);
}

/**
 * Extract a code example (function/class) from content.
 */
function extractCodeExample(
  content: string,
  language: string
): { description: string; signature?: string; code: string } | null {
  const lines = content.split('\n');

  if (language === 'python') {
    return extractPythonExample(lines);
  } else if (language === 'typescript' || language === 'javascript') {
    return extractTypeScriptExample(lines);
  }

  return null;
}

/**
 * Extract Python function/class example.
 */
function extractPythonExample(
  lines: string[]
): { description: string; signature?: string; code: string } | null {
  // Look for function definition with docstring
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const funcMatch = line.match(/^def\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?:/);
    if (funcMatch) {
      const funcName = funcMatch[1] || 'function';
      const params = funcMatch[2] || '';
      const returnType = funcMatch[3];

      // Get docstring if present
      let docstring = '';
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]?.trim() ?? '';
        if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
          // Extract docstring
          let endQuote = nextLine.startsWith('"""') ? '"""' : "'''";
          if (nextLine.endsWith(endQuote) && nextLine.length > 6) {
            docstring = nextLine.slice(3, -3);
          } else {
            // Multi-line docstring
            for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
              const docLine = lines[j];
              if (docLine && docLine.includes(endQuote)) {
                break;
              }
              if (docLine) {
                docstring += ' ' + docLine.trim();
              }
            }
          }
        }
      }

      // Extract function body (up to next function or end)
      const codeLines: string[] = [];
      for (let j = i; j < Math.min(i + 30, lines.length); j++) {
        const codeLine = lines[j];
        if (codeLine === undefined) break;

        // Stop at next top-level definition
        if (j > i && /^(def |class |if __name__|@)/.test(codeLine)) {
          break;
        }
        codeLines.push(codeLine);
      }

      const signature = `def ${funcName}(${params})${returnType ? ` -> ${returnType}` : ''}`;

      return {
        description: docstring || `Implementation of ${funcName}`,
        signature,
        code: codeLines.join('\n').trim(),
      };
    }
  }

  return null;
}

/**
 * Extract TypeScript/JavaScript function/class example.
 */
function extractTypeScriptExample(
  lines: string[]
): { description: string; signature?: string; code: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Function declaration
    const funcMatch = line.match(
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\((.*?)\)(?:\s*:\s*(.+?))?/
    );
    if (funcMatch) {
      const funcName = funcMatch[1] || 'function';
      const params = funcMatch[2] || '';
      const returnType = funcMatch[3];

      // Get JSDoc if present
      let jsdoc = '';
      if (i > 0) {
        const prevLine = lines[i - 1]?.trim() ?? '';
        if (prevLine.endsWith('*/')) {
          // Found end of JSDoc, walk back
          for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
            const docLine = lines[j];
            if (docLine && docLine.trim().startsWith('/**')) {
              // Extract description from JSDoc
              const descMatch = lines.slice(j, i).join('\n').match(/\*\s+([^@\n]+)/);
              if (descMatch?.[1]) {
                jsdoc = descMatch[1].trim();
              }
              break;
            }
          }
        }
      }

      // Extract function body
      const codeLines: string[] = [];
      let braceCount = 0;
      let started = false;

      for (let j = i; j < Math.min(i + 50, lines.length); j++) {
        const codeLine = lines[j];
        if (codeLine === undefined) break;

        codeLines.push(codeLine);

        for (const char of codeLine) {
          if (char === '{') {
            braceCount++;
            started = true;
          } else if (char === '}') {
            braceCount--;
          }
        }

        if (started && braceCount === 0) break;
      }

      const asyncPrefix = line.includes('async ') ? 'async ' : '';
      const signature = `${asyncPrefix}function ${funcName}(${params})${returnType ? `: ${returnType}` : ''}`;

      return {
        description: jsdoc || `Implementation of ${funcName}`,
        signature,
        code: codeLines.join('\n').trim(),
      };
    }

    // Arrow function const
    const arrowMatch = line.match(
      /^(?:export\s+)?const\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s*)?\(/
    );
    if (arrowMatch) {
      const funcName = arrowMatch[1] || 'function';

      // Extract function body
      const codeLines: string[] = [];
      let braceCount = 0;
      let parenCount = 0;
      let started = false;

      for (let j = i; j < Math.min(i + 50, lines.length); j++) {
        const codeLine = lines[j];
        if (codeLine === undefined) break;

        codeLines.push(codeLine);

        for (const char of codeLine) {
          if (char === '{') {
            braceCount++;
            started = true;
          } else if (char === '}') {
            braceCount--;
          } else if (char === '(') {
            parenCount++;
          } else if (char === ')') {
            parenCount--;
          }
        }

        if (started && braceCount === 0 && parenCount === 0) break;
      }

      return {
        description: `Implementation of ${funcName}`,
        signature: `const ${funcName}`,
        code: codeLines.join('\n').trim(),
      };
    }
  }

  return null;
}

// =============================================================================
// Pattern Detection
// =============================================================================

/**
 * Analyze code context to detect patterns.
 */
export function detectPatterns(context: ContextItem[], language: string): CodePatterns {
  const patterns: CodePatterns = {
    naming: {
      functions: 'unknown',
      variables: 'unknown',
      classes: 'unknown',
    },
    imports: [],
    errorHandling: 'unknown',
    docStyle: 'unknown',
    typeStyle: 'unknown',
    asyncStyle: 'unknown',
  };

  // Aggregate all code content
  const allCode = context
    .filter((c) => c.type === 'file' || c.type === 'snippet')
    .map((c) => c.content)
    .join('\n');

  if (!allCode) return patterns;

  // Detect naming conventions
  patterns.naming = detectNamingConventions(allCode, language);

  // Detect imports
  patterns.imports = detectCommonImports(allCode, language).slice(0, 10);

  // Detect error handling style
  patterns.errorHandling = detectErrorHandling(allCode, language);

  // Detect documentation style
  patterns.docStyle = detectDocStyle(allCode, language);

  // Detect type style
  patterns.typeStyle = detectTypeStyle(allCode, language);

  // Detect async style
  patterns.asyncStyle = detectAsyncStyle(allCode, language);

  return patterns;
}

/**
 * Detect naming conventions in code.
 */
function detectNamingConventions(
  code: string,
  language: string
): CodePatterns['naming'] {
  const result: CodePatterns['naming'] = {
    functions: 'unknown',
    variables: 'unknown',
    classes: 'unknown',
  };

  if (language === 'python') {
    // Python: check for snake_case vs camelCase
    const funcNames = code.match(/def\s+(\w+)/g)?.map((m) => m.replace('def ', '')) ?? [];
    const snakeFuncs = funcNames.filter((n) => /^[a-z][a-z0-9_]*$/.test(n)).length;
    const camelFuncs = funcNames.filter((n) => /^[a-z][a-zA-Z0-9]*$/.test(n) && n.includes('')).length;
    result.functions = snakeFuncs > camelFuncs ? 'snake_case' : snakeFuncs < camelFuncs ? 'camelCase' : 'snake_case'; // Python default

    const classNames = code.match(/class\s+(\w+)/g)?.map((m) => m.replace('class ', '')) ?? [];
    const pascalClasses = classNames.filter((n) => /^[A-Z][a-zA-Z0-9]*$/.test(n)).length;
    result.classes = pascalClasses > 0 ? 'PascalCase' : 'unknown';

    result.variables = 'snake_case'; // Python convention
  } else if (language === 'typescript' || language === 'javascript') {
    // TS/JS: check for camelCase vs snake_case
    const funcNames =
      code.match(/(?:function|const|let|var)\s+(\w+)/g)?.map((m) => m.split(/\s+/)[1]) ?? [];
    const validNames = funcNames.filter((n): n is string => n !== undefined);
    const camelFuncs = validNames.filter((n) => /^[a-z][a-zA-Z0-9]*$/.test(n)).length;
    const snakeFuncs = validNames.filter((n) => /^[a-z][a-z0-9_]*$/.test(n) && n.includes('_')).length;
    result.functions = camelFuncs > snakeFuncs ? 'camelCase' : 'snake_case';

    const classNames = code.match(/class\s+(\w+)/g)?.map((m) => m.replace('class ', '')) ?? [];
    const pascalClasses = classNames.filter((n) => /^[A-Z][a-zA-Z0-9]*$/.test(n)).length;
    result.classes = pascalClasses > 0 ? 'PascalCase' : 'unknown';

    result.variables = 'camelCase'; // JS convention
  }

  return result;
}

/**
 * Detect common imports in code.
 */
function detectCommonImports(code: string, language: string): string[] {
  const imports: string[] = [];

  if (language === 'python') {
    const matches = code.match(/^(?:from\s+\S+\s+)?import\s+.+$/gm) ?? [];
    for (const m of matches) {
      if (!imports.includes(m)) imports.push(m);
    }
  } else if (language === 'typescript' || language === 'javascript') {
    const matches = code.match(/^import\s+.+$/gm) ?? [];
    for (const m of matches) {
      if (!imports.includes(m)) imports.push(m);
    }
  }

  return imports;
}

/**
 * Detect error handling style.
 */
function detectErrorHandling(code: string, language: string): CodePatterns['errorHandling'] {
  const tryCatch = (code.match(/try\s*[{:]/g) ?? []).length;
  const resultType = (code.match(/Result[<\[]/g) ?? []).length;
  const asserts = (code.match(/assert\s+/g) ?? []).length;

  if (tryCatch > resultType && tryCatch > asserts && tryCatch > 0) {
    return 'try-catch';
  }
  if (resultType > tryCatch && resultType > asserts && resultType > 0) {
    return 'result-type';
  }
  if (asserts > tryCatch && asserts > resultType && asserts > 0) {
    return 'assert';
  }

  return tryCatch === 0 && resultType === 0 && asserts === 0 ? 'none' : 'unknown';
}

/**
 * Detect documentation style.
 */
function detectDocStyle(code: string, language: string): CodePatterns['docStyle'] {
  if (language === 'python') {
    const docstrings = (code.match(/"""\s*\n|'''\s*\n/g) ?? []).length;
    const inline = (code.match(/#\s+.+$/gm) ?? []).length;
    return docstrings > inline / 2 ? 'docstring' : inline > 0 ? 'inline' : 'none';
  } else if (language === 'typescript' || language === 'javascript') {
    const jsdoc = (code.match(/\/\*\*[\s\S]*?\*\//g) ?? []).length;
    const inline = (code.match(/\/\/\s+.+$/gm) ?? []).length;
    return jsdoc > inline / 3 ? 'jsdoc' : inline > 0 ? 'inline' : 'none';
  }
  return 'unknown';
}

/**
 * Detect type annotation style.
 */
function detectTypeStyle(code: string, language: string): CodePatterns['typeStyle'] {
  if (language === 'typescript') {
    const typeAnnotations = (code.match(/:\s*\w+[<\[\]>|&,\s\w]*(?=[,)\]\s{=])/g) ?? []).length;
    const functions = (code.match(/function\s+\w+|=>\s*{/g) ?? []).length;
    if (functions === 0) return 'unknown';
    const ratio = typeAnnotations / functions;
    return ratio > 0.8 ? 'full' : ratio > 0.3 ? 'partial' : 'none';
  } else if (language === 'python') {
    const typeHints = (code.match(/:\s*(?:str|int|float|bool|List|Dict|Optional|Any|Tuple)/g) ?? []).length;
    const functions = (code.match(/def\s+\w+/g) ?? []).length;
    if (functions === 0) return 'unknown';
    const ratio = typeHints / functions;
    return ratio > 1.5 ? 'full' : ratio > 0.5 ? 'partial' : 'none';
  }
  return 'unknown';
}

/**
 * Detect async style.
 */
function detectAsyncStyle(code: string, language: string): CodePatterns['asyncStyle'] {
  const asyncAwait = (code.match(/async\s+|await\s+/g) ?? []).length;
  const promises = (code.match(/\.then\s*\(|Promise\./g) ?? []).length;
  const callbacks = (code.match(/callback|cb\s*[,)]/gi) ?? []).length;

  if (asyncAwait > promises && asyncAwait > callbacks && asyncAwait > 0) {
    return 'async-await';
  }
  if (promises > asyncAwait && promises > callbacks && promises > 0) {
    return 'promises';
  }
  if (callbacks > asyncAwait && callbacks > promises && callbacks > 0) {
    return 'callbacks';
  }

  return asyncAwait === 0 && promises === 0 && callbacks === 0 ? 'none' : 'unknown';
}

// =============================================================================
// Prompt Building
// =============================================================================

/**
 * Build an augmented prompt with few-shot examples and patterns.
 */
export function buildAugmentedPrompt(
  task: string,
  language: string,
  context: ContextItem[],
  options: AugmentOptions = {}
): AugmentedPrompt {
  const maxContextTokens = options.maxContextTokens ?? 4000;
  const includePatterns = options.includePatterns ?? true;
  const includeStyleHints = options.includeStyleHints ?? true;

  const sections: string[] = [];

  // System instruction
  const systemSection = `You are an expert ${language} programmer. Generate clean, correct, production-ready code that matches the style and patterns of the existing codebase.`;
  sections.push(systemSection);

  // Extract few-shot examples
  const examples = extractFewShot(context, task, language, options);
  let examplesSection = '';

  if (examples.length > 0) {
    examplesSection = '\n## Examples from Codebase\n\n';
    examplesSection += 'Here are examples of similar code from this project:\n\n';

    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      if (!ex) continue;
      examplesSection += `### Example ${i + 1}: ${ex.description}\n`;
      if (ex.source) examplesSection += `Source: ${ex.source}\n`;
      examplesSection += `\`\`\`${language}\n${ex.output}\n\`\`\`\n\n`;
    }
  }
  sections.push(examplesSection);

  // Detect and include patterns
  let patternsSection = '';

  if (includePatterns && context.length > 0) {
    const patterns = detectPatterns(context, language);

    if (includeStyleHints) {
      patternsSection = '\n## Code Style Guidelines\n\n';
      patternsSection += 'Follow these patterns observed in the codebase:\n\n';

      if (patterns.naming.functions !== 'unknown') {
        patternsSection += `- Function names: ${patterns.naming.functions}\n`;
      }
      if (patterns.naming.variables !== 'unknown') {
        patternsSection += `- Variable names: ${patterns.naming.variables}\n`;
      }
      if (patterns.naming.classes !== 'unknown') {
        patternsSection += `- Class names: ${patterns.naming.classes}\n`;
      }
      if (patterns.errorHandling !== 'unknown' && patterns.errorHandling !== 'none') {
        patternsSection += `- Error handling: ${patterns.errorHandling}\n`;
      }
      if (patterns.docStyle !== 'unknown' && patterns.docStyle !== 'none') {
        patternsSection += `- Documentation: ${patterns.docStyle}\n`;
      }
      if (patterns.typeStyle !== 'unknown' && patterns.typeStyle !== 'none') {
        patternsSection += `- Type annotations: ${patterns.typeStyle}\n`;
      }
      if (patterns.asyncStyle !== 'unknown' && patterns.asyncStyle !== 'none') {
        patternsSection += `- Async style: ${patterns.asyncStyle}\n`;
      }

      // Include common imports as hints
      if (patterns.imports.length > 0) {
        patternsSection += `\nCommonly used imports:\n`;
        for (const imp of patterns.imports.slice(0, 5)) {
          patternsSection += `\`\`\`${language}\n${imp}\n\`\`\`\n`;
        }
      }
    }
  }
  sections.push(patternsSection);

  // Task section
  const taskSection = `\n## Task\n\n${task}\n`;
  sections.push(taskSection);

  // Build full prompt
  const full = sections.join('\n');

  // Estimate tokens (rough: ~4 chars per token)
  const totalTokensEstimate = Math.ceil(full.length / 4);

  return {
    system: systemSection,
    examples: examplesSection,
    patterns: patternsSection,
    task: taskSection,
    full,
    metadata: {
      num_examples: examples.length,
      patterns_detected: patternsSection.length > 50,
      total_tokens_estimate: totalTokensEstimate,
    },
  };
}

/**
 * Format RAG results as few-shot examples for a prompt.
 * Simpler version that just formats context as examples.
 */
export function formatAsExamples(
  context: ContextItem[],
  language: string,
  maxExamples: number = 3
): string {
  const examples = extractFewShot(context, '', language, { maxExamples });

  if (examples.length === 0) {
    return '';
  }

  let result = '## Similar Code Examples\n\n';

  for (const ex of examples) {
    result += `### ${ex.description}\n`;
    if (ex.source) result += `(from ${ex.source})\n`;
    result += `\`\`\`${language}\n${ex.output}\n\`\`\`\n\n`;
  }

  return result;
}

// =============================================================================
// Export utility for simple usage
// =============================================================================

/**
 * Quick augmentation - add few-shot examples to an existing prompt.
 */
export function augmentPrompt(
  originalPrompt: string,
  language: string,
  context: ContextItem[],
  options: AugmentOptions = {}
): string {
  const augmented = buildAugmentedPrompt(originalPrompt, language, context, options);
  return augmented.full;
}
