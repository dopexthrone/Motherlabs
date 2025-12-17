// esbuild Bundler for Gate 4
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: Gate 4 (Test Execution) - Resolves imports before sandbox execution
// TCB Component: Part of the 6-Gate Validation System
//
// Uses esbuild to bundle code with local imports into a single executable file.
// This allows Gate 4 to execute code that imports from the project.

import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'
import { Result, Ok, Err } from '../core/result'

export type BundleResult = {
  bundled: string
  sourceMap: string
  warnings: string[]
}

export type BundleOptions = {
  /** Directory containing the target file (for import resolution) */
  targetDir?: string
  /** External modules to exclude from bundling */
  external?: string[]
  /** Whether to minify the output */
  minify?: boolean
  /** Target Node.js version */
  nodeVersion?: string
}

const DEFAULT_OPTIONS: BundleOptions = {
  external: ['node:*'],  // Keep Node.js builtins external
  minify: false,
  nodeVersion: '18'
}

/**
 * Bundle TypeScript code with local imports using esbuild
 *
 * Writes code to temp file, bundles with esbuild, returns bundled output.
 * This resolves ./  ../ imports and produces executable JavaScript.
 */
export async function bundleForExecution(
  code: string,
  options: BundleOptions = {}
): Promise<Result<BundleResult, Error>> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const tempDir = path.join(process.cwd(), '.gate-temp')
  const timestamp = Date.now()  // DETERMINISM-EXEMPT:TIME - Temp file uniqueness
  const tempInput = path.join(tempDir, `input-${timestamp}.ts`)
  const tempOutput = path.join(tempDir, `output-${timestamp}.js`)

  try {
    // Ensure temp directory exists
    fs.mkdirSync(tempDir, { recursive: true })

    // Write code to temp file
    fs.writeFileSync(tempInput, code)

    // Determine working directory for import resolution
    const absWorkingDir = opts.targetDir
      ? path.resolve(opts.targetDir)
      : process.cwd()

    // Build external list
    const external = [
      ...(opts.external || []),
      // Always exclude node builtins
      'fs', 'path', 'crypto', 'os', 'child_process', 'http', 'https', 'net',
      'stream', 'url', 'util', 'events', 'buffer', 'querystring', 'assert'
    ]

    // Run esbuild
    const result = await esbuild.build({
      entryPoints: [tempInput],
      bundle: true,
      outfile: tempOutput,
      platform: 'node',
      target: `node${opts.nodeVersion}`,
      sourcemap: true,
      format: 'cjs',
      absWorkingDir,
      external,
      logLevel: 'silent',  // We handle errors ourselves
      minify: opts.minify,
      // Don't fail on warnings
      write: true
    })

    // Collect warnings
    const warnings = result.warnings.map(w =>
      `${w.location?.file}:${w.location?.line}: ${w.text}`
    )

    // Read bundled output
    if (!fs.existsSync(tempOutput)) {
      return Err(new Error('Bundle output not created'))
    }

    const bundled = fs.readFileSync(tempOutput, 'utf-8')
    const sourceMap = fs.existsSync(tempOutput + '.map')
      ? fs.readFileSync(tempOutput + '.map', 'utf-8')
      : ''

    return Ok({
      bundled,
      sourceMap,
      warnings
    })

  } catch (error) {
    if (error && typeof error === 'object' && 'errors' in error) {
      // esbuild error with structured info
      const buildError = error as esbuild.BuildFailure
      const messages = buildError.errors.map(e =>
        `${e.location?.file}:${e.location?.line}: ${e.text}`
      )
      return Err(new Error(`Bundle failed: ${messages.join('; ')}`))
    }

    return Err(
      error instanceof Error
        ? new Error(`Bundle failed: ${error.message}`)
        : new Error('Bundle failed: Unknown error')
    )

  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput)
      if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput)
      if (fs.existsSync(tempOutput + '.map')) fs.unlinkSync(tempOutput + '.map')
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if code has local imports that need bundling
 */
export function hasLocalImports(code: string): boolean {
  // Match: import ... from './...' or import ... from '../...'
  return /import\s+.*from\s+['"]\.\.?\//.test(code) ||
         // Also match: require('./...') or require('../...')
         /require\s*\(\s*['"]\.\.?\//.test(code)
}

/**
 * Bundle code only if it has local imports
 *
 * Returns the original code if no bundling needed,
 * or the bundled code if imports were resolved.
 */
export async function bundleIfNeeded(
  code: string,
  targetFile?: string
): Promise<Result<{ code: string; wasBundled: boolean }, Error>> {
  if (!hasLocalImports(code)) {
    return Ok({ code, wasBundled: false })
  }

  const targetDir = targetFile ? path.dirname(targetFile) : undefined

  const bundleResult = await bundleForExecution(code, { targetDir })

  if (!bundleResult.ok) {
    return Err(bundleResult.error)
  }

  return Ok({
    code: bundleResult.value.bundled,
    wasBundled: true
  })
}
