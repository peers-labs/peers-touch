import type { MobileAuthSession } from '../auth/authSession';
import type { RealtimeWireEvent } from '../social/socialWire';
import {
  messagingCallSignalOpen,
  messagingCallSignalSeal,
  messagingStatus,
  type MobileCallSignalKind,
} from '../../services/mobileCommands';
import {
  executeStationOperation,
  responseJson,
  type StationTransportResponse,
} from '../../services/stationTransport';

export type CallStateLifecycle =
  | 'idle'
  | 'ringing_all_devices'
  | 'outgoing'
  | 'incoming'
  | 'active_here'
  | 'reconnecting'
  | 'handled_elsewhere'
  | 'ended';

export type CallMediaKind = 'audio' | 'video';

export type CallEndReason =
  | 'hangup'
  | 'rejected'
  | 'no-answer'
  | 'busy'
  | 'canceled'
  | 'media-failed'
  | 'network-failed'
  | 'handled-elsewhere';

export interface CallSnapshot {
  callId: string;
  mediaKind: CallMediaKind;
  state: CallStateLifecycle;
  startedAt?: number;
  endReason?: CallEndReason;
  peerPtid: string;
  winningDeviceId?: string;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  micMuted?: boolean;
  cameraOff?: boolean;
}

export type CallStateListener = (snapshot: CallSnapshot | null) => void;

interface ActiveCall {
  direction: 'incoming' | 'outgoing';
  signalingSessionId: string;
  snapshot: CallSnapshot;
  peerConnection: RTCPeerConnection | null;
  pendingCandidates: RTCIceCandidateInit[];
  remoteDescriptionApplied: boolean;
}

interface CallResolutionWire {
  call_id?: string;
  state?: string;
  winning_device_id?: string;
  terminal_action?: string;
}

const RING_TIMEOUT_MS = 45_000;
const RECONNECT_TIMEOUT_MS = 20_000;

export class MobileCallManager {
  private session: MobileAuthSession | null = null;
  private deviceId = '';
  private call: ActiveCall | null = null;
  private listeners = new Set<CallStateListener>();
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private operationTail: Promise<void> = Promise.resolve();

  subscribe(listener: CallStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): CallSnapshot | null {
    return this.call ? { ...this.call.snapshot } : null;
  }

  async activate(session: MobileAuthSession): Promise<void> {
    if (
      this.session
      && (
        this.session.stationPeerId !== session.stationPeerId
        || this.session.actorRef.ptid !== session.actorRef.ptid
      )
    ) {
      this.reset();
    }
    this.session = session;
    const status = await messagingStatus();
    if (
      !status.active
      || status.stationPeerId !== session.stationPeerId
      || status.actorPtid !== session.actorRef.ptid
      || !status.deviceId
    ) {
      throw new Error('mobile.call.messagingEndpointUnavailable');
    }
    this.deviceId = status.deviceId;
  }

  suspend(): void {
    if (this.call?.snapshot.state === 'active_here') {
      this.call.snapshot = { ...this.call.snapshot, state: 'reconnecting' };
      this.emit();
    }
  }

  async resume(): Promise<void> {
    if (!this.call?.snapshot.callId) return;
    await this.enqueue(() => this.reconcileResolution(this.call!.snapshot.callId));
  }

  ingestRealtimeSignal(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
  ): Promise<void> {
    return this.enqueue(() => this.handleSignal(event));
  }

  startOutgoingCall(
    peerPtid: string,
    mediaKind: CallMediaKind,
  ): Promise<CallSnapshot> {
    return this.enqueue(async () => {
      this.requireIdle();
      const session = this.requireSession();
      const callId = newCallId();
      const signalingSessionId = deriveSignalingSessionId(
        session.actorRef.ptid,
        peerPtid,
      );
      const localStream = await acquireMedia(mediaKind);
      this.call = {
        direction: 'outgoing',
        signalingSessionId,
        snapshot: {
          callId,
          mediaKind,
          state: 'outgoing',
          peerPtid,
          localStream,
        },
        peerConnection: null,
        pendingCandidates: [],
        remoteDescriptionApplied: false,
      };
      this.emit();
      try {
        await this.sendSignal(
          'CALL_REQUEST',
          { callId, kind: mediaKind },
          callId,
        );
      } catch (error) {
        this.endLocal('network-failed');
        throw error;
      }
      this.armRingTimeout(callId);
      return this.getSnapshot()!;
    });
  }

