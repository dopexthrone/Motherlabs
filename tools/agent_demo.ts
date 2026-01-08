#!/usr/bin/env npx tsx
/**
 * Agent Demo with RAG
 * ===================
 *
 * Demonstrates the coding agent with vector-based RAG.
 */

import { createAdapter } from '../src/adapters/index.js';
import { createCodingAgent } from '../src/agent/index.js';
import type { Document } from '../src/rag/index.js';

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                  CODING AGENT WITH RAG DEMO                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // Create adapter (uses Gemini by default)
  const adapter = createAdapter({ provider: 'google' });
  console.log(`Model: ${adapter.model_id}\n`);

  // Create agent
  const agent = createCodingAgent(adapter, {
    mode: 'auto',
    verification_level: 'basic', // Use basic for faster demo
    confidence_threshold: 0.7,
    max_attempts: 2,
    enable_rag: true,
  });

  // Start agent
  await agent.start();

  // Index some context documents
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                      INDEXING CONTEXT                              ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const documents: Document[] = [
    {
      id: 'math_utils',
      type: 'code',
      language: 'python',
      source: 'utils/math.py',
      content: `
"""Math utility functions."""

def factorial(n: int) -> int:
    """Calculate factorial of n."""
    if n < 0:
        raise ValueError("n must be non-negative")
    if n <= 1:
        return 1
    return n * factorial(n - 1)

def fibonacci(n: int) -> int:
    """Get nth Fibonacci number."""
    if n < 0:
        raise ValueError("n must be non-negative")
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

def is_prime(n: int) -> bool:
    """Check if n is prime."""
    if n < 2:
        return False
    if n == 2:
        return True
    if n % 2 == 0:
        return False
    for i in range(3, int(n**0.5) + 1, 2):
        if n % i == 0:
            return False
    return True

def gcd(a: int, b: int) -> int:
    """Calculate greatest common divisor."""
    while b:
        a, b = b, a % b
    return a
`,
    },
    {
      id: 'string_utils',
      type: 'code',
      language: 'python',
      source: 'utils/strings.py',
      content: `
"""String utility functions."""

def reverse_string(s: str) -> str:
    """Reverse a string."""
    return s[::-1]

def is_palindrome(s: str) -> bool:
    """Check if string is a palindrome."""
    cleaned = ''.join(c.lower() for c in s if c.isalnum())
    return cleaned == cleaned[::-1]

def count_words(s: str) -> int:
    """Count words in a string."""
    return len(s.split())

def capitalize_words(s: str) -> str:
    """Capitalize first letter of each word."""
    return ' '.join(word.capitalize() for word in s.split())
`,
    },
  ];

  for (const doc of documents) {
    const chunks = await agent.indexDocument(doc);
    console.log(`Indexed: ${doc.source} (${chunks} chunks)`);
  }

  const ragStats = agent.getRAGStats();
  console.log(`\nRAG: ${ragStats.total_documents} docs, ${ragStats.total_chunks} chunks`);
  console.log(`Embedding tokens: ${ragStats.total_embedding_tokens}`);

  // Test generation WITH context
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('              TEST 1: Generate with RAG Context                     ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const result1 = await agent.generate({
    prompt: 'Write a Python function that calculates the least common multiple (LCM) of two numbers. Use the GCD function from the codebase.',
    language: 'python',
    signature: 'def lcm(a: int, b: int) -> int',
  });

  console.log(`Success: ${result1.success}`);
  console.log(`Confidence: ${(result1.confidence * 100).toFixed(0)}%`);
  console.log(`Attempts: ${result1.attempts}`);
  console.log(`Context items used: ${result1.metadata.context_items}`);
  console.log(`Verification: ${result1.verification.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`\nGenerated Code:\n${'─'.repeat(50)}`);
  console.log(result1.code || '(no code)');
  console.log(`${'─'.repeat(50)}`);

  // Test 2: Generate something related to strings
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('              TEST 2: String manipulation with RAG                  ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const result2 = await agent.generate({
    prompt: 'Write a Python function that checks if two strings are anagrams of each other. Follow the coding style from the string utilities in the codebase.',
    language: 'python',
    signature: 'def is_anagram(s1: str, s2: str) -> bool',
  });

  console.log(`Success: ${result2.success}`);
  console.log(`Confidence: ${(result2.confidence * 100).toFixed(0)}%`);
  console.log(`Context items used: ${result2.metadata.context_items}`);
  console.log(`\nGenerated Code:\n${'─'.repeat(50)}`);
  console.log(result2.code || '(no code)');
  console.log(`${'─'.repeat(50)}`);

  // Show agent state
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                         AGENT STATE                                ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const state = agent.getState();
  console.log(`Agent ID: ${state.id}`);
  console.log(`Mode: ${state.config.mode}`);
  console.log(`Total Requests: ${state.stats.total_requests}`);
  console.log(`Successful: ${state.stats.successful}`);
  console.log(`Average Confidence: ${(state.stats.average_confidence * 100).toFixed(0)}%`);
  console.log(`Pending Reviews: ${state.pending_reviews.length}`);

  const finalRagStats = agent.getRAGStats();
  console.log(`\nRAG Searches: ${finalRagStats.total_searches}`);
  console.log(`Avg Search Latency: ${finalRagStats.average_search_latency_ms}ms`);

  // Stop agent
  await agent.stop();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                              DONE                                  ');
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
