import {
  Room, RoomEvent, EngineEvent, ConnectionState, ConnectionQuality, Track,
  type Participant as LivekitParticipant,
} from 'livekit-client';
import type {
  ConnectionQualityGrade, GroupCallConnectionState, GroupCallProvider, GroupCallMediaStats, Participant, Unsubscribe,
} from './types.js';

function quality(value: ConnectionQuality): ConnectionQualityGrade {
  if (value === ConnectionQuality.Excellent) return 'excellent';
  if (value === ConnectionQuality.Good) return 'good';
  if (value === ConnectionQuality.Lost) return 'lost';
  return 'poor';
}

function actorIdentity(participant: LivekitParticipant): string {
  try {
    const metadata = JSON.parse(participant.metadata ?? '{}') as { actorPtid?: unknown };
    if (typeof metadata.actorPtid === 'string' && metadata.actorPtid) return metadata.actorPtid;
  } catch { /* No authenticated display metadata yet. */ }
  return participant.identity;
}

export class LivekitAdapter implements GroupCallProvider {
  private room: Room | null = null;
  private connectTask: Promise<void> | null = null;
  private controls = new Set<Promise<unknown>>();
  private listenerCleanups: Unsubscribe[] = [];
  private attachments = new Set<Unsubscribe>();
  private participantCbs = new Set<(participants: Participant[]) => void>();
  private speakerCbs = new Set<(actorPtid: string | null) => void>();
  private connectionCbs = new Set<(state: GroupCallConnectionState) => void>();
  private cleanupTask: Promise<void> | null = null;
  private admissionCancel: (() => void) | null = null;
  private admittedRoom: Room | null = null;
  private refreshedTokenCbs = new Set<(token: string) => void>();

  /** Native Harness diagnostics; credentials never enter media observations. */
  onTokenRefreshed(cb: (token: string) => void): Unsubscribe {
    this.refreshedTokenCbs.add(cb);
    return () => { this.refreshedTokenCbs.delete(cb); };
  }

  async requestSignalReconnect(): Promise<void> {
    const room = this.room;
    if (!room || this.admittedRoom !== room) throw new Error('call.mediaUnavailable');
    // This closes the SDK's actual signal transport and runs its real resume
    // path. No connection state or participant projection is injected.
    await room.simulateScenario('signal-reconnect');
  }

  async connect(url: string, token: string, rtcConfig?: RTCConfiguration): Promise<void> {
    await this.disconnect();
    const room = new Room({ publishDefaults: { stopMicTrackOnMute: true } });
    this.room = room;
    this.attachListeners(room);
    const task = (async () => {
      await room.connect(url, token, { rtcConfig });
      await this.waitForAdmission(room);
    })();
    this.connectTask = task;
    try {
      await task;
      if (this.room !== room) {
        await room.disconnect(true);
        throw new DOMException('Call canceled', 'AbortError');
      }
      this.emitParticipants(room);
    } catch (error) {
      // Do not await disconnect's wait for this same connect task.
      await room.disconnect(true);
      if (this.room === room) {
        this.room = null;
        this.clearListeners();
      }
      throw error;
    } finally {
      if (this.connectTask === task) this.connectTask = null;
    }
  }

  disconnect(): Promise<void> {
    if (this.cleanupTask) return this.cleanupTask;
    const room = this.room;
    if (!room) return Promise.resolve();
    const connection = this.connectTask;
    const controls = [...this.controls];
    this.room = null;
    this.admittedRoom = null;
    this.admissionCancel?.();
    this.clearListeners();
    for (const detach of [...this.attachments]) detach();
    // Stop capture before waiting for slow pending operations.
    room.localParticipant.trackPublications.forEach((publication) => publication.track?.stop());
    const cleanup = (async () => {
      await room.disconnect(true);
      await Promise.allSettled([...(connection ? [connection] : []), ...controls]);
      // A capture/connect that finished late must also be stopped.
      room.localParticipant.trackPublications.forEach((publication) => publication.track?.stop());
      await room.disconnect(true);
    })();
    this.cleanupTask = cleanup.catch((error) => {
      // Keep the room addressable so the owner can retry failed cleanup.
      this.room = room;
      throw error;
    }).finally(() => { this.cleanupTask = null; });
    return this.cleanupTask;
  }

