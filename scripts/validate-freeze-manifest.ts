#!/usr/bin/env npx tsx
/**
 * Freeze Manifest Validator
 *
 * Validates that all file paths referenced in the freeze manifest
 * actually exist in the repository at the current tag.
 *
 * Deterministic: No timestamps, no network, no randomness.
 * Output: PASS with count, or FAIL with missing paths list.
 */

import * as fs from 'fs'
import * as path from 'path'

const MANIFEST_PATH = 'docs/FREEZE_MANIFEST.governance-v0.1.json'

interface ManifestComponent {
  path: string
  sha256: string
  invariants?: string[]
}

interface Manifest {
  version: string
  freeze_type: string
  governance_components?: Record<string, ManifestComponent>
  tcb_authority_files?: Record<string, string>
  tcb_governed_files?: Record<string, string>
  constitutional_files?: Record<string, string>
  acceptance_test_files?: Record<string, string>
  [key: string]: unknown
}

function extractPaths(manifest: Manifest): string[] {
  const paths: Set<string> = new Set()

  // Extract from governance_components (has nested .path)
  if (manifest.governance_components) {
    for (const component of Object.values(manifest.governance_components)) {
      if (component.path) {
        paths.add(component.path)
      }
    }
  }

  // Extract from file maps (keys are paths)
  const fileMaps = [
    'tcb_authority_files',
    'tcb_governed_files',
    'constitutional_files',
    'acceptance_test_files'
  ] as const

  for (const mapName of fileMaps) {
    const fileMap = manifest[mapName]
    if (fileMap && typeof fileMap === 'object') {
      for (const filePath of Object.keys(fileMap as Record<string, string>)) {
        paths.add(filePath)
      }
    }
  }

  // Return sorted for deterministic output
  return Array.from(paths).sort()
}

function validatePaths(paths: string[]): { valid: string[]; missing: string[] } {
  const valid: string[] = []
  const missing: string[] = []

  for (const filePath of paths) {
    const fullPath = path.resolve(process.cwd(), filePath)
    if (fs.existsSync(fullPath)) {
      valid.push(filePath)
    } else {
      missing.push(filePath)
    }
  }

  return { valid, missing }
}

function main(): void {
  // Check manifest exists
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`ERROR: Manifest not found: ${MANIFEST_PATH}`)
    process.exit(1)
  }

  // Read and parse manifest
  const manifestContent = fs.readFileSync(MANIFEST_PATH, 'utf-8')
  const manifest: Manifest = JSON.parse(manifestContent)

  // Extract all paths
  const paths = extractPaths(manifest)
  console.log(`Paths extracted from manifest: ${paths.length}`)
  console.log('')

  // Validate each path
  const { valid, missing } = validatePaths(paths)

  // Output results
  console.log('Checked paths:')
  for (const p of paths) {
    const exists = valid.includes(p)
    console.log(`  ${exists ? '[OK]' : '[MISSING]'} ${p}`)
  }
  console.log('')

  if (missing.length === 0) {
    console.log(`MANIFEST VALIDATION: PASS`)
    console.log(`Total paths checked: ${paths.length}`)
    process.exit(0)
  } else {
    console.log(`MANIFEST VALIDATION: FAIL`)
    console.log(`Missing paths (${missing.length}):`)
    for (const p of missing) {
      console.log(`  - ${p}`)
    }
    process.exit(1)
  }
}

main()
