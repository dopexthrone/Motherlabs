// Error Formatter - Actionable error messages for gate failures
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 9 (Runtime UX - make refusals informative)
//
// This module transforms cryptic error messages into actionable suggestions
// that tell users exactly what to fix.

export type GateErrorContext = {
  gateName: string
  code?: string
  line?: number
  column?: number
  identifiers?: string[]
  threshold?: number
  actual?: number
}

export type FormattedError = {
  message: string
  suggestion: string
  documentation?: string
}

/**
 * Format a gate error into an actionable message
 */
export function formatGateError(
  gateName: string,
  error: string,
  context: Partial<GateErrorContext> = {}
): FormattedError {
  const formatter = ERROR_FORMATTERS[gateName]
  if (formatter) {
    return formatter(error, context)
  }

  // Default: just return the error with no suggestion
  return {
    message: error,
    suggestion: 'Review the error message and adjust your code accordingly.'
  }
}

/**
 * Format a complete error message with context
 */
export function formatFullError(formatted: FormattedError): string {
  const lines = [
    formatted.message,
    '',
    `FIX: ${formatted.suggestion}`
  ]

  if (formatted.documentation) {
    lines.push(`DOCS: ${formatted.documentation}`)
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════════════════════
// Gate-specific error formatters
// ═══════════════════════════════════════════════════════════════════════════

type ErrorFormatter = (error: string, context: Partial<GateErrorContext>) => FormattedError

const ERROR_FORMATTERS: Record<string, ErrorFormatter> = {
  schema_validation: formatSchemaError,
  syntax_validation: formatSyntaxError,
  variable_resolution: formatVariableError,
  test_execution: formatTestError,
  urco_entropy: formatEntropyError,
  governance_check: formatGovernanceError
}

function formatSchemaError(error: string, context: Partial<GateErrorContext>): FormattedError {
  if (error.includes('must export')) {
    return {
      message: 'Code must export at least one declaration (function, const, class, type, or interface)',
      suggestion: 'Add "export" keyword to at least one declaration. Example: export function myFunc() {}',
      documentation: 'https://github.com/dopexthrone/Motherlabs/docs/gates.md#schema-validation'
    }
  }

  if (error.includes('test patterns')) {
    return {
      message: 'Code appears to be test code but does not export declarations',
      suggestion: 'Ensure test files use describe/it/test patterns, or export functions for library code',
    }
  }

  return {
    message: error,
    suggestion: 'Ensure your code follows the expected schema structure.'
  }
}

function formatSyntaxError(error: string, context: Partial<GateErrorContext>): FormattedError {
  // Extract line number if present
  const lineMatch = error.match(/line (\d+)/i) || error.match(/:(\d+):/);
  const line = lineMatch ? parseInt(lineMatch[1]) : context.line

  if (error.includes('Parse error')) {
    return {
      message: `Syntax error${line ? ` at line ${line}` : ''}: ${error}`,
      suggestion: 'Check for missing brackets, parentheses, or semicolons near the indicated line.',
    }
  }

  if (error.includes('Cannot find name') || error.includes('is not defined')) {
    const nameMatch = error.match(/'(\w+)'/)
    const name = nameMatch ? nameMatch[1] : 'unknown'
    return {
      message: `TypeScript error: '${name}' is not defined`,
      suggestion: `Add an import for '${name}' or define it in your code. Example: import { ${name} } from './module'`,
    }
  }

  if (error.includes('Type') && error.includes('is not assignable')) {
    return {
      message: `Type error: ${error}`,
      suggestion: 'Check that your types match. You may need to add type annotations or cast values.',
    }
  }

  return {
    message: `Syntax/Type error: ${error}`,
    suggestion: 'Review the TypeScript error and fix the indicated issue.'
  }
}

function formatVariableError(error: string, context: Partial<GateErrorContext>): FormattedError {
  if (error.includes('Undefined:')) {
    const varsMatch = error.match(/Undefined: (.+)/)
    const vars = varsMatch ? varsMatch[1].split(', ') : context.identifiers || []

    if (vars.length > 0) {
      const firstVar = vars[0]

      // Check for common patterns
      if (firstVar.match(/^[A-Z][a-z]+/)) {
        // Looks like a class/type name
        return {
          message: `Undefined identifier(s): ${vars.join(', ')}`,
          suggestion: `Add imports for these types/classes. Example:\nimport { ${vars.slice(0, 3).join(', ')} } from './types'`,
        }
      }

      if (firstVar.match(/^[a-z]+$/)) {
        // Looks like a variable name
        return {
          message: `Undefined variable(s): ${vars.join(', ')}`,
          suggestion: `Declare these variables or add them as function parameters. Example:\nconst ${firstVar} = ...`,
        }
      }
    }

    return {
      message: `Undefined identifier(s): ${vars.join(', ')}`,
      suggestion: 'Add imports or declarations for all undefined identifiers.'
    }
  }

  return {
    message: error,
    suggestion: 'Check that all variables are properly imported or declared.'
  }
}

function formatTestError(error: string, context: Partial<GateErrorContext>): FormattedError {
  if (error.includes('timeout') || error.includes('Timeout')) {
    return {
      message: 'Test execution timed out',
      suggestion: 'Your code takes too long to execute. Reduce loops, avoid infinite recursion, or optimize algorithms.',
    }
  }

  if (error.includes('Runner error')) {
    return {
      message: `Test runner error: ${error.replace('Runner error: ', '')}`,
      suggestion: 'There was an error running your code. Check for syntax errors or missing dependencies.',
    }
  }

  if (error.includes('Bundle failed') || error.includes('Import resolution')) {
    const moduleMatch = error.match(/Cannot find module '([^']+)'/)
    if (moduleMatch) {
      return {
        message: `Missing dependency: ${moduleMatch[1]}`,
        suggestion: `Install the missing module or use a different import path. Run: npm install ${moduleMatch[1]}`,
      }
    }
    return {
      message: 'Failed to bundle code with imports',
      suggestion: 'Check that all import paths are correct and modules are installed.',
    }
  }

  if (error.includes('test') && error.includes('fail')) {
    return {
      message: 'Tests failed during execution',
      suggestion: 'Review the test output and fix failing assertions.',
    }
  }

  return {
    message: `Test execution error: ${error}`,
    suggestion: 'Check the error output and ensure your code runs correctly.'
  }
}

function formatEntropyError(error: string, context: Partial<GateErrorContext>): FormattedError {
  if (error.includes('Entropy') || error.includes('entropy')) {
    const threshold = context.threshold || 0.7
    const actual = context.actual

    return {
      message: `Code entropy too high${actual ? ` (${actual.toFixed(2)} > ${threshold})` : ''}`,
      suggestion: `Reduce ambiguity in your code by:\n  1. Using specific, descriptive variable names\n  2. Adding type annotations\n  3. Breaking complex expressions into named steps\n  4. Removing dead or commented-out code`,
    }
  }

  return {
    message: error,
    suggestion: 'Make your code clearer and more specific.'
  }
}

function formatGovernanceError(error: string, context: Partial<GateErrorContext>): FormattedError {
  if (error.includes('eval') || error.includes('Function(')) {
    const lineMatch = error.match(/line (\d+)/i)
    const line = lineMatch ? ` at line ${lineMatch[1]}` : ''
    return {
      message: `Security violation: eval() or Function() detected${line}`,
      suggestion: 'Never use eval() or Function() with dynamic input. Use a parser or predefined functions instead.',
      documentation: 'https://github.com/dopexthrone/Motherlabs/docs/security.md'
    }
  }

  if (error.includes('exec') || error.includes('spawn')) {
    return {
      message: 'Security violation: shell command execution with untrusted input',
      suggestion: 'Use parameterized commands or execFile() with fixed arguments. Never concatenate user input.',
    }
  }

  if (error.includes('innerHTML') || error.includes('outerHTML')) {
    return {
      message: 'Security violation: innerHTML with potentially untrusted content',
      suggestion: 'Use textContent for text or sanitize HTML with a trusted library like DOMPurify.',
    }
  }

  if (error.includes('JSON.parse')) {
    return {
      message: 'Security warning: JSON.parse on untrusted input',
      suggestion: 'Wrap JSON.parse in try/catch and validate the parsed structure before use.',
    }
  }

  if (error.includes('SQL') || error.includes('query')) {
    return {
      message: 'Security violation: potential SQL injection',
      suggestion: 'Use parameterized queries or prepared statements. Never concatenate user input into SQL.',
    }
  }

  return {
    message: `Governance check failed: ${error}`,
    suggestion: 'Review the security guidelines and ensure your code follows safe patterns.'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract line number from various error formats
 */
export function extractLineNumber(error: string): number | undefined {
  const patterns = [
    /line (\d+)/i,
    /:(\d+):/,
    /\((\d+),\d+\)/,
    /at line (\d+)/i
  ]

  for (const pattern of patterns) {
    const match = error.match(pattern)
    if (match) {
      return parseInt(match[1])
    }
  }

  return undefined
}

/**
 * Extract variable names from an error message
 */
export function extractIdentifiers(error: string): string[] {
  const matches = error.match(/'([^']+)'/g)
  if (matches) {
    return matches.map(m => m.replace(/'/g, ''))
  }
  return []
}
