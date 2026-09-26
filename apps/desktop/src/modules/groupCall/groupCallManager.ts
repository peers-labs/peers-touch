/**
 * Group call state manager.
 *
 * Owns the lifecycle of a single active group call: joining via Station,
 * connecting through the provider, observing participants, and reacting
 * to SSE room events. Only one group call may be active at a time.
 *
 * The manager is intentionally framework-agnostic (no React imports).
 * UI layers subscribe via `onSnapshot` and receive immutable copies.
 */

import { api } from '../../services/desktop_api';
import { eventBus } from '../../kernel/events/bus';
import { EVENT } from '../../kernel/events/catalog';
import { log } from '../../utils/logger';
import type {
  GroupCallProvider,
  GroupCallSnapshot,
  GroupCallJoinResponse,
  Participant,
  Unsubscribe,
} from './types';
import { createIdleSnapshot } from './types';
import { LivekitAdapter } from './livekitAdapter';

const TAG = 'groupCall.manager';

type SnapshotListener = (snapshot: GroupCallSnapshot) => void;

/**
 * Listener type for room-level SSE notifications that the UI can use
 * to show a "join call" affordance on groups with an active room, even
 * when the local user has not joined yet.
 */
type RoomEventListener = (event: {
  kind: 'room_active' | 'room_ended';
  groupUlid: string;
  roomName: string;
}) => void;

class GroupCallManager {
  private provider: GroupCallProvider;
  private snapshot: GroupCallSnapshot;
  private snapshotListeners = new Set<SnapshotListener>();
  private roomEventListeners = new Set<RoomEventListener>();
  private providerUnsubs: Unsubscribe[] = [];
  private sseUnsub: Unsubscribe | null = null;

  constructor(provider?: GroupCallProvider) {
    this.provider = provider ?? new LivekitAdapter();
    this.snapshot = createIdleSnapshot();
    this.subscribeToSSE();
  }

  // ── Public API ────────────────────────────────────────────────────

  /** Current snapshot; cheap to call — returns the cached reference. */
  getSnapshot(): GroupCallSnapshot {
    return this.snapshot;
  }

  /** Subscribe to snapshot changes. Returns an unsubscribe function. */
  onSnapshot(listener: SnapshotListener): Unsubscribe {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  /** Subscribe to room-level SSE events (ROOM_ACTIVE / ROOM_ENDED).
   *  Useful for rendering "call in progress" banners on groups the
   *  local user has not joined. */
  onRoomEvent(listener: RoomEventListener): Unsubscribe {
    this.roomEventListeners.add(listener);
    return () => {
      this.roomEventListeners.delete(listener);
    };
  }

  /**
   * Join a group call.
   *
   * 1. POST to Station `/group-call/join` to obtain SFU credentials.
   * 2. Connect to the SFU via the provider.
   * 3. Begin observing participants.
   *
   * Rejects if the user is already in a call (single-call invariant).
   */
  async joinGroupCall(
    groupUlid: string,
    mediaKind: 'audio' | 'video' = 'audio',
  ): Promise<void> {
    if (this.snapshot.state !== 'idle' && this.snapshot.state !== 'failed') {
      log.warn(TAG, 'joinGroupCall: already in a call', {
        currentState: this.snapshot.state,
        currentGroup: this.snapshot.groupUlid,
      });
      throw new Error('Already in a group call — leave the current call first');
    }

    this.updateSnapshot({ state: 'connecting', groupUlid });

    // Step 1: Obtain SFU credentials from Station.
    let joinResp: GroupCallJoinResponse;
    try {
      joinResp = await api.groupCallJoin({ group_ulid: groupUlid });
    } catch (error) {
      log.error(TAG, 'Station group-call/join failed', { groupUlid, error });
      this.updateSnapshot({ state: 'failed' });
      throw error;
    }

    const { url, token, room_name: roomName } = joinResp;
    this.updateSnapshot({ roomName });

    // Step 2: Connect to the SFU.
    this.attachProviderListeners();
    try {
      await this.provider.connect(url, token);
      await this.provider.setMicEnabled(true);
      await this.provider.setCameraEnabled(mediaKind === 'video');
    } catch (error) {
      log.error(TAG, 'provider connect failed', { roomName, error });
      this.detachProviderListeners();
      this.provider.disconnect();
      this.updateSnapshot({ state: 'failed' });
      throw error;
    }

    this.updateSnapshot({
      state: 'connected',
      localMicEnabled: true,
      localCameraEnabled: mediaKind === 'video',
    });
    log.info(TAG, 'joined group call', { groupUlid, roomName });
  }

  /** Leave the current group call and reset to idle. Safe to call when
   *  already idle. */
  leaveGroupCall(): void {
    if (this.snapshot.state === 'idle') return;

    log.info(TAG, 'leaving group call', {
      groupUlid: this.snapshot.groupUlid,
      roomName: this.snapshot.roomName,
    });

    this.detachProviderListeners();
    this.provider.disconnect();
    this.snapshot = createIdleSnapshot();
    this.emitSnapshot();
  }

  /** Toggle the local microphone. */
  async setMicEnabled(enabled: boolean): Promise<void> {
    if (this.snapshot.state !== 'connected' && this.snapshot.state !== 'reconnecting') {
      log.warn(TAG, 'setMicEnabled: not in an active call');
      return;
    }
    await this.provider.setMicEnabled(enabled);
    this.updateSnapshot({ localMicEnabled: enabled });
  }

  /** Toggle the local camera. */
  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (this.snapshot.state !== 'connected' && this.snapshot.state !== 'reconnecting') {
      log.warn(TAG, 'setCameraEnabled: not in an active call');
      return;
    }
    await this.provider.setCameraEnabled(enabled);
    this.updateSnapshot({ localCameraEnabled: enabled });
  }

