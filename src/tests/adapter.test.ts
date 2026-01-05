/**
 * Model Adapter Tests
 * ===================
 *
 * Tests for the ModelAdapter interface and implementations:
 * - MockModelAdapter
 * - RecordingModelAdapter
 * - ReplayModelAdapter
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  MockModelAdapter,
  RecordingModelAdapter,
  ReplayModelAdapter,
  AdapterError,
  createEchoAdapter,
  createFixedAdapter,
  createAdapterFromRecording,
} from '../adapters/index.js';
import type {
  TransformContext,
  MockResponse,
  RecordingSession,
} from '../adapters/index.js';

// =============================================================================
// Test Utilities
// =============================================================================

function createTestContext(overrides: Partial<TransformContext> = {}): TransformContext {
  return {
    intent_id: 'test_intent_001',
    run_id: 'run_001',
    mode: 'plan-only',
    constraints: ['constraint_1', 'constraint_2'],
    metadata: {},
    ...overrides,
  };
}

function hashString(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

// =============================================================================
// MockModelAdapter Tests
// =============================================================================

describe('MockModelAdapter', () => {
  it('should return configured response for exact prompt', async () => {
    const responses = new Map<string, MockResponse>();
    const prompt = 'Test prompt';
    const promptHash = hashString(prompt);
    responses.set(promptHash, { content: 'Test response' });

    const adapter = new MockModelAdapter(responses);
    const result = await adapter.transform(prompt, createTestContext());

    assert.equal(result.content, 'Test response');
    assert.equal(result.from_cache, true);
  });

  it('should throw AdapterError for unmatched prompt in strict mode', async () => {
    const adapter = new MockModelAdapter();

    await assert.rejects(
      () => adapter.transform('Unknown prompt', createTestContext()),
      (err: AdapterError) => {
        assert.equal(err.code, 'REPLAY_MISS');
        return true;
      }
    );
  });

  it('should echo prompt in echo mode', async () => {
    const adapter = createEchoAdapter();
    const prompt = 'Echo this back';
    const result = await adapter.transform(prompt, createTestContext());

    assert.equal(result.content, prompt);
  });

  it('should return fixed content in fixed mode', async () => {
    const adapter = createFixedAdapter('Fixed response');
    const result = await adapter.transform('Any prompt', createTestContext());

    assert.equal(result.content, 'Fixed response');
  });

  it('should match substring patterns', async () => {
    const adapter = new MockModelAdapter();
    adapter.addSubstringMatch('important', { content: 'Matched!' });

    const result = await adapter.transform('This is an important message', createTestContext());
    assert.equal(result.content, 'Matched!');
  });

  it('should record interactions when enabled', async () => {
    const adapter = new MockModelAdapter(new Map(), { record: true, default_behavior: { type: 'echo' } });

    await adapter.transform('First prompt', createTestContext());
    await adapter.transform('Second prompt', createTestContext());

    const interactions = adapter.getRecordedInteractions();
    assert.equal(interactions.length, 2);
    assert.equal(interactions[0]!.sequence, 0);
    assert.equal(interactions[1]!.sequence, 1);
  });

  it('should export recording session', async () => {
    const adapter = new MockModelAdapter(new Map(), { record: true, default_behavior: { type: 'echo' } });

    await adapter.transform('Test', createTestContext());

    const session = adapter.exportRecording();
    assert.equal(session.format_version, '1.0');
    assert.equal(session.interactions.length, 1);
    assert.equal(session.stats.total_interactions, 1);
  });

  it('should report ready state correctly', async () => {
    const adapter = new MockModelAdapter();

    assert.equal(await adapter.isReady(), true);
    await adapter.shutdown();
    assert.equal(await adapter.isReady(), false);
  });

  it('should have correct adapter_id and model_id', () => {
    const adapter = new MockModelAdapter(new Map(), { model_id: 'test-model' });

    assert.equal(adapter.model_id, 'test-model');
    assert.ok(adapter.adapter_id.startsWith('mock_'));
  });

  it('should estimate tokens from content length', async () => {
    const adapter = createEchoAdapter();
    const prompt = 'A'.repeat(100); // 100 chars

    const result = await adapter.transform(prompt, createTestContext());

    // Token estimate: ceil(length / 4)
    assert.equal(result.tokens_input, 25);
    assert.equal(result.tokens_output, 25);
  });
});

// =============================================================================
// RecordingModelAdapter Tests
// =============================================================================

describe('RecordingModelAdapter', () => {
  it('should record interactions from delegate', async () => {
    const delegate = createEchoAdapter();
    const recorder = new RecordingModelAdapter(delegate);

    await recorder.transform('First', createTestContext());
    await recorder.transform('Second', createTestContext());

    const interactions = recorder.getInteractions();
    assert.equal(interactions.length, 2);
  });

  it('should delegate transform calls correctly', async () => {
    const delegate = createFixedAdapter('Delegate response');
    const recorder = new RecordingModelAdapter(delegate);

    const result = await recorder.transform('Any prompt', createTestContext());
    assert.equal(result.content, 'Delegate response');
  });

  it('should compute stats correctly', async () => {
    const responses = new Map<string, MockResponse>();
    responses.set(hashString('prompt1'), { content: 'response1', tokens_input: 10, tokens_output: 20 });
    responses.set(hashString('prompt2'), { content: 'response2', tokens_input: 15, tokens_output: 25 });

    const delegate = new MockModelAdapter(responses);
    const recorder = new RecordingModelAdapter(delegate);

    await recorder.transform('prompt1', createTestContext());
    await recorder.transform('prompt2', createTestContext());

    const stats = recorder.getStats();
    assert.equal(stats.total_interactions, 2);
    assert.equal(stats.total_tokens_input, 25);
    assert.equal(stats.total_tokens_output, 45);
  });

  it('should respect max_interactions limit', async () => {
    const delegate = createEchoAdapter();
    const recorder = new RecordingModelAdapter(delegate, { max_interactions: 2 });

    await recorder.transform('First', createTestContext());
    await recorder.transform('Second', createTestContext());

    await assert.rejects(
      () => recorder.transform('Third', createTestContext()),
      (err: AdapterError) => {
        assert.equal(err.code, 'ADAPTER_ERROR');
        return true;
      }
    );
  });

  it('should redact prompts when include_prompts is false', async () => {
    const delegate = createEchoAdapter();
    const recorder = new RecordingModelAdapter(delegate, { include_prompts: false });

    await recorder.transform('Secret prompt', createTestContext());

    const interactions = recorder.getInteractions();
    assert.equal(interactions[0]!.prompt, '[REDACTED]');
    assert.ok(interactions[0]!.prompt_hash.length === 64);
  });

  it('should delegate isReady and shutdown', async () => {
    const delegate = new MockModelAdapter();
    const recorder = new RecordingModelAdapter(delegate);

    assert.equal(await recorder.isReady(), true);
    await recorder.shutdown();
    assert.equal(await delegate.isReady(), false);
  });
});

// =============================================================================
// ReplayModelAdapter Tests
// =============================================================================

describe('ReplayModelAdapter', () => {
  function createTestSession(): RecordingSession {
    return {
      format_version: '1.0',
      started_at: '2025-01-01T00:00:00Z',
      ended_at: '2025-01-01T00:01:00Z',
      model_id: 'test-model',
      interactions: [
        {
          sequence: 0,
          prompt_hash: hashString('prompt1'),
          prompt: 'prompt1',
          context: createTestContext(),
          result: {
            content: 'response1',
            tokens_input: 10,
            tokens_output: 20,
            latency_ms: 100,
            model_version: 'test-v1',
            from_cache: false,
          },
          recorded_at: '2025-01-01T00:00:30Z',
        },
        {
          sequence: 1,
          prompt_hash: hashString('prompt2'),
          prompt: 'prompt2',
          context: createTestContext(),
          result: {
            content: 'response2',
            tokens_input: 15,
            tokens_output: 25,
            latency_ms: 150,
            model_version: 'test-v1',
            from_cache: false,
          },
          recorded_at: '2025-01-01T00:00:45Z',
        },
      ],
      stats: {
        total_interactions: 2,
        total_tokens_input: 25,
        total_tokens_output: 45,
        total_latency_ms: 250,
      },
    };
  }

  it('should replay recorded response by prompt hash', async () => {
    const session = createTestSession();
    const adapter = new ReplayModelAdapter(session);

    const result = await adapter.transform('prompt1', createTestContext());
    assert.equal(result.content, 'response1');
    assert.equal(result.from_cache, true);
    assert.equal(result.latency_ms, 0); // Latency is zeroed for determinism
  });

  it('should throw for unrecorded prompt in strict mode', async () => {
    const session = createTestSession();
    const adapter = new ReplayModelAdapter(session, { strict: true });

    await assert.rejects(
      () => adapter.transform('unknown prompt', createTestContext()),
      (err: AdapterError) => {
        assert.equal(err.code, 'REPLAY_MISS');
        return true;
      }
    );
  });

  it('should return empty content for unrecorded prompt in non-strict mode', async () => {
    const session = createTestSession();
    const adapter = new ReplayModelAdapter(session, { strict: false });

    const result = await adapter.transform('unknown prompt', createTestContext());
    assert.equal(result.content, '');
  });

  it('should enforce sequence order in sequential mode', async () => {
    const session = createTestSession();
    const adapter = new ReplayModelAdapter(session, { sequential: true });

    // First prompt should work
    const result1 = await adapter.transform('prompt1', createTestContext());
    assert.equal(result1.content, 'response1');

    // Second prompt should work
    const result2 = await adapter.transform('prompt2', createTestContext());
    assert.equal(result2.content, 'response2');
  });

  it('should fail in sequential mode if prompts are out of order', async () => {
    const session = createTestSession();
    const adapter = new ReplayModelAdapter(session, { sequential: true });

    // Trying to call prompt2 first should fail
    await assert.rejects(
      () => adapter.transform('prompt2', createTestContext()),
      (err: AdapterError) => {
        assert.equal(err.code, 'REPLAY_MISS');
        return true;
      }
    );
  });

  it('should report recording count', () => {
    const session = createTestSession();
    const adapter = new ReplayModelAdapter(session);

    assert.equal(adapter.getRecordingCount(), 2);
  });

  it('should check hasRecording correctly', () => {
    const session = createTestSession();
    const adapter = new ReplayModelAdapter(session);

    assert.equal(adapter.hasRecording(hashString('prompt1')), true);
    assert.equal(adapter.hasRecording(hashString('unknown')), false);
  });

  it('should always be ready', async () => {
    const session = createTestSession();
    const adapter = new ReplayModelAdapter(session);

    assert.equal(await adapter.isReady(), true);
    await adapter.shutdown();
    assert.equal(await adapter.isReady(), true); // Still ready after shutdown
  });
});

// =============================================================================
// Integration Tests: Record and Replay
// =============================================================================

describe('Record and Replay Integration', () => {
  it('should produce identical results when replaying recorded session', async () => {
    // Setup delegate with known responses
    const responses = new Map<string, MockResponse>();
    responses.set(hashString('query1'), { content: 'answer1' });
    responses.set(hashString('query2'), { content: 'answer2' });
    const delegate = new MockModelAdapter(responses);

    // Record interactions
    const recorder = new RecordingModelAdapter(delegate);
    const originalResults: string[] = [];

    originalResults.push((await recorder.transform('query1', createTestContext())).content);
    originalResults.push((await recorder.transform('query2', createTestContext())).content);

    // Export and replay
    const session = recorder.exportSession();
    const replay = new ReplayModelAdapter(session);
    const replayResults: string[] = [];

    replayResults.push((await replay.transform('query1', createTestContext())).content);
    replayResults.push((await replay.transform('query2', createTestContext())).content);

    // Results should be identical
    assert.deepEqual(originalResults, replayResults);
  });

  it('should create adapter from recording session', async () => {
    const session: RecordingSession = {
      format_version: '1.0',
      started_at: '2025-01-01T00:00:00Z',
      ended_at: '2025-01-01T00:01:00Z',
      model_id: 'original-model',
      interactions: [
        {
          sequence: 0,
          prompt_hash: hashString('test'),
          prompt: 'test',
          context: createTestContext(),
          result: {
            content: 'recorded response',
            tokens_input: 5,
            tokens_output: 10,
            latency_ms: 50,
            model_version: 'v1',
            from_cache: false,
          },
          recorded_at: '2025-01-01T00:00:30Z',
        },
      ],
      stats: {
        total_interactions: 1,
        total_tokens_input: 5,
        total_tokens_output: 10,
        total_latency_ms: 50,
      },
    };

    const adapter = createAdapterFromRecording(session);
    const result = await adapter.transform('test', createTestContext());

    assert.equal(result.content, 'recorded response');
    assert.equal(adapter.model_id, 'original-model');
  });
});

// =============================================================================
// Determinism Tests
// =============================================================================

describe('Adapter Determinism', () => {
  it('should produce identical results across multiple runs', async () => {
    const responses = new Map<string, MockResponse>();
    responses.set(hashString('deterministic'), {
      content: 'Same every time',
      tokens_input: 10,
      tokens_output: 20,
    });

    const adapter = new MockModelAdapter(responses);
    const results: string[] = [];

    for (let i = 0; i < 10; i++) {
      const result = await adapter.transform('deterministic', createTestContext());
      results.push(result.content);
    }

    // All results should be identical
    assert.ok(results.every((r) => r === results[0]));
  });

  it('should produce same hash for same prompt regardless of context metadata', async () => {
    const adapter = createEchoAdapter();

    const result1 = await adapter.transform('same prompt', createTestContext({ metadata: { a: 1 } }));
    const result2 = await adapter.transform('same prompt', createTestContext({ metadata: { b: 2 } }));

    // Content should be identical (echo)
    assert.equal(result1.content, result2.content);
  });
});
