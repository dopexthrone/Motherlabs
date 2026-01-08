# Roadmap: v0.4.0 - Live LLM Adapters

## Overview

v0.4.0 introduces **live LLM adapters** that connect the context engine kernel to real AI models. Building on the ModelAdapter abstraction from v0.3.0, this release enables:

1. Live Claude API integration (primary model)
2. OpenAI API integration (fallback/embedding)
3. Local Ollama integration (offline/development)
4. Unified adapter factory with routing

## Current State (v0.3.16)

- ModelAdapter interface: Defined and stable
- MockModelAdapter: Testing without live calls
- RecordingModelAdapter: Capture interactions
- ReplayModelAdapter: Deterministic replay
- Tests: 1095 passing
- Goldens: 10/10 unchanged
- RUNNER_SPEC: Complete with RN1-RN12 invariants

## Goals for v0.4.0

### G1: ClaudeAdapter

Primary adapter using Anthropic's Claude API:

```typescript
interface ClaudeAdapterOptions {
  api_key: string;                    // From environment
  model: ClaudeModel;                 // claude-3-5-sonnet, claude-3-opus, etc.
  max_retries?: number;               // Default: 3
  timeout_ms?: number;                // Default: 120000
  base_url?: string;                  // Optional override
}

type ClaudeModel =
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-20250514'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-haiku-20241022'
  | 'claude-3-opus-20240229';
```

Capabilities:
- Structured JSON output via tool_use
- 200K context window (Sonnet/Opus)
- Streaming support
- Tool/function calling

### G2: OpenAIAdapter

Secondary adapter for OpenAI models:

```typescript
interface OpenAIAdapterOptions {
  api_key: string;
  organization_id?: string;
  model: OpenAIModel;
  max_retries?: number;
  timeout_ms?: number;
}

type OpenAIModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'o1'
  | 'o1-mini';
```

Capabilities:
- JSON mode
- 128K context (GPT-4o)
- Function calling
- Embeddings (separate endpoint)

### G3: OllamaAdapter

Local model adapter for offline development:

```typescript
interface OllamaAdapterOptions {
  base_url?: string;                  // Default: http://localhost:11434
  model: string;                      // llama3.3, qwen2.5, mistral, etc.
  timeout_ms?: number;
}
```

Capabilities:
- No API key required
- Offline operation
- Variable context windows
- Custom model support

### G4: AdapterFactory

Unified factory for creating adapters:

```typescript
interface AdapterFactoryOptions {
  provider: 'anthropic' | 'openai' | 'ollama' | 'mock';
  model?: string;
  fallback_provider?: 'anthropic' | 'openai' | 'ollama';
}

function createAdapter(options: AdapterFactoryOptions): ModelAdapter;
```

### G5: Model Routing (Future)

Prepare for intelligent routing (deferred to v0.5.0):

```typescript
interface RoutingConfig {
  primary: AdapterFactoryOptions;
  fallback: AdapterFactoryOptions;
  embedding: AdapterFactoryOptions;
  rules: RoutingRule[];
}

interface RoutingRule {
  condition: 'cost' | 'latency' | 'quality' | 'context_length';
  threshold: number;
  action: 'use_fallback' | 'use_local';
}
```

## Non-Goals for v0.4.0

