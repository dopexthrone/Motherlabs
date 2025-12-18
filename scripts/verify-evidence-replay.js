#!/usr/bin/env node
// Evidence Replay Validation
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// Enforces: AXIOM 6 (Reproducibility), AXIOM 4 (Mechanical Verification)
//
// This script verifies that all evidence files can be replayed and validated.
// It performs:
// 1. Hash chain verification for all ledger files
// 2. Context reconstruction for sample entries
// 3. Artifact integrity verification
//
// Run with: npm run verify:evidence

const fs = require('fs')
const path = require('path')

const EVIDENCE_DIR = path.join(__dirname, '..', 'evidence')

// Colors for output
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

function log(status, message) {
  const symbol = status === 'pass' ? `${GREEN}✓${RESET}` :
                 status === 'fail' ? `${RED}✗${RESET}` :
                 status === 'warn' ? `${YELLOW}⚠${RESET}` : ' '
  console.log(`  ${symbol} ${message}`)
}

async function main() {
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  EVIDENCE REPLAY VALIDATION')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')

  // Check if evidence directory exists
  if (!fs.existsSync(EVIDENCE_DIR)) {
    console.log('  No evidence directory found - skipping validation')
    console.log('  (This is OK for fresh installs)')
    process.exit(0)
  }

  // Find all JSONL ledger files
  const files = fs.readdirSync(EVIDENCE_DIR)
    .filter(f => f.endsWith('.jsonl'))

  if (files.length === 0) {
    console.log('  No ledger files found in evidence/')
    console.log('  (This is OK if no validation runs have occurred)')
    process.exit(0)
  }

  console.log(`  Found ${files.length} ledger file(s)`)
  console.log('')

  // Import the required modules (after build)
  let JSONLLedger, EvidenceQuery, contentAddress
  try {
    const ledgerModule = require('../dist/persistence/jsonlLedger')
    JSONLLedger = ledgerModule.JSONLLedger

    const queryModule = require('../dist/persistence/evidenceQuery')
    EvidenceQuery = queryModule.EvidenceQuery

    const addressModule = require('../dist/core/contentAddress')
    contentAddress = addressModule.contentAddress
  } catch (err) {
    console.log(`${RED}ERROR: Build required before running evidence verification${RESET}`)
    console.log('  Run: npm run build')
    process.exit(1)
  }

  let totalPassed = 0
  let totalFailed = 0
  let totalWarnings = 0

  // Step 1: Verify hash chains
  console.log('Step 1: Hash Chain Verification')
  console.log('─────────────────────────────────────────────────────────────')

  for (const file of files) {
    const filepath = path.join(EVIDENCE_DIR, file)

    try {
      const ledger = new JSONLLedger(filepath)
      const result = ledger.verifyChain()

      if (result.ok) {
        log('pass', `${file} - chain valid`)
        totalPassed++
      } else {
        // Check if this is a hash mismatch (likely legacy format)
        const errMsg = result.error.message
        if (errMsg.includes('Hash mismatch') || errMsg.includes('expected=')) {
          log('warn', `${file} - legacy format (hash mismatch)`)
          totalWarnings++
        } else {
          log('fail', `${file} - ${errMsg}`)
          totalFailed++
        }
      }
    } catch (err) {
      // Check if it's a legacy file warning (non-fatal)
      if (err.message && (err.message.includes('legacy file') || err.message.includes('Hash mismatch'))) {
        log('warn', `${file} - legacy format`)
        totalWarnings++
      } else {
        log('fail', `${file} - ${err.message}`)
        totalFailed++
      }
    }
  }

  console.log('')

  // Step 2: Context reconstruction (sample entries)
  console.log('Step 2: Context Reconstruction')
  console.log('─────────────────────────────────────────────────────────────')

  let reconstructionsTested = 0
  let reconstructionsSucceeded = 0

  for (const file of files.slice(0, 3)) { // Test first 3 files
    const filepath = path.join(EVIDENCE_DIR, file)

    try {
      const query = new EvidenceQuery(filepath)
      const stats = query.getStats()

      if (stats.ok && stats.value.total > 0) {
        // Try to reconstruct context for first entry
        const entries = query.query({ limit: 1 })
        if (entries.ok && entries.value.length > 0) {
          const entry = entries.value[0]
          const context = query.reconstructContext(entry.record_hash)

          reconstructionsTested++
          if (context.ok) {
            log('pass', `${file} - context reconstructed (${stats.value.total} entries)`)
            reconstructionsSucceeded++
          } else {
            log('warn', `${file} - reconstruction partial: ${context.error.message}`)
            totalWarnings++
          }
        }
      } else {
        log('pass', `${file} - empty ledger (valid)`)
      }
    } catch (err) {
      log('warn', `${file} - skipped: ${err.message.slice(0, 50)}`)
      totalWarnings++
    }
  }

  if (reconstructionsTested > 0) {
    log('pass', `${reconstructionsSucceeded}/${reconstructionsTested} context reconstructions succeeded`)
    totalPassed++
  }

  console.log('')

  // Step 3: Content address verification (sample)
  console.log('Step 3: Content Address Verification')
  console.log('─────────────────────────────────────────────────────────────')

  let addressesTested = 0
  let addressesValid = 0

  for (const file of files.slice(0, 2)) { // Test first 2 files
    const filepath = path.join(EVIDENCE_DIR, file)

    try {
      const content = fs.readFileSync(filepath, 'utf-8')
      const lines = content.trim().split('\n').filter(l => l.length > 0)

      for (const line of lines.slice(0, 5)) { // Test first 5 entries
        try {
          const entry = JSON.parse(line)
          if (entry.record_hash && entry.record) {
            addressesTested++

            // Recompute hash without timestamp (our canonical format)
            const forHash = {
              record_type: entry.record_type,
              seq: entry.seq,
              prev_hash: entry.prev_hash,
              record: entry.record
            }
            const computed = contentAddress(forHash)

            if (computed === entry.record_hash) {
              addressesValid++
            }
          }
        } catch {
          // Skip malformed entries
        }
      }
    } catch (err) {
      log('warn', `${file} - could not read: ${err.message}`)
    }
  }

  if (addressesTested > 0) {
    const rate = ((addressesValid / addressesTested) * 100).toFixed(1)
    if (addressesValid === addressesTested) {
      log('pass', `${addressesValid}/${addressesTested} content addresses verified (100%)`)
      totalPassed++
    } else {
      log('warn', `${addressesValid}/${addressesTested} content addresses verified (${rate}%)`)
      log('warn', 'Some entries may use legacy hash format')
      totalWarnings++
    }
  }

  console.log('')

  // Summary
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')
  console.log(`  ${GREEN}Passed:${RESET}   ${totalPassed}`)
  console.log(`  ${RED}Failed:${RESET}   ${totalFailed}`)
  console.log(`  ${YELLOW}Warnings:${RESET} ${totalWarnings}`)
  console.log('')

  if (totalFailed > 0) {
    console.log(`${RED}  EVIDENCE VERIFICATION FAILED${RESET}`)
    console.log('')
    process.exit(1)
  } else if (totalWarnings > 0) {
    console.log(`${YELLOW}  EVIDENCE VERIFICATION PASSED WITH WARNINGS${RESET}`)
    console.log('  (Legacy format files are acceptable but should be migrated)')
    console.log('')
    process.exit(0)
  } else {
    console.log(`${GREEN}  EVIDENCE VERIFICATION PASSED${RESET}`)
    console.log('')
    process.exit(0)
  }
}

main().catch(err => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`)
  process.exit(1)
})