  onParticipantChanged(cb: (participants: Participant[]) => void): Unsubscribe {
    this.participantCbs.add(cb);
    return () => { this.participantCbs.delete(cb); };
  }
  onActiveSpeaker(cb: (actorPtid: string | null) => void): Unsubscribe {
    this.speakerCbs.add(cb);
    return () => { this.speakerCbs.delete(cb); };
  }
  onConnectionStateChanged(cb: (state: GroupCallConnectionState) => void): Unsubscribe {
    this.connectionCbs.add(cb);
    return () => { this.connectionCbs.delete(cb); };
  }

  attachParticipantMedia(id: string, video: HTMLVideoElement | null, audio: HTMLAudioElement | null): Unsubscribe {
    const room = this.room;
    const participant = room?.localParticipant.identity === id
      ? room.localParticipant : room?.remoteParticipants.get(id);
    if (!participant || !room) return () => {};
    const cleanups: Unsubscribe[] = [];
    const camera = participant.getTrackPublication(Track.Source.Camera)?.track;
    if (camera && video) {
      video.autoplay = true;
      video.playsInline = true;
      video.muted = participant === room.localParticipant;
      camera.attach(video);
      cleanups.push(() => { camera.detach(video); video.srcObject = null; });
    }
    const microphone = participant.getTrackPublication(Track.Source.Microphone)?.track;
    if (microphone && audio && participant !== room.localParticipant) {
      audio.autoplay = true;
      microphone.attach(audio);
      cleanups.push(() => { microphone.detach(audio); audio.srcObject = null; });
    }
    const detach = () => {
      cleanups.splice(0).forEach((cleanup) => cleanup());
      this.attachments.delete(detach);
    };
    this.attachments.add(detach);
    return detach;
  }

  setMicEnabled(enabled: boolean): Promise<void> {
    return this.control((room) => room.localParticipant.setMicrophoneEnabled(enabled));
  }
  setCameraEnabled(enabled: boolean): Promise<void> {
    return this.control((room) => room.localParticipant.setCameraEnabled(enabled));
  }
  async readMediaStats(): Promise<GroupCallMediaStats> {
    const room = this.room;
    const stats: GroupCallMediaStats = {
      connected: room?.state === ConnectionState.Connected,
      roomSid: room?.state === ConnectionState.Connected ? await room.getSid() : '',
      participantSid: room?.localParticipant.sid ?? '',
      canPublish: room?.localParticipant.permissions?.canPublish === true,
      canSubscribe: room?.localParticipant.permissions?.canSubscribe === true,
      localLiveTracks: 0, tracks: [],
    };
    if (!room) return stats;
    for (const participant of [room.localParticipant, ...room.remoteParticipants.values()]) {
      for (const publication of participant.trackPublications.values()) {
        const track = publication.track;
        if (!track) continue;
        if (participant === room.localParticipant && track.mediaStreamTrack.readyState === 'live') {
          stats.localLiveTracks++;
        }
        const report = await track.getRTCStatsReport();
        report?.forEach((row) => {
          if (row.type !== 'inbound-rtp' && row.type !== 'outbound-rtp') return;
          const kind = row.kind ?? row.mediaType;
          if (kind !== 'audio' && kind !== 'video') return;
          stats.tracks.push({
            participantId: participant.identity, actorPtid: actorIdentity(participant),
            trackSid: publication.trackSid, kind,
            direction: row.type === 'inbound-rtp' ? 'inbound' : 'outbound',
            bytes: Number(row.bytesReceived ?? row.bytesSent ?? 0),
            packets: Number(row.packetsReceived ?? row.packetsSent ?? 0),
            frames: Number(row.framesDecoded ?? row.framesEncoded ?? 0),
          });
        });
      }
    }
    if (this.room !== room) return {
      connected: false, roomSid: '', participantSid: '', canPublish: false,
      canSubscribe: false, localLiveTracks: 0, tracks: [],
    };
    return stats;
  }
  private async control(operation: (room: Room) => Promise<unknown>): Promise<void> {
    const room = this.room;
    if (!room) throw new Error('call.mediaUnavailable');
    if (!room.localParticipant.permissions?.canPublish || !room.localParticipant.permissions.canSubscribe) {
      throw new Error('call.grantUnavailable');
    }
    const pending = operation(room);
    this.controls.add(pending);
    try {
      await pending;
      if (this.room !== room) {
        room.localParticipant.trackPublications.forEach((publication) => publication.track?.stop());
        throw new DOMException('Call canceled', 'AbortError');
      }
      this.emitParticipants(room);
    } finally { this.controls.delete(pending); }
  }

