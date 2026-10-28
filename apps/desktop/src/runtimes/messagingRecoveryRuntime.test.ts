import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT, eventBus } from '../kernel/events';
import { messagingRecoveryService } from '../services/messaging-recovery-service';
import { useMessagingRecoveryStore } from '../store/messagingRecovery';
import { useSessionStore } from '../store/session';
import { messagingRecoveryRuntime } from './messagingRecoveryRuntime';

const status = { identity: null, exists: false, latest: null };

describe('messagingRecoveryRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', new EventTarget());
    useSessionStore.setState({
      authenticated: true, sessionEpoch: 1,
      currentUser: {
        actorPtid: 'ptid:actor:alice', name: 'Alice',
        email: 'alice@example.test', loginMethod: 'password',
      },
    });
    vi.spyOn(messagingRecoveryService, 'status').mockResolvedValue(status);
    messagingRecoveryRuntime.install();
  });

  afterEach(() => {
    messagingRecoveryRuntime.teardown();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useSessionStore.setState({ authenticated: false, currentUser: null });
  });

  it('owns initial and periodic backup reads without a local Engine', async () => {
    await messagingRecoveryRuntime.bootstrap(null);
    expect(messagingRecoveryService.status).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(messagingRecoveryService.status).toHaveBeenCalledTimes(2);
  });

  it('resets blocked operations when the same Actor accepts a new Session', async () => {
    await messagingRecoveryRuntime.bootstrap(null);
    useMessagingRecoveryStore.setState({ restoring: true, error: 'old Session' });
    useSessionStore.setState({ sessionEpoch: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(useMessagingRecoveryStore.getState()).toMatchObject({
      restoring: false, loading: false, error: null,
    });
    expect(messagingRecoveryService.status).toHaveBeenCalledTimes(2);
  });

  it('fences recovery state on Station replacement', async () => {
    await messagingRecoveryRuntime.bootstrap(null);
    useMessagingRecoveryStore.setState({ creating: true, error: 'old Station' });
    eventBus.publish(EVENT.STATION_ACTIVE_CHANGED, { stationPeerId: 'station-b', routeId: 'b' });
    await vi.advanceTimersByTimeAsync(0);
    expect(useMessagingRecoveryStore.getState()).toMatchObject({
      creating: false, loading: false, error: null,
    });
    expect(messagingRecoveryService.status).toHaveBeenCalledTimes(2);
  });

  it('installs once and releases all recurring work on teardown', async () => {
    messagingRecoveryRuntime.install();
    await messagingRecoveryRuntime.bootstrap(null);
    messagingRecoveryRuntime.teardown();
    useSessionStore.setState({ sessionEpoch: 2 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(messagingRecoveryService.status).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
