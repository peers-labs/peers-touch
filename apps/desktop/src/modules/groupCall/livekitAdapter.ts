/**
 * LiveKit implementation of GroupCallProvider.
 *
 * Wraps `@livekit/livekit-client` (imported as `livekit-client`) and maps
 * its event model onto the project's provider interface so the manager
 * and UI never depend on LiveKit directly.
 */

import {
  Room,
  RoomEvent,
  ConnectionState,
  Participant as LKParticipant,
  ConnectionQuality,
  Track,
} from 'livekit-client';
import { log } from '../../utils/logger';
import type {
  GroupCallProvider,
  GroupCallConnectionState,
  Participant,
  ConnectionQualityGrade,
  Unsubscribe,
} from './types';

const TAG = 'groupCall.livekit';

// ── Quality mapping ─────────────────────────────────────────────────

function mapConnectionQuality(lkQuality: ConnectionQuality): ConnectionQualityGrade {
  switch (lkQuality) {
    case ConnectionQuality.Excellent:
      return 'excellent';
    case ConnectionQuality.Good:
      return 'good';
    case ConnectionQuality.Poor:
      return 'poor';
    case ConnectionQuality.Lost:
      return 'lost';
    default:
      return 'poor';
  }
}

// ── Participant snapshot ────────────────────────────────────────────

/** Build a `Participant` domain object from a LiveKit participant. */
function snapshotParticipant(lk: LKParticipant): Participant {
  return {
    actorPtid: lk.identity,
    isMicEnabled: lk.isMicrophoneEnabled,
    isCameraEnabled: lk.isCameraEnabled,
    isSpeaking: lk.isSpeaking,
    connectionQuality: mapConnectionQuality(lk.connectionQuality),
  };
}

// ── Adapter ─────────────────────────────────────────────────────────

export class LivekitAdapter implements GroupCallProvider {
  private room: Room | null = null;

  /** Registered teardown functions for LiveKit event listeners. */
  private roomListenerCleanups: Array<() => void> = [];

  /** External callbacks registered via `onParticipantChanged`. */
  private participantCbs = new Set<(participants: Participant[]) => void>();

  /** External callbacks registered via `onActiveSpeaker`. */
  private speakerCbs = new Set<(actorPtid: string) => void>();

  /** External callbacks registered via `onConnectionStateChanged`. */
  private connectionCbs = new Set<(state: GroupCallConnectionState) => void>();

  // ── Lifecycle ───────────────────────────────────────────────────

  async connect(url: string, token: string): Promise<void> {
    // Defensive: tear down a stale room if one exists.
    if (this.room) {
      this.cleanupRoom();
    }

    const room = new Room();
    this.room = room;
    this.attachRoomListeners(room);

    try {
      await room.connect(url, token);
      this.emitParticipants();
      this.emitConnectionState('connected');
      log.info(TAG, 'connected to room', { roomName: room.name });
    } catch (error) {
      log.error(TAG, 'failed to connect to room', { url, error });
      this.cleanupRoom();
      throw error;
    }
  }

  disconnect(): void {
    if (!this.room) return;
    log.info(TAG, 'disconnecting from room', { roomName: this.room.name });
    this.cleanupRoom();
  }

  // ── Event subscriptions ─────────────────────────────────────────

  onParticipantChanged(cb: (participants: Participant[]) => void): Unsubscribe {
    this.participantCbs.add(cb);
    return () => {
      this.participantCbs.delete(cb);
    };
  }

  onActiveSpeaker(cb: (actorPtid: string) => void): Unsubscribe {
    this.speakerCbs.add(cb);
    return () => {
      this.speakerCbs.delete(cb);
    };
  }

  onConnectionStateChanged(cb: (state: GroupCallConnectionState) => void): Unsubscribe {
    this.connectionCbs.add(cb);
    return () => {
      this.connectionCbs.delete(cb);
    };
  }

  attachParticipantMedia(
    actorPtid: string,
    videoElement: HTMLVideoElement | null,
    audioElement: HTMLAudioElement | null,
  ): Unsubscribe {
    const room = this.room;
    if (!room) return () => {};
    const participant = room.localParticipant.identity === actorPtid
      ? room.localParticipant
      : room.remoteParticipants.get(actorPtid);
    if (!participant) return () => {};

    const attached: Array<{ detach: (element?: HTMLMediaElement) => HTMLElement[]; element: HTMLMediaElement }> = [];
    const videoTrack = participant.getTrackPublication(Track.Source.Camera)?.track;
    if (videoTrack && videoElement) {
      videoElement.autoplay = true;
      videoElement.playsInline = true;
      videoTrack.attach(videoElement);
      attached.push({ detach: videoTrack.detach.bind(videoTrack), element: videoElement });
    }
    const audioTrack = participant.getTrackPublication(Track.Source.Microphone)?.track;
    if (
      audioTrack
      && audioElement
      && participant.identity !== room.localParticipant.identity
    ) {
      audioElement.autoplay = true;
      audioTrack.attach(audioElement);
      attached.push({ detach: audioTrack.detach.bind(audioTrack), element: audioElement });
    }

    return () => {
      for (const item of attached) item.detach(item.element);
    };
  }

