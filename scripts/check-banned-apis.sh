#!/usr/bin/env bash
#
# Banned API Check
# ================
#
# This script enforces the determinism contract by checking for banned APIs
# in the kernel source code. Any match causes CI failure.
#
# Banned APIs (in bundle hash domain):
# - Date.now() - Wall-clock time
# - new Date() - Wall-clock time
# - Math.random() - Non-deterministic
# - crypto.randomUUID() - Non-deterministic
# - os.hostname() - Host-dependent
# - process.uptime() - Host-dependent
# - readdirSync without .sort() - Order varies by OS
#
# Usage: ./scripts/check-banned-apis.sh
# Exit code: 0 if clean, 1 if violations found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$PROJECT_ROOT/src"

# Exclude test files, protocol/executor, harness/, and adapters/ (evidence domain, not bundle hash domain)
# The executor is untrusted and produces timestamps for audit - this is allowed per KERNEL_DETERMINISM.md
# The harness is non-authoritative orchestration layer - it may use Date.now(), new Date(), etc.
# because harness runtime data never affects bundle hashes (by design)
# Adapters are also part of the harness layer - they record timestamps for audit trails
EXCLUDE_PATTERN="tests/\|protocol/executor\|harness/\|adapters/"

echo "=== Banned API Check ==="
echo "Checking: $SRC_DIR"
echo ""

VIOLATIONS=0

# Function to check for a pattern
check_pattern() {
  local pattern="$1"
  local description="$2"
  local allow_pattern="${3:-}"

  echo "Checking: $description"

  # Find all TypeScript files, excluding tests
  local matches
  if [ -n "$allow_pattern" ]; then
    matches=$(grep -rn "$pattern" "$SRC_DIR" --include="*.ts" | grep -v "$EXCLUDE_PATTERN" | grep -v "$allow_pattern" || true)
  else
    matches=$(grep -rn "$pattern" "$SRC_DIR" --include="*.ts" | grep -v "$EXCLUDE_PATTERN" || true)
  fi

  if [ -n "$matches" ]; then
    echo "  VIOLATION FOUND:"
    echo "$matches" | while read -r line; do
      echo "    $line"
    done
    VIOLATIONS=$((VIOLATIONS + 1))
    return 1
  else
    echo "  OK"
    return 0
  fi
}

# Check each banned API
check_pattern "Math\.random" "Math.random()" || true
check_pattern "Date\.now" "Date.now()" || true
check_pattern "new Date\(\)" "new Date() without args" || true
check_pattern "randomUUID" "crypto.randomUUID()" || true
check_pattern "os\.hostname" "os.hostname()" || true
check_pattern "process\.uptime" "process.uptime()" || true

# Check for readdirSync without sort
echo "Checking: readdirSync without .sort()"
READDIR_MATCHES=$(grep -rn "readdirSync" "$SRC_DIR" --include="*.ts" | grep -v "$EXCLUDE_PATTERN" || true)
if [ -n "$READDIR_MATCHES" ]; then
  # For each match, check if .sort( appears on same or next line
  echo "$READDIR_MATCHES" | while read -r line; do
    FILE=$(echo "$line" | cut -d: -f1)
    LINENUM=$(echo "$line" | cut -d: -f2)

    # Get this line and next line
    CONTEXT=$(sed -n "${LINENUM}p;$((LINENUM + 1))p" "$FILE")

    if ! echo "$CONTEXT" | grep -q "\.sort("; then
      echo "  VIOLATION FOUND:"
      echo "    $line"
      echo "    (readdirSync result not sorted)"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
fi

# Check for JSON.stringify in bundle path (should use canonicalize)
echo "Checking: JSON.stringify in bundle path"
STRINGIFY_MATCHES=$(grep -rn "JSON\.stringify" "$SRC_DIR" --include="*.ts" | grep -v "$EXCLUDE_PATTERN" | grep -v "canonical\.ts" || true)
if [ -n "$STRINGIFY_MATCHES" ]; then
  echo "  WARNING (not blocking): JSON.stringify found outside canonical.ts"
  echo "$STRINGIFY_MATCHES" | while read -r line; do
    echo "    $line"
  done
  echo "  Consider using canonicalize() for deterministic output."
fi

echo ""
echo "=== Summary ==="

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "FAILED: $VIOLATIONS violation(s) found"
  echo ""
  echo "These APIs are banned in the kernel because they introduce non-determinism."
  echo "See KERNEL_DETERMINISM.md for alternatives."
  exit 1
else
  echo "PASSED: No violations found"
  exit 0
fi
