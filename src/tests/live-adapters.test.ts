/**
 * Live Adapter Tests
 * ==================
 *
 * Tests for ClaudeAdapter, OpenAIAdapter, OllamaAdapter, and AdapterFactory.
 *
 * These tests verify:
 * 1. Adapter instantiation and configuration
 * 2. Error handling and mapping
 * 3. Factory creation
 * 4. Live API calls (when credentials are available)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  ClaudeAdapter,
  createClaudeAdapter,
  getClaudeCapabilities,
  type ClaudeModel,
} from '../adapters/claude.js';

import {
  OpenAIAdapter,
  createOpenAIAdapter,
  getOpenAICapabilities,
  type OpenAIModel,
} from '../adapters/openai.js';

import {
  OllamaAdapter,
  createOllamaAdapter,
  isOllamaAvailable,
  listOllamaModels,
} from '../adapters/ollama.js';

import {
  createAdapter,
  createAdapterWithFallback,
  createAutoAdapter,
  getConfiguredProvider,
  isProviderAvailable,
  getDefaultModel,
  type AdapterProvider,
} from '../adapters/factory.js';

import { AdapterError, type TransformContext } from '../adapters/model.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_CONTEXT: TransformContext = {
  intent_id: 'test_intent_001',
  run_id: 'test_run_001',
  mode: 'plan-only',
  constraints: ['no_network', 'deterministic'],
  metadata: { test: true },
};

const SIMPLE_PROMPT = 'Say "hello" and nothing else.';

// =============================================================================
// Claude Adapter Tests
// =============================================================================

describe('ClaudeAdapter', () => {
  describe('instantiation', () => {
    it('throws without API key', () => {
      // Save and clear env
      const saved = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      try {
        assert.throws(
          () => new ClaudeAdapter(),
          (err: unknown) =>
            err instanceof AdapterError && err.code === 'ADAPTER_ERROR'
        );
      } finally {
        // Restore env
        if (saved) process.env.ANTHROPIC_API_KEY = saved;
      }
    });

    it('creates adapter with explicit API key', () => {
      const adapter = new ClaudeAdapter({ api_key: 'test-key' });
      assert.ok(adapter.adapter_id.startsWith('claude_'));
      assert.ok(adapter.model_id.includes('claude'));
      assert.ok(adapter.capabilities.max_context_tokens > 0);
    });

    it('respects model option', () => {
      const adapter = new ClaudeAdapter({
        api_key: 'test-key',
        model: 'claude-3-opus-20240229',
      });
      assert.equal(adapter.model_id, 'claude-3-opus-20240229');
    });
  });

  describe('capabilities', () => {
    it('returns capabilities for known models', () => {
      const models: ClaudeModel[] = [
        'claude-3-5-sonnet-20241022',
        'claude-3-opus-20240229',
        'claude-3-haiku-20240307',
      ];

      for (const model of models) {
        const caps = getClaudeCapabilities(model);
        assert.ok(caps.max_context_tokens > 0);
        assert.ok(caps.max_output_tokens > 0);
        assert.equal(caps.supports_tool_use, true);
      }
    });
  });

  describe('factory function', () => {
    it('creates adapter with defaults', () => {
      // Only run if API key is set
      if (!process.env.ANTHROPIC_API_KEY) {
        return;
      }
      const adapter = createClaudeAdapter();
      assert.ok(adapter instanceof ClaudeAdapter);
    });
  });
});

// =============================================================================
// OpenAI Adapter Tests
// =============================================================================

describe('OpenAIAdapter', () => {
  describe('instantiation', () => {
    it('throws without API key', () => {
      const saved = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        assert.throws(
          () => new OpenAIAdapter(),
          (err: unknown) =>
            err instanceof AdapterError && err.code === 'ADAPTER_ERROR'
        );
      } finally {
        if (saved) process.env.OPENAI_API_KEY = saved;
      }
    });

    it('creates adapter with explicit API key', () => {
      const adapter = new OpenAIAdapter({ api_key: 'test-key' });
      assert.ok(adapter.adapter_id.startsWith('openai_'));
      assert.ok(adapter.model_id.includes('gpt'));
      assert.ok(adapter.capabilities.max_context_tokens > 0);
    });

    it('respects model option', () => {
      const adapter = new OpenAIAdapter({
        api_key: 'test-key',
        model: 'gpt-4-turbo',
      });
      assert.equal(adapter.model_id, 'gpt-4-turbo');
    });
  });

  describe('capabilities', () => {
    it('returns capabilities for known models', () => {
      const models: OpenAIModel[] = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];

      for (const model of models) {
        const caps = getOpenAICapabilities(model);
        assert.ok(caps.max_context_tokens > 0);
        assert.ok(caps.max_output_tokens > 0);
      }
    });

    it('o1 models have limited capabilities', () => {
      const caps = getOpenAICapabilities('o1');
      assert.equal(caps.supports_structured_output, false);
      assert.equal(caps.supports_tool_use, false);
      assert.equal(caps.supports_streaming, false);
    });
  });

  describe('factory function', () => {
    it('creates adapter with defaults', () => {
      if (!process.env.OPENAI_API_KEY) {
        return;
      }
      const adapter = createOpenAIAdapter();
      assert.ok(adapter instanceof OpenAIAdapter);
    });
  });
});

// =============================================================================
// Ollama Adapter Tests
// =============================================================================

describe('OllamaAdapter', () => {
  describe('instantiation', () => {
    it('creates adapter without API key', () => {
      const adapter = new OllamaAdapter();
      assert.ok(adapter.adapter_id.startsWith('ollama_'));
      assert.ok(adapter.model_id.includes('ollama/'));
    });

    it('respects model option', () => {
      const adapter = new OllamaAdapter({ model: 'mistral' });
      assert.equal(adapter.model_id, 'ollama/mistral');
    });

    it('uses default capabilities for unknown models', () => {
      const adapter = new OllamaAdapter({ model: 'custom-model' });
      assert.ok(adapter.capabilities.max_context_tokens > 0);
    });

    it('uses known capabilities for known models', () => {
      const adapter = new OllamaAdapter({ model: 'llama3.3:70b' });
      assert.equal(adapter.capabilities.max_context_tokens, 131072);
    });
  });

  describe('availability check', async () => {
    it('isOllamaAvailable returns boolean', async () => {
      const available = await isOllamaAvailable();
      assert.equal(typeof available, 'boolean');
    });

    it('listOllamaModels returns array', async () => {
      const models = await listOllamaModels();
      assert.ok(Array.isArray(models));
    });
  });

  describe('factory function', () => {
    it('creates adapter with defaults', () => {
      const adapter = createOllamaAdapter();
      assert.ok(adapter instanceof OllamaAdapter);
    });
  });
});

// =============================================================================
// Factory Tests
// =============================================================================

describe('AdapterFactory', () => {
  describe('createAdapter', () => {
    it('creates mock adapter', () => {
      const adapter = createAdapter({ provider: 'mock' });
      assert.ok(adapter.adapter_id.startsWith('mock_'));
    });

    it('creates ollama adapter', () => {
      const adapter = createAdapter({ provider: 'ollama' });
      assert.ok(adapter.adapter_id.startsWith('ollama_'));
    });

    it('creates claude adapter with API key', () => {
      if (!process.env.ANTHROPIC_API_KEY) return;
      const adapter = createAdapter({ provider: 'anthropic' });
      assert.ok(adapter.adapter_id.startsWith('claude_'));
    });

    it('creates openai adapter with API key', () => {
      if (!process.env.OPENAI_API_KEY) return;
      const adapter = createAdapter({ provider: 'openai' });
      assert.ok(adapter.adapter_id.startsWith('openai_'));
    });

    it('throws on unknown provider', () => {
      assert.throws(
        () => createAdapter({ provider: 'unknown' as AdapterProvider }),
        (err: unknown) =>
          err instanceof AdapterError && err.code === 'INVALID_REQUEST'
      );
    });
  });

  describe('createAdapterWithFallback', () => {
    it('returns single adapter without fallback', () => {
      const adapter = createAdapterWithFallback({ provider: 'mock' });
      assert.ok(adapter.adapter_id.startsWith('mock_'));
    });

    it('creates fallback adapter', () => {
      const adapter = createAdapterWithFallback({
        provider: 'ollama',
        fallback_provider: 'mock',
      });
      assert.ok(adapter.adapter_id.includes('fallback'));
    });
  });

  describe('createAutoAdapter', () => {
    it('returns an adapter', async () => {
      const adapter = await createAutoAdapter();
      assert.ok(adapter.adapter_id);
      assert.ok(adapter.model_id);
    });
  });

  describe('utility functions', () => {
    it('getConfiguredProvider returns provider or null', () => {
      const provider = getConfiguredProvider();
      assert.ok(provider === null || ['anthropic', 'openai'].includes(provider));
    });

    it('isProviderAvailable checks correctly', async () => {
      const mockAvailable = await isProviderAvailable('mock');
      assert.equal(mockAvailable, true);
    });

    it('getDefaultModel returns model name', () => {
      const models: AdapterProvider[] = ['anthropic', 'openai', 'ollama', 'mock'];
      for (const provider of models) {
        const model = getDefaultModel(provider);
        assert.ok(typeof model === 'string');
        assert.ok(model.length > 0);
      }
    });
  });
});

// =============================================================================
// Live API Tests (conditional)
// =============================================================================

describe('Live API Tests', () => {
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

  describe('Claude live test', { skip: !hasAnthropicKey }, () => {
    it('makes successful API call', async () => {
      const adapter = createClaudeAdapter('claude-3-5-haiku-20241022');

      const result = await adapter.transform(SIMPLE_PROMPT, TEST_CONTEXT);

      assert.ok(result.content.toLowerCase().includes('hello'));
      assert.ok(result.tokens_input > 0);
      assert.ok(result.tokens_output > 0);
      assert.ok(result.latency_ms > 0);
      assert.equal(result.from_cache, false);
    });
  });

  describe('OpenAI live test', { skip: !hasOpenAIKey }, () => {
    it('makes successful API call', async () => {
      const adapter = createOpenAIAdapter('gpt-4o-mini');

      try {
        const result = await adapter.transform(SIMPLE_PROMPT, TEST_CONTEXT);

        assert.ok(result.content.toLowerCase().includes('hello'));
        assert.ok(result.tokens_input > 0);
        assert.ok(result.tokens_output > 0);
        assert.ok(result.latency_ms > 0);
        assert.equal(result.from_cache, false);
      } catch (err) {
        // Skip if credentials are invalid (401/403)
        if (err instanceof AdapterError && err.details?.status === 401) {
          console.log('Skipping OpenAI test: invalid API key');
          return;
        }
        throw err;
      }
    });
  });

  describe('Ollama live test', async () => {
    const ollamaAvailable = await isOllamaAvailable();

    it('makes successful API call', { skip: !ollamaAvailable }, async () => {
      const models = await listOllamaModels();
      if (models.length === 0) {
        return; // Skip if no models installed
      }

      const adapter = createOllamaAdapter(models[0]);
      const result = await adapter.transform(SIMPLE_PROMPT, TEST_CONTEXT);

      assert.ok(result.content.length > 0);
      assert.ok(result.latency_ms > 0);
      assert.equal(result.from_cache, false);
    });
  });
});
