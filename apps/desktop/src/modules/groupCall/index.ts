/**
 * Group call module — public API surface.
 *
 * Re-exports the singleton manager and all types needed by consumers
 * (UI components, other modules). Implementation details (LiveKit
 * adapter internals, provider wiring) are intentionally excluded.
 */

export { groupCallManager } from './groupCallManager';
export { LivekitAdapter } from './livekitAdapter';
export type {
  GroupCallProvider,
  GroupCallSnapshot,
  GroupCallState,
  GroupCallConnectionState,
  GroupCallSignalPayload,
  GroupCallJoinResponse,
  Participant,
  ConnectionQualityGrade,
  Unsubscribe,
} from './types';
export { createIdleSnapshot } from './types';
