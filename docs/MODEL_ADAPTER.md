# Model Adapter Guide

The ModelAdapter abstraction decouples the context engine kernel from AI model implementations. This enables deterministic replay, testing without live model calls, and model-agnostic intent processing.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Harness Layer                         │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │ MockAdapter   │  │RecordAdapter  │  │ ReplayAdapter │   │
│  │ (tests)       │  │ (capture)     │  │ (determinism) │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                │
│              ┌─────────────▼─────────────┐                  │
│              │     ModelAdapter          │                  │
│              │     Interface             │                  │
│              └───────────────────────────┘                  │
│                            │                                │
│         ┌──────────────────┼──────────────────┐             │
│         │                  │                  │             │
│  ┌──────▼──────┐  ┌───────▼───────┐  ┌──────▼──────┐      │
│  │ClaudeAdapter│  │OpenAIAdapter  │  │GeminiAdapter│      │
│  │ (Anthropic) │  │ (OpenAI)      │  │ (Google)    │      │
│  └─────────────┘  └───────────────┘  └─────────────┘      │
│         │                                                   │
│  ┌──────▼──────┐  ┌───────────────────────────────┐        │
│  │OllamaAdapter│  │ ResilientAdapter (wrapper)    │        │
│  │ (Local)     │  │ - Circuit breaker             │        │
│  └─────────────┘  │ - Retry with backoff          │        │
│                   └───────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                       Kernel Layer                           │
│                   (Authoritative, Deterministic)             │
└─────────────────────────────────────────────────────────────┘
```

## Model Mode

The harness supports three model modes:

| Mode | Description | Policy Requirement |
|------|-------------|-------------------|
| `none` | No model calls (kernel-only) | All policies |
| `record` | Record model interactions | `dev` policy only |
| `replay` | Replay recorded interactions | `dev` policy only |

### Policy Enforcement

**Strict and Default policies** enforce `model_mode=none`:
- This is a safety constraint
- Live model calls require explicit opt-in via `dev` policy
- Prevents accidental network calls in CI/production

**Dev policy** allows all modes:
- Used for local development and testing
- Recording captures model responses for later replay
- Replay ensures deterministic test execution

## Usage

### Command Line

```bash
# Default: no model calls (strict policy)
npm run dogfood -- intents/real/intent_001.json --policy strict

# Record mode (dev policy required)
npm run dogfood -- intents/real/intent_001.json \
  --policy dev \
  --model-mode record \
  --model-recording recordings/session_001.json

# Replay mode (deterministic)
npm run dogfood -- intents/real/intent_001.json \
  --policy dev \
  --model-mode replay \
  --model-recording recordings/session_001.json
```

### Programmatic

```typescript
import { runHarness } from './harness/run_intent.js';

// No model calls (default)
const result1 = await runHarness({
  intent_path: 'intents/real/intent_001.json',
  mode: 'plan-only',
  policy: 'strict',
  // model_mode defaults to 'none'
});

// Record mode
const result2 = await runHarness({
  intent_path: 'intents/real/intent_001.json',
  mode: 'plan-only',
  policy: 'dev',
  model_mode: 'record',
  model_recording_path: 'recordings/session_001.json',
});

// Replay mode
const result3 = await runHarness({
  intent_path: 'intents/real/intent_001.json',
  mode: 'plan-only',
  policy: 'dev',
  model_mode: 'replay',
  model_recording_path: 'recordings/session_001.json',
});
```

## Adapter Types

### MockModelAdapter

For testing with pre-configured responses:

```typescript
import { MockModelAdapter, createEchoAdapter, createFixedAdapter } from './adapters/index.js';

// Echo adapter - returns prompt as response
const echo = createEchoAdapter();

// Fixed adapter - always returns same content
const fixed = createFixedAdapter('Fixed response');

// Custom responses by prompt hash
const responses = new Map([
  ['sha256_of_prompt', { content: 'response' }],
]);
const mock = new MockModelAdapter(responses);
```

### RecordingModelAdapter

Wraps another adapter and records all interactions:

```typescript
import { RecordingModelAdapter } from './adapters/index.js';

const delegate = createEchoAdapter();
const recorder = new RecordingModelAdapter(delegate);

// Use recorder instead of delegate
await recorder.transform(prompt, context);

// Export recording
const session = recorder.exportSession();
await recorder.saveRecording('recordings/session.json');
```

### ReplayModelAdapter

Replays recorded interactions deterministically:

```typescript
import { ReplayModelAdapter, loadReplayAdapter } from './adapters/index.js';

// Load from file
const replay = await loadReplayAdapter('recordings/session.json');

// Replays recorded response (zero latency, deterministic)
const result = await replay.transform(prompt, context);
```

## Live Model Adapters

### ClaudeAdapter (Anthropic)

```typescript
import { ClaudeAdapter, createClaudeAdapter } from './adapters/index.js';

// Simple creation
const claude = createClaudeAdapter();

// With options
const claude = new ClaudeAdapter({
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0,
  max_tokens: 4096,
});
```

Requires `ANTHROPIC_API_KEY` environment variable.

### OpenAIAdapter

```typescript
import { OpenAIAdapter, createOpenAIAdapter } from './adapters/index.js';

const openai = createOpenAIAdapter();

