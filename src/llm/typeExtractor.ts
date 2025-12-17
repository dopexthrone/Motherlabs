// Type Extractor - Extract type definitions from imports for LLM context
// Helps LLM understand available types in the codebase

import * as fs from 'fs'
import * as path from 'path'

// Internal types - not exported to avoid ungoverned type exposure
// These are utility types used only within this module
type ExtractedType = {
  name: string
  definition: string
  source: string
}

type ExtractedFunction = {
  name: string
  signature: string
  source: string
}

type ExtractedClass = {
  name: string
  definition: string
  source: string
}

/**
 * Extract imports from TypeScript code
 */
export function extractImports(code: string): Array<{ names: string[], source: string }> {
  const imports: Array<{ names: string[], source: string }> = []

  // Match: import { X, Y } from './path'
  const namedImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  let match

  while ((match = namedImportRegex.exec(code)) !== null) {
    const names = match[1].split(',').map(s => s.trim().split(' as ')[0].trim())
    imports.push({ names, source: match[2] })
  }

  // Match: import type { X, Y } from './path'
  const typeImportRegex = /import\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g

  while ((match = typeImportRegex.exec(code)) !== null) {
    const names = match[1].split(',').map(s => s.trim().split(' as ')[0].trim())
    imports.push({ names, source: match[2] })
  }

  // Match: import X from './path'
  const defaultImportRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g

  while ((match = defaultImportRegex.exec(code)) !== null) {
    imports.push({ names: [match[1]], source: match[2] })
  }

  return imports
}

/**
 * Resolve import path to actual file path
 */
export function resolveImportPath(importSource: string, fromFile: string, basePath: string = 'src'): string | null {
  // Skip node_modules imports
  if (!importSource.startsWith('.') && !importSource.startsWith('/')) {
    return null
  }

  const fromDir = path.dirname(fromFile)
  let resolved = path.resolve(fromDir, importSource)

  // Try with .ts extension
  if (fs.existsSync(resolved + '.ts')) {
    return resolved + '.ts'
  }

  // Try index.ts
  if (fs.existsSync(path.join(resolved, 'index.ts'))) {
    return path.join(resolved, 'index.ts')
  }

  return null
}

/**
 * Extract type definition from source file
 */
export function extractTypeDefinition(typeName: string, sourceCode: string): string | null {
  // Match: export type X = { ... }
  const typeRegex = new RegExp(
    `export\\s+type\\s+${typeName}\\s*=\\s*\\{[^}]*\\}|` +
    `export\\s+type\\s+${typeName}\\s*=\\s*[^;]+;`,
    's'
  )
  const typeMatch = sourceCode.match(typeRegex)
  if (typeMatch) {
    return typeMatch[0]
  }

  // Match: export interface X { ... }
  const interfaceRegex = new RegExp(
    `export\\s+interface\\s+${typeName}\\s*\\{[^}]*\\}`,
    's'
  )
  const interfaceMatch = sourceCode.match(interfaceRegex)
  if (interfaceMatch) {
    return interfaceMatch[0]
  }

  // Match: type X = ... (non-exported, for internal types)
  const internalTypeRegex = new RegExp(
    `type\\s+${typeName}\\s*=\\s*[^;]+;|` +
    `type\\s+${typeName}\\s*=\\s*\\{[^}]*\\}`,
    's'
  )
  const internalMatch = sourceCode.match(internalTypeRegex)
  if (internalMatch) {
    return internalMatch[0]
  }

  return null
}

/**
 * Extract all type definitions from a file
 */
export function extractAllTypesFromFile(filepath: string): ExtractedType[] {
  if (!fs.existsSync(filepath)) {
    return []
  }

  const code = fs.readFileSync(filepath, 'utf-8')
  const types: ExtractedType[] = []
  const seenTypes = new Set<string>()

  // Match union types that span multiple lines (like Result<T,E>)
  // Pattern: export type Name<...> = \n  | { ... } \n  | { ... }
  const unionTypeRegex = /export\s+type\s+(\w+)(?:<[^>]+>)?\s*=\s*\n\s*\|[^;]+/gs
  let match

  while ((match = unionTypeRegex.exec(code)) !== null) {
    const name = match[1]
    if (!seenTypes.has(name)) {
      types.push({
        name,
        definition: match[0].trim(),
        source: filepath
      })
      seenTypes.add(name)
    }
  }

  // Match simple exported types (single line or block)
  const typeRegex = /export\s+type\s+(\w+)(?:<[^>]+>)?\s*=\s*(?:\{[^}]*\}|'[^']*'(?:\s*\|\s*'[^']*')*|[^;\n]+);?/gs

  while ((match = typeRegex.exec(code)) !== null) {
    const name = match[1]
    if (!seenTypes.has(name)) {
      types.push({
        name,
        definition: match[0].trim(),
        source: filepath
      })
      seenTypes.add(name)
    }
  }

  // Match all exported interfaces
  const interfaceRegex = /export\s+interface\s+(\w+)\s*\{[^}]*\}/gs

  while ((match = interfaceRegex.exec(code)) !== null) {
    const name = match[1]
    if (!seenTypes.has(name)) {
      types.push({
        name,
        definition: match[0].trim(),
        source: filepath
      })
      seenTypes.add(name)
    }
  }

  return types
}

