/**
 * Group call types and provider interface.
 *
 * The provider abstraction decouples group call business logic from the
 * concrete SFU implementation (LiveKit today). Any future backend can
 * implement `GroupCallProvider` without touching the manager or the UI.
 */

// ── Domain types ────────────────────────────────────────────────────

/** A remote (or local) participant in a group call room. */
export interface Participant {
  /** The actor's Peers-Touch identity (PTID). */
  actorPtid: string;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isSpeaking: boolean;
  connectionQuality: ConnectionQualityGrade;
}

/** Coarse connection quality; maps 1-to-1 onto LiveKit's enum but kept
 *  as a plain union so the rest of the codebase never imports the SDK. */
export type ConnectionQualityGrade = 'excellent' | 'good' | 'poor' | 'lost';

/** Lifecycle state of the local user's participation in a group call. */
export type GroupCallState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/** Provider connectivity states that affect the product lifecycle. */
export type GroupCallConnectionState = 'connected' | 'reconnecting' | 'failed';

/** Convenience alias for listener teardown functions. */
export type Unsubscribe = () => void;

// ── SSE event payloads ──────────────────────────────────────────────

/** Payload shape for ROOM_ACTIVE / ROOM_ENDED SSE events. */
export interface GroupCallSignalPayload {
  /** The group this call belongs to. */
  groupUlid: string;
  /** LiveKit room name assigned by Station. */
  roomName: string;
}

// ── Join response ───────────────────────────────────────────────────

/** Station response for `POST /group-call/join`. */
export interface GroupCallJoinResponse {
  url: string;
  token: string;
  room_name: string;
}

// ── State snapshot ──────────────────────────────────────────────────

/** Full observable snapshot of the local group-call session. The manager
 *  emits a fresh copy on every state transition; consumers should spread
 *  into React state (`useState({...snapshot})`) for reliable re-renders. */
export interface GroupCallSnapshot {
  state: GroupCallState;
  /** ULID of the group the call belongs to; empty when idle. */
  groupUlid: string;
  /** LiveKit room name; empty when idle. */
  roomName: string;
  /** All participants (including local) currently in the room. */
  participants: Participant[];
  /** PTID of the loudest current speaker, if any. */
  activeSpeakerPtid: string | null;
  /** Whether the local user's microphone is enabled. */
  localMicEnabled: boolean;
  /** Whether the local user's camera is enabled. */
  localCameraEnabled: boolean;
}

/** Factory for the initial idle snapshot. */
export function createIdleSnapshot(): GroupCallSnapshot {
  return {
    state: 'idle',
    groupUlid: '',
    roomName: '',
    participants: [],
    activeSpeakerPtid: null,
    localMicEnabled: true,
    localCameraEnabled: false,
  };
}

// ── Provider interface ──────────────────────────────────────────────

/**
 * Abstract backend for group call media transport.
 *
 * Implementations handle room connection, track management, and
 * participant observation. The manager consumes this interface without
 * knowing whether the underlying SFU is LiveKit, Janus, or anything
 * else. All methods that can fail return Promises; synchronous helpers
 * (disconnect) are fire-and-forget by design.
 */
export interface GroupCallProvider {
  /** Connect to an SFU room. Resolves once the transport is established
   *  and the local participant has joined. */
  connect(url: string, token: string): Promise<void>;

  /** Disconnect from the current room and release all resources.
   *  Safe to call when already disconnected. */
  disconnect(): void;

  /** Subscribe to participant list changes. The callback receives the
   *  full list (including local) whenever any participant's tracks,
   *  connection quality, or speaking state changes. */
  onParticipantChanged(cb: (participants: Participant[]) => void): Unsubscribe;

  /** Subscribe to active-speaker changes. Fires with the PTID of the
   *  loudest participant; consumers can highlight that tile. */
  onActiveSpeaker(cb: (actorPtid: string) => void): Unsubscribe;

  /** Subscribe to provider connectivity changes. */
  onConnectionStateChanged(cb: (state: GroupCallConnectionState) => void): Unsubscribe;

  /** Attach the participant's current camera and audio tracks to UI
   *  elements without exposing provider-specific track objects. */
  attachParticipantMedia(
    actorPtid: string,
    videoElement: HTMLVideoElement | null,
    audioElement: HTMLAudioElement | null,
  ): Unsubscribe;

  /** Enable or disable the local microphone track. */
  setMicEnabled(enabled: boolean): Promise<void>;

  /** Enable or disable the local camera track. */
  setCameraEnabled(enabled: boolean): Promise<void>;
}
