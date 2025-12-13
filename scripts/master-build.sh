#!/bin/bash
# Master Build Script - ALL gates enforced

set -e  # Fail on any error
set -u  # Fail on undefined variable
set -o pipefail  # Fail on pipe errors

echo "════════════════════════════════════════"
echo "MOTHERLABS GATED BUILD PIPELINE"
echo "════════════════════════════════════════"
echo ""

# ============================================================================
# GATE 1: Pre-Build Validation
# ============================================================================
echo "[1/5] Running Pre-Build Validation Gates..."
./scripts/pre-build.sh || {
  echo ""
  echo "✗ PRE-BUILD VALIDATION FAILED"
  echo "Fix violations before proceeding"
  exit 1
}

# ============================================================================
# GATE 2: TypeScript Compilation
# ============================================================================
echo "[2/5] TypeScript Compilation..."
echo "  → Type checking (tsc --noEmit)..."
npx tsc --noEmit || {
  echo "✗ TYPE CHECK FAILED"
  exit 1
}

echo "  → Compiling..."
npx tsc || {
  echo "✗ COMPILATION FAILED"
  exit 1
}
echo "✓ Compilation successful"
echo ""

# ============================================================================
# GATE 3: Test Suite
# ============================================================================
echo "[3/5] Running Test Suite..."
npm run test:urco > /tmp/test-urco.log 2>&1 || {
  echo "✗ URCO TESTS FAILED"
  cat /tmp/test-urco.log
  exit 1
}

npm run test:failures > /tmp/test-failures.log 2>&1 || {
  echo "✗ FAILURE MODE TESTS FAILED"
  cat /tmp/test-failures.log
  exit 1
}

npm run test:deterministic > /tmp/test-det.log 2>&1 || {
  echo "✗ DETERMINISTIC TESTS FAILED"
  cat /tmp/test-det.log
  exit 1
}

echo "✓ All test suites passed"
echo ""

# ============================================================================
# GATE 4: Evidence Generation
# ============================================================================
echo "[4/5] Generating Build Evidence..."
mkdir -p evidence

cat > evidence/build-$(date +%Y%m%d-%H%M%S).json << EVIDENCE
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "gates": {
    "prevalidation": "passed",
    "compilation": "passed",
    "tests": "passed"
  },
  "tests": {
    "urco": "$(grep 'Passed:' /tmp/test-urco.log | tail -1)",
    "failures": "$(grep 'Passed:' /tmp/test-failures.log | tail -1)",
    "deterministic": "$(grep 'Passed:' /tmp/test-det.log | tail -1)"
  },
  "commit": "$(git rev-parse HEAD)",
  "status": "all_gates_passed"
}
EVIDENCE

echo "✓ Evidence generated: evidence/build-*.json"
echo ""

# ============================================================================
# GATE 5: Final Verification
# ============================================================================
echo "[5/5] Final Verification..."

# Verify dist/ directory exists and has files
if [ ! -d "dist" ] || [ -z "$(ls -A dist)" ]; then
  echo "✗ dist/ directory empty or missing"
  exit 1
fi

# Verify CLI works
if [ ! -f "dist/cli.js" ]; then
  echo "✗ CLI not compiled"
  exit 1
fi

echo "✓ Final verification passed"
echo ""

# ============================================================================
# SUCCESS
# ============================================================================
echo "════════════════════════════════════════"
echo "✓ ALL GATES PASSED"
echo "════════════════════════════════════════"
echo ""
echo "Build Status:"
echo "  ✓ Pre-validation: PASSED"
echo "  ✓ Compilation: PASSED"
echo "  ✓ Tests: PASSED"
echo "  ✓ Evidence: GENERATED"
echo "  ✓ Verification: PASSED"
echo ""
echo "Safe to deploy."
echo ""