/**
 * Extract all exported function signatures from a file
 */
export function extractAllFunctionsFromFile(filepath: string): ExtractedFunction[] {
  if (!fs.existsSync(filepath)) {
    return []
  }

  const code = fs.readFileSync(filepath, 'utf-8')
  const functions: ExtractedFunction[] = []
  const seenFunctions = new Set<string>()

  // Match: export function name(...): ReturnType
  // Captures up to the opening brace or first newline after return type
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*(<[^>]+>)?\s*\([^)]*\)(?:\s*:\s*[^{]+)?/g
  let match

  while ((match = funcRegex.exec(code)) !== null) {
    const name = match[1]
    if (!seenFunctions.has(name)) {
      functions.push({
        name,
        signature: match[0].trim(),
        source: filepath
      })
      seenFunctions.add(name)
    }
  }

  // Match: export const name = (...): ReturnType =>
  // For arrow functions
  const arrowRegex = /export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)(?:\s*:\s*[^=]+)?\s*=>/g

  while ((match = arrowRegex.exec(code)) !== null) {
    const name = match[1]
    if (!seenFunctions.has(name)) {
      functions.push({
        name,
        signature: match[0].replace(/\s*=>$/, '').trim(),
        source: filepath
      })
      seenFunctions.add(name)
    }
  }

  return functions
}

/**
 * Extract function definition for a specific function name
 */
export function extractFunctionSignature(funcName: string, sourceCode: string): string | null {
  // Match export function
  const funcRegex = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${funcName}\\s*(<[^>]+>)?\\s*\\([^)]*\\)(?:\\s*:\\s*[^{]+)?`,
    's'
  )
  const funcMatch = sourceCode.match(funcRegex)
  if (funcMatch) {
    return funcMatch[0].trim()
  }

  // Match export const arrow
  const arrowRegex = new RegExp(
    `export\\s+const\\s+${funcName}\\s*=\\s*(?:async\\s+)?\\([^)]*\\)(?:\\s*:\\s*[^=]+)?\\s*=>`,
    's'
  )
  const arrowMatch = sourceCode.match(arrowRegex)
  if (arrowMatch) {
    return arrowMatch[0].replace(/\s*=>$/, '').trim()
  }

  return null
}

/**
 * Get relevant type definitions for a file
 * Extracts types from all imports in the file
 */
export function getRelevantTypes(filepath: string, maxTypes: number = 10): ExtractedType[] {
  if (!fs.existsSync(filepath)) {
    return []
  }

  const code = fs.readFileSync(filepath, 'utf-8')
  const imports = extractImports(code)
  const types: ExtractedType[] = []
  const seenTypes = new Set<string>()

  for (const imp of imports) {
    const resolvedPath = resolveImportPath(imp.source, filepath)
    if (!resolvedPath) continue

    try {
      const sourceCode = fs.readFileSync(resolvedPath, 'utf-8')

      for (const typeName of imp.names) {
        if (seenTypes.has(typeName)) continue

        const definition = extractTypeDefinition(typeName, sourceCode)
        if (definition) {
          types.push({
            name: typeName,
            definition,
            source: imp.source
          })
          seenTypes.add(typeName)
        }
      }
    } catch {
      // File not readable, skip
    }

    if (types.length >= maxTypes) break
  }

  return types
}

/**
 * Format type definitions for inclusion in prompt
 */
export function formatTypesForPrompt(types: ExtractedType[]): string {
  if (types.length === 0) {
    return ''
  }

  const lines = ['AVAILABLE TYPE DEFINITIONS:', '']

  for (const t of types) {
    lines.push(`// From ${t.source}`)
    lines.push(t.definition)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Get core project types that are commonly used
 */
export function getCoreProjectTypes(basePath: string = 'src'): ExtractedType[] {
  const coreFiles = [
    'types.ts',
    'core/result.ts',
    'core/ids.ts'
  ]

  const types: ExtractedType[] = []

  for (const file of coreFiles) {
    const fullPath = path.join(basePath, file)
    const fileTypes = extractAllTypesFromFile(fullPath)
    types.push(...fileTypes)
  }

  return types
}

