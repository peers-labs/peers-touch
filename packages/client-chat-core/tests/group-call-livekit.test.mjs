import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { ConnectionState, RoomEvent, EngineEvent } from 'livekit-client';
import { LivekitAdapter } from '../dist/group-call/livekitAdapter.js';

function fixture() {
  const room = new EventEmitter();
  room.engine = new EventEmitter();
  room.simulateScenario = async (scenario) => {
    assert.equal(scenario, 'signal-reconnect');
    room.state = ConnectionState.SignalReconnecting;
    room.emit(RoomEvent.ConnectionStateChanged, room.state);
  };
  let stopped = 0, captured = 0;
  room.state = ConnectionState.Connected;
  room.localParticipant = {
    identity: 'gce-endpoint', sid: 'PA-current', permissions: {},
    trackPublications: new Map(),
    setMicrophoneEnabled: async () => { captured++; },
  };
  room.remoteParticipants = new Map();
  room.getSid = async () => 'RM-current';
  room.disconnect = async () => { room.state = ConnectionState.Disconnected; };
  const adapter = new LivekitAdapter();
  // Observe the real SDK adapter with an event-driven Room double, without
  // replacing its admission, permission, capture or cleanup implementation.
  adapter.room = room;
  adapter.attachListeners(room);
  const track = { stop: () => { stopped++; }, mediaStreamTrack: { readyState: 'live' } };
  return { adapter, room, track, captured: () => captured, stopped: () => stopped };
}

describe('LivekitAdapter admission and withdrawal', () => {
  it('cannot capture before both permissions and waits for the local admission event', async () => {
    const f = fixture();
    let admitted = false;
    const waiting = f.adapter.waitForAdmission(f.room).then(() => { admitted = true; });
    await assert.rejects(f.adapter.setMicEnabled(true), /grantUnavailable/);
    f.room.localParticipant.permissions = { canPublish: true, canSubscribe: false };
    f.room.emit(RoomEvent.ParticipantPermissionsChanged);
    await Promise.resolve();
    assert.equal(admitted, false);
    f.room.localParticipant.permissions.canSubscribe = true;
    f.room.emit(RoomEvent.ParticipantPermissionsChanged);
    await waiting;
    await f.adapter.setMicEnabled(true);
    assert.equal(f.captured(), 1);
    await f.adapter.disconnect();
    assert.equal(f.room.eventNames().length, 0);
  });

  it('cancels pending admission and removes every event listener', async () => {
    const f = fixture();
    const waiting = assert.rejects(f.adapter.waitForAdmission(f.room), { name: 'AbortError' });
    await f.adapter.disconnect();
    await waiting;
    assert.equal(f.captured(), 0);
    assert.equal(f.room.eventNames().length, 0);
  });

  it('stops capture immediately when admitted permissions are withdrawn', async () => {
    const f = fixture(), states = [];
    f.room.localParticipant.permissions = { canPublish: true, canSubscribe: true };
    await f.adapter.waitForAdmission(f.room);
    f.adapter.onConnectionStateChanged((state) => states.push(state));
    f.room.localParticipant.trackPublications.set('TR-local', { track: f.track });
    f.room.localParticipant.permissions.canSubscribe = false;
    f.room.emit(RoomEvent.ParticipantPermissionsChanged);
    assert.equal(f.stopped(), 1);
    assert.deepEqual(states, ['failed']);
    await assert.rejects(f.adapter.setMicEnabled(true), /grantUnavailable/);
    await f.adapter.disconnect();
    f.room.localParticipant.permissions.canSubscribe = true;
    f.room.emit(RoomEvent.ParticipantPermissionsChanged);
    assert.deepEqual(states, ['failed']);
  });

  it('drains a late capture and rejects it after disconnect', async () => {
    const f = fixture();
    f.room.localParticipant.permissions = { canPublish: true, canSubscribe: true };
    let complete;
    f.room.localParticipant.setMicrophoneEnabled = () => new Promise((resolve) => { complete = resolve; });
    const capture = assert.rejects(f.adapter.setMicEnabled(true), { name: 'AbortError' });
    const disconnected = f.adapter.disconnect();
    f.room.localParticipant.trackPublications.set('TR-late', { track: f.track });
    complete();
    await Promise.all([capture, disconnected]);
    assert.ok(f.stopped() >= 1);
    assert.equal(f.room.eventNames().length, 0);
  });

  it('reports empty media after teardown and discards stats from an old room', async () => {
    const f = fixture();
    let complete;
    f.track.getRTCStatsReport = () => new Promise((resolve) => { complete = resolve; });
    f.room.localParticipant.trackPublications.set('TR-local', { track: f.track, trackSid: 'TR-local' });
    const stats = f.adapter.readMediaStats();
    await Promise.resolve();
    await f.adapter.disconnect();
    complete(new Map([['rtp', { type: 'outbound-rtp', kind: 'audio', bytesSent: 100, packetsSent: 2 }]]));
    const value = await stats;
    assert.equal(value.connected, false);
    assert.equal(value.localLiveTracks, 0);
    assert.deepEqual(value.tracks, []);
    assert.equal((await f.adapter.readMediaStats()).roomSid, '');
  });

  it('runs the SDK signal reconnect and projects its real resume state', async () => {
    const f = fixture(), states = [];
    await assert.rejects(f.adapter.requestSignalReconnect(), /mediaUnavailable/);
    f.room.localParticipant.permissions = { canPublish: true, canSubscribe: true };
    await f.adapter.waitForAdmission(f.room);
    f.adapter.onConnectionStateChanged((state) => states.push(state));
    await f.adapter.requestSignalReconnect();
    f.room.state = ConnectionState.Connected;
    f.room.emit(RoomEvent.ConnectionStateChanged, f.room.state);
    assert.deepEqual(states, ['reconnecting', 'connected']);
    await f.adapter.disconnect();
    f.room.emit(RoomEvent.ConnectionStateChanged, ConnectionState.SignalReconnecting);
    assert.deepEqual(states, ['reconnecting', 'connected']);
  });

  it('observes refreshed credentials only from the current admitted engine and removes its listener', async () => {
    const f = fixture(), tokens = [];
    const detach = f.adapter.onTokenRefreshed((token) => tokens.push(token));
    f.room.engine.emit(EngineEvent.TokenRefreshed, 'before-admission');
    assert.deepEqual(tokens, []);
    f.room.localParticipant.permissions = { canPublish: true, canSubscribe: true };
    await f.adapter.waitForAdmission(f.room);
    f.room.engine.emit(EngineEvent.TokenRefreshed, 'sfu-refreshed');
    assert.deepEqual(tokens, ['sfu-refreshed']);
    await f.adapter.disconnect();
    assert.equal(f.room.engine.eventNames().length, 0);
    f.room.engine.emit(EngineEvent.TokenRefreshed, 'after-release');
    assert.deepEqual(tokens, ['sfu-refreshed']);
    detach();
  });
});
