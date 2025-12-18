// Motherlabs Website Module - Banner Component
// CONSTITUTIONAL AUTHORITY - See docs/MOTHERLABS_CONSTITUTION.md
// This module provides the main banner visualization for the Motherlabs website

export type ConceptInfo = {
  name: string;
  description: string;
  icon: string;
};

/**
 * Core Motherlabs concepts
 */
export const CORE_CONCEPTS: ConceptInfo[] = [
  {
    name: '6-GATE VALIDATION',
    description: 'Every code change passes through 6 verification gates',
    icon: '🔒'
  },
  {
    name: 'HASH-CHAINED LEDGER',
    description: 'All decisions recorded in immutable, verifiable chain',
    icon: '⛓️'
  },
  {
    name: 'DETERMINISTIC REASONING',
    description: 'Same inputs always produce identical outputs',
    icon: '🎯'
  }
];

// Version exported as constant (proper pattern)
export const VERSION = '0.1.0';

/**
 * Format concept as ASCII block
 */
export function formatConcept(concept: ConceptInfo, width: number): string[] {
  const lines: string[] = [];
  const innerWidth = width - 4;

  lines.push('┌' + '─'.repeat(width - 2) + '┐');
  lines.push('│ ' + (concept.icon + ' ' + concept.name).padEnd(innerWidth) + ' │');
  lines.push('├' + '─'.repeat(width - 2) + '┤');

  // Word wrap description
  const words = concept.description.split(' ');
  let currentLine = '';
  for (const word of words) {
    if (currentLine.length + word.length + 1 <= innerWidth) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      lines.push('│ ' + currentLine.padEnd(innerWidth) + ' │');
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push('│ ' + currentLine.padEnd(innerWidth) + ' │');
  }

  lines.push('└' + '─'.repeat(width - 2) + '┘');
  return lines;
}

/**
 * Complete demonstration of Motherlabs core concepts
 */
export function renderBanner(): string {
  const lines: string[] = [];
  const width = 65;

  lines.push('');
  lines.push('╔' + '═'.repeat(width - 2) + '╗');
  lines.push('║' + '  MOTHERLABS RUNTIME - DETERMINISTIC REASONING ENGINE'.padEnd(width - 2) + '║');
  lines.push('╠' + '═'.repeat(width - 2) + '╣');
  lines.push('║' + ''.padEnd(width - 2) + '║');
  lines.push('║' + '  "Knowable correctness through mechanical verification"'.padEnd(width - 2) + '║');
  lines.push('║' + ''.padEnd(width - 2) + '║');
  lines.push('╚' + '═'.repeat(width - 2) + '╝');
  lines.push('');

  // Add each concept
  for (const concept of CORE_CONCEPTS) {
    const conceptLines = formatConcept(concept, width);
    for (const line of conceptLines) {
      lines.push(line);
    }
    lines.push('');
  }

  return lines.join('\n');
}
