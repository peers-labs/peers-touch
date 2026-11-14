import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GroupCallController } from '../dist/group-call/controller.js';
import { MediaReservation } from '../dist/mediaReservation.js';
import { GroupCallReplayProbe } from '../dist/group-call/replayProbe.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const grant = {
  url: 'ws://sfu.test', token: 'opaque', room_name: 'gc-group',
  grant_id: 'a'.repeat(64), participant_identity: `gce-${'a'.repeat(64)}`,
};

function fixture(overrides = {}) {
  const callbacks = { roster: new Set(), state: new Set(), speaker: new Set() };
  const calls = [];
  const reservation = new MediaReservation();
  const provider = {
    connect: async () => { calls.push('connect'); },
    disconnect: async () => { calls.push('disconnect'); },
    setMicEnabled: async (enabled) => { calls.push(`mic:${enabled}`); },
    setCameraEnabled: async (enabled) => { calls.push(`camera:${enabled}`); },
    attachParticipantMedia: () => () => {},
    readMediaStats: async () => ({
      connected: false, roomSid: '', participantSid: '', canPublish: false,
      canSubscribe: false, localLiveTracks: 0, tracks: [],
    }),
    onParticipantChanged: (cb) => { callbacks.roster.add(cb); return () => callbacks.roster.delete(cb); },
    onConnectionStateChanged: (cb) => { callbacks.state.add(cb); return () => callbacks.state.delete(cb); },
    onActiveSpeaker: (cb) => { callbacks.speaker.add(cb); return () => callbacks.speaker.delete(cb); },
    ...overrides.provider,
  };
  const controller = new GroupCallController({
    join: overrides.join ?? (async () => grant),
    iceServers: async () => [],
    createProvider: overrides.createProvider ?? (async () => provider),
    reservation,
  });
  return { controller, provider, reservation, callbacks, calls };
}

describe('GroupCallController', () => {
  it('joins audio/video and releases the shared direct/group reservation', async () => {
    const f = fixture();
    await f.controller.joinGroupCall('group', 'audio');
    assert.equal(f.controller.getSnapshot().state, 'connected');
    assert.deepEqual(f.calls.slice(0, 3), ['connect', 'mic:true', 'camera:false']);
    assert.throws(() => f.reservation.acquire('direct', 'other'), /Occupied/);
    await f.controller.leaveGroupCall();
    assert.equal(f.controller.getSnapshot().state, 'idle');
    assert.equal(f.reservation.isOccupied(), false);
    assert.equal(f.callbacks.roster.size + f.callbacks.state.size + f.callbacks.speaker.size, 0);
    await f.controller.joinGroupCall('group', 'video');
    assert.equal(f.controller.getSnapshot().localCameraEnabled, true);
    await f.controller.leaveGroupCall();
  });

  it('rejects a grant with a different endpoint before capturing media', async () => {
    const f = fixture({ join: async () => ({ ...grant, participant_identity: 'ptid:alice' }) });
    await assert.rejects(f.controller.joinGroupCall('group'), /grantUnavailable/);
    assert.equal(f.calls.includes('connect'), false);
    assert.equal(f.reservation.isOccupied(), false);
    assert.equal(f.controller.getSnapshot().state, 'failed');
  });

  it('drains a provider that arrives after cancellation and never captures', async () => {
    const pending = deferred();
    let f;
    f = fixture({ createProvider: () => pending.promise });
    const joined = f.controller.joinGroupCall('group');
    const rejected = assert.rejects(joined, { name: 'AbortError' });
    const leaving = f.controller.leaveGroupCall();
    assert.equal(f.reservation.isOccupied(), true);
    pending.resolve(f.provider);
    await Promise.all([rejected, leaving]);
    assert.equal(f.calls.includes('connect'), false);
    assert.equal(f.calls.includes('mic:true'), false);
    assert.equal(f.calls.includes('disconnect'), true);
    assert.equal(f.reservation.isOccupied(), false);
  });

  it('holds the reservation until pending media capture has drained', async () => {
    const capture = deferred(), capturing = deferred();
    const f = fixture({ provider: { setMicEnabled: async () => { capturing.resolve(); await capture.promise; } } });
    const joined = f.controller.joinGroupCall('group');
    const rejected = assert.rejects(joined, { name: 'AbortError' });
    await capturing.promise;
    const leaving = f.controller.leaveGroupCall();
    assert.equal(f.reservation.isOccupied(), true);
    capture.resolve();
    await Promise.all([rejected, leaving]);
    assert.equal(f.calls.includes('camera:false'), false);
    assert.equal(f.reservation.isOccupied(), false);
  });

  it('serializes controls and permits retry after a capture permission error', async () => {
    const toggle = deferred(), toggling = deferred();
    let first = true;
    const f = fixture();
    await f.controller.joinGroupCall('group');
    f.provider.setCameraEnabled = async (enabled) => {
      f.calls.push(`camera:${enabled}`);
      if (first) { first = false; toggling.resolve(); await toggle.promise; throw new DOMException('denied', 'NotAllowedError'); }
    };
    const off = f.controller.setCameraEnabled(false);
    const rejected = assert.rejects(off, { name: 'NotAllowedError' });
    await toggling.promise;
    const on = f.controller.setCameraEnabled(true);
    toggle.resolve();
    await Promise.all([rejected, on]);
    assert.equal(f.controller.getSnapshot().localCameraEnabled, true);
    assert.equal(f.controller.getSnapshot().pendingControl, undefined);
    assert.equal(f.controller.getSnapshot().errorCode, undefined);
    await f.controller.leaveGroupCall();
  });

  it('ignores late callbacks and old SSE while releasing failed media', async () => {
    const f = fixture();
    await f.controller.joinGroupCall('group');
    const roster = [...f.callbacks.roster][0], state = [...f.callbacks.state][0];
    f.controller.ingestRoomEvent({ kind: 'room_ended', groupUlid: 'group', roomName: 'gc-group' });
    assert.equal(f.controller.getSnapshot().state, 'connected');
    state('failed');
    await f.controller.leaveGroupCall();
    roster([{ actorPtid: 'stale', participantId: 'stale', isLocal: true, isMicEnabled: true }]);
    state('connected');
    assert.equal(f.controller.getSnapshot().participants.length, 0);
    assert.equal(f.controller.getSnapshot().state, 'failed');
    assert.equal(f.reservation.isOccupied(), false);
  });

  it('retains ownership when disconnect fails, then releases on retry', async () => {
    const f = fixture();
    await f.controller.joinGroupCall('group');
    const disconnect = f.provider.disconnect;
    f.provider.disconnect = async () => { throw new Error('disconnect failed'); };
    await assert.rejects(f.controller.leaveGroupCall(), /disconnect failed/);
    assert.equal(f.reservation.isOccupied(), true);
    assert.equal(f.controller.getSnapshot().state, 'leaving');
    f.provider.disconnect = disconnect;
    await f.controller.leaveGroupCall();
    assert.equal(f.reservation.isOccupied(), false);
  });
});