  attachParticipantMedia(
    actorPtid: string,
    videoElement: HTMLVideoElement | null,
    audioElement: HTMLAudioElement | null,
  ): Unsubscribe {
    return this.provider.attachParticipantMedia(actorPtid, videoElement, audioElement);
  }

  /** Tear down everything — call this on app unmount. */
  destroy(): void {
    this.leaveGroupCall();
    if (this.sseUnsub) {
      this.sseUnsub();
      this.sseUnsub = null;
    }
    this.snapshotListeners.clear();
    this.roomEventListeners.clear();
  }

  // ── Provider event wiring ─────────────────────────────────────────

  private attachProviderListeners(): void {
    this.detachProviderListeners();

    const unsubParticipants = this.provider.onParticipantChanged(
      (participants: Participant[]) => {
        this.updateSnapshot({ participants });
      },
    );

    const unsubSpeaker = this.provider.onActiveSpeaker(
      (actorPtid: string) => {
        this.updateSnapshot({ activeSpeakerPtid: actorPtid });
      },
    );

    const unsubConnection = this.provider.onConnectionStateChanged((state) => {
      if (this.snapshot.state === 'idle') return;
      this.updateSnapshot({ state });
    });

    this.providerUnsubs = [unsubParticipants, unsubSpeaker, unsubConnection];
  }

  private detachProviderListeners(): void {
    for (const unsub of this.providerUnsubs) {
      try {
        unsub();
      } catch {
        /* best-effort */
      }
    }
    this.providerUnsubs = [];
  }

  // ── SSE event handling ────────────────────────────────────────────

  private subscribeToSSE(): void {
    // Listen for group-call related SSE events via the existing
    // REALTIME_CALL_SIGNAL channel. The payload carries `group_ulid`
    // and `room_name` for kinds ROOM_ACTIVE (10) and ROOM_ENDED (11).
    this.sseUnsub = eventBus.subscribe(
      EVENT.REALTIME_CALL_SIGNAL,
      (payload: any) => {
        this.handleSSECallSignal(payload);
      },
    );
  }

  private handleSSECallSignal(payload: any): void {
    // Group-call SSE events carry `group_ulid` and `room_name`.
    // The `kind` field (numeric or string) distinguishes the event type.
    const groupUlid = payload?.group_ulid || payload?.groupUlid;
    const roomName = payload?.room_name || payload?.roomName;
    if (!groupUlid || !roomName) return;

    const kind = payload?.kind;

    if (kind === 10 || kind === 'ROOM_ACTIVE') {
      this.handleRoomActive(groupUlid, roomName);
    } else if (kind === 11 || kind === 'ROOM_ENDED') {
      this.handleRoomEnded(groupUlid, roomName);
    }
  }

  private handleRoomActive(groupUlid: string, roomName: string): void {
    log.info(TAG, 'SSE: room active', { groupUlid, roomName });
    for (const listener of this.roomEventListeners) {
      try {
        listener({ kind: 'room_active', groupUlid, roomName });
      } catch (error) {
        log.warn(TAG, 'roomEvent listener threw', { error });
      }
    }
  }

  private handleRoomEnded(groupUlid: string, roomName: string): void {
    log.info(TAG, 'SSE: room ended', { groupUlid, roomName });

    // If the local user is in this room, tear down.
    if (
      this.snapshot.roomName === roomName &&
      this.snapshot.state !== 'idle'
    ) {
      log.info(TAG, 'room ended while user was in call — leaving', {
        groupUlid,
        roomName,
      });
      this.detachProviderListeners();
      this.provider.disconnect();
      this.snapshot = createIdleSnapshot();
      this.emitSnapshot();
    }

    for (const listener of this.roomEventListeners) {
      try {
        listener({ kind: 'room_ended', groupUlid, roomName });
      } catch (error) {
        log.warn(TAG, 'roomEvent listener threw', { error });
      }
    }
  }

  // ── Snapshot management ───────────────────────────────────────────

  private updateSnapshot(patch: Partial<GroupCallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    const frozen = { ...this.snapshot };
    for (const listener of this.snapshotListeners) {
      try {
        listener(frozen);
      } catch (error) {
        log.warn(TAG, 'snapshot listener threw', { error });
      }
    }
  }
}

/** Singleton manager instance — mirrors the `callP2p` pattern from
 *  `modules/p2p/callP2p.ts`. */
export const groupCallManager = new GroupCallManager();
