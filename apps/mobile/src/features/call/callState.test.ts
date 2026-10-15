// @ts-nocheck -- Vitest supplies the DOM/runtime doubles used here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
  messagingStatus: vi.fn(),
  open: vi.fn(),
  seal: vi.fn(),
}));
const transportMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  responseJson: vi.fn((response) => response.json ?? {}),
}));

vi.mock('../../services/mobileCommands', () => ({
  messagingStatus: commandMocks.messagingStatus,
  messagingCallSignalOpen: commandMocks.open,
  messagingCallSignalSeal: commandMocks.seal,
}));

vi.mock('../../services/stationTransport', () => ({
  executeStationOperation: transportMocks.execute,
  responseJson: transportMocks.responseJson,
}));

import { MobileCallManager } from './callState';

const session = {
  stationPeerId: 'station-primary',
  stationUrl: 'https://station.example',
  sessionId: 'session-1',
  deviceId: 'device-1',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:bob' },
  authenticatedAt: 1,
};

describe('mobile call manager', () => {
  beforeEach(() => {
    commandMocks.messagingStatus.mockReset().mockResolvedValue({
      active: true,
      stationPeerId: 'station-primary',
      actorPtid: 'ptid:bob',
      deviceId: 'bob-mobile',
      deviceEnrolled: true,
    });
    commandMocks.open.mockReset().mockResolvedValue(
      JSON.stringify({ callId: '01K5TCALL00000000000000000', kind: 'audio' }),
    );
    commandMocks.seal.mockReset().mockResolvedValue('c2VhbGVk');
    transportMocks.execute.mockReset().mockResolvedValue({
      status: 204,
      contentType: '',
      bodyBytes: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rings globally and converges a losing sibling to handled_elsewhere', async () => {
    const manager = new MobileCallManager();
    await manager.activate(session);
    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_REQUEST',
      callId: '01K5TCALL00000000000000000',
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: '',
      payload: new Uint8Array([1]),
      cursor: 'event-1',
      timestampMs: 1,
    });
    expect(manager.getSnapshot()).toMatchObject({
      state: 'ringing_all_devices',
      peerPtid: 'ptid:alice',
    });

    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_ACCEPT',
      callId: '01K5TCALL00000000000000000',
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:bob',
      winningDeviceId: 'bob-desktop',
      payload: new Uint8Array(),
      cursor: 'event-2',
      timestampMs: 2,
    });
    expect(manager.getSnapshot()).toMatchObject({
      state: 'handled_elsewhere',
      winningDeviceId: 'bob-desktop',
      endReason: 'handled-elsewhere',
    });
    manager.reset();
  });

  it('treats duplicate delivery of the active incoming request idempotently', async () => {
    const manager = new MobileCallManager();
    const request = {
      kind: 'call-signal',
      signalKind: 'CALL_REQUEST',
      callId: '01K5TCALL00000000000000000',
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: '',
      payload: new Uint8Array([1]),
      cursor: 'event-1',
      timestampMs: 1,
    };

    await manager.activate(session);
    await manager.ingestRealtimeSignal(request);
    await manager.ingestRealtimeSignal({
      ...request,
      cursor: 'event-2',
      timestampMs: 2,
    });

    expect(manager.getSnapshot()).toMatchObject({
      callId: request.callId,
      state: 'ringing_all_devices',
      peerPtid: request.fromActorPtid,
    });
    expect(transportMocks.execute).not.toHaveBeenCalled();
    manager.reset();
  });

  it('retains the winning device when rejecting an incoming call', async () => {
    const manager = new MobileCallManager();
    await manager.activate(session);
    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_REQUEST',
      callId: '01K5TCALL00000000000000000',
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: '',
      payload: new Uint8Array([1]),
      cursor: 'event-1',
      timestampMs: 1,
    });

    await manager.rejectCall();

    expect(manager.getSnapshot()).toMatchObject({
      state: 'ended',
      endReason: 'rejected',
      winningDeviceId: 'bob-mobile',
    });
    manager.reset();
  });

  it('commits acceptance before opening local media', async () => {
    const manager = new MobileCallManager();
    const order: string[] = [];
    transportMocks.execute.mockImplementation(async (_session, operation) => {
      order.push(operation.operationId);
      if (operation.operationId === 'turn_ice_servers') {
        return {
          status: 200,
          contentType: 'application/json',
          bodyBytes: [],
          json: { ice_servers: [] },
        };
      }
      return { status: 204, contentType: '', bodyBytes: [] };
    });
    const stream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [],
    };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          order.push('media');
          return stream;
        }),
      },
    });
    vi.stubGlobal('RTCPeerConnection', class {
      connectionState = 'new';
      onicecandidate = null;
      ontrack = null;
      addTrack() {}
      getSenders() { return []; }
      close() {}
    });

    await manager.activate(session);
    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_REQUEST',
      callId: '01K5TCALL00000000000000000',
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: '',
      payload: new Uint8Array([1]),
      cursor: 'event-1',
      timestampMs: 1,
    });
    await manager.acceptCall();

    expect(order.slice(0, 2)).toEqual(['realtime_signal_send', 'media']);
    expect(manager.getSnapshot()).toMatchObject({
      state: 'active_here',
      winningDeviceId: 'bob-mobile',
    });
    manager.reset();
  });

  it('retries temporary media contention when accepting a follow-up call', async () => {
    const manager = new MobileCallManager();
    transportMocks.execute.mockImplementation(async (_session, operation) => {
      if (operation.operationId === 'turn_ice_servers') {
        return {
          status: 200,
          contentType: 'application/json',
          bodyBytes: [],
          json: { ice_servers: [] },
        };
      }
      return { status: 204, contentType: '', bodyBytes: [] };
    });
    const stream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [],
    };
    const temporaryContention = Object.assign(
      new Error('Could not start audio source'),
      { name: 'NotReadableError' },
    );
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(temporaryContention)
      .mockResolvedValueOnce(stream);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
    });
    vi.stubGlobal('RTCPeerConnection', class {
      connectionState = 'new';
      onconnectionstatechange = null;
      onicecandidate = null;
      ontrack = null;
      addTrack() {}
      getSenders() { return []; }
      close() {}
    });

    await manager.activate(session);
    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_REQUEST',
      callId: '01K5TCALL00000000000000001',
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: '',
      payload: new Uint8Array([1]),
      cursor: 'event-3',
      timestampMs: 3,
    });

    await expect(manager.acceptCall()).resolves.toMatchObject({
      state: 'active_here',
      winningDeviceId: 'bob-mobile',
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    manager.reset();
  });

  it('does not retry a denied media permission when accepting a call', async () => {
    const manager = new MobileCallManager();
    const permissionDenied = Object.assign(
      new Error('Permission denied'),
      { name: 'NotAllowedError' },
    );
    const getUserMedia = vi.fn().mockRejectedValue(permissionDenied);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
    });

    await manager.activate(session);
    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_REQUEST',
      callId: '01K5TCALL00000000000000002',
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: '',
      payload: new Uint8Array([1]),
      cursor: 'event-4',
      timestampMs: 4,
    });

    await expect(manager.acceptCall()).rejects.toMatchObject({
      name: 'NotAllowedError',
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot()).toMatchObject({
      state: 'ended',
      endReason: 'media-failed',
    });
    manager.reset();
  });

  it('keeps an actionable terminal projection when outgoing media is denied', async () => {
    const manager = new MobileCallManager();
    const permissionDenied = Object.assign(
      new Error('Permission denied'),
      { name: 'NotAllowedError' },
    );
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(permissionDenied),
      },
    });

    await manager.activate(session);
    await expect(
      manager.startOutgoingCall('ptid:alice', 'video'),
    ).rejects.toMatchObject({ name: 'NotAllowedError' });

    expect(manager.getSnapshot()).toMatchObject({
      state: 'ended',
      endReason: 'media-failed',
      mediaFailure: 'permission-denied',
      peerPtid: 'ptid:alice',
    });
    expect(transportMocks.execute).not.toHaveBeenCalled();
    manager.reset();
  });

  it('restores an outgoing active call after foreground reconciliation', async () => {
    const manager = new MobileCallManager();
    let offerCount = 0;
    const stream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [],
    };
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal('RTCPeerConnection', class {
      connectionState = 'connected';
      onconnectionstatechange = null;
      onicecandidate = null;
      ontrack = null;
      addTrack() {}
      getSenders() { return []; }
      createOffer() {
        offerCount += 1;
        return Promise.resolve({ type: 'offer', sdp: 'offer' });
      }
      setLocalDescription() { return Promise.resolve(); }
      close() {}
    });
    transportMocks.execute.mockImplementation(async (_session, operation) => {
      if (operation.operationId === 'turn_ice_servers') {
        return {
          status: 200,
          contentType: 'application/json',
          bodyBytes: [],
          json: { ice_servers: [] },
        };
      }
      if (operation.operationId === 'realtime_call_resolution_get') {
        return {
          status: 200,
          contentType: 'application/json',
          bodyBytes: [],
          json: {
            state: 'ACCEPTED',
            winning_device_id: 'alice-mobile',
          },
        };
      }
      return { status: 204, contentType: '', bodyBytes: [] };
    });

    await manager.activate(session);
    const outgoing = await manager.startOutgoingCall('ptid:alice', 'audio');
    commandMocks.open.mockResolvedValue(JSON.stringify({
      callId: outgoing.callId,
    }));
    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_ACCEPT',
      callId: outgoing.callId,
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: 'alice-mobile',
      payload: new Uint8Array([1]),
      cursor: 'event-5',
      timestampMs: 5,
    });
    expect(manager.getSnapshot()?.state).toBe('active_here');
    const startedAt = manager.getSnapshot()?.startedAt;
    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_ACCEPT',
      callId: outgoing.callId,
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: 'alice-mobile',
      payload: new Uint8Array([1]),
      cursor: 'event-5-duplicate',
      timestampMs: 6,
    });
    expect(manager.getSnapshot()?.startedAt).toBe(startedAt);
    expect(offerCount).toBe(1);

    manager.suspend();
    expect(manager.getSnapshot()?.state).toBe('reconnecting');
    await manager.resume();

    expect(manager.getSnapshot()).toMatchObject({
      state: 'active_here',
      callId: outgoing.callId,
    });
    manager.reset();
  });

  it('preserves a remote media failure reason for caller recovery', async () => {
    const manager = new MobileCallManager();
    const stream = {
      getTracks: () => [],
      getAudioTracks: () => [],
      getVideoTracks: () => [],
    };
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    await manager.activate(session);
    const outgoing = await manager.startOutgoingCall('ptid:alice', 'audio');
    commandMocks.open.mockResolvedValue(JSON.stringify({
      callId: outgoing.callId,
      reason: 'media-failed',
      mediaFailure: 'permission-denied',
    }));
    await manager.ingestRealtimeSignal({
      kind: 'call-signal',
      signalKind: 'CALL_END',
      callId: outgoing.callId,
      sessionUlid: 'ptid:alice-ptid:bob',
      fromActorPtid: 'ptid:alice',
      winningDeviceId: 'alice-mobile',
      payload: new Uint8Array([1]),
      cursor: 'event-6',
      timestampMs: 6,
    });

    expect(manager.getSnapshot()).toMatchObject({
      state: 'ended',
      endReason: 'media-failed',
      mediaFailure: 'permission-denied',
    });
    manager.reset();
  });
});