  acceptCall(): Promise<CallSnapshot | null> {
    return this.enqueue(async () => {
      const call = this.call;
      if (!call || !isIncoming(call.snapshot.state)) return null;
      const { callId, mediaKind } = call.snapshot;
      this.clearRingTimeout();
      try {
        await this.sendSignal('CALL_ACCEPT', { callId }, callId);
      } catch (error) {
        if (this.call?.snapshot.state !== 'handled_elsewhere') {
          this.armRingTimeout(callId);
        }
        throw error;
      }
      call.snapshot = {
        ...call.snapshot,
        state: 'active_here',
        startedAt: Date.now(),
        winningDeviceId: this.deviceId,
      };
      this.emit();
      try {
        const localStream = await acquireMedia(mediaKind);
        call.snapshot = { ...call.snapshot, localStream };
        await this.ensurePeerConnection(call);
        this.attachLocalTracks(call);
        this.emit();
      } catch (error) {
        await this.sendSignal('CALL_END', { callId, reason: 'media-failed' }, callId)
          .catch(() => undefined);
        this.endLocal('media-failed');
        throw error;
      }
      return this.getSnapshot();
    });
  }

  rejectCall(reason = 'declined'): Promise<CallSnapshot | null> {
    return this.enqueue(async () => {
      const call = this.call;
      if (!call || !isIncoming(call.snapshot.state)) return null;
      const callId = call.snapshot.callId;
      await this.sendSignal('CALL_REJECT', { callId, reason }, callId);
      call.snapshot = {
        ...call.snapshot,
        winningDeviceId: this.deviceId,
      };
      this.endLocal(reason === 'busy' ? 'busy' : 'rejected');
      return this.getSnapshot();
    });
  }

  endCall(): Promise<CallSnapshot | null> {
    return this.enqueue(async () => {
      const call = this.call;
      if (!call || call.snapshot.state === 'idle' || call.snapshot.state === 'ended') {
        return this.getSnapshot();
      }
      const reason: CallEndReason =
        call.snapshot.state === 'active_here' || call.snapshot.state === 'reconnecting'
          ? 'hangup'
          : 'canceled';
      await this.sendSignal(
        'CALL_END',
        { callId: call.snapshot.callId, reason },
        call.snapshot.callId,
      ).catch(() => undefined);
      this.endLocal(reason);
      return this.getSnapshot();
    });
  }

  toggleMicrophone(): void {
    const call = this.call;
    if (!call?.snapshot.localStream) return;
    const muted = !call.snapshot.micMuted;
    call.snapshot.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    call.snapshot = { ...call.snapshot, micMuted: muted };
    this.emit();
  }

  toggleCamera(): void {
    const call = this.call;
    if (!call?.snapshot.localStream || call.snapshot.mediaKind !== 'video') return;
    const cameraOff = !call.snapshot.cameraOff;
    call.snapshot.localStream.getVideoTracks().forEach((track) => {
      track.enabled = !cameraOff;
    });
    call.snapshot = { ...call.snapshot, cameraOff };
    this.emit();
  }

  async readResolution(callId: string): Promise<CallSnapshot | null> {
    await this.enqueue(() => this.reconcileResolution(callId));
    return this.getSnapshot();
  }

  dismiss(): void {
    if (this.call && isTerminal(this.call.snapshot.state)) {
      this.releaseMedia();
      this.call = null;
      this.emit();
    }
  }

