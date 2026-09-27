import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => {
  const session = {
    stationPeerId: 'station-a',
    stationUrl: 'https://station.example',
    sessionId: 'session-a',
    deviceId: 'device-a',
    lifecycleGeneration: 1,
    actorRef: { ptid: 'ptid:alice' },
    authenticatedAt: 1,
  };
  const social = {
    authSession: session,
    sessions: [{ ulid: 'direct-a' }, { ulid: 'direct-b' }],
    messagingConversations: [
      { conversationId: 'direct-a', kind: 1 },
      { conversationId: 'direct-b', kind: 1 },
      { conversationId: 'group-a', kind: 2 },
    ],
    messages: {} as Record<string, never[]>,
    activeSessionUlid: null as string | null,
    refreshSessions: vi.fn(async () => undefined),
    loadMessages: vi.fn(async (_id: string) => undefined),
  };
  const readinessReady = vi.fn();
  const readinessFail = vi.fn();
  return {
    session, social,
    events: new Map<string, (event: { payload: unknown }) => void>(),
    unlisten: vi.fn(),
    unsubscribe: vi.fn(),
    list: vi.fn(async () => [
      { conversationId: 'direct-a', kind: 1 },
      { conversationId: 'direct-b', kind: 1 },
    ]),
    reconcile: vi.fn(async () => ({})),
    deactivate: vi.fn(async () => undefined),
    readinessReady,
    readinessFail,
    beginReadinessUpdate: vi.fn(() => ({
      isCurrent: () => true,
      waitForDependencies: async () => true,
      ready: readinessReady,
      fail: readinessFail,
    })),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    ports.events.set(name, callback);
    return ports.unlisten;
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('../features/auth/authSession', () => ({ isAccessGranted: () => true }));
vi.mock('../features/auth/authStore', () => ({
  useAuthStore: {
    getState: () => ({ session: ports.session, accessDecision: {} }),
    subscribe: () => ports.unsubscribe,
  },
}));
vi.mock('../features/social/socialStore', () => ({
  useSocialStore: { getState: () => ports.social },
}));
vi.mock('../services/mobileCommands', () => ({
  messagingActivate: vi.fn(async () => ({
    profileId: 'profile-a', activationGeneration: 1, laneSequence: 0,
  })),
  messagingDeactivate: ports.deactivate,
  messagingListConversations: ports.list,
  messagingReconcile: ports.reconcile,
}));

import {
  createMessagingRuntimeDescriptor,
  MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT,
  MOBILE_MESSAGING_RUNTIME_ERROR_EVENT,
  reconcileActiveMessagingSession,
  wakeActiveMessagingSession,
} from './messagingRuntime';

const descriptors: ReturnType<typeof createMessagingRuntimeDescriptor>[] = [];
const context = {
  generation: 1,
  beginReadinessUpdate: ports.beginReadinessUpdate,
};

async function start() {
  const descriptor = createMessagingRuntimeDescriptor();
  descriptors.push(descriptor);
  await descriptor.bootstrap(context);
}

function deliver(conversationId: string, laneSequence = 1, activationGeneration = 1) {
  ports.events.get(MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT)?.({
    payload: {
      stationPeerId: ports.session.stationPeerId,
      actorPtid: ports.session.actorRef.ptid,
      profileId: 'profile-a',
      activationGeneration,
      cycleId: laneSequence,
      conversationId,
      eventId: `event-${laneSequence}`,
      laneSequence,
    },
  });
}

describe('Messaging projection hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ports.events.clear();
    ports.session.sessionId = 'session-a';
    ports.social.authSession = ports.session;
    ports.social.messagingConversations = [
      { conversationId: 'direct-a', kind: 1 },
      { conversationId: 'direct-b', kind: 1 },
      { conversationId: 'group-a', kind: 2 },
    ];
    ports.social.messages = {};
    ports.social.activeSessionUlid = null;
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(async () => {
    for (const descriptor of descriptors.splice(0)) {
      await descriptor.teardown({ reason: 'app-unmount' });
    }
    vi.unstubAllGlobals();
  });

  it('refreshes summaries without materializing unopened histories', async () => {
    await start();
    expect(ports.social.refreshSessions).toHaveBeenCalledOnce();
    expect(ports.social.loadMessages).not.toHaveBeenCalled();
  });

  it('refreshes active and previously materialized histories only', async () => {
    ports.social.messages = { 'direct-a': [] };
    await start();
    expect(ports.social.loadMessages.mock.calls).toEqual([['direct-a']]);
    await reconcileActiveMessagingSession();
    expect(ports.social.loadMessages).toHaveBeenCalledTimes(2);
  });

  it('routes inactive Direct events to summaries without marking history read', async () => {
    await start();
    deliver('direct-b');
    await vi.waitFor(() => expect(ports.social.refreshSessions).toHaveBeenCalledTimes(2));
    expect(ports.social.loadMessages).not.toHaveBeenCalled();
  });

  it('updates a materialized target and deduplicates its lane sequence', async () => {
    await start();
    ports.social.messages = { 'direct-a': [] };
    deliver('direct-a');
    deliver('direct-a');
    await vi.waitFor(() => expect(ports.social.refreshSessions).toHaveBeenCalledTimes(2));
    expect(ports.social.loadMessages.mock.calls).toEqual([['direct-a']]);
  });

  it('hydrates a materialized Group conversation through the same store owner', async () => {
    await start();
    ports.social.messages = { 'group-a': [] };
    ports.list.mockResolvedValueOnce([{ conversationId: 'group-a', kind: 2 }]);
    deliver('group-a');
    await vi.waitFor(() => expect(ports.social.refreshSessions).toHaveBeenCalledTimes(2));
    expect(ports.social.loadMessages.mock.calls).toEqual([['group-a']]);
  });

  it('ignores events from a previous native activation', async () => {
    await start();
    deliver('direct-a', 1, 0);
    await Promise.resolve();
    await Promise.resolve();
    expect(ports.list).not.toHaveBeenCalled();
    expect(ports.social.loadMessages).not.toHaveBeenCalled();
  });

  it('does not refresh replacement-account stores after a delayed lookup', async () => {
    await start();
    let resolve!: (rows: Awaited<ReturnType<typeof ports.list>>) => void;
    ports.list.mockImplementationOnce(() => new Promise((accept) => { resolve = accept; }));
    deliver('direct-a');
    await vi.waitFor(() => expect(ports.list).toHaveBeenCalledOnce());
    ports.social.authSession = {
      ...ports.session, actorRef: { ptid: 'ptid:bob' },
    };
    resolve([{ conversationId: 'direct-a', kind: 1 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(ports.social.loadMessages).not.toHaveBeenCalled();
  });

  it('publishes a failed worker cycle to lifecycle readiness and clears it after recovery', async () => {
    await start();
    ports.beginReadinessUpdate.mockClear();
    ports.readinessFail.mockClear();
    ports.readinessReady.mockClear();
    ports.reconcile.mockRejectedValueOnce(new Error('private worker failure'));

    await expect(wakeActiveMessagingSession()).rejects.toThrow(
      'private worker failure',
    );
    expect(ports.readinessFail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'private worker failure' }),
    );
    expect(ports.readinessReady).not.toHaveBeenCalled();

    await wakeActiveMessagingSession();
    expect(ports.readinessReady).toHaveBeenCalledOnce();
    expect(ports.beginReadinessUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not assign Social stream ownership failures to Messaging readiness', async () => {
    await start();
    ports.beginReadinessUpdate.mockClear();
    ports.readinessFail.mockClear();

    window.dispatchEvent(new CustomEvent(MOBILE_MESSAGING_RUNTIME_ERROR_EVENT, {
      detail: {
        operation: 'realtime-stream',
        message: 'social stream failed',
      },
    }));

    expect(ports.beginReadinessUpdate).not.toHaveBeenCalled();
    expect(ports.readinessFail).not.toHaveBeenCalled();
  });
});
