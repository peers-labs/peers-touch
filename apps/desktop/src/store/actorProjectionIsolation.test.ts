import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  api,
  type NotificationData,
} from '../services/desktop_api';
import { useNotificationStore } from './notification';
import { useSessionStore, type CurrentUser } from './session';
import { useSocialChatStore } from './socialChat';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function authenticatedUser(actorPtid: string): CurrentUser {
  return {
    actorPtid,
    name: actorPtid,
    email: `${actorPtid}@p.t`,
    loginMethod: 'password',
  };
}

function accountProfile(actorPtid: string, username: string) {
  return {
    actorPtid,
    username,
    displayName: username,
    avatar: '',
  };
}

function notification(id: string, body: string): NotificationData {
  return {
    id,
    recipientPtid: 'ptid:peer:bob',
    actorPtid: 'ptid:peer:bob',
    type: 1,
    category: 1,
    status: 1,
    targetType: '',
    targetId: '',
    title: '',
    body,
    metadata: {},
    groupKey: '',
    createdAt: '',
  };
}

async function expectStaleNotificationMutationIgnored(
  request: Promise<unknown>,
  complete: () => void,
): Promise<void> {
  useSessionStore.setState({
    authenticated: true,
    currentUser: authenticatedUser('ptid:peer:bob'),
  });
  const bobNotification = notification('shared-notification', 'Bob');
  useNotificationStore.setState({
    notifications: [bobNotification],
    unreadTotal: 7,
    unreadByCategory: { 1: 7 },
  });

  complete();
  await request;

  expect(useNotificationStore.getState().notifications).toEqual([bobNotification]);
  expect(useNotificationStore.getState().unreadTotal).toBe(7);
  expect(useNotificationStore.getState().unreadByCategory).toEqual({ 1: 7 });
}

