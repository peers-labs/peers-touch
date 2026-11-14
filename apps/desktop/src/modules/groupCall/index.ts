/**
 * Group call module — public API surface.
 *
 * Re-exports the singleton manager and all types needed by consumers
 * (UI components, other modules). Implementation details (LiveKit
 * adapter internals, provider wiring) are intentionally excluded.
 */

export { groupCallManager, groupCallAdmissionProbe } from './groupCallManager';
export { LivekitAdapter } from '@peers-touch/client-chat-core/group-call/livekit';
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
} from '@peers-touch/client-chat-core/group-call';
export { createIdleSnapshot } from '@peers-touch/client-chat-core/group-call';
