// Gate Visualization Types for Motherlabs Website
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// This module provides ASCII visualization for 6-gate validation results

export type GateStatus = 'passed' | 'failed' | 'pending';

export type GateResult = {
  gateName: string;
  status: GateStatus;
  duration?: number;
  error?: string;
};

export type ValidationSummary = {
  gates: GateResult[];
  allPassed: boolean;
  totalDuration: number;
};

// Box drawing characters for ASCII visualization
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│'
} as const;

// Status icons
const ICONS: Record<GateStatus, string> = {
  passed: '✓',
  failed: '✗',
  pending: '○'
};

/**
 * Format a single gate result as ASCII
 */
export function formatGateResult(gate: GateResult): string {
  const icon = ICONS[gate.status];
  const statusText = gate.status.toUpperCase();
  const time = gate.duration !== undefined ? ` (${gate.duration}ms)` : '';
  return `  ${icon} ${gate.gateName}: ${statusText}${time}`;
}

/**
 * Format full validation summary as ASCII box
 */
export function formatValidationSummary(summary: ValidationSummary): string {
  const lines: string[] = [];
  const width = 50;

  // Header
  lines.push(BOX.topLeft + BOX.horizontal.repeat(width - 2) + BOX.topRight);
  lines.push(BOX.vertical + '  6-GATE VALIDATION RESULTS'.padEnd(width - 3) + BOX.vertical);
  lines.push(BOX.vertical + BOX.horizontal.repeat(width - 2) + BOX.vertical);

  // Gate results
  for (const gate of summary.gates) {
    const formatted = formatGateResult(gate);
    lines.push(BOX.vertical + formatted.padEnd(width - 3) + BOX.vertical);
  }

  // Footer
  lines.push(BOX.vertical + BOX.horizontal.repeat(width - 2) + BOX.vertical);
  const result = summary.allPassed ? '✓ ALL GATES PASSED' : '✗ VALIDATION FAILED';
  lines.push(BOX.vertical + ('  ' + result).padEnd(width - 3) + BOX.vertical);
  lines.push(BOX.bottomLeft + BOX.horizontal.repeat(width - 2) + BOX.bottomRight);

  return lines.join('\n');
}

/**
 * Create a sample summary for testing
 */
export function createSampleSummary(): ValidationSummary {
  return {
    gates: [
      { gateName: 'schema_validation', status: 'passed', duration: 12 },
      { gateName: 'syntax_validation', status: 'passed', duration: 45 },
      { gateName: 'variable_resolution', status: 'passed', duration: 8 },
      { gateName: 'test_execution', status: 'passed', duration: 234 },
      { gateName: 'urco_entropy', status: 'passed', duration: 15 },
      { gateName: 'governance_check', status: 'passed', duration: 23 }
    ],
    allPassed: true,
    totalDuration: 337
  };
}