/**
 * Get relevant function signatures for a file
 * Extracts function signatures from all imports in the file
 */
export function getRelevantFunctions(filepath: string, maxFuncs: number = 10): ExtractedFunction[] {
  if (!fs.existsSync(filepath)) {
    return []
  }

  const code = fs.readFileSync(filepath, 'utf-8')
  const imports = extractImports(code)
  const functions: ExtractedFunction[] = []
  const seenFunctions = new Set<string>()

  for (const imp of imports) {
    const resolvedPath = resolveImportPath(imp.source, filepath)
    if (!resolvedPath) continue

    try {
      const sourceCode = fs.readFileSync(resolvedPath, 'utf-8')

      for (const funcName of imp.names) {
        if (seenFunctions.has(funcName)) continue

        const signature = extractFunctionSignature(funcName, sourceCode)
        if (signature) {
          functions.push({
            name: funcName,
            signature,
            source: imp.source
          })
          seenFunctions.add(funcName)
        }
      }
    } catch {
      // File not readable, skip
    }

    if (functions.length >= maxFuncs) break
  }

  return functions
}

/**
 * Format function signatures for inclusion in prompt
 */
export function formatFunctionsForPrompt(functions: ExtractedFunction[]): string {
  if (functions.length === 0) {
    return ''
  }

  const lines = ['AVAILABLE FUNCTION SIGNATURES:', '']

  for (const f of functions) {
    lines.push(`// From ${f.source}`)
    lines.push(f.signature)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Extract class definition with public methods
 */
export function extractClassDefinition(className: string, sourceCode: string): string | null {
  // Find class definition
  const classStartRegex = new RegExp(`export\\s+class\\s+${className}\\s*(?:extends\\s+\\w+)?\\s*\\{`, 's')
  const classMatch = sourceCode.match(classStartRegex)
  if (!classMatch) return null

  const classStart = sourceCode.indexOf(classMatch[0])
  if (classStart === -1) return null

  // Find the end of the class by counting braces
  let braceCount = 1
  let i = classStart + classMatch[0].length
  while (i < sourceCode.length && braceCount > 0) {
    if (sourceCode[i] === '{') braceCount++
    else if (sourceCode[i] === '}') braceCount--
    i++
  }

  const classBody = sourceCode.slice(classStart, i)

  // Extract method signatures (public, async, static methods)
  // Must start at beginning of line (after whitespace) and have valid method name
  const methods: string[] = []
  const methodRegex = /^\s+((?:async\s+)?(?:public\s+)?(?:static\s+)?(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)(?:\s*:\s*[^{]+)?)\s*\{/gm
  let methodMatch

  while ((methodMatch = methodRegex.exec(classBody)) !== null) {
    const methodSig = methodMatch[1].trim()
    const methodName = methodMatch[2]
    // Skip constructor, private methods, and JavaScript keywords
    const keywords = ['if', 'for', 'while', 'switch', 'catch', 'try', 'else', 'return', 'throw']
    if (methodName !== 'constructor' && !methodName.startsWith('_') && !keywords.includes(methodName)) {
      methods.push(methodSig)
    }
  }

  // Build a simplified class definition showing method signatures
  const simplified = `export class ${className} {\n  ${methods.join('\n  ')}\n}`
  return simplified
}

/**
 * Get class definitions for imported classes
 */
export function getRelevantClasses(filepath: string, maxClasses: number = 5): ExtractedClass[] {
  if (!fs.existsSync(filepath)) {
    return []
  }

  const code = fs.readFileSync(filepath, 'utf-8')
  const imports = extractImports(code)
  const classes: ExtractedClass[] = []
  const seenClasses = new Set<string>()

  for (const imp of imports) {
    const resolvedPath = resolveImportPath(imp.source, filepath)
    if (!resolvedPath) continue

    try {
      const sourceCode = fs.readFileSync(resolvedPath, 'utf-8')

      for (const className of imp.names) {
        if (seenClasses.has(className)) continue

        const definition = extractClassDefinition(className, sourceCode)
        if (definition) {
          classes.push({
            name: className,
            definition,
            source: imp.source
          })
          seenClasses.add(className)
        }
      }
    } catch {
      // File not readable, skip
    }

    if (classes.length >= maxClasses) break
  }

  return classes
}

/**
 * Format class definitions for inclusion in prompt
 */
export function formatClassesForPrompt(classes: ExtractedClass[]): string {
  if (classes.length === 0) {
    return ''
  }

  const lines = ['AVAILABLE CLASS DEFINITIONS:', '']

  for (const c of classes) {
    lines.push(`// From ${c.source}`)
    lines.push(c.definition)
    lines.push('')
  }

  return lines.join('\n')
}
