/**
 * Coding Agent
 * ============
 *
 * A coding agent that combines LLM generation with verification layers
 * for high-accuracy code generation.
 *
 * Architecture (from deep exploration):
 * - CodeT5+/LLM for generation
 * - Property-based testing (Hypothesis)
 * - Static analysis (Semgrep)
 * - Human-in-the-loop with Active Learning
 * - VSCode extension integration
 *
 * Modes:
 * - auto: Fully automated with verification gates
 * - human-in-loop: Active learning selects what humans review
 */

export * from './types.js';
export * from './generator.js';
export * from './verifier.js';
export * from './agent.js';
