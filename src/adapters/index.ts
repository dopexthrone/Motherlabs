/**
 * Adapter Exports
 * ===============
 *
 * Re-export all adapter types and implementations.
 */

// Types and interface
export type {
  ModelAdapter,
  ModelCapabilities,
  TransformContext,
  TransformMode,
  TransformResult,
  AdapterErrorCode,
  RecordedInteraction,
  RecordingSession,
} from './model.js';

export { AdapterError } from './model.js';

// Mock adapter
export type {
  MockResponse,
  MockDefaultBehavior,
  MockModelAdapterOptions,
} from './mock.js';

export {
  MockModelAdapter,
  createEchoAdapter,
  createFixedAdapter,
  createAdapterFromRecording,
} from './mock.js';

// Recording and replay adapters
export type {
  RecordingModelAdapterOptions,
  ReplayModelAdapterOptions,
} from './recording.js';

export {
  RecordingModelAdapter,
  ReplayModelAdapter,
  loadReplayAdapter,
} from './recording.js';
