import { createCallId } from '../callId.js';
import { MediaReservation } from '../mediaReservation.js';
import {
  createIdleSnapshot,
  type GroupCallErrorCode, type GroupCallJoinResponse, type GroupCallMediaKind,
  type GroupCallProvider, type GroupCallRoomEvent, type GroupCallSnapshot, type GroupCallMediaStats, type Unsubscribe,
} from './types.js';

export interface GroupCallPorts {
  join(groupUlid: string, signal: AbortSignal): Promise<GroupCallJoinResponse>;
  iceServers(signal: AbortSignal): Promise<RTCIceServer[]>;
  createProvider(): Promise<GroupCallProvider>;
  reservation: MediaReservation;
}

interface Attempt {
  abort: AbortController;
  release: Unsubscribe;
  provider?: GroupCallProvider;
  unsubs: Unsubscribe[];
  setup?: Promise<void>;
  controls: Promise<void>;
  cleanup?: Promise<void>;
}

export class GroupCallController {
  private snapshot = createIdleSnapshot();
  private attempt: Attempt | null = null;
  private listeners = new Set<(snapshot: GroupCallSnapshot) => void>();
  private roomListeners = new Set<(event: GroupCallRoomEvent) => void>();

  constructor(private readonly ports: GroupCallPorts) {}

