# Roadmap: v0.3.0 - ModelAdapter Boundary

## Overview

v0.3.0 introduces the **ModelAdapter** abstraction, decoupling the context engine kernel from any specific AI model implementation. This enables:

1. Model-agnostic intent processing
2. Deterministic replay with recorded model responses
3. Testing without live model calls
4. Multi-model orchestration

## Current State (v0.2.1)

- Kernel: Decomposition, assembly, validation (deterministic)
- Harness: Sandbox execution, evidence collection, policy enforcement
- Tests: 193 passing (170 kernel + 23 harness)
- Goldens: 10 real intents with stable hashes

## Goals for v0.3.0

### G1: Define ModelAdapter Interface

Create a clean boundary between kernel logic and model invocation:

```typescript
interface ModelAdapter {
  // Core transform capability
  transform(prompt: string, context: TransformContext): Promise<TransformResult>;

  // Model identification for audit trails
  readonly model_id: string;

  // Capabilities declaration
  readonly capabilities: ModelCapabilities;
}

interface TransformContext {
  intent_id: string;
  run_id: string;
  mode: 'plan-only' | 'execute' | 'clarify';
  constraints: readonly string[];
}

interface TransformResult {
  content: string;
  tokens_used: number;
  latency_ms: number;
  model_version: string;
}

interface ModelCapabilities {
  max_context_tokens: number;
  supports_structured_output: boolean;
  supports_tool_use: boolean;
}
```

### G2: Implement Mock Adapter for Testing

```typescript
class MockModelAdapter implements ModelAdapter {
  constructor(private responses: Map<string, TransformResult>);

  // Returns pre-recorded responses for deterministic testing
  async transform(prompt: string, context: TransformContext): Promise<TransformResult>;
}
```

### G3: Implement Recording Adapter

```typescript
class RecordingModelAdapter implements ModelAdapter {
  constructor(private delegate: ModelAdapter);

  // Records all interactions for replay
  async transform(prompt: string, context: TransformContext): Promise<TransformResult>;

  // Save recorded interactions
  saveRecording(path: string): Promise<void>;
}
```

### G4: Implement Replay Adapter

```typescript
class ReplayModelAdapter implements ModelAdapter {
  constructor(recordingPath: string);

  // Replays recorded interactions deterministically
  async transform(prompt: string, context: TransformContext): Promise<TransformResult>;
}
```

## Non-Goals for v0.3.0

- Actual integration with Claude, GPT-4, or other models (deferred to v0.4.0)
- Multi-model routing logic
- Cost optimization
- Rate limiting

## Architecture Changes

### Before (v0.2.x)

```
Intent -> Decomposer -> Assembler -> Validator -> Bundle
                                                    |
                                                    v
                                              [No model calls]
```

### After (v0.3.0)

```
Intent -> Decomposer -> [ModelAdapter] -> Assembler -> Validator -> Bundle
                              ^
                              |
                    MockAdapter (tests)
                    RecordingAdapter (capture)
                    ReplayAdapter (determinism)
```

## Files to Create/Modify

| Action | Path | Description |
|--------|------|-------------|
| CREATE | `src/adapters/model.ts` | ModelAdapter interface and types |
| CREATE | `src/adapters/mock.ts` | MockModelAdapter implementation |
| CREATE | `src/adapters/recording.ts` | RecordingModelAdapter implementation |
| CREATE | `src/adapters/replay.ts` | ReplayModelAdapter implementation |
| CREATE | `src/adapters/index.ts` | Adapter exports |
| MODIFY | `src/harness/run_intent.ts` | Accept ModelAdapter parameter |
| MODIFY | `src/harness/types.ts` | Add adapter field to HarnessRunInput |
| CREATE | `src/tests/adapter.test.ts` | Adapter unit tests |
| CREATE | `src/tests/replay-determinism.test.ts` | Replay determinism tests |

## Test Requirements

### Unit Tests

1. MockModelAdapter returns expected responses
2. RecordingModelAdapter captures all interactions
3. ReplayModelAdapter reproduces recorded sessions exactly
4. Adapter interface validates correctly

### Integration Tests

1. Harness works with MockAdapter
2. Record-then-replay produces identical results
3. Different mock responses produce different bundle hashes

### Determinism Tests

1. Same recording + same intent = same bundle hash (100 runs)
2. Replay across Node versions (24.x series)
3. Replay across platforms (Linux, macOS)

## Migration Path

1. Add ModelAdapter interface (non-breaking)
2. Create adapters (non-breaking)
3. Update harness to optionally accept adapter (backward compatible)
4. Default to MockAdapter in tests
5. Update golden suite to use explicit MockAdapter

## Success Criteria

| Metric | Target |
|--------|--------|
| All existing tests pass | 193/193 |
| New adapter tests pass | TBD (estimate: 20-30) |
| Golden hashes unchanged | 10/10 |
| Replay determinism | 100% |
| No kernel source changes | Yes |

## Timeline (Blocked on v0.2.1 External Verification)

This roadmap is on hold until v0.2.1 receives at least one external verification report. Once verified:

1. Create feature branch: `feature/model-adapter`
2. Implement interfaces and types
3. Implement MockAdapter
4. Update harness
5. Add tests
6. Implement Recording/Replay adapters
7. Full test suite
8. Tag v0.3.0

## Open Questions

1. **Prompt hashing**: Should prompt content be hashed for cache keys?
2. **Streaming**: Should adapters support streaming responses?
3. **Error mapping**: How should model errors map to kernel decisions?
4. **Token counting**: Should adapters handle token estimation?

## References

- KERNEL_DETERMINISM.md - Determinism invariants
- GOVERNANCE.md - Change governance
- docs/VERIFY_RELEASE.md - Verification process
