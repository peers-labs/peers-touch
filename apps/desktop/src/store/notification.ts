import { create } from 'zustand';
import { api, type NotificationData, type NotificationUnreadCountsResponse } from '../services/desktop_api';
import { log } from '../utils/logger';

const POLL_INTERVAL = 15_000;
const MAX_ITEMS = 200;

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

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadTotal: 0,
  unreadByCategory: {},
  loading: false,
  hasMore: false,
  nextCursor: '',
  pollTimer: null,

  loadNotifications: async () => {
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
      log.error('notification', 'Failed to load notifications', err);
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { nextCursor, loading, hasMore } = get();
    if (loading || !hasMore || !nextCursor) return;

    set({ loading: true });
    try {
      const resp = await api.notificationList(undefined, undefined, nextCursor, 20);
      set((prev) => ({
        notifications: [...prev.notifications, ...(resp.notifications || [])].slice(0, MAX_ITEMS),
        hasMore: !!resp.nextCursor,
        nextCursor: resp.nextCursor || '',
        loading: false,
      }));
    } catch (err) {
      log.error('notification', 'Failed to load more notifications', err);
      set({ loading: false });
    }
  },

  refreshUnreadCounts: async () => {
    try {
      const resp: NotificationUnreadCountsResponse = await api.notificationUnreadCounts();
      set({
        unreadTotal: resp.total || 0,
        unreadByCategory: resp.byCategory || {},
      });
    } catch {
      // Silently ignore — will retry on next poll
    }
  },

  markRead: async (ids: string[]) => {
    try {
      await api.notificationMarkRead(ids);
      set((prev) => ({
        notifications: prev.notifications.map((n) =>
          ids.includes(n.id) ? { ...n, status: 2, readAt: new Date().toISOString() } : n,
        ),
        unreadTotal: Math.max(0, prev.unreadTotal - ids.length),
      }));
    } catch (err) {
      log.error('notification', 'Failed to mark notifications read', err);
    }
  },

  markAllRead: async (category?: number) => {
    try {
      await api.notificationMarkAllRead(category);
      set((prev) => ({
        notifications: prev.notifications.map((n) => {
          if (category && n.category !== category) return n;
          return { ...n, status: 2, readAt: new Date().toISOString() };
        }),
        unreadTotal: category ? prev.unreadTotal : 0,
        unreadByCategory: category
          ? { ...prev.unreadByCategory, [category]: 0 }
          : {},
      }));
    } catch (err) {
      log.error('notification', 'Failed to mark all notifications read', err);
    }
  },

  deleteNotifications: async (ids: string[]) => {
    try {
      await api.notificationDelete(ids);
      set((prev) => ({
        notifications: prev.notifications.filter((n) => !ids.includes(n.id)),
      }));
      get().refreshUnreadCounts();
    } catch (err) {
      log.error('notification', 'Failed to delete notifications', err);
    }
  },

  startPolling: () => {
    const { pollTimer } = get();
    if (pollTimer) return;

    get().loadNotifications();
    get().refreshUnreadCounts();

    const timer = setInterval(() => {
      get().loadNotifications();
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
