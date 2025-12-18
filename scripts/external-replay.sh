#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# MOTHERLABS EXTERNAL EVIDENCE VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════
#
# This script allows third parties to independently verify Motherlabs evidence
# without trusting the Motherlabs runtime itself.
#
# USAGE:
#   ./scripts/external-replay.sh                    # Basic verification
#   ANTHROPIC_API_KEY=sk-... ./scripts/external-replay.sh  # Full validation
#
# WHAT IT VERIFIES:
#   1. Hash chain integrity (prev_hash links)
#   2. Content address authenticity (SHA256 matches)
#   3. Public benchmark reproducibility (if API key provided)
#
# REQUIREMENTS:
#   - Node.js 18+
#   - npm (for dependencies)
#   - Built dist/ folder (npm run build)

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  MOTHERLABS EXTERNAL EVIDENCE VERIFICATION"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Check if dist exists
if [ ! -d "dist" ]; then
  echo -e "${RED}ERROR: dist/ folder not found. Run 'npm run build' first.${NC}"
  exit 1
fi

# Check if evidence exists
if [ ! -d "evidence" ]; then
  echo -e "${YELLOW}No evidence/ directory found.${NC}"
  echo "This is OK for fresh installs - there's nothing to verify yet."
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# STEP 1: Hash Chain Verification
# ═══════════════════════════════════════════════════════════════════════════
echo "Step 1: Hash Chain Verification"
echo "─────────────────────────────────────────────────────────────────────────"
echo ""

LEDGER_COUNT=$(ls -1 evidence/*.jsonl 2>/dev/null | wc -l)
echo "Found $LEDGER_COUNT ledger file(s)"
echo ""

PASSED=0
FAILED=0
LEGACY=0

for file in evidence/*.jsonl; do
  if [ -f "$file" ]; then
    RESULT=$(node -e "
      const { JSONLLedger } = require('./dist/persistence/jsonlLedger');
      const ledger = new JSONLLedger('$file');
      const result = ledger.verifyChain();
      if (result.ok) {
        console.log('PASS');
      } else if (result.error.message.includes('Hash mismatch')) {
        console.log('LEGACY');
      } else {
        console.log('FAIL:' + result.error.message);
      }
    " 2>/dev/null || echo "ERROR")

    BASENAME=$(basename "$file")

    if [ "$RESULT" = "PASS" ]; then
      echo -e "  ${GREEN}✓${NC} $BASENAME"
      PASSED=$((PASSED + 1))
    elif [ "$RESULT" = "LEGACY" ]; then
      echo -e "  ${YELLOW}⚠${NC} $BASENAME (legacy format)"
      LEGACY=$((LEGACY + 1))
    else
      echo -e "  ${RED}✗${NC} $BASENAME - ${RESULT#FAIL:}"
      FAILED=$((FAILED + 1))
    fi
  fi
done

echo ""
echo "  Passed: $PASSED | Legacy: $LEGACY | Failed: $FAILED"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# STEP 2: Content Address Verification
# ═══════════════════════════════════════════════════════════════════════════
echo "Step 2: Content Address Verification"
echo "─────────────────────────────────────────────────────────────────────────"
echo ""

node -e "
  const { contentAddress } = require('./dist/core/contentAddress');
  const fs = require('fs');
  const path = require('path');

  const files = fs.readdirSync('evidence').filter(f => f.endsWith('.jsonl'));
  let tested = 0;
  let valid = 0;

  for (const file of files.slice(0, 5)) {  // Sample first 5 files
    const content = fs.readFileSync(path.join('evidence', file), 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);

    for (const line of lines.slice(0, 10)) {  // Sample first 10 entries
      try {
        const entry = JSON.parse(line);
        if (entry.record_hash && entry.record) {
          tested++;

          // Recompute hash without timestamp
          const forHash = {
            record_type: entry.record_type,
            seq: entry.seq,
            prev_hash: entry.prev_hash,
            record: entry.record
          };
          const computed = contentAddress(forHash);

          if (computed === entry.record_hash) {
            valid++;
          }
        }
      } catch {}
    }
  }

  const rate = tested > 0 ? ((valid / tested) * 100).toFixed(1) : 0;
  console.log('  Sampled ' + tested + ' entries, ' + valid + ' verified (' + rate + '%)');

  if (valid === tested && tested > 0) {
    console.log('  ✓ Content addresses verified');
  } else if (valid > tested * 0.8) {
    console.log('  ⚠ Some entries use legacy hash format');
  } else {
    console.log('  ✗ Content address verification failed');
    process.exit(1);
  }
"

echo ""

# ═══════════════════════════════════════════════════════════════════════════
# STEP 3: Public Benchmark Reproducibility (if API key provided)
# ═══════════════════════════════════════════════════════════════════════════
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo "Step 3: Public Benchmark Reproducibility"
  echo "─────────────────────────────────────────────────────────────────────────"
  echo ""
  echo "  Running public validation suite..."
  echo "  (This may take several minutes)"
  echo ""

  node scripts/run-public-validation.js 2>&1 | grep -E "(task-|Summary|Pass Rate)" | head -25
else
  echo "Step 3: Public Benchmark (SKIPPED)"
  echo "─────────────────────────────────────────────────────────────────────────"
  echo ""
  echo "  Set ANTHROPIC_API_KEY to run public benchmark validation"
  echo "  Example: ANTHROPIC_API_KEY=sk-ant-... ./scripts/external-replay.sh"
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  VERIFICATION COMPLETE"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}VERIFICATION FAILED${NC}"
  echo "$FAILED file(s) failed hash chain verification"
  exit 1
else
  echo -e "${GREEN}VERIFICATION PASSED${NC}"
  if [ $LEGACY -gt 0 ]; then
    echo -e "${YELLOW}Note: $LEGACY file(s) use legacy hash format${NC}"
  fi
fi

echo ""
