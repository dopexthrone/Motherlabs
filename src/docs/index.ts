/**
 * Auto Documentation
 * ==================
 *
 * Generate and manage code documentation (JSDoc, docstrings).
 * Extracts signatures and generates appropriate documentation.
 */

import type { ModelAdapter, TransformContext } from '../adapters/model.js';
import { randomBytes } from 'node:crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported documentation styles.
 */
export type DocStyle = 'jsdoc' | 'docstring' | 'markdown' | 'inline';

/**
 * Extracted code element for documentation.
 */
export interface CodeElement {
  /**
   * Element type.
   */
  type: 'function' | 'class' | 'method' | 'property' | 'variable' | 'module';

  /**
   * Element name.
   */
  name: string;

  /**
   * Full signature.
   */
  signature: string;

  /**
   * Parameters (for functions/methods).
   */
  params?: Array<{
    name: string;
    type?: string;
    default?: string;
  }>;

  /**
   * Return type (for functions/methods).
   */
  returnType?: string;

  /**
   * Line number in source.
   */
  line: number;

  /**
   * Existing documentation (if any).
   */
  existingDoc?: string;
}

/**
 * Generated documentation.
 */
export interface GeneratedDoc {
  /**
   * The element being documented.
   */
  element: CodeElement;

  /**
   * Generated documentation text.
   */
  documentation: string;

  /**
   * Style used.
   */
  style: DocStyle;

  /**
   * Where to insert (line number).
   */
  insertAt: number;
}

/**
 * Documentation result.
 */
export interface DocResult {
  /**
   * Original code.
   */
  original: string;

  /**
   * Code with documentation added.
   */
  documented: string;

  /**
   * Documentation generated.
   */
  docs: GeneratedDoc[];

  /**
   * Elements that already had docs.
   */
  skipped: string[];

  /**
   * Duration in ms.
   */
  duration_ms: number;
}

/**
 * Documentation options.
 */
export interface DocOptions {
  /**
   * Documentation style to use.
   */
  style?: DocStyle;

  /**
   * Skip elements that already have docs.
   */
  skipExisting?: boolean;

  /**
   * Minimum complexity to document (skip simple getters/setters).
   */
  minComplexity?: number;

  /**
   * Use AI to generate descriptions.
   */
  useAI?: boolean;

  /**
   * Include examples in documentation.
   */
  includeExamples?: boolean;
}

// =============================================================================
// Extraction
// =============================================================================

/**
 * Extract code elements from Python code.
 */
export function extractPythonElements(code: string): CodeElement[] {
  const elements: CodeElement[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Match function definition
    const funcMatch = line.match(/^(\s*)def\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?:/);
    if (funcMatch) {
      const indent = funcMatch[1]?.length ?? 0;
      const name = funcMatch[2] ?? 'unknown';
      const paramsStr = funcMatch[3] ?? '';
      const returnType = funcMatch[4]?.trim();

      // Parse parameters
      const params = parseParams(paramsStr);

      // Check for existing docstring
      let existingDoc: string | undefined;
      const nextLine = lines[i + 1]?.trim() ?? '';
      if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
        existingDoc = extractDocstring(lines, i + 1);
      }

      const element: CodeElement = {
        type: indent > 0 ? 'method' : 'function',
        name,
        signature: line.trim(),
        params,
        line: i + 1,
      };
      if (returnType) element.returnType = returnType;
      if (existingDoc) element.existingDoc = existingDoc;

      elements.push(element);
    }

    // Match class definition
    const classMatch = line.match(/^class\s+(\w+)(?:\s*\((.*?)\))?:/);
    if (classMatch) {
      const name = classMatch[1] ?? 'unknown';

      // Check for existing docstring
      let existingDoc: string | undefined;
      const nextLine = lines[i + 1]?.trim() ?? '';
      if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
        existingDoc = extractDocstring(lines, i + 1);
      }

      const element: CodeElement = {
        type: 'class',
        name,
        signature: line.trim(),
        line: i + 1,
      };
      if (existingDoc) element.existingDoc = existingDoc;

      elements.push(element);
    }
  }

  return elements;
}

/**
 * Extract code elements from TypeScript/JavaScript code.
 */
