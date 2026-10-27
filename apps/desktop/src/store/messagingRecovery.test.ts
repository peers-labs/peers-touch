import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messagingRecoveryService } from '../services/messaging-recovery-service';
import { useMessagingRecoveryStore } from './messagingRecovery';
import { useSessionStore } from './session';
import { eventBus } from '../kernel/events';

const backup = {
  backupId: 'revision', revision: 'revision', formatVersion: 1,
  createdAtUnixMs: 123, blobSizeBytes: 456,
};
const identity = {
  ready: true, ptid: 'ptid:peer:alice', deviceId: 'device', fingerprint: 'fingerprint',
};
const status = { identity, exists: true, latest: backup };
const result = {
  backup, recoveryEpoch: 1, messageCount: 2, conversationCount: 1,
  attachmentCount: 0, verifiedFingerprintCount: 0,
};
const restored = {
  ...result, deviceId: 'device', fingerprint: 'fingerprint',
  actorPtid: 'ptid:peer:alice', profileId: 'profile-alice', stationPeerId: 'station-a',
  conversations: [], attachments: [], verifiedFingerprints: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function authenticate(actorPtid: string) {
  useSessionStore.setState({
    authenticated: true,
    currentUser: { actorPtid, name: 'Test', email: 'test@example.test', loginMethod: 'password' },
  });
}

const actions = ['refresh', 'createRevision', 'restoreLatest'] as const;

function invokeAction(action: typeof actions[number]) {
  const store = useMessagingRecoveryStore.getState();
  return action === 'refresh' ? store.refresh() : store[action]('test-input');
}

function delayAction(action: typeof actions[number]) {
  const pending = deferred<any>();
  vi.mocked(messagingRecoveryService[
    action === 'refresh' ? 'status' : action
  ]).mockReturnValueOnce(pending.promise);
  return { ...pending, result: action === 'refresh' ? status : action === 'createRevision' ? result : restored };
}

describe('authenticated Messaging Recovery projection', () => {
  beforeEach(() => {
    authenticate('ptid:peer:alice');
    useMessagingRecoveryStore.getState().reset();
    vi.spyOn(messagingRecoveryService, 'status').mockResolvedValue(status);
    vi.spyOn(messagingRecoveryService, 'createRevision').mockResolvedValue(result);
    vi.spyOn(messagingRecoveryService, 'restoreLatest').mockResolvedValue(restored);
    vi.spyOn(eventBus, 'publish').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useMessagingRecoveryStore.getState().reset();
    useSessionStore.setState({ authenticated: false, currentUser: null });
  });

  it('loads the authenticated backup status', async () => {
    await invokeAction('refresh');
    expect(useMessagingRecoveryStore.getState()).toMatchObject({
      identity, latest: backup, exists: true, loading: false, error: null,
    });
  });

  it('publishes a newly created backup', async () => {
    await expect(invokeAction('createRevision')).resolves.toEqual(result);
    expect(useMessagingRecoveryStore.getState()).toMatchObject({
      latest: backup, exists: true, creating: false,
    });
  });

  it('refreshes identity after successful restore', async () => {
    await expect(invokeAction('restoreLatest')).resolves.toEqual(restored);
    expect(useMessagingRecoveryStore.getState()).toMatchObject({
      identity, latest: backup, exists: true, restoring: false,
    });
    expect(messagingRecoveryService.status).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(actions)('propagates a current %s failure', async (action) => {
    const failure = new Error('recovery unavailable');
    const pending = delayAction(action);
    const operation = invokeAction(action);
    pending.reject(failure);
    await expect(operation).rejects.toBe(failure);
    expect(useMessagingRecoveryStore.getState()).toMatchObject({
      error: failure.message, loading: false, creating: false, restoring: false,
    });
  });

  it.each(actions)('discards a %s completion after scope reset', async (action) => {
    const pending = delayAction(action);
    const operation = invokeAction(action);
    useMessagingRecoveryStore.getState().reset();
    pending.resolve(pending.result);
    await operation;
    expect(useMessagingRecoveryStore.getState()).toMatchObject({
      identity: null, latest: null, exists: false,
      loading: false, creating: false, restoring: false, error: null,
    });
    if (action === 'restoreLatest') {
      expect(messagingRecoveryService.status).not.toHaveBeenCalled();
    }
  });

  it.each(actions)('discards a %s failure after scope reset', async (action) => {
    const pending = delayAction(action);
    const operation = invokeAction(action);
    useMessagingRecoveryStore.getState().reset();
    const failure = new Error('old actor failure');
    pending.reject(failure);
    await expect(operation).rejects.toBe(failure);
    expect(useMessagingRecoveryStore.getState().error).toBeNull();
  });

  it('does not publish an old actor status while the next actor logs in', async () => {
    const pending = delayAction('refresh');
    const operation = invokeAction('refresh');
    authenticate('ptid:peer:bob');
    pending.resolve(status);
    await operation;
    expect(useMessagingRecoveryStore.getState().identity).toBeNull();
    expect(useMessagingRecoveryStore.getState().exists).toBe(false);
  });

  it('publishes committed profile activation before waiting for remote backup status', async () => {
    const pending = deferred<typeof status>();
    vi.mocked(messagingRecoveryService.status).mockReturnValueOnce(pending.promise);
    const operation = invokeAction('restoreLatest');
    await Promise.resolve();
    expect(eventBus.publish).toHaveBeenCalledExactlyOnceWith('messaging.profile_activated', {
      actorPtid: restored.actorPtid, sessionEpoch: useSessionStore.getState().sessionEpoch,
      profileId: restored.profileId, stationPeerId: restored.stationPeerId,
      endpointId: restored.deviceId,
    });
    pending.resolve(status);
    await operation;
  });

  it('keeps committed activation observable when remote backup status fails', async () => {
    const failure = new Error('backup status unavailable');
    vi.mocked(messagingRecoveryService.status).mockRejectedValueOnce(failure);
    await expect(invokeAction('restoreLatest')).rejects.toBe(failure);
    expect(eventBus.publish).toHaveBeenCalledOnce();
  });

  it.each(actions)('discards a %s completion from the previous same-Actor Session', async (action) => {
    const pending = delayAction(action);
    const operation = invokeAction(action);
    useSessionStore.setState((state) => ({ sessionEpoch: state.sessionEpoch + 1 }));
    pending.resolve(pending.result);
    await operation;
    expect(useMessagingRecoveryStore.getState()).toMatchObject({ identity: null, exists: false });
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it.each(actions)('discards a %s failure from the previous same-Actor Session', async (action) => {
    const pending = delayAction(action);
    const operation = invokeAction(action);
    useSessionStore.setState((state) => ({ sessionEpoch: state.sessionEpoch + 1 }));
    const failure = new Error('obsolete Session failure');
    pending.reject(failure);
    await expect(operation).rejects.toBe(failure);
    expect(useMessagingRecoveryStore.getState().error).toBeNull();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