  getSnapshot(): GroupCallSnapshot { return this.snapshot; }
  onSnapshot(cb: (snapshot: GroupCallSnapshot) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  onRoomEvent(cb: (event: GroupCallRoomEvent) => void): Unsubscribe {
    this.roomListeners.add(cb);
    return () => { this.roomListeners.delete(cb); };
  }

  async joinGroupCall(groupUlid: string, mediaKind: GroupCallMediaKind = 'audio'): Promise<void> {
    if (this.attempt || !groupUlid) throw new Error('call.mediaAlreadyOccupied');
    const release = this.ports.reservation.acquire('group', createCallId());
    const attempt: Attempt = {
      abort: new AbortController(), release, unsubs: [], controls: Promise.resolve(),
    };
    this.attempt = attempt;
    this.update({ ...createIdleSnapshot(), state: 'connecting', groupUlid, mediaKind });
    const timeout = setTimeout(() => {
      if (this.current(attempt)) void this.finish(attempt, 'network').catch(() => undefined);
    }, 30_000);
    attempt.setup = this.setup(attempt, groupUlid, mediaKind);
    try {
      await attempt.setup;
      this.check(attempt);
      this.update({ state: 'connected', startedAt: Date.now(), localMicEnabled: true, localCameraEnabled: mediaKind === 'video' });
    } catch (error) {
      if (this.current(attempt)) await this.finish(attempt, groupCallErrorCode(error));
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async leaveGroupCall(): Promise<void> {
    if (this.attempt) await this.finish(this.attempt);
    else this.update(createIdleSnapshot());
  }
  setMicEnabled(enabled: boolean): Promise<void> {
    return this.control('microphone', enabled);
  }
  setCameraEnabled(enabled: boolean): Promise<void> {
    return this.control('camera', enabled);
  }
  attachParticipantMedia(id: string, video: HTMLVideoElement | null, audio: HTMLAudioElement | null): Unsubscribe {
    return this.attempt?.provider?.attachParticipantMedia(id, video, audio) ?? (() => {});
  }
  readMediaStats(): Promise<GroupCallMediaStats> {
    return this.attempt?.provider?.readMediaStats() ?? Promise.resolve({
      connected: false, roomSid: '', participantSid: '', canPublish: false,
      canSubscribe: false, localLiveTracks: 0, tracks: [],
    });
  }
  ingestRoomEvent(event: GroupCallRoomEvent): void {
    // SSE is a room-list hint. Only the current SDK connection can end local
    // media; an old room_finished delivery must not close a later join.
    this.roomListeners.forEach((listener) => listener(event));
  }

  private async setup(attempt: Attempt, groupUlid: string, mediaKind: GroupCallMediaKind): Promise<void> {
    const signal = attempt.abort.signal;
    const [grant, iceServers, provider] = await Promise.all([
      this.ports.join(groupUlid, signal), this.ports.iceServers(signal),
      this.ports.createProvider().then((value) => { attempt.provider = value; return value; }),
    ]);
    this.check(attempt);
    if (!grant.url || !grant.token || !grant.room_name || !grant.grant_id ||
      grant.participant_identity !== `gce-${grant.grant_id}`) throw new Error('call.grantUnavailable');
    this.update({ roomName: grant.room_name });
    attempt.unsubs = [
      provider.onParticipantChanged((participants) => {
        if (!this.current(attempt)) return;
        const local = participants.find((participant) => participant.isLocal);
        this.update({
          participants: participants.map((participant) => ({ ...participant })),
          localMicEnabled: local?.isMicEnabled ?? false,
          localCameraEnabled: local?.isCameraEnabled ?? false,
          mediaRevision: this.snapshot.mediaRevision + 1,
        });
      }),
      provider.onActiveSpeaker((activeSpeakerPtid) => {
        if (this.current(attempt)) this.update({ activeSpeakerPtid });
      }),
      provider.onConnectionStateChanged((state) => {
        if (!this.current(attempt)) return;
        if (state === 'failed') void this.finish(attempt, 'network').catch(() => undefined);
        else if (this.snapshot.state !== 'connecting') this.update({ state });
      }),
    ];
    await provider.connect(grant.url, grant.token, { iceServers });
    this.check(attempt);
    await provider.setMicEnabled(true);
    this.check(attempt);
    await provider.setCameraEnabled(mediaKind === 'video');
    this.check(attempt);
  }

  private async control(kind: 'microphone' | 'camera', enabled: boolean): Promise<void> {
    const attempt = this.attempt;
    if (!attempt || !['connected', 'reconnecting'].includes(this.snapshot.state)) return;
    const pending = attempt.controls.then(async () => {
      this.check(attempt);
      this.update({ pendingControl: kind, errorCode: undefined });
      try {
        if (kind === 'camera') await attempt.provider!.setCameraEnabled(enabled);
        else await attempt.provider!.setMicEnabled(enabled);
        this.check(attempt);
        this.update(kind === 'camera' ? { localCameraEnabled: enabled } : { localMicEnabled: enabled });
      } catch (error) {
        if (this.current(attempt)) this.update({ errorCode: groupCallErrorCode(error) });
        throw error;
      } finally {
        if (this.current(attempt)) this.update({ pendingControl: undefined });
      }
    });
    attempt.controls = pending.catch(() => undefined);
    return pending;
  }

  private finish(attempt: Attempt, errorCode?: GroupCallErrorCode): Promise<void> {
    if (attempt.cleanup) return attempt.cleanup;
    attempt.abort.abort();
    attempt.unsubs.splice(0).forEach((unsub) => unsub());
    this.update({ state: 'leaving', pendingControl: undefined });
    attempt.cleanup = (async () => {
      // Disconnect now to abort SDK connect/capture; then drain late work.
      await attempt.provider?.disconnect();
      await Promise.allSettled([attempt.setup, attempt.controls]);
      await attempt.provider?.disconnect();
      if (this.attempt !== attempt) return;
      attempt.release();
      this.attempt = null;
      this.update(errorCode ? {
        state: 'failed', errorCode, participants: [], activeSpeakerPtid: null,
        localMicEnabled: false, localCameraEnabled: false,
      } : createIdleSnapshot());
    })().catch((error) => {
      attempt.cleanup = undefined;
      if (this.attempt === attempt) this.update({ state: 'leaving', errorCode: 'unavailable' });
      throw error;
    });
    return attempt.cleanup;
  }
  private current(attempt: Attempt): boolean { return this.attempt === attempt && !attempt.abort.signal.aborted; }
  private check(attempt: Attempt): void {
    if (!this.current(attempt)) throw new DOMException('Call canceled', 'AbortError');
  }
  private update(patch: Partial<GroupCallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}

export function groupCallErrorCode(error: unknown): GroupCallErrorCode {
  const value = error as { name?: string; status?: number; message?: string };
  if (value?.name === 'NotAllowedError' || value?.name === 'PermissionDeniedError') return 'permission';
  if (value?.status === 401 || value?.status === 403) return 'membership';
  if (value?.status === 429 || value?.message?.includes('capacity')) return 'capacity';
  if (value?.status === 503) return 'unavailable';
  if (value?.message?.includes('Occupied')) return 'busy';
  if (value?.name === 'NotFoundError' || value?.name === 'NotReadableError') return 'media';
  if (value?.message?.includes('Unavailable')) return 'unavailable';
  return 'network';
}