export function extractTypeScriptElements(code: string): CodeElement[] {
  const elements: CodeElement[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Match function declaration
    const funcMatch = line.match(
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]+>)?\s*\((.*?)\)(?:\s*:\s*(.+?))?(?:\s*{|$)/
    );
    if (funcMatch) {
      const name = funcMatch[1] ?? 'unknown';
      const paramsStr = funcMatch[2] ?? '';
      const returnType = funcMatch[3]?.trim();

      // Check for existing JSDoc
      let existingDoc: string | undefined;
      if (i > 0) {
        const prevLine = lines[i - 1]?.trim() ?? '';
        if (prevLine.endsWith('*/')) {
          existingDoc = extractJSDoc(lines, i);
        }
      }

      const element: CodeElement = {
        type: 'function',
        name,
        signature: line.trim(),
        params: parseTypeScriptParams(paramsStr),
        line: i + 1,
      };
      if (returnType) element.returnType = returnType;
      if (existingDoc) element.existingDoc = existingDoc;

      elements.push(element);
    }

    // Match arrow function const
    const arrowMatch = line.match(
      /^(?:export\s+)?const\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s*)?\((.*?)\)(?:\s*:\s*(.+?))?\s*=>/
    );
    if (arrowMatch) {
      const name = arrowMatch[1] ?? 'unknown';
      const paramsStr = arrowMatch[2] ?? '';
      const returnType = arrowMatch[3]?.trim();

      // Check for existing JSDoc
      let existingDoc: string | undefined;
      if (i > 0) {
        const prevLine = lines[i - 1]?.trim() ?? '';
        if (prevLine.endsWith('*/')) {
          existingDoc = extractJSDoc(lines, i);
        }
      }

      const element: CodeElement = {
        type: 'function',
        name,
        signature: line.trim(),
        params: parseTypeScriptParams(paramsStr),
        line: i + 1,
      };
      if (returnType) element.returnType = returnType;
      if (existingDoc) element.existingDoc = existingDoc;

      elements.push(element);
    }

    // Match class declaration
    const classMatch = line.match(/^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+.+)?/);
    if (classMatch) {
      const name = classMatch[1] ?? 'unknown';

      // Check for existing JSDoc
      let existingDoc: string | undefined;
      if (i > 0) {
        const prevLine = lines[i - 1]?.trim() ?? '';
        if (prevLine.endsWith('*/')) {
          existingDoc = extractJSDoc(lines, i);
        }
      }

      const element: CodeElement = {
        type: 'class',
        name,
        signature: line.trim(),
        line: i + 1,
      };
      if (existingDoc) element.existingDoc = existingDoc;

      elements.push(element);
    }

    // Match interface/type
    const interfaceMatch = line.match(/^(?:export\s+)?(?:interface|type)\s+(\w+)/);
    if (interfaceMatch) {
      const name = interfaceMatch[1] ?? 'unknown';

      // Check for existing JSDoc
      let existingDoc: string | undefined;
      if (i > 0) {
        const prevLine = lines[i - 1]?.trim() ?? '';
        if (prevLine.endsWith('*/')) {
          existingDoc = extractJSDoc(lines, i);
        }
      }

      const element: CodeElement = {
        type: 'class', // Use 'class' for interfaces too
        name,
        signature: line.trim(),
        line: i + 1,
      };
      if (existingDoc) element.existingDoc = existingDoc;

      elements.push(element);
    }
  }

  return elements;
}

/**
 * Parse Python-style parameters.
 */
function parseParams(paramsStr: string): Array<{ name: string; type?: string; default?: string }> {
  if (!paramsStr.trim()) return [];

  const params: Array<{ name: string; type?: string; default?: string }> = [];
  const parts = paramsStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === 'self' || trimmed === 'cls') continue;

    // Match: name: type = default or name = default or name: type or name
    const match = trimmed.match(/^(\w+)(?:\s*:\s*([^=]+))?(?:\s*=\s*(.+))?$/);
    if (match && match[1]) {
      const param: { name: string; type?: string; default?: string } = {
        name: match[1],
      };
      if (match[2]) param.type = match[2].trim();
      if (match[3]) param.default = match[3].trim();
      params.push(param);
    }
  }

  return params;
}

/**
 * Parse TypeScript-style parameters.
 */