  // ── Local track control ─────────────────────────────────────────

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!this.room) {
      log.warn(TAG, 'setMicEnabled called without an active room');
      return;
    }
    try {
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
    } catch (error) {
      log.error(TAG, 'setMicEnabled failed', { enabled, error });
      throw error;
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.room) {
      log.warn(TAG, 'setCameraEnabled called without an active room');
      return;
    }
    try {
      await this.room.localParticipant.setCameraEnabled(enabled);
    } catch (error) {
      log.error(TAG, 'setCameraEnabled failed', { enabled, error });
      throw error;
    }
  }

  // ── Internal ────────────────────────────────────────────────────

  /** Wire up LiveKit room events and translate them into provider
   *  callbacks. Every `room.on(...)` call is tracked so cleanup is
   *  deterministic. */
  private attachRoomListeners(room: Room): void {
    const on = <E extends RoomEvent>(event: E, handler: (...args: any[]) => void) => {
      room.on(event, handler);
      this.roomListenerCleanups.push(() => room.off(event, handler));
    };

    // Participant roster changes — any of these warrant a full re-snapshot.
    on(RoomEvent.ParticipantConnected, () => this.emitParticipants());
    on(RoomEvent.ParticipantDisconnected, () => this.emitParticipants());
    on(RoomEvent.TrackSubscribed, () => this.emitParticipants());
    on(RoomEvent.TrackUnsubscribed, () => this.emitParticipants());
    on(RoomEvent.TrackMuted, () => this.emitParticipants());
    on(RoomEvent.TrackUnmuted, () => this.emitParticipants());
    on(RoomEvent.ConnectionQualityChanged, () => this.emitParticipants());
    on(RoomEvent.ActiveSpeakersChanged, (speakers: LKParticipant[]) => {
      this.emitParticipants();
      if (speakers.length > 0) {
        const loudest = speakers[0].identity;
        for (const cb of this.speakerCbs) {
          try {
            cb(loudest);
          } catch (error) {
            log.warn(TAG, 'activeSpeaker callback threw', { error });
          }
        }
      }
    });

    // Connection state changes for diagnostics.
    on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      log.info(TAG, 'room connection state changed', { state });
      if (state === ConnectionState.Connected) {
        this.emitConnectionState('connected');
      } else if (state === ConnectionState.Reconnecting) {
        this.emitConnectionState('reconnecting');
      } else if (state === ConnectionState.Disconnected) {
        this.emitConnectionState('failed');
      }
    });

    on(RoomEvent.Disconnected, () => {
      log.info(TAG, 'room disconnected event');
      this.emitConnectionState('failed');
    });
  }

  private emitParticipants(): void {
    if (!this.room) return;
    const all = this.collectParticipants();
    for (const cb of this.participantCbs) {
      try {
        cb(all);
      } catch (error) {
        log.warn(TAG, 'participantChanged callback threw', { error });
      }
    }
  }

  private emitConnectionState(state: GroupCallConnectionState): void {
    for (const cb of this.connectionCbs) {
      try {
        cb(state);
      } catch (error) {
        log.warn(TAG, 'connectionState callback threw', { error });
      }
    }
  }

  /** Aggregate local + remote participants into domain snapshots. */
  private collectParticipants(): Participant[] {
    if (!this.room) return [];
    const result: Participant[] = [];
    // Local participant first.
    result.push(snapshotParticipant(this.room.localParticipant));
    // Remote participants.
    for (const remote of this.room.remoteParticipants.values()) {
      result.push(snapshotParticipant(remote));
    }
    return result;
  }

  /** Disconnect the room and remove all event listeners. */
  private cleanupRoom(): void {
    for (const cleanup of this.roomListenerCleanups) {
      try {
        cleanup();
      } catch {
        /* best-effort */
      }
    }
    this.roomListenerCleanups = [];

    if (this.room) {
      try {
        this.room.disconnect();
      } catch {
        /* best-effort */
      }
      this.room = null;
    }
  }
}
