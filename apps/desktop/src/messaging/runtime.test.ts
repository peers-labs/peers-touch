import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProjectionKind } from '../gen/proto/domain/chat/event_pb';

const mocks = vi.hoisted(() => ({
  actorPtid: 'ptid:actor:alice',
  sessionEpoch: 1,
  subscribeSession: vi.fn(),
  handlers: new Map<string, (payload: any) => void>(),
  accountGetActive: vi.fn(),
  profileGet: vi.fn(),
  accountGetDeviceId: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    accountGetActive: mocks.accountGetActive,
    profileGet: mocks.profileGet,
    accountGetDeviceId: mocks.accountGetDeviceId,
    messagingTypingSend: vi.fn(),
    messagingReadCursor: vi.fn(),
    messagingEditMessage: vi.fn(),
    messagingMetadataInteraction: vi.fn(),
  },
}));

vi.mock('../services/im-service', () => ({
  imServiceV1: {
    conversation: {
      getConversation: mocks.getConversation,
    },
    messaging: {
      listConversations: mocks.listConversations,
    },
  },
}));

vi.mock('../store/session', () => ({
  currentAuthenticatedActorPtid: () => mocks.actorPtid,
  useSessionStore: {
    getState: () => ({ sessionEpoch: mocks.sessionEpoch }),
    subscribe: mocks.subscribeSession,
  },
}));

vi.mock('../kernel/events', () => ({
  EVENT: {
    STATION_ACTIVE_CHANGED: 'station.active_changed',
    MESSAGING_PROFILE_ACTIVATED: 'messaging.profile_activated',
  },
  eventBus: {
    subscribe: (name: string, handler: (payload: any) => void) => {
      mocks.handlers.set(name, handler);
      return () => { mocks.handlers.delete(name); };
    },
    publish: (name: string, payload: any) => mocks.handlers.get(name)?.(payload),
  },
}));