function parseTypeScriptParams(paramsStr: string): Array<{ name: string; type?: string; default?: string }> {
  if (!paramsStr.trim()) return [];

  const params: Array<{ name: string; type?: string; default?: string }> = [];

  // Simple split (doesn't handle nested generics well)
  let depth = 0;
  let current = '';
  for (const char of paramsStr) {
    if (char === '<' || char === '(' || char === '{' || char === '[') depth++;
    if (char === '>' || char === ')' || char === '}' || char === ']') depth--;

    if (char === ',' && depth === 0) {
      if (current.trim()) {
        const param = parseOneTypeScriptParam(current.trim());
        if (param) params.push(param);
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    const param = parseOneTypeScriptParam(current.trim());
    if (param) params.push(param);
  }

  return params;
}

/**
 * Parse a single TypeScript parameter.
 */
function parseOneTypeScriptParam(param: string): { name: string; type?: string; default?: string } | null {
  // Match: name?: type = default or name: type = default or name: type or name
  const match = param.match(/^(\w+)\??\s*(?::\s*([^=]+))?\s*(?:=\s*(.+))?$/);
  if (match && match[1]) {
    const result: { name: string; type?: string; default?: string } = {
      name: match[1],
    };
    if (match[2]) result.type = match[2].trim();
    if (match[3]) result.default = match[3].trim();
    return result;
  }
  return null;
}

/**
 * Extract docstring from Python code.
 */
function extractDocstring(lines: string[], startLine: number): string {
  const docLines: string[] = [];
  const firstLine = lines[startLine]?.trim() ?? '';
  const quote = firstLine.startsWith('"""') ? '"""' : "'''";

  // Single line docstring
  if (firstLine.startsWith(quote) && firstLine.endsWith(quote) && firstLine.length > 6) {
    return firstLine.slice(3, -3).trim();
  }

  // Multi-line docstring
  for (let i = startLine; i < Math.min(startLine + 50, lines.length); i++) {
    const line = lines[i];
    if (!line) continue;

    docLines.push(line);
    if (i > startLine && line.includes(quote)) {
      break;
    }
  }

  return docLines.join('\n');
}

/**
 * Extract JSDoc from TypeScript/JavaScript code.
 */
function extractJSDoc(lines: string[], elementLine: number): string {
  const docLines: string[] = [];

  // Walk backwards from element line
  for (let i = elementLine - 1; i >= Math.max(0, elementLine - 50); i--) {
    const line = lines[i];
    if (!line) continue;

    const trimmed = line.trim();
    docLines.unshift(line);

    if (trimmed.startsWith('/**')) {
      break;
    }
  }

  return docLines.join('\n');
}

// =============================================================================
// Generation
// =============================================================================

/**
 * Generate documentation for Python element.
 */
function generatePythonDoc(element: CodeElement, description: string): string {
  const lines: string[] = ['"""'];

  lines.push(description);

  if (element.params && element.params.length > 0) {
    lines.push('');
    lines.push('Args:');
    for (const param of element.params) {
      const typeStr = param.type ? ` (${param.type})` : '';
      const defaultStr = param.default ? ` Defaults to ${param.default}.` : '';
      lines.push(`    ${param.name}${typeStr}: TODO - describe parameter.${defaultStr}`);
    }
  }

  if (element.returnType && element.returnType !== 'None') {
    lines.push('');
    lines.push('Returns:');
    lines.push(`    ${element.returnType}: TODO - describe return value.`);
  }

  lines.push('"""');

  return lines.join('\n');
}

/**
 * Generate documentation for TypeScript element.
 */
function generateTypeScriptDoc(element: CodeElement, description: string): string {
  const lines: string[] = ['/**'];

  lines.push(` * ${description}`);

  if (element.params && element.params.length > 0) {
    lines.push(' *');
    for (const param of element.params) {
      const typeStr = param.type ? ` {${param.type}}` : '';
      lines.push(` * @param${typeStr} ${param.name} - TODO: describe parameter`);
    }
  }

  if (element.returnType) {
    lines.push(` * @returns {${element.returnType}} TODO: describe return value`);
  }

  lines.push(' */');

  return lines.join('\n');
}

/**
 * Generate a simple description from element name.
 */
function generateSimpleDescription(element: CodeElement): string {
  // Convert camelCase/snake_case to words
  const words = element.name
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();

  switch (element.type) {
    case 'function':
    case 'method':
      return `${words.charAt(0).toUpperCase() + words.slice(1)}.`;
    case 'class':
      return `${words.charAt(0).toUpperCase() + words.slice(1)} class.`;
    default:
      return `${words.charAt(0).toUpperCase() + words.slice(1)}.`;
  }
}

// =============================================================================
// Documenter
// =============================================================================

/**
 * Code documenter.
 */
export class CodeDocumenter {
  private readonly adapter?: ModelAdapter;

  constructor(adapter?: ModelAdapter) {
    if (adapter) {
      this.adapter = adapter;
    }
  }

  /**
   * Document Python code.
   */
  async documentPython(code: string, options: DocOptions = {}): Promise<DocResult> {
    const startTime = performance.now();
    const skipExisting = options.skipExisting ?? true;
    const useAI = options.useAI ?? false;

    const elements = extractPythonElements(code);
    const docs: GeneratedDoc[] = [];
    const skipped: string[] = [];

    for (const element of elements) {
      // Skip if already documented
      if (skipExisting && element.existingDoc) {
        skipped.push(element.name);
        continue;
      }

      // Generate description
      let description: string;
      if (useAI && this.adapter) {
        description = await this.generateAIDescription(element, 'python');
      } else {
        description = generateSimpleDescription(element);
      }

      // Generate documentation
      const documentation = generatePythonDoc(element, description);

      docs.push({
        element,
        documentation,
        style: 'docstring',
        insertAt: element.line,
      });
    }

    // Apply documentation to code
    const documented = this.applyDocumentation(code, docs, 'python');

    return {
      original: code,
      documented,
      docs,
      skipped,
      duration_ms: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Document TypeScript/JavaScript code.
   */
  async documentTypeScript(code: string, options: DocOptions = {}): Promise<DocResult> {
    const startTime = performance.now();
    const skipExisting = options.skipExisting ?? true;
    const useAI = options.useAI ?? false;

    const elements = extractTypeScriptElements(code);
    const docs: GeneratedDoc[] = [];
    const skipped: string[] = [];

    for (const element of elements) {
      // Skip if already documented
      if (skipExisting && element.existingDoc) {
        skipped.push(element.name);
        continue;
      }

      // Generate description
      let description: string;
      if (useAI && this.adapter) {
        description = await this.generateAIDescription(element, 'typescript');
      } else {
        description = generateSimpleDescription(element);
      }

      // Generate documentation
      const documentation = generateTypeScriptDoc(element, description);

      docs.push({
        element,
        documentation,
        style: 'jsdoc',
        insertAt: element.line,
      });
    }

    // Apply documentation to code
    const documented = this.applyDocumentation(code, docs, 'typescript');

    return {
      original: code,
      documented,
      docs,
      skipped,
      duration_ms: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Generate AI-powered description.
   */
  private async generateAIDescription(element: CodeElement, language: string): Promise<string> {
    if (!this.adapter) {
      return generateSimpleDescription(element);
    }

    const prompt = `Generate a brief, one-sentence description for this ${language} ${element.type}:

\`\`\`${language}
${element.signature}
\`\`\`

Respond with ONLY the description, no quotes or extra text. Be concise.`;

    try {
      const context: TransformContext = {
        intent_id: `doc_${randomBytes(4).toString('hex')}`,
        run_id: 'doc_gen',
        mode: 'execute',
        constraints: [],
        metadata: { language },
      };

      const result = await this.adapter.transform(prompt, context);
      const description = result.content.trim().replace(/^["']|["']$/g, '');

      // Ensure it ends with a period
      return description.endsWith('.') ? description : description + '.';
    } catch {
      return generateSimpleDescription(element);
    }
  }

  /**
   * Apply generated documentation to code.
   */
  private applyDocumentation(code: string, docs: GeneratedDoc[], language: string): string {
    if (docs.length === 0) return code;

    const lines = code.split('\n');

    // Sort docs by line number descending (apply from bottom to top)
    const sortedDocs = [...docs].sort((a, b) => b.insertAt - a.insertAt);

    for (const doc of sortedDocs) {
      const insertIdx = doc.insertAt - 1; // Convert to 0-indexed

      if (language === 'python') {
        // Insert after the function/class line
        const docLines = doc.documentation.split('\n');
        // Get indentation from the function line
        const funcLine = lines[insertIdx] ?? '';
        const indent = funcLine.match(/^(\s*)/)?.[1] ?? '';
        const innerIndent = indent + '    ';

        // Indent the docstring
        const indentedDoc = docLines.map((l, i) => (i === 0 ? innerIndent + l : innerIndent + l)).join('\n');

        lines.splice(insertIdx + 1, 0, indentedDoc);
      } else {
        // Insert before the function/class line
        const docLines = doc.documentation.split('\n');
        // Get indentation from the function line
        const funcLine = lines[insertIdx] ?? '';
        const indent = funcLine.match(/^(\s*)/)?.[1] ?? '';

        // Indent the JSDoc
        const indentedDoc = docLines.map((l) => indent + l).join('\n');

        lines.splice(insertIdx, 0, indentedDoc);
      }
    }

    return lines.join('\n');
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a code documenter.
 */
export function createDocumenter(adapter?: ModelAdapter): CodeDocumenter {
  return new CodeDocumenter(adapter);
}

// =============================================================================
// Quick API
// =============================================================================

/**
 * Document code based on language.
 */
export async function documentCode(
  code: string,
  language: 'python' | 'typescript' | 'javascript',
  adapter?: ModelAdapter,
  options: DocOptions = {}
): Promise<DocResult> {
  const documenter = createDocumenter(adapter);

  if (language === 'python') {
    return documenter.documentPython(code, options);
  } else {
    return documenter.documentTypeScript(code, options);
  }
}

/**
 * Extract elements from code (no documentation generation).
 */
export function extractElements(
  code: string,
  language: 'python' | 'typescript' | 'javascript'
): CodeElement[] {
  if (language === 'python') {
    return extractPythonElements(code);
  } else {
    return extractTypeScriptElements(code);
  }
}
