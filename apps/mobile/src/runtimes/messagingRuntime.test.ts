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
    messages: {} as Record<string, never[]>,
    activeSessionUlid: null as string | null,
    refreshSessions: vi.fn(async () => undefined),
    loadMessages: vi.fn(async (_id: string) => undefined),
  };
  const group = {
    authSession: session,
    groups: [{ ulid: 'group-a' }, { ulid: 'group-b' }],
    messages: {} as Record<string, never[]>,
    activeGroupUlid: null as string | null,
    refreshGroups: vi.fn(async () => undefined),
    refreshUnreadCounts: vi.fn(async () => undefined),
    loadMessages: vi.fn(async (_id: string) => undefined),
  };
  const readinessReady = vi.fn();
  const readinessFail = vi.fn();
  return {
    session, social, group,
    events: new Map<string, (event: { payload: unknown }) => void>(),
    unlisten: vi.fn(),
    unsubscribe: vi.fn(),
    list: vi.fn(async () => [
      { conversationId: 'direct-a', kind: 1 },
      { conversationId: 'direct-b', kind: 1 },
      { conversationId: 'group-a', kind: 2 },
      { conversationId: 'group-b', kind: 2 },
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
vi.mock('../features/group/groupStore', () => ({
  useGroupStore: { getState: () => ports.group },
}));
vi.mock('../services/mobileCommands', () => ({
  messagingActivate: vi.fn(async () => ({
    profileId: 'profile-a',
    deviceId: 'device-a',
    activationGeneration: 1,
    laneSequence: 0,
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
    ports.group.authSession = ports.session;
    ports.social.messages = {};
    ports.group.messages = {};
    ports.social.activeSessionUlid = null;
    ports.group.activeGroupUlid = null;
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
    expect(ports.group.refreshUnreadCounts).toHaveBeenCalledOnce();
    expect(ports.social.loadMessages).not.toHaveBeenCalled();
    expect(ports.group.loadMessages).not.toHaveBeenCalled();
  });

  it('refreshes active and previously materialized histories only', async () => {
    ports.social.messages = { 'direct-a': [] };
    ports.group.activeGroupUlid = 'group-b';
    await start();
    expect(ports.social.loadMessages.mock.calls).toEqual([['direct-a']]);
    expect(ports.group.loadMessages.mock.calls).toEqual([['group-b']]);
    await reconcileActiveMessagingSession();
    expect(ports.social.loadMessages).toHaveBeenCalledTimes(2);
    expect(ports.group.loadMessages).toHaveBeenCalledTimes(2);
  });

  it('routes inactive Direct events to summaries without marking history read', async () => {
    await start();
    deliver('direct-b');
    await vi.waitFor(() => expect(ports.social.refreshSessions).toHaveBeenCalledTimes(2));
    expect(ports.social.loadMessages).not.toHaveBeenCalled();
  });

  it('routes inactive Group events to summaries without hydrating history', async () => {
    await start();
    deliver('group-a');
    await vi.waitFor(() => expect(ports.group.refreshUnreadCounts).toHaveBeenCalledTimes(2));
    expect(ports.group.loadMessages).not.toHaveBeenCalled();
  });

  it('updates a materialized target and deduplicates its lane sequence', async () => {
    await start();
    ports.social.messages = { 'direct-a': [] };
    deliver('direct-a');
    deliver('direct-a');
    await vi.waitFor(() => expect(ports.social.refreshSessions).toHaveBeenCalledTimes(2));
    expect(ports.social.loadMessages.mock.calls).toEqual([['direct-a']]);
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
    deliver('group-a');
    await vi.waitFor(() => expect(ports.list).toHaveBeenCalledOnce());
    ports.group.authSession = {
      ...ports.session, actorRef: { ptid: 'ptid:bob' },
    };
    resolve([{ conversationId: 'group-a', kind: 2 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(ports.group.refreshUnreadCounts).toHaveBeenCalledOnce();
    expect(ports.group.loadMessages).not.toHaveBeenCalled();
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
      expect.objectContaining({ message: 'mobile.lifecycle.runtimeFailed' }),
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
