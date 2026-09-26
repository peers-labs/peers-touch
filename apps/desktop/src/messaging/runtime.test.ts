import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProjectionKind } from '../gen/proto/domain/chat/event_pb';

const mocks = vi.hoisted(() => ({
  actorPtid: 'ptid:actor:alice',
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
    subscribe: vi.fn(() => () => undefined),
  },
}));

import {
  MessagingRuntimeScopeChangedError,
  messagingCommands,
  messagingConversations,
  messagingDomainRuntime,
} from './runtime';

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
    mocks.actorPtid = 'ptid:actor:alice';
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
    })).toBe(true);
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
});