function activateProfile(overrides: Record<string, unknown> = {}) {
  mocks.handlers.get('messaging.profile_activated')?.({
    actorPtid: mocks.actorPtid, sessionEpoch: mocks.sessionEpoch,
    profileId: 'profile-alice', stationPeerId: 'station-a',
    endpointId: 'device-recovered', ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

import {
  MessagingRuntimeScopeChangedError,
  messagingCommands,
  messagingConversations,
  messagingDomainRuntime,
} from './runtime';
import { EVENT, eventBus } from '../kernel/events';

describe('DesktopMessagingDomainRuntime', () => {
  const lifecycle = {
    install: vi.fn(),
    teardown: vi.fn(),
    resetProjection: vi.fn(),
    reconcile: vi.fn(),
  };

  beforeEach(() => {
    messagingDomainRuntime.teardown();
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('window', new EventTarget());
    mocks.actorPtid = 'ptid:actor:alice';
    mocks.sessionEpoch = 1;
    mocks.subscribeSession.mockImplementation(() => () => undefined);
    mocks.accountGetActive.mockResolvedValue({ id: 'profile-alice' });
    const homeIdentity = { home_station_peer_id: 'station-a' };
    mocks.profileGet.mockResolvedValue(homeIdentity);
    mocks.accountGetDeviceId.mockResolvedValue({ device_id: 'device-desktop' });
    lifecycle.reconcile.mockResolvedValue(undefined);
    messagingDomainRuntime.configure(lifecycle);
    messagingDomainRuntime.install();
  });

  afterEach(() => {
    messagingDomainRuntime.teardown();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('activates one complete identity scope and periodically reconciles it', async () => {
    await messagingDomainRuntime.bootstrap('ptid:actor:alice');

    expect(messagingDomainRuntime.captureScope()).toMatchObject({
      actorPtid: 'ptid:actor:alice',
      stationPeerId: 'station-a',
      profileId: 'profile-alice',
      endpointId: 'device-desktop',
    });
    expect(lifecycle.resetProjection).toHaveBeenCalledOnce();
    expect(lifecycle.reconcile).toHaveBeenCalledWith(
      'runtime:bootstrap',
      expect.objectContaining({ actorPtid: 'ptid:actor:alice' }),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(lifecycle.reconcile).toHaveBeenCalledWith(
      'runtime:reconcile:periodic',
      expect.objectContaining({ actorPtid: 'ptid:actor:alice' }),
    );
    expect(messagingDomainRuntime.matchesInvalidation({
      $typeName: 'peers_touch.model.chat.v1.MessagingProjectionInvalidation',
      schemaVersion: 1,
      actorPtid: 'ptid:actor:alice',
      homeStationPeerId: 'station-a',
      deviceId: 'device-desktop',
      conversationId: 'direct-1',
      eventId: 'event-1',
      laneSequence: 1n,
      kind: MessagingProjectionKind.CONVERSATION,
      messageId: '',
      messageRemovedFromProjection: false,
    })).toBe(true);
  });

  it('preserves the Messaging scope across a same-Station route switch', async () => {
    await messagingDomainRuntime.bootstrap('ptid:actor:alice');
    const before = messagingDomainRuntime.captureScope();
    const resetsBeforeSwitch = lifecycle.resetProjection.mock.calls.length;

    eventBus.publish(EVENT.STATION_ACTIVE_CHANGED, {
      stationPeerId: 'station-a',
      routeId: 'relay-a',
    });
    await Promise.resolve();

    expect(messagingDomainRuntime.captureScope()).toEqual(before);
    expect(lifecycle.resetProjection).toHaveBeenCalledTimes(resetsBeforeSwitch);
  });

  it('rejects an async command result after the active scope is invalidated', async () => {
    let resolveCommand!: (value: never[]) => void;
    mocks.listConversations.mockReturnValue(new Promise((resolve) => {
      resolveCommand = resolve;
    }));
    await messagingDomainRuntime.bootstrap('ptid:actor:alice');

    const result = messagingCommands.listConversations();
    messagingDomainRuntime.teardown();
    resolveCommand([]);

    await expect(result).rejects.toBeInstanceOf(MessagingRuntimeScopeChangedError);
  });

  it('scope-fences conversation reads as well as Messaging commands', async () => {
    mocks.getConversation.mockResolvedValue({ conversationId: 'direct-1' });
    await messagingDomainRuntime.bootstrap('ptid:actor:alice');

    await messagingConversations.getConversation('direct-1');

    expect(mocks.getConversation).toHaveBeenCalledWith('direct-1');
  });

  it('rejects bootstrap when the authenticated actor changes during scope resolution', async () => {
    mocks.accountGetActive.mockImplementation(async () => {
      mocks.actorPtid = 'ptid:actor:bob';
      return { id: 'profile-alice' };
    });

    await expect(
      messagingDomainRuntime.bootstrap('ptid:actor:alice'),
    ).rejects.toBeInstanceOf(MessagingRuntimeScopeChangedError);
    expect(messagingDomainRuntime.captureScope()).toBeNull();
  });

  it('rebuilds Chat scope after a recovered profile becomes active', async () => {
    mocks.accountGetDeviceId.mockRejectedValueOnce(new Error('recovery required'));
    await expect(messagingDomainRuntime.bootstrap(mocks.actorPtid)).rejects.toThrow('recovery required');
    mocks.accountGetDeviceId.mockResolvedValue({ device_id: 'device-recovered' });

    activateProfile();
    await vi.advanceTimersByTimeAsync(0);

    expect(messagingDomainRuntime.captureScope()).toMatchObject({ endpointId: 'device-recovered' });
    expect(lifecycle.reconcile).toHaveBeenCalledWith('runtime:bootstrap',
      expect.objectContaining({ endpointId: 'device-recovered' }));
  });

  it('retries missing scope during periodic reconciliation when activation wake is lost', async () => {
    mocks.accountGetDeviceId.mockRejectedValueOnce(new Error('recovery required'));
    await expect(messagingDomainRuntime.bootstrap(mocks.actorPtid)).rejects.toThrow();
    mocks.accountGetDeviceId.mockResolvedValue({ device_id: 'device-recovered' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(messagingDomainRuntime.captureScope()).toMatchObject({ endpointId: 'device-recovered' });
  });

  it.each([
    { actorPtid: 'ptid:actor:bob' }, { sessionEpoch: 0 },
    { profileId: '' }, { stationPeerId: '' }, { endpointId: '' },
  ])('ignores activation outside the authenticated scope: %j', async (binding) => {
    await messagingDomainRuntime.bootstrap(mocks.actorPtid);
    const before = messagingDomainRuntime.captureScope();
    activateProfile(binding);
    await vi.advanceTimersByTimeAsync(0);
    expect(messagingDomainRuntime.captureScope()).toEqual(before);
  });

  it.each([
    { profileId: 'other-profile' }, { stationPeerId: 'other-station' }, { endpointId: 'obsolete-device' },
  ])('rejects activation that differs from native scope readback: %j', async (binding) => {
    await messagingDomainRuntime.bootstrap(mocks.actorPtid);
    activateProfile(binding);
    await vi.advanceTimersByTimeAsync(0);
    expect(messagingDomainRuntime.captureScope()).toBeNull();
  });

  it('drops a queued Station refresh after teardown without touching projections', async () => {
    await messagingDomainRuntime.bootstrap(mocks.actorPtid);
    eventBus.publish(EVENT.STATION_ACTIVE_CHANGED, { stationPeerId: 'station-b', routeId: 'b' });
    messagingDomainRuntime.teardown();
    const resetCount = lifecycle.resetProjection.mock.calls.length;
    await vi.advanceTimersByTimeAsync(0);
    expect(messagingDomainRuntime.captureScope()).toBeNull();
    expect(lifecycle.resetProjection).toHaveBeenCalledTimes(resetCount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('invalidates commands immediately when a new Session is accepted for the same Actor', async () => {
    await messagingDomainRuntime.bootstrap(mocks.actorPtid);
    const pending = deferred<never[]>();
    mocks.listConversations.mockReturnValue(pending.promise);
    const command = messagingCommands.listConversations();
    const failure = expect(command).rejects.toBeInstanceOf(MessagingRuntimeScopeChangedError);
    mocks.sessionEpoch += 1;
    pending.resolve([]);
    await failure;
  });

  it('rejects bootstrap completion from the previous same-Actor Session', async () => {
    const pending = deferred<{ device_id: string }>();
    mocks.accountGetDeviceId.mockReturnValueOnce(pending.promise);
    const bootstrap = messagingDomainRuntime.bootstrap(mocks.actorPtid);
    const failure = expect(bootstrap).rejects.toBeInstanceOf(MessagingRuntimeScopeChangedError);
    mocks.sessionEpoch += 1;
    pending.resolve({ device_id: 'old-device' });
    await failure;
    expect(messagingDomainRuntime.captureScope()).toBeNull();
    expect(lifecycle.reconcile).not.toHaveBeenCalled();
  });
});