describe('GroupCallReplayProbe', () => {
  it('retains an actually refreshed token for restart replay and clears all credentials on consume', async () => {
    let refresh, observedToken, failConnection, released;
    const provider = {
      connect: (_, token) => {
        released = false; observedToken = token;
        return new Promise((_, reject) => { failConnection = reject; });
      },
      disconnect: async () => { released = true; },
      readMediaStats: async () => {
        if (released) return { connected: false, localLiveTracks: 0, tracks: [] };
        failConnection(new Error('admission denied'));
        return { connected: true, participantSid: 'PA-replay', canPublish: false,
          canSubscribe: false, localLiveTracks: 0, tracks: [] };
      },
    };
    const probe = new GroupCallReplayProbe(async () => provider);
    probe.arm(); probe.capture(grant);
    probe.observe({
      onTokenRefreshed: (cb) => { refresh = cb; return () => { refresh = undefined; }; },
      onConnectionStateChanged: () => () => {},
      requestSignalReconnect: async () => {},
    });
    refresh('actually-refreshed-token');
    const first = await probe.replay('PA-admitted', 'refreshed', false);
    assert.equal(first.denied, true);
    assert.equal(first.tokenKind, 'refreshed');
    assert.equal(observedToken, 'actually-refreshed-token');
    assert.equal(JSON.stringify(first).includes(observedToken), false);
    assert.equal(probe.status().hasRefreshedToken, true);
    assert.equal((await probe.replay('PA-admitted', 'refreshed')).denied, true);
    assert.equal(probe.status().hasRefreshedToken, false);
    assert.equal(refresh, undefined);
    await assert.rejects(probe.replay('PA-admitted', 'refreshed'), /replayProbeUnavailable/);
  });

  it('reports reconnect only after its native provider emitted the transition', async () => {
    const probe = new GroupCallReplayProbe(async () => ({}));
    let stateListener, removed = false;
    probe.observe({
      onTokenRefreshed: () => () => {},
      onConnectionStateChanged: (cb) => { stateListener = cb; return () => { removed = true; }; },
      requestSignalReconnect: async () => { stateListener('reconnecting'); },
    });
    assert.deepEqual(await probe.reconnect(), { requested: true, observedReconnecting: true });
    assert.equal(removed, true);
    probe.clear();
    await assert.rejects(probe.reconnect(), /replayProbeUnavailable/);
  });

  it('observes a new denied SID using only the captured production grant, then erases it', async () => {
    let failConnection, released = false, observedCredential;
    const provider = {
      connect: (url, token) => {
        observedCredential = { url, token };
        return new Promise((_, reject) => { failConnection = reject; });
      },
      disconnect: async () => { released = true; },
      readMediaStats: async () => {
        if (released) return { connected: false, localLiveTracks: 0, tracks: [] };
        failConnection(new Error('admission denied'));
        return { connected: true, participantSid: 'PA-replay', canPublish: false,
          canSubscribe: false, localLiveTracks: 0, tracks: [] };
      },
    };
    const probe = new GroupCallReplayProbe(async () => provider);
    probe.arm();
    probe.capture(grant);
    const result = await probe.replay('PA-admitted');
    assert.equal(result.denied, true);
    assert.equal(result.replaySid, 'PA-replay');
    assert.equal(result.mediaReleased, true);
    assert.deepEqual(observedCredential, { url: grant.url, token: grant.token });
    assert.equal(JSON.stringify(result).includes(grant.token), false);
    await assert.rejects(probe.replay('PA-admitted'), /replayProbeUnavailable/);
  });

  it('does not retain unarmed credentials and never calls an admitted replay denied', async () => {
    const provider = {
      connect: async () => undefined,
      disconnect: async () => undefined,
      readMediaStats: async () => ({ connected: false, localLiveTracks: 0, tracks: [] }),
    };
    const probe = new GroupCallReplayProbe(async () => provider);
    probe.capture(grant);
    await assert.rejects(probe.replay('PA-admitted'), /replayProbeUnavailable/);
    probe.arm(); probe.capture(grant);
    assert.equal((await probe.replay('PA-admitted')).denied, false);
  });
});
