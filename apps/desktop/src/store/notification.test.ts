import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationData } from '../services/desktop_api';

const api = vi.hoisted(() => ({
  notificationList: vi.fn(),
  notificationUnreadCounts: vi.fn(),
  notificationMarkRead: vi.fn(),
  notificationMarkAllRead: vi.fn(),
  notificationDelete: vi.fn(),
}));
const session = vi.hoisted(() => ({ actorPtid: 'ptid:self', sessionEpoch: 1 }));
vi.mock('../services/desktop_api', () => ({ api, isUnauthorizedError: () => false }));
vi.mock('./session', () => ({
  currentAuthenticatedActorPtid: () => session.actorPtid,
  useSessionStore: { getState: () => session },
}));
import { useNotificationStore } from './notification';

function item(id: string): NotificationData {
  return {
    id, recipientPtid: 'ptid:self', actorPtid: 'ptid:other', type: 200, category: 2,
    status: 1, targetType: 'friend_request', targetId: id, title: '', body: '',
    metadata: {}, groupKey: '', createdAt: '2026-10-14T00:00:00Z',
  };
}

describe('notification reconciliation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    session.sessionEpoch = 1;
    useNotificationStore.getState().reset();
  });
  afterEach(() => useNotificationStore.getState().reset());

  it('uses authoritative counts after a category read including unloaded notifications', async () => {
    useNotificationStore.setState({ notifications: [item('visible')], unreadTotal: 19 });
    api.notificationMarkAllRead.mockResolvedValueOnce({ updatedCount: 9 });
    api.notificationUnreadCounts.mockResolvedValueOnce({ total: 10, byCategory: { 1: 10, 2: 0 } });
    await useNotificationStore.getState().markAllRead(2);
    expect(useNotificationStore.getState()).toMatchObject({
      unreadTotal: 10, unreadByCategory: { 1: 10, 2: 0 },
    });
    expect(useNotificationStore.getState().notifications[0].status).toBe(2);
  });

  it('does not let a pre-mutation count response overwrite reconciliation', async () => {
    let complete!: (value: { total: number; byCategory: Record<number, number> }) => void;
    api.notificationUnreadCounts.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }))
      .mockResolvedValueOnce({ total: 2, byCategory: { 2: 2 } });
    const oldRead = useNotificationStore.getState().refreshUnreadCounts();
    api.notificationMarkRead.mockResolvedValueOnce({ updatedCount: 1 });
    await useNotificationStore.getState().markRead(['visible']);
    complete({ total: 3, byCategory: { 2: 3 } });
    await oldRead;
    expect(useNotificationStore.getState().unreadTotal).toBe(2);
  });

  it('keeps loaded history through a runtime refresh', async () => {
    const first = Array.from({ length: 20 }, (_, index) => item(`first-${index}`));
    const second = Array.from({ length: 20 }, (_, index) => item(`second-${index}`));
    useNotificationStore.setState({ notifications: [...first, ...second], nextCursor: 'third', hasMore: true });
    api.notificationList.mockResolvedValueOnce({
      notifications: first, nextCursor: 'second', totalCount: 60, unreadCount: 0,
    }).mockResolvedValueOnce({
      notifications: second, nextCursor: 'third', totalCount: 60, unreadCount: 0,
    });
    await useNotificationStore.getState().loadNotifications();
    expect(useNotificationStore.getState().notifications).toHaveLength(40);
    expect(useNotificationStore.getState().nextCursor).toBe('third');
    expect(api.notificationList).toHaveBeenLastCalledWith(undefined, undefined, 'second', 20);
  });

  it('stops a repeated cursor and preserves the previous list for retry', async () => {
    const previous = Array.from({ length: 40 }, (_, index) => item(`previous-${index}`));
    useNotificationStore.setState({ notifications: previous });
    api.notificationList.mockResolvedValue({
      notifications: previous.slice(0, 20), nextCursor: 'repeated', totalCount: 40, unreadCount: 0,
    });
    await useNotificationStore.getState().loadNotifications();
    expect(api.notificationList).toHaveBeenCalledTimes(2);
    expect(useNotificationStore.getState()).toMatchObject({
      notifications: previous, loading: false, error: 'layout.notifications.loadFailed',
    });
  });

  it('drops responses from an earlier session of the same actor', async () => {
    let complete!: (value: { total: number; byCategory: Record<number, number> }) => void;
    api.notificationUnreadCounts.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const request = useNotificationStore.getState().refreshUnreadCounts();
    session.sessionEpoch += 1;
    useNotificationStore.getState().reset();
    complete({ total: 8, byCategory: { 2: 8 } });
    await request;
    expect(useNotificationStore.getState().unreadTotal).toBe(0);
  });

  it('preserves loaded history when the next page cursor does not advance', async () => {
    const previous = [item('visible')];
    useNotificationStore.setState({ notifications: previous, nextCursor: 'same', hasMore: true });
    api.notificationList.mockResolvedValueOnce({
      notifications: [item('unconfirmed')], nextCursor: 'same', totalCount: 40,
    });
    await useNotificationStore.getState().loadMore();
    expect(useNotificationStore.getState()).toMatchObject({
      notifications: previous, nextCursor: 'same', hasMore: true,
      loading: false, error: 'layout.notifications.loadFailed',
    });
  });

  it('retains the last known count and exposes a retryable failure', async () => {
    useNotificationStore.setState({ unreadTotal: 7 });
    api.notificationUnreadCounts.mockRejectedValueOnce(new Error('offline'));
    await useNotificationStore.getState().refreshUnreadCounts();
    expect(useNotificationStore.getState()).toMatchObject({
      unreadTotal: 7, countsError: 'layout.notifications.countsFailed',
    });
  });
});
