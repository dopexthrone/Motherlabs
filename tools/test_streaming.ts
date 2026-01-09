#!/usr/bin/env npx tsx
/**
 * Test Streaming Support
 *
 * Verifies that streaming works correctly with live adapters.
 */

import { GeminiAdapter } from '../src/adapters/gemini.js';
import { isStreamingAdapter, collectStream } from '../src/adapters/model.js';
import type { TransformContext } from '../src/adapters/model.js';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                    STREAMING SUPPORT TEST                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // Create Gemini adapter
  const adapter = new GeminiAdapter({ model: 'gemini-2.0-flash' });

  console.log(`Adapter ID: ${adapter.adapter_id}`);
  console.log(`Model: ${adapter.model_id}`);
  console.log(`Supports Streaming: ${adapter.capabilities.supports_streaming}`);
  console.log(`Is Streaming Adapter: ${isStreamingAdapter(adapter)}\n`);

  const context: TransformContext = {
    intent_id: 'test_stream',
    run_id: 'run_stream_1',
    mode: 'execute',
    constraints: [],
    metadata: {},
  };

  // Test 1: Basic streaming
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              TEST 1: Basic Streaming                               ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const prompt = 'Count from 1 to 5, one number per line.';
  console.log(`Prompt: "${prompt}"\n`);
  console.log('Streaming output:');
  console.log('─────────────────');

  let chunkCount = 0;
  let totalContent = '';
  const startTime = performance.now();
  let firstChunkTime: number | undefined;

  const stream = adapter.transformStream(prompt, context);

  for await (const chunk of stream) {
    if (!chunk.done && chunk.content) {
      if (firstChunkTime === undefined) {
        firstChunkTime = performance.now() - startTime;
      }
      process.stdout.write(chunk.content);
      totalContent += chunk.content;
      chunkCount++;
    }
  }

  // Get final result
  const finalResult = await stream.next();
  const result = finalResult.done ? finalResult.value : undefined;

  console.log('\n─────────────────');
  console.log(`\nChunks received: ${chunkCount}`);
  console.log(`Time to first chunk: ${firstChunkTime?.toFixed(0) ?? 'N/A'}ms`);
  console.log(`Total time: ${(performance.now() - startTime).toFixed(0)}ms`);

  if (result) {
    console.log(`\nFinal Result:`);
    console.log(`  Tokens In: ${result.tokens_input}`);
    console.log(`  Tokens Out: ${result.tokens_output}`);
    console.log(`  Total Chunks: ${result.total_chunks}`);
    console.log(`  Time to First Chunk: ${result.time_to_first_chunk_ms}ms`);
  }

  // Test 2: Longer content
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('              TEST 2: Longer Streaming Content                      ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const longPrompt = 'Write a 4-line poem about coding. Keep it short.';
  console.log(`Prompt: "${longPrompt}"\n`);
  console.log('Streaming:');
  console.log('─────────────────');

  const stream2 = adapter.transformStream(longPrompt, context);
  let chunks2 = 0;

  for await (const chunk of stream2) {
    if (!chunk.done && chunk.content) {
      process.stdout.write(chunk.content);
      chunks2++;
    }
  }

  console.log('\n─────────────────');
  console.log(`Chunks: ${chunks2}`);

  // Test 3: Using collectStream helper
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('              TEST 3: collectStream() Helper                        ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const stream3 = adapter.transformStream('What is 2+2?', context);
  const collectedResult = await collectStream(stream3);

  console.log(`Content: "${collectedResult.content.trim()}"`);
  console.log(`Total Chunks: ${collectedResult.total_chunks}`);
  console.log(`Latency: ${collectedResult.latency_ms}ms`);

  await adapter.shutdown();
  console.log('\n✓ Streaming test complete');
}

main().catch(console.error);