  reset(): void {
    this.clearRingTimeout();
    this.clearReconnectTimeout();
    this.releaseMedia();
    this.call = null;
    this.session = null;
    this.deviceId = '';
    this.emit();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async handleSignal(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
  ): Promise<void> {
    const session = this.requireSession();
    if (
      event.signalKind === 'CALL_NO_ANSWER'
      && event.callId
      && this.call?.snapshot.callId === event.callId
    ) {
      this.endLocal('no-answer');
      return;
    }
    if (event.fromActorPtid === session.actorRef.ptid) {
      if (
        event.callId
        && this.call?.snapshot.callId === event.callId
        && (event.signalKind === 'CALL_ACCEPT' || event.signalKind === 'CALL_REJECT')
        && event.winningDeviceId
        && event.winningDeviceId !== this.deviceId
      ) {
        this.markHandledElsewhere(event.winningDeviceId);
      }
      return;
    }

    if (
      this.call
      && (
        this.call.signalingSessionId !== event.sessionUlid
        || this.call.snapshot.peerPtid !== event.fromActorPtid
      )
    ) {
      return;
    }

    const plaintext = await messagingCallSignalOpen({
      stationPeerId: session.stationPeerId,
      actorPtid: session.actorRef.ptid,
      peerPtid: event.fromActorPtid,
      sessionUlid: event.sessionUlid,
      kind: event.signalKind,
      payload: [...event.payload],
    });
    const payload = parseSignalPayload(plaintext);

    switch (event.signalKind) {
      case 'CALL_REQUEST':
        await this.handleIncomingRequest(event, payload);
        return;
      case 'CALL_ACCEPT':
        await this.handleRemoteAccept(event, payload);
        return;
      case 'CALL_REJECT':
        this.handleRemoteReject(event, payload);
        return;
      case 'CALL_END':
      case 'HANGUP':
        this.handleRemoteEnd(event, payload);
        return;
      case 'OFFER':
        await this.handleOffer(event, payload);
        return;
      case 'ANSWER':
        await this.handleAnswer(event, payload);
        return;
      case 'CANDIDATE':
        await this.handleCandidate(event, payload);
    }
  }

  private async handleIncomingRequest(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const callId = stringValue(payload.callId) || event.callId;
    if (!callId) throw new Error('mobile.call.callIdMissing');
    if (this.call && !isTerminal(this.call.snapshot.state)) {
      await this.sendSignalFor(
        event.fromActorPtid,
        event.sessionUlid,
        'CALL_REJECT',
        { callId, reason: 'busy' },
        callId,
      );
      return;
    }
    this.call = {
      direction: 'incoming',
      signalingSessionId: event.sessionUlid,
      snapshot: {
        callId,
        mediaKind: payload.kind === 'video' ? 'video' : 'audio',
        state: 'ringing_all_devices',
        peerPtid: event.fromActorPtid,
      },
      peerConnection: null,
      pendingCandidates: [],
      remoteDescriptionApplied: false,
    };
    this.emit();
    this.armRingTimeout(callId);
  }

  private async handleRemoteAccept(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const call = this.call;
    const callId = stringValue(payload.callId) || event.callId;
    if (!call || call.direction !== 'outgoing' || call.snapshot.callId !== callId) return;
    this.clearRingTimeout();
    call.snapshot = {
      ...call.snapshot,
      state: 'active_here',
      startedAt: Date.now(),
      winningDeviceId: event.winningDeviceId || undefined,
    };
    await this.ensurePeerConnection(call);
    this.attachLocalTracks(call);
    this.emit();
    const offer = await call.peerConnection!.createOffer();
    await call.peerConnection!.setLocalDescription(offer);
    await this.sendSignal('OFFER', {
      callId,
      sdp: offer.sdp ?? '',
    });
  }

  private handleRemoteReject(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
    payload: Record<string, unknown>,
  ): void {
    const callId = stringValue(payload.callId) || event.callId;
    if (!this.call || this.call.snapshot.callId !== callId) return;
    const reason = payload.reason === 'busy'
      ? 'busy'
      : payload.reason === 'media-failed'
        ? 'media-failed'
        : 'rejected';
    this.endLocal(reason);
  }

  private handleRemoteEnd(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
    payload: Record<string, unknown>,
  ): void {
    const callId = stringValue(payload.callId) || event.callId;
    if (!this.call || this.call.snapshot.callId !== callId) return;
    const reason = this.call.snapshot.state === 'active_here'
      || this.call.snapshot.state === 'reconnecting'
      ? 'hangup'
      : 'no-answer';
    this.endLocal(reason);
  }

  private async handleOffer(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const call = this.call;
    const sdp = stringValue(payload.sdp);
    if (!call || call.snapshot.peerPtid !== event.fromActorPtid || !sdp) return;
    await this.ensurePeerConnection(call);
    await call.peerConnection!.setRemoteDescription({ type: 'offer', sdp });
    call.remoteDescriptionApplied = true;
    await this.flushPendingCandidates(call);
    const answer = await call.peerConnection!.createAnswer();
    await call.peerConnection!.setLocalDescription(answer);
    await this.sendSignal('ANSWER', {
      callId: call.snapshot.callId,
      sdp: answer.sdp ?? '',
    });
  }

  private async handleAnswer(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const call = this.call;
    const sdp = stringValue(payload.sdp);
    if (!call?.peerConnection || call.snapshot.peerPtid !== event.fromActorPtid || !sdp) return;
    await call.peerConnection.setRemoteDescription({ type: 'answer', sdp });
    call.remoteDescriptionApplied = true;
    await this.flushPendingCandidates(call);
  }

  private async handleCandidate(
    event: Extract<RealtimeWireEvent, { kind: 'call-signal' }>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const call = this.call;
    const candidate = stringValue(payload.candidate);
    if (!call || call.snapshot.peerPtid !== event.fromActorPtid || !candidate) return;
    const init: RTCIceCandidateInit = {
      candidate,
      sdpMid: stringValue(payload.mid) || undefined,
      sdpMLineIndex: numberValue(payload.mline),
    };
    if (!call.peerConnection || !call.remoteDescriptionApplied) {
      call.pendingCandidates.push(init);
      return;
    }
    await call.peerConnection.addIceCandidate(init);
  }

  private async ensurePeerConnection(call: ActiveCall): Promise<void> {
    if (call.peerConnection) return;
    const session = this.requireSession();
    const response = await executeStationOperation(session, {
      operationId: 'turn_ice_servers',
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`mobile.call.iceServersUnavailable.${response.status}`);
    }
    const body = responseJson(response) as {
      ice_servers?: RTCIceServer[];
      iceServers?: RTCIceServer[];
    };
    const peerConnection = new RTCPeerConnection({
      iceServers: body.ice_servers ?? body.iceServers ?? [],
    });
    call.peerConnection = peerConnection;
    peerConnection.onicecandidate = (iceEvent) => {
      if (!iceEvent.candidate) return;
      void this.enqueue(() => this.sendSignal('CANDIDATE', {
        callId: call.snapshot.callId,
        candidate: iceEvent.candidate!.candidate,
        mid: iceEvent.candidate!.sdpMid ?? '',
        mline: iceEvent.candidate!.sdpMLineIndex ?? 0,
      })).catch(() => {
        this.endLocal('network-failed');
      });
    };
    peerConnection.ontrack = (trackEvent) => {
      const remoteStream = call.snapshot.remoteStream ?? new MediaStream();
      if (!remoteStream.getTracks().some((track) => track.id === trackEvent.track.id)) {
        remoteStream.addTrack(trackEvent.track);
      }
      call.snapshot = { ...call.snapshot, remoteStream };
      this.emit();
    };
    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'connected') {
        this.clearReconnectTimeout();
        if (call.snapshot.state === 'reconnecting') {
          call.snapshot = { ...call.snapshot, state: 'active_here' };
          this.emit();
        }
      } else if (
        peerConnection.connectionState === 'disconnected'
        || peerConnection.connectionState === 'failed'
      ) {
        this.enterReconnect(call);
      }
    };
  }

  private attachLocalTracks(call: ActiveCall): void {
    if (!call.peerConnection || !call.snapshot.localStream) return;
    const existing = new Set(
      call.peerConnection.getSenders().map((sender) => sender.track?.id).filter(Boolean),
    );
    call.snapshot.localStream.getTracks().forEach((track) => {
      if (!existing.has(track.id)) {
        call.peerConnection!.addTrack(track, call.snapshot.localStream!);
      }
    });
  }

  private async flushPendingCandidates(call: ActiveCall): Promise<void> {
    if (!call.peerConnection || !call.remoteDescriptionApplied) return;
    const pending = call.pendingCandidates.splice(0);
    for (const candidate of pending) {
      await call.peerConnection.addIceCandidate(candidate);
    }
  }

  private async sendSignal(
    kind: MobileCallSignalKind,
    payload: Readonly<Record<string, unknown>>,
    callId = '',
  ): Promise<void> {
    const call = this.call;
    if (!call) throw new Error('mobile.call.notActive');
    const effectiveCallId = callId || call.snapshot.callId;
    await this.sendSignalFor(
      call.snapshot.peerPtid,
      call.signalingSessionId,
      kind,
      payload,
      effectiveCallId,
    );
  }

  private async sendSignalFor(
    peerPtid: string,
    signalingSessionId: string,
    kind: MobileCallSignalKind,
    payload: Readonly<Record<string, unknown>>,
    callId = '',
  ): Promise<void> {
    const session = this.requireSession();
    const payloadBase64 = await messagingCallSignalSeal({
      stationPeerId: session.stationPeerId,
      actorPtid: session.actorRef.ptid,
      peerPtid,
      sessionUlid: signalingSessionId,
      kind,
      plaintext: JSON.stringify(payload),
    });
    const response = await executeStationOperation(session, {
      operationId: 'realtime_signal_send',
      recipient_ptid: peerPtid,
      session_ulid: signalingSessionId,
      kind,
      payload_b64: payloadBase64,
      call_id: callId,
      device_id: callId ? this.requireDeviceId() : '',
    });
    if ((response.status < 200 || response.status >= 300) && callId) {
      const resolution = await this.reconcileResolution(callId).catch(() => null);
      if (
        resolution?.winning_device_id === this.deviceId
        && (
          (kind === 'CALL_ACCEPT' && resolution.terminal_action === 'accept')
          || (kind === 'CALL_REJECT' && resolution.terminal_action === 'reject')
        )
      ) {
        return;
      }
      if (response.status === 409) {
        throw new Error('mobile.call.alreadyHandled');
      }
      throw new Error(`mobile.call.signalFailed.${response.status}`);
    }
  }

  private async reconcileResolution(
    callId: string,
  ): Promise<CallResolutionWire | null> {
    const session = this.requireSession();
    const call = this.call;
    if (!call || call.snapshot.callId !== callId) return null;
    const response = await executeStationOperation(session, {
      operationId: 'realtime_call_resolution_get',
      call_id: callId,
      peer_actor_ptid: call.snapshot.peerPtid,
    });
    if (response.status === 404 || response.status === 409) return null;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`mobile.call.resolutionUnavailable.${response.status}`);
    }
    await this.applyResolutionResponse(response, callId);
    return responseJson(response) as CallResolutionWire;
  }

  private async applyResolutionResponse(
    response: StationTransportResponse,
    callId: string,
  ): Promise<void> {
    const resolution = responseJson(response) as CallResolutionWire;
    const call = this.call;
    if (!call || call.snapshot.callId !== callId) return;
    const winningDeviceId = resolution.winning_device_id ?? '';
    if (resolution.state === 'NO_ANSWER') {
      this.endLocal('no-answer');
      return;
    }
    if (call.direction === 'incoming' && winningDeviceId && winningDeviceId !== this.deviceId) {
      this.markHandledElsewhere(winningDeviceId);
      return;
    }
    if (resolution.state === 'REJECTED') {
      call.snapshot = {
        ...call.snapshot,
        winningDeviceId: winningDeviceId || undefined,
      };
      this.endLocal('rejected');
      return;
    }
    if (
      resolution.state === 'ACCEPTED'
      && call.direction === 'outgoing'
      && call.snapshot.state === 'outgoing'
    ) {
      this.clearRingTimeout();
      call.snapshot = {
        ...call.snapshot,
        state: 'active_here',
        startedAt: call.snapshot.startedAt ?? Date.now(),
        winningDeviceId,
      };
      await this.ensurePeerConnection(call);
      this.attachLocalTracks(call);
      this.emit();
      const offer = await call.peerConnection!.createOffer();
      await call.peerConnection!.setLocalDescription(offer);
      await this.sendSignal('OFFER', {
        callId,
        sdp: offer.sdp ?? '',
      });
      return;
    }
    if (
      resolution.state === 'ACCEPTED'
      && call.direction === 'incoming'
      && winningDeviceId === this.deviceId
      && call.snapshot.state === 'reconnecting'
      && call.peerConnection?.connectionState === 'connected'
    ) {
      this.clearReconnectTimeout();
      call.snapshot = { ...call.snapshot, state: 'active_here' };
      this.emit();
    }
  }

  private enterReconnect(call: ActiveCall): void {
    if (
      call.snapshot.state !== 'active_here'
      && call.snapshot.state !== 'reconnecting'
    ) {
      return;
    }
    if (call.snapshot.state !== 'reconnecting') {
      call.snapshot = { ...call.snapshot, state: 'reconnecting' };
      this.emit();
    }
    if (this.reconnectTimer !== null) return;
    const callId = call.snapshot.callId;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.call?.snapshot.callId === callId) this.endLocal('network-failed');
    }, RECONNECT_TIMEOUT_MS);
  }

  private markHandledElsewhere(winningDeviceId: string): void {
    if (!this.call) return;
    this.clearRingTimeout();
    this.releaseMedia();
    this.call.snapshot = {
      ...this.call.snapshot,
      state: 'handled_elsewhere',
      endReason: 'handled-elsewhere',
      winningDeviceId,
      localStream: undefined,
      remoteStream: undefined,
    };
    this.emit();
  }

  private endLocal(reason: CallEndReason): void {
    if (!this.call) return;
    this.clearRingTimeout();
    this.clearReconnectTimeout();
    this.releaseMedia();
    this.call.snapshot = {
      ...this.call.snapshot,
      state: 'ended',
      endReason: reason,
      localStream: undefined,
      remoteStream: undefined,
    };
    this.emit();
  }

  private releaseMedia(): void {
    const call = this.call;
    if (!call) return;
    call.snapshot.localStream?.getTracks().forEach((track) => track.stop());
    call.snapshot.remoteStream?.getTracks().forEach((track) => track.stop());
    call.peerConnection?.close();
    call.peerConnection = null;
    call.pendingCandidates = [];
    call.remoteDescriptionApplied = false;
  }

  private armRingTimeout(callId: string): void {
    this.clearRingTimeout();
    this.ringTimer = setTimeout(() => {
      this.ringTimer = null;
      if (
        this.call?.snapshot.callId === callId
        && (
          this.call.snapshot.state === 'outgoing'
          || isIncoming(this.call.snapshot.state)
        )
      ) {
        this.endLocal('no-answer');
      }
    }, RING_TIMEOUT_MS);
  }

  private clearRingTimeout(): void {
    if (this.ringTimer !== null) {
      clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private requireSession(): MobileAuthSession {
    if (!this.session) throw new Error('mobile.call.runtimeUnavailable');
    return this.session;
  }

  private requireDeviceId(): string {
    if (!this.deviceId) throw new Error('mobile.call.deviceUnavailable');
    return this.deviceId;
  }

  private requireIdle(): void {
    if (this.call && !isTerminal(this.call.snapshot.state)) {
      throw new Error('mobile.call.alreadyActive');
    }
    this.releaseMedia();
    this.call = null;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

function isIncoming(state: CallStateLifecycle): boolean {
  return state === 'incoming' || state === 'ringing_all_devices';
}

function isTerminal(state: CallStateLifecycle): boolean {
  return state === 'idle' || state === 'ended' || state === 'handled_elsewhere';
}

function deriveSignalingSessionId(left: string, right: string): string {
  return [left, right].sort((a, b) => a.localeCompare(b)).join('-');
}

function parseSignalPayload(plaintext: string): Record<string, unknown> {
  const value = JSON.parse(plaintext) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('mobile.call.signalPayloadInvalid');
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function acquireMedia(kind: CallMediaKind): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('mobile.call.mediaUnavailable'));
  }
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: kind === 'video',
  });
}

function newCallId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let timestamp = BigInt(Date.now());
  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = alphabet[Number(timestamp & 31n)] + timePart;
    timestamp >>= 5n;
  }
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  let randomness = 0n;
  randomBytes.forEach((byte) => {
    randomness = (randomness << 8n) | BigInt(byte);
  });
  let randomPart = '';
  for (let index = 0; index < 16; index += 1) {
    randomPart = alphabet[Number(randomness & 31n)] + randomPart;
    randomness >>= 5n;
  }
  return timePart + randomPart;
}

export const mobileCallManager = new MobileCallManager();
