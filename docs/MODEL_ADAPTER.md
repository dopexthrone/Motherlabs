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

## Future Integration

When model integration is added to the kernel:

1. Adapters will be instantiated based on `model_mode`
2. Kernel will call adapter for transformations
3. Recording will capture all model I/O for replay
4. Golden suite will use replay for deterministic verification

## Security Notes

- Recording files may contain sensitive prompts
- Use `include_prompts: false` option to redact
- Never commit recordings with sensitive data
- Model API keys must never appear in recordings