// With specific model
const openai = new OpenAIAdapter({
  model: 'gpt-4o',
  temperature: 0,
});
```

Requires `OPENAI_API_KEY` environment variable.

### GeminiAdapter (Google)

```typescript
import { GeminiAdapter, createGeminiAdapter } from './adapters/index.js';

const gemini = createGeminiAdapter();

// With specific model
const gemini = new GeminiAdapter({
  model: 'gemini-2.0-flash',
  temperature: 0,
});
```

Requires `GOOGLE_API_KEY` or `GEMINI_API_KEY` environment variable.

### OllamaAdapter (Local)

```typescript
import { OllamaAdapter, createOllamaAdapter, isOllamaAvailable } from './adapters/index.js';

// Check if Ollama is running
if (await isOllamaAvailable()) {
  const ollama = createOllamaAdapter();
}

// With specific model
const ollama = new OllamaAdapter({
  model: 'llama3.3',
  host: 'http://localhost:11434',
});
```

Requires Ollama running locally.

## Factory Functions

### createAdapter

Create adapters by provider name:

```typescript
import { createAdapter } from './adapters/index.js';

const adapter = createAdapter({
  provider: 'anthropic',  // 'openai' | 'google' | 'ollama' | 'mock'
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0,
});
```

### createAdapterWithFallback

Create adapter with automatic fallback:

```typescript
import { createAdapterWithFallback } from './adapters/index.js';

const adapter = createAdapterWithFallback({
  provider: 'anthropic',
  fallback_provider: 'openai',
  fallback_model: 'gpt-4o',
});
```

### createAutoAdapter

Auto-detect best available adapter:

```typescript
import { createAutoAdapter } from './adapters/index.js';

// Tries: Ollama -> Gemini -> OpenAI -> Claude -> Mock
const adapter = await createAutoAdapter();
```

### createProductionAdapter

Production-ready adapter with resilience:

```typescript
import { createProductionAdapter } from './adapters/index.js';

const adapter = createProductionAdapter({
  provider: 'anthropic',
  fallback_provider: 'openai',
});
// Includes circuit breaker + retry with exponential backoff
```

## Resilience Patterns

### ResilientAdapter

Wraps any adapter with fault tolerance:

```typescript
import { createResilientAdapter } from './adapters/index.js';

const resilient = createResilientAdapter({
  provider: 'anthropic',
  circuit_config: {
    failureThreshold: 5,    // Open after 5 failures
    resetTimeout: 30000,     // Try recovery after 30s
    successThreshold: 2,     // Close after 2 successes
  },
  retry_config: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: 0.1,
  },
});

// Get resilience stats
const stats = resilient.getResilienceStats();
console.log(stats.circuit.state);  // 'closed' | 'open' | 'half-open'
```

### Circuit Breaker States

| State | Description |
|-------|-------------|
| `closed` | Normal operation, requests pass through |
| `open` | Failures exceeded threshold, requests rejected |
| `half-open` | Recovery mode, limited requests allowed |

## Streaming Support

For adapters that support streaming:

```typescript
import { isStreamingAdapter, simulateStream, collectStream } from './adapters/index.js';

// Check if adapter supports streaming
if (isStreamingAdapter(adapter)) {
  // Native streaming
  for await (const chunk of adapter.transformStream(prompt, context)) {
    console.log(chunk.content);
  }
}

// Simulate streaming for non-streaming adapters
for await (const chunk of simulateStream(adapter, prompt, context)) {
  console.log(chunk.content);
}

// Collect full result from stream
const result = await collectStream(adapter.transformStream(prompt, context));
```

## Evidence Logging

When `model_mode` is `record`, model interactions are logged to:

```
artifacts/harness/out/<run_id>/model_io.jsonl
```

Each line is a JSON object:

```json
{
  "sequence": 0,
  "timestamp": "2026-01-05T00:00:00.000Z",
  "request_sha256": "abc123...",
  "model_id": "mock",
  "parameters": {
    "prompt_length": 150,
    "context_intent_id": "intent_001",
    "context_mode": "plan-only"
  },
  "raw_response": "...",
  "response_sha256": "def456...",
  "tokens": { "input": 40, "output": 80 },
  "latency_ms": 150
}
```

## Determinism Guarantees

1. **Same recording + same intent = same bundle hash** (100 runs)
2. **Replay zeroes latency** - timing has no effect on results
3. **Replay across platforms** - Linux and macOS produce identical hashes

## Default Behavior

- **model_mode** defaults to `none`
- **No live model calls** by default
- Strict/default policies reject non-none modes
- All current kernel processing is rule-based (no model calls needed)

## AI Agent System

The `CodingAgent` uses adapters for code generation:

```typescript
import { createCodingAgent } from './agent/index.js';

const agent = createCodingAgent({
  adapter,
  mode: 'autonomous',
  auto_style: true,
  auto_security: true,
  enable_rag: true,
});

const result = await agent.generate({
  prompt: 'Implement a function to validate email addresses',
  language: 'typescript',
});
```

See `src/agent/` for the full agent system documentation.

## Security Notes

- Recording files may contain sensitive prompts
- Use `include_prompts: false` option to redact
- Never commit recordings with sensitive data
- Model API keys must never appear in recordings
