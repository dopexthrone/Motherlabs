/**
 * Self-Improvement Module
 * =======================
 *
 * Governed self-improvement loop for autonomous capability enhancement.
 *
 * Protocol:
 * 1. DISCOVER - Explore improvements via beam search
 * 2. SELECT   - Pick best candidate, generate plan
 * 3. IMPLEMENT - Apply changes (with backups)
 * 4. VALIDATE - Run eval, check no regression
 * 5. INTEGRATE - Commit if validated
 * 6. LOOP     - Repeat with new baseline
 */

export * from './types.js';
export * from './protocol.js';