- Automatic cost optimization (v0.5.0)
- Multi-model ensemble (v0.5.0)
- Streaming responses to kernel (v0.5.0)
- Fine-tuned model support (v0.6.0)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Harness Layer                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ClaudeAdptr │  │OpenAIAdptr │  │OllamaAdptr │  │MockAdapter │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘ │
│        │               │               │               │        │
│        └───────────────┼───────────────┼───────────────┘        │
│                        │               │                        │
│              ┌─────────▼───────────────▼─────────┐              │
│              │      AdapterFactory               │              │
│              │  (provider selection + routing)   │              │
│              └─────────────────┬─────────────────┘              │
│                                │                                │
│                  ┌─────────────▼─────────────┐                  │
│                  │     ModelAdapter          │                  │
│                  │     Interface             │                  │
│                  └───────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Kernel Layer                               │
│                   (Authoritative, Deterministic)                 │
└─────────────────────────────────────────────────────────────────┘
```

## Files to Create/Modify

| Action | Path | Description |
|--------|------|-------------|
| CREATE | `src/adapters/claude.ts` | ClaudeAdapter implementation |
| CREATE | `src/adapters/openai.ts` | OpenAIAdapter implementation |
| CREATE | `src/adapters/ollama.ts` | OllamaAdapter implementation |
| CREATE | `src/adapters/factory.ts` | AdapterFactory implementation |
| MODIFY | `src/adapters/index.ts` | Export new adapters |
| CREATE | `src/adapters/tests/claude.test.ts` | Claude adapter tests |
| CREATE | `src/adapters/tests/openai.test.ts` | OpenAI adapter tests |
| CREATE | `src/adapters/tests/ollama.test.ts` | Ollama adapter tests |
| CREATE | `src/adapters/tests/factory.test.ts` | Factory tests |
| MODIFY | `package.json` | Add SDK dependencies |

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "openai": "^4.77.0"
  }
}
```

Note: Ollama uses HTTP API directly (no SDK needed).

## Environment Variables

```bash
# Required for ClaudeAdapter
ANTHROPIC_API_KEY=sk-ant-...

# Required for OpenAIAdapter
OPENAI_API_KEY=sk-proj-...
OPENAI_ORG_ID=org-...           # Optional

# Optional for OllamaAdapter
OLLAMA_BASE_URL=http://localhost:11434
```

## Test Requirements

### Unit Tests (mocked HTTP)

1. ClaudeAdapter serializes requests correctly
2. OpenAIAdapter serializes requests correctly
3. OllamaAdapter serializes requests correctly
4. Error mapping works (rate limit, timeout, etc.)
5. Factory selects correct adapter

### Integration Tests (live API, skipped in CI)

1. ClaudeAdapter makes successful call
2. OpenAIAdapter makes successful call
3. OllamaAdapter makes successful call (if running)
4. Recording + Replay produces identical results

### Determinism Tests

1. Same prompt + same model version = same response (temperature=0)
2. Recording captures all necessary state
3. Replay matches live call exactly

## Policy Considerations

Live model calls require explicit policy opt-in:

| Policy | Allowed Modes |
|--------|---------------|
| `strict` | `none` only |
| `default` | `none` only |
| `dev` | `none`, `record`, `replay`, `live` |

New mode `live` enables actual API calls without recording.

## Security Notes

- API keys from environment only (never hardcoded)
- Keys never appear in logs or recordings
- Recording files exclude raw prompts by default (hash only)
- Rate limiting at adapter level

## Success Criteria

| Metric | Target |
|--------|--------|
| All existing tests pass | 1095/1095 |
| New adapter tests pass | TBD (~50) |
| Golden hashes unchanged | 10/10 |
| Live API smoke test | Pass |
| Recording/replay determinism | 100% |

## Migration Path

1. Add SDK dependencies (non-breaking)
2. Create adapters (non-breaking)
3. Update factory to support new providers (non-breaking)
4. Add `live` mode to dev policy (non-breaking)
5. Documentation update
6. Tag v0.4.0

## Open Questions

1. **Token estimation**: Use tiktoken for pre-flight checks?
2. **Cost tracking**: Log costs per adapter call?
3. **Retry strategy**: Exponential backoff parameters?
4. **Streaming**: Buffer or pass through?

## References

- ROADMAP_v0.3.0.md - ModelAdapter introduction
- docs/MODEL_ADAPTER.md - Adapter usage guide
- KERNEL_DETERMINISM.md - Determinism invariants
- AI Periodic Table - Stack alignment
