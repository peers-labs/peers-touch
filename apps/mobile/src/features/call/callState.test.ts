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
});
