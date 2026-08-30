import { createDesktopStore } from './createDesktopStore';
import {
  applyAllChatNotificationsRead,
  applyChatNotificationsRead,
  deleteChatNotifications,
  mergeChatNotifications,
} from '@peers-touch/client-chat-core';

import { api, isUnauthorizedError, type NotificationData, type NotificationUnreadCountsResponse } from '../services/desktop_api';
import { currentAuthenticatedActorPtid } from './session';
import { log } from '../utils/logger';

const POLL_INTERVAL = 15_000;
const MAX_ITEMS = 200;
const NOTIFICATION_STATUS_UNREAD = 1;
const NOTIFICATION_STATUS_READ = 2;

interface NotificationStore {
  notifications: NotificationData[];
  unreadTotal: number;
  unreadByCategory: Record<number, number>;
  loading: boolean;
  hasMore: boolean;
  nextCursor: string;
  pollTimer: ReturnType<typeof setInterval> | null;

  loadNotifications: () => Promise<void>;
  loadMore: () => Promise<void>;
  refreshUnreadCounts: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: (category?: number) => Promise<void>;
  deleteNotifications: (ids: string[]) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useNotificationStore = createDesktopStore<NotificationStore>('notification', (set, get) => ({
  notifications: [],
  unreadTotal: 0,
  unreadByCategory: {},
  loading: false,
  hasMore: false,
  nextCursor: '',
  pollTimer: null,

  loadNotifications: async () => {
    if (!currentAuthenticatedActorPtid()) {
      set({ loading: false });
      return;
    }
    set({ loading: true });
    try {
      const resp = await api.notificationList(undefined, undefined, undefined, 20);
      set({
        notifications: (resp.notifications || []).slice(0, MAX_ITEMS),
        unreadTotal: resp.unreadCount || 0,
        hasMore: !!resp.nextCursor,
        nextCursor: resp.nextCursor || '',
        loading: false,
      });
    } catch (err) {
      if (isUnauthorizedError(err)) {
        set({ loading: false });
        return;
      }
      log.error('notification', 'Failed to load notifications', err);
      set({ loading: false });
    }
  },

  loadMore: async () => {
    if (!currentAuthenticatedActorPtid()) return;
    const { nextCursor, loading, hasMore } = get();
    if (loading || !hasMore || !nextCursor) return;

    set({ loading: true });
    try {
      const resp = await api.notificationList(undefined, undefined, nextCursor, 20);
      set((prev) => ({
        notifications: mergeChatNotifications(prev.notifications, resp.notifications || [], {
          resolveCreatedAt: notificationCreatedAtMs,
          limit: MAX_ITEMS,
        }),
        hasMore: !!resp.nextCursor,
        nextCursor: resp.nextCursor || '',
        loading: false,
      }));
    } catch (err) {
      if (isUnauthorizedError(err)) {
        set({ loading: false });
        return;
      }
      log.error('notification', 'Failed to load more notifications', err);
      set({ loading: false });
    }
  },

  refreshUnreadCounts: async () => {
    if (!currentAuthenticatedActorPtid()) {
      set({ unreadTotal: 0, unreadByCategory: {} });
      return;
    }
    try {
      const resp: NotificationUnreadCountsResponse = await api.notificationUnreadCounts();
      set({
        unreadTotal: resp.total || 0,
        unreadByCategory: resp.byCategory || {},
      });
    } catch (err) {
      if (isUnauthorizedError(err)) return;
      // Silently ignore — will retry on next poll
    }
  },

  markRead: async (ids: string[]) => {
    if (!currentAuthenticatedActorPtid()) return;
    try {
      await api.notificationMarkRead(ids);
      set((prev) => ({
        notifications: applyChatNotificationsRead(prev.notifications, ids, NOTIFICATION_STATUS_READ, new Date().toISOString()),
        unreadTotal: Math.max(0, prev.unreadTotal - countUnreadTargets(prev.notifications, ids)),
      }));
    } catch (err) {
      if (isUnauthorizedError(err)) return;
      log.error('notification', 'Failed to mark notifications read', err);
    }
  },

  markAllRead: async (category?: number) => {
    if (!currentAuthenticatedActorPtid()) return;
    try {
      await api.notificationMarkAllRead(category);
      set((prev) => ({
        notifications: applyAllChatNotificationsRead(
          prev.notifications,
          NOTIFICATION_STATUS_READ,
          new Date().toISOString(),
          category || undefined,
        ),
        unreadTotal: category ? prev.unreadTotal : 0,
        unreadByCategory: category
          ? { ...prev.unreadByCategory, [category]: 0 }
          : {},
      }));
    } catch (err) {
      if (isUnauthorizedError(err)) return;
      log.error('notification', 'Failed to mark all notifications read', err);
    }
  },

  deleteNotifications: async (ids: string[]) => {
    if (!currentAuthenticatedActorPtid()) return;
    try {
      await api.notificationDelete(ids);
      set((prev) => ({
        notifications: deleteChatNotifications(prev.notifications, ids),
      }));
      get().refreshUnreadCounts();
    } catch (err) {
      if (isUnauthorizedError(err)) return;
      log.error('notification', 'Failed to delete notifications', err);
    }
  },

  startPolling: () => {
    if (!currentAuthenticatedActorPtid()) {
      get().stopPolling();
      set({ notifications: [], unreadTotal: 0, unreadByCategory: {}, loading: false });
      return;
    }
    const { pollTimer } = get();
    if (pollTimer) return;

    get().loadNotifications();
    get().refreshUnreadCounts();

    const timer = setInterval(() => {
      get().refreshUnreadCounts();
    }, POLL_INTERVAL);
    set({ pollTimer: timer });
  },

  stopPolling: () => {
    const { pollTimer } = get();
    if (pollTimer) {
      clearInterval(pollTimer);
      set({ pollTimer: null });
    }
  },
}));

function notificationCreatedAtMs(notification: NotificationData): number {
  const parsed = Date.parse(notification.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function countUnreadTargets(notifications: NotificationData[], ids: string[]): number {
  const targetIds = new Set(ids);
  return notifications.filter((notification) =>
    targetIds.has(notification.id) && notification.status === NOTIFICATION_STATUS_UNREAD,
  ).length;
}