  private waitForAdmission(room: Room): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (timer) clearTimeout(timer);
        room.off(RoomEvent.ParticipantPermissionsChanged, check);
        room.off(RoomEvent.ConnectionStateChanged, check);
        if (this.admissionCancel === cancel) this.admissionCancel = null;
        if (error) reject(error); else { this.admittedRoom = room; resolve(); }
      };
      const cancel = () => finish(new DOMException('Call canceled', 'AbortError'));
      const check = () => {
        if (this.room !== room || room.state === ConnectionState.Disconnected) return cancel();
        const permissions = room.localParticipant.permissions;
        if (permissions?.canPublish && permissions.canSubscribe) finish();
      };
      this.admissionCancel = cancel;
      room.on(RoomEvent.ParticipantPermissionsChanged, check);
      room.on(RoomEvent.ConnectionStateChanged, check);
      timer = setTimeout(() => finish(new Error('call.mediaUnavailable')), 20_000);
      check();
    });
  }

  private attachListeners(room: Room): void {
    const refreshed = (token: string) => {
      if (this.room === room && this.admittedRoom === room) {
        this.refreshedTokenCbs.forEach((cb) => cb(token));
      }
    };
    room.engine.on(EngineEvent.TokenRefreshed, refreshed);
    this.listenerCleanups.push(() => { room.engine.off(EngineEvent.TokenRefreshed, refreshed); });
    const roster = () => { if (this.room === room) this.emitParticipants(room); };
    for (const event of [
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished, RoomEvent.ConnectionQualityChanged,
      RoomEvent.ParticipantMetadataChanged,
      RoomEvent.ParticipantPermissionsChanged,
    ]) {
      room.on(event, roster);
      this.listenerCleanups.push(() => { room.off(event, roster); });
    }
    const speakers = (participants: LivekitParticipant[]) => {
      if (this.room !== room) return;
      this.emitParticipants(room);
      this.speakerCbs.forEach((cb) => cb(participants[0] ? actorIdentity(participants[0]) : null));
    };
    room.on(RoomEvent.ActiveSpeakersChanged, speakers);
    this.listenerCleanups.push(() => { room.off(RoomEvent.ActiveSpeakersChanged, speakers); });
    const permission = () => {
      if (this.room !== room || this.admittedRoom !== room) return;
      if (room.localParticipant.permissions?.canPublish && room.localParticipant.permissions.canSubscribe) return;
      room.localParticipant.trackPublications.forEach((publication) => publication.track?.stop());
      this.connectionCbs.forEach((cb) => cb('failed'));
    };
    room.on(RoomEvent.ParticipantPermissionsChanged, permission);
    this.listenerCleanups.push(() => { room.off(RoomEvent.ParticipantPermissionsChanged, permission); });
    const state = (value: ConnectionState) => {
      if (this.room !== room) return;
      if (value === ConnectionState.Connected && this.admittedRoom === room) {
        if (!room.localParticipant.permissions?.canPublish || !room.localParticipant.permissions.canSubscribe) {
          permission();
          return;
        }
        this.connectionCbs.forEach((cb) => cb('connected'));
      }
      if (value === ConnectionState.Reconnecting || value === ConnectionState.SignalReconnecting) {
        this.connectionCbs.forEach((cb) => cb('reconnecting'));
      }
      if (value === ConnectionState.Disconnected) this.connectionCbs.forEach((cb) => cb('failed'));
    };
    room.on(RoomEvent.ConnectionStateChanged, state);
    this.listenerCleanups.push(() => { room.off(RoomEvent.ConnectionStateChanged, state); });
  }
  private emitParticipants(room: Room): void {
    const participants = [room.localParticipant, ...room.remoteParticipants.values()]
      .filter((value) => value.permissions?.canPublish && value.permissions.canSubscribe).map((value) => ({
      participantId: value.identity, actorPtid: actorIdentity(value), isLocal: value === room.localParticipant,
      isMicEnabled: value.isMicrophoneEnabled, isCameraEnabled: value.isCameraEnabled,
      isSpeaking: value.isSpeaking, connectionQuality: quality(value.connectionQuality),
    }));
    this.participantCbs.forEach((cb) => cb(participants));
  }
  private clearListeners(): void { this.listenerCleanups.splice(0).forEach((cleanup) => cleanup()); }
}
