// Hash Chain Visualization for Motherlabs Website
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// This module provides ASCII visualization for hash-chained ledger entries

export type LedgerEntry = {
  seq: number;
  recordType: string;
  recordHash: string;
  prevHash: string;
  timestamp: number;
};

export type ChainVisualization = {
  entries: LedgerEntry[];
  isValid: boolean;
  brokenAt?: number;
};

// Shortened hash for display
function shortHash(hash: string): string {
  if (hash.startsWith('sha256:')) {
    return hash.slice(7, 15) + '...' + hash.slice(-6);
  }
  return hash.slice(0, 8) + '...' + hash.slice(-6);
}

/**
 * Format a single ledger entry as ASCII block
 */
export function formatEntry(entry: LedgerEntry): string[] {
  const lines: string[] = [];
  const width = 44;

  lines.push('┌' + '─'.repeat(width - 2) + '┐');
  lines.push('│ SEQ ' + String(entry.seq).padStart(4) + ' │ ' + entry.recordType.padEnd(width - 16) + '│');
  lines.push('├' + '─'.repeat(width - 2) + '┤');
  lines.push('│ hash: ' + shortHash(entry.recordHash).padEnd(width - 10) + '│');
  lines.push('│ prev: ' + shortHash(entry.prevHash).padEnd(width - 10) + '│');
  lines.push('└' + '─'.repeat(width - 2) + '┘');

  return lines;
}

/**
 * Format chain connection arrow
 */
export function formatChainLink(isValid: boolean): string[] {
  if (isValid) {
    return [
      '         │',
      '         ▼'
    ];
  }
  return [
    '         │',
    '    ✗ BROKEN'
  ];
}

/**
 * Format complete chain visualization
 */
export function formatChain(viz: ChainVisualization): string {
  const allLines: string[] = [];

  // Header
  allLines.push('');
  allLines.push('  ═══════════════════════════════════════════');
  allLines.push('  HASH-CHAINED LEDGER VISUALIZATION');
  allLines.push('  ═══════════════════════════════════════════');
  allLines.push('');

  for (let i = 0; i < viz.entries.length; i++) {
    const entry = viz.entries[i];
    const entryLines = formatEntry(entry);

    for (const line of entryLines) {
      allLines.push('  ' + line);
    }

    // Add chain link if not last entry
    if (i < viz.entries.length - 1) {
      const isValidLink = viz.brokenAt === undefined || i < viz.brokenAt;
      const linkLines = formatChainLink(isValidLink);
      for (const line of linkLines) {
        allLines.push('  ' + line);
      }
    }
  }

  // Footer with status
  allLines.push('');
  if (viz.isValid) {
    allLines.push('  ✓ CHAIN INTEGRITY VERIFIED');
  } else {
    allLines.push('  ✗ CHAIN INTEGRITY COMPROMISED at seq ' + viz.brokenAt);
  }
  allLines.push('');

  return allLines.join('\n');
}

/**
 * Create sample chain for demonstration
 */
export function createSampleChain(): ChainVisualization {
  return {
    entries: [
      {
        seq: 0,
        recordType: 'GENESIS',
        recordHash: 'sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        prevHash: 'sha256:0000000000000000000000000000000000000000',
        timestamp: 1700000000000
      },
      {
        seq: 1,
        recordType: 'validation_request',
        recordHash: 'sha256:b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1',
        prevHash: 'sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        timestamp: 1700000001000
      },
      {
        seq: 2,
        recordType: 'gate_result',
        recordHash: 'sha256:c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        prevHash: 'sha256:b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1',
        timestamp: 1700000002000
      }
    ],
    isValid: true
  };
}
