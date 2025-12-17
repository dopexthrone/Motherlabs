#!/bin/bash
# Pre-build script - Runs determinism audit before TypeScript compilation
# CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
# Enforces: AXIOM 3 (Determinism), AXIOM 6 (Reproducibility)

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  PRE-BUILD CHECKS"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Change to project root
cd "$(dirname "$0")/.."

# Step 1: Determinism audit (using existing check-determinism.js)
echo "Step 1: Running determinism audit..."
node scripts/check-determinism.js

echo ""
echo "Step 2: Schema verification (advisory)..."
node scripts/verify-schemas.js || echo "  [WARNING] Schema verification found issues (non-blocking)"

echo ""
echo "Step 3: TypeScript type-check..."
npx tsc --noEmit

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  PRE-BUILD CHECKS PASSED"
echo "═══════════════════════════════════════════════════════════════"
