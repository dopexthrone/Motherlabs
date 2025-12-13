#!/bin/bash
# Pre-Build Validation - ALL checks must pass

set -e  # Exit on any error
set -u  # Exit on undefined variable

echo "=== Pre-Build Validation Gates ==="
echo ""

# Gate 1: No TODO/FIXME in src/
echo "[Gate 1] Checking for TODO/FIXME in source..."
if grep -rn "TODO\|FIXME\|XXX\|HACK" src/ --include="*.ts" | grep -v "node_modules" | grep -v "SAFETY:"; then
  echo "✗ GATE FAILED: TODO/FIXME found in source code"
  echo "RULE: No placeholders in production paths"
  exit 1
fi
echo "✓ Gate 1 passed"
echo ""

# Gate 2: All types have schemas
echo "[Gate 2] Verifying schema coverage..."
node scripts/verify-schemas.js || {
  echo "✗ GATE FAILED: Schema coverage incomplete"
  exit 1
}
echo ""

# Gate 3: No non-deterministic code
echo "[Gate 3] Checking determinism..."
node scripts/check-determinism.js || {
  echo "✗ GATE FAILED: Non-deterministic code detected"
  exit 1
}
echo ""

# Gate 4: No mock bias
echo "[Gate 4] Checking for mock bias..."
if [ -d "tests" ]; then
  node scripts/detect-mocks.js || {
    echo "✗ GATE FAILED: Mock/stub patterns detected"
    exit 1
  }
fi
echo ""

# Gate 5: TypeScript strict mode check
echo "[Gate 5] Verifying TypeScript strict mode..."
if ! grep -q '"strict": true' tsconfig.json; then
  echo "✗ GATE FAILED: TypeScript strict mode not enabled"
  exit 1
fi
echo "✓ Gate 5 passed"
echo ""

echo "═══════════════════════════════════════"
echo "✓ ALL PRE-BUILD GATES PASSED"
echo "✓ Safe to proceed with build"
echo "═══════════════════════════════════════"