describe('actor-scoped projection publication', () => {
  beforeEach(() => {
    useSessionStore.setState({
      authenticated: true,
      currentUser: authenticatedUser('ptid:peer:alice'),
      restoring: false,
    });
    useSocialChatStore.getState().reset();
    useNotificationStore.setState({
      notifications: [],
      unreadTotal: 0,
      unreadByCategory: {},
      loading: false,
      hasMore: false,
      nextCursor: '',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSessionStore.getState().reset();
    useSocialChatStore.getState().reset();
  });

  it('rejects a stale self-profile response after the actor changes', async () => {
    const aliceProfile = deferred<Awaited<ReturnType<typeof api.actorGetMyProfile>>>();
    vi.spyOn(api, 'actorGetMyProfile').mockReturnValueOnce(aliceProfile.promise);

    const load = useSocialChatStore.getState().loadCurrentUserProfile();
    useSessionStore.setState({
      authenticated: true,
      currentUser: authenticatedUser('ptid:peer:bob'),
    });
    useSocialChatStore.setState({
      currentUserPtid: 'ptid:peer:bob',
      currentUserProfile: {
        actorPtid: 'ptid:peer:bob',
        username: 'bob',
        displayName: 'Bob',
        avatar: '',
      },
    });

    aliceProfile.resolve(accountProfile('ptid:peer:alice', 'alice'));
    await load;

    expect(useSocialChatStore.getState().currentUserPtid).toBe('ptid:peer:bob');
    expect(useSocialChatStore.getState().currentUserProfile?.actorPtid).toBe('ptid:peer:bob');
  });

  it('rejects stale notification results after the actor changes', async () => {
    const aliceNotifications = deferred<Awaited<ReturnType<typeof api.notificationList>>>();
    const aliceUnreadCounts = deferred<Awaited<ReturnType<typeof api.notificationUnreadCounts>>>();
    vi.spyOn(api, 'notificationList').mockReturnValueOnce(aliceNotifications.promise);
    vi.spyOn(api, 'notificationUnreadCounts').mockReturnValueOnce(aliceUnreadCounts.promise);

    const notificationsLoad = useNotificationStore.getState().loadNotifications();
    const unreadLoad = useNotificationStore.getState().refreshUnreadCounts();
    useSessionStore.setState({
      authenticated: true,
      currentUser: authenticatedUser('ptid:peer:bob'),
    });
    const bobNotification = notification('bob-notification', 'Bob');
    useNotificationStore.setState({
      notifications: [bobNotification],
      unreadTotal: 7,
      unreadByCategory: { 1: 7 },
      loading: false,
    });

    aliceNotifications.resolve({
      notifications: [notification('alice-notification', 'Alice')],
      unreadCount: 1,
      nextCursor: '',
      totalCount: 1,
    });
    aliceUnreadCounts.resolve({
      total: 1,
      byCategory: { 1: 1 },
    });
    await Promise.all([notificationsLoad, unreadLoad]);

    expect(useNotificationStore.getState().notifications).toEqual([bobNotification]);
    expect(useNotificationStore.getState().unreadTotal).toBe(7);
    expect(useNotificationStore.getState().unreadByCategory).toEqual({ 1: 7 });
  });

  it('rejects a stale notification page after the actor changes', async () => {
    const alicePage = deferred<Awaited<ReturnType<typeof api.notificationList>>>();
    vi.spyOn(api, 'notificationList').mockReturnValueOnce(alicePage.promise);
    useNotificationStore.setState({
      hasMore: true,
      nextCursor: 'alice-next',
    });

    const load = useNotificationStore.getState().loadMore();
    useSessionStore.setState({
      authenticated: true,
      currentUser: authenticatedUser('ptid:peer:bob'),
    });
    const bobNotification = notification('bob-notification', 'Bob');
    useNotificationStore.setState({
      notifications: [bobNotification],
      unreadTotal: 7,
      hasMore: false,
      nextCursor: '',
      loading: false,
    });

    alicePage.resolve({
      notifications: [notification('alice-notification', 'Alice')],
      unreadCount: 1,
      nextCursor: '',
      totalCount: 1,
    });
    await load;

    expect(useNotificationStore.getState().notifications).toEqual([bobNotification]);
    expect(useNotificationStore.getState().unreadTotal).toBe(7);
  });

  it('rejects a stale mark-read completion after the actor changes', async () => {
    const completion = deferred<{ updatedCount: number }>();
    vi.spyOn(api, 'notificationMarkRead').mockReturnValueOnce(completion.promise);

    const request = useNotificationStore.getState().markRead(['shared-notification']);
    await expectStaleNotificationMutationIgnored(
      request,
      () => completion.resolve({ updatedCount: 1 }),
    );
  });

  it('rejects a stale mark-all-read completion after the actor changes', async () => {
    const completion = deferred<{ updatedCount: number }>();
    vi.spyOn(api, 'notificationMarkAllRead').mockReturnValueOnce(completion.promise);

    const request = useNotificationStore.getState().markAllRead();
    await expectStaleNotificationMutationIgnored(
      request,
      () => completion.resolve({ updatedCount: 1 }),
    );
  });

  it('rejects a stale delete completion after the actor changes', async () => {
    const completion = deferred<{ deletedCount: number }>();
    vi.spyOn(api, 'notificationDelete').mockReturnValueOnce(completion.promise);

    const request = useNotificationStore.getState().deleteNotifications([
      'shared-notification',
    ]);
    await expectStaleNotificationMutationIgnored(
      request,
      () => completion.resolve({ deletedCount: 1 }),
    );
  });

  it('clears all notification state during an actor transition', () => {
    const pollTimer = setInterval(() => undefined, 60_000);
    useNotificationStore.setState({
      notifications: [notification('alice-notification', 'Alice')],
      unreadTotal: 1,
      unreadByCategory: { 1: 1 },
      loading: true,
      hasMore: true,
      nextCursor: 'alice-next',
      pollTimer,
    });

    useNotificationStore.getState().reset();

    expect(useNotificationStore.getState()).toMatchObject({
      notifications: [],
      unreadTotal: 0,
      unreadByCategory: {},
      loading: false,
      hasMore: false,
      nextCursor: '',
      pollTimer: null,
    });
  });
});
