import { createDesktopStore } from './createDesktopStore';
import {
  applyAllChatNotificationsRead,
  applyChatNotificationsRead,
  deleteChatNotifications,
  mergeChatNotifications,
} from '@peers-touch/client-chat-core';

import { api, isUnauthorizedError, type NotificationData, type NotificationUnreadCountsResponse } from '../services/desktop_api';
import { currentAuthenticatedActorPtid, useSessionStore } from './session';
import { log } from '../utils/logger';

const POLL_INTERVAL = 15_000;
const PAGE_SIZE = 20;
const NOTIFICATION_STATUS_READ = 2;
let listGeneration = 0;
let countsGeneration = 0;

function sessionKey(): string | null {
  const actorPtid = currentAuthenticatedActorPtid();
  return actorPtid ? `${actorPtid}\0${useSessionStore.getState().sessionEpoch}` : null;
}

interface NotificationStore {
  notifications: NotificationData[];
  unreadTotal: number;
  unreadByCategory: Record<number, number>;
  loading: boolean;
  error: string | null;
  countsError: string | null;
  pendingIds: string[];
  markingAllRead: boolean;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string;
  pollTimer: ReturnType<typeof setInterval> | null;

  reset: () => void;
  loadNotifications: () => Promise<void>;
  loadMore: () => Promise<void>;
  refreshUnreadCounts: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: (category?: number) => Promise<void>;
  deleteNotifications: (ids: string[]) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

const initialNotificationState = {
  notifications: [] as NotificationData[],
  unreadTotal: 0,
  unreadByCategory: {} as Record<number, number>,
  loading: false,
  error: null as string | null,
  countsError: null as string | null,
  pendingIds: [] as string[],
  markingAllRead: false,
  totalCount: 0,
  hasMore: false,
  nextCursor: '',
  pollTimer: null as ReturnType<typeof setInterval> | null,
};

export const useNotificationStore = createDesktopStore<NotificationStore>('notification', (set, get) => ({
  ...initialNotificationState,

  reset: () => {
    listGeneration += 1;
    countsGeneration += 1;
    const { pollTimer } = get();
    if (pollTimer) clearInterval(pollTimer);
    set({ ...initialNotificationState });
  },

  loadNotifications: async () => {
    const scope = sessionKey();
    if (!scope) {
      set({ loading: false });
      return;
    }
    const generation = ++listGeneration;
    const visibleCount = Math.max(PAGE_SIZE, get().notifications.length);
    set({ loading: true, error: null });
    try {
      let cursor: string | undefined;
      let notifications: NotificationData[] = [];
      let totalCount = 0;
      const visitedCursors = new Set<string>();
      do {
        if (cursor) {
          if (visitedCursors.has(cursor)) throw new Error('Notification pagination did not advance');
          visitedCursors.add(cursor);
        }
        const resp = await api.notificationList(undefined, undefined, cursor, PAGE_SIZE);
        if (sessionKey() !== scope || generation !== listGeneration) return;
        notifications = mergeChatNotifications(notifications, resp.notifications || [], {
          resolveCreatedAt: notificationCreatedAtMs,
        });
        totalCount = resp.totalCount;
        cursor = resp.nextCursor || undefined;
      } while (cursor && notifications.length < visibleCount);

      set({
        notifications,
        totalCount,
        hasMore: !!cursor,
        nextCursor: cursor || '',
        loading: false,
      });
    } catch (err) {
      if (sessionKey() !== scope || generation !== listGeneration) return;
      if (isUnauthorizedError(err)) {
        set({ loading: false });
        return;
      }
      log.error('notification', 'Failed to load notifications', err);
      set({ loading: false, error: 'layout.notifications.loadFailed' });
    }
  },

  loadMore: async () => {
    const scope = sessionKey();
    if (!scope) return;
    const { nextCursor, loading, hasMore } = get();
    if (loading || !hasMore || !nextCursor) return;

    const generation = ++listGeneration;
    set({ loading: true, error: null });
    try {
      const resp = await api.notificationList(undefined, undefined, nextCursor, PAGE_SIZE);
      if (sessionKey() !== scope || generation !== listGeneration) return;
      if (resp.nextCursor === nextCursor) throw new Error('Notification pagination did not advance');

      set((prev) => ({
        notifications: mergeChatNotifications(prev.notifications, resp.notifications || [], {
          resolveCreatedAt: notificationCreatedAtMs,
        }),
        totalCount: resp.totalCount,
        hasMore: !!resp.nextCursor,
        nextCursor: resp.nextCursor || '',
        loading: false,
      }));
    } catch (err) {
      if (sessionKey() !== scope || generation !== listGeneration) return;
      if (isUnauthorizedError(err)) {
        set({ loading: false });
        return;
      }
      log.error('notification', 'Failed to load more notifications', err);
      set({ loading: false, error: 'layout.notifications.loadFailed' });
    }
  },

  refreshUnreadCounts: async () => {
    const scope = sessionKey();
    if (!scope) {
      set({ unreadTotal: 0, unreadByCategory: {} });
      return;
    }
    const generation = ++countsGeneration;
    try {
      const resp: NotificationUnreadCountsResponse = await api.notificationUnreadCounts();
      if (sessionKey() !== scope || generation !== countsGeneration) return;

      set({
        unreadTotal: resp.total || 0,
        unreadByCategory: resp.byCategory || {},
        countsError: null,
      });
    } catch (err) {
      if (sessionKey() !== scope || generation !== countsGeneration) return;
      if (isUnauthorizedError(err)) return;
      log.warn('notification', 'Unread reconciliation failed', err);
      set({ countsError: 'layout.notifications.countsFailed' });
    }
  },

  markRead: async (ids: string[]) => {
    const scope = sessionKey();
    if (!scope || ids.some((id) => get().pendingIds.includes(id))) return;
    set((state) => ({ pendingIds: [...state.pendingIds, ...ids], error: null }));
    try {
      await api.notificationMarkRead(ids);
      if (sessionKey() !== scope) return;
      listGeneration += 1;
      countsGeneration += 1;

      set((prev) => ({
        notifications: applyChatNotificationsRead(prev.notifications, ids, NOTIFICATION_STATUS_READ, new Date().toISOString()),
        loading: false,
      }));
      await get().refreshUnreadCounts();
    } catch (err) {
      if (sessionKey() !== scope) return;
      if (isUnauthorizedError(err)) return;
      log.error('notification', 'Failed to mark notifications read', err);
      set({ error: 'layout.notifications.actionFailed' });
    } finally {
      if (sessionKey() === scope) {
        set((state) => ({ pendingIds: state.pendingIds.filter((id) => !ids.includes(id)) }));
      }
    }
  },

  markAllRead: async (category?: number) => {
    const scope = sessionKey();
    if (!scope || get().markingAllRead) return;
    set({ markingAllRead: true, error: null });
    try {
      await api.notificationMarkAllRead(category);
      if (sessionKey() !== scope) return;
      listGeneration += 1;
      countsGeneration += 1;

      set((prev) => ({
        notifications: applyAllChatNotificationsRead(
          prev.notifications,
          NOTIFICATION_STATUS_READ,
          new Date().toISOString(),
          category || undefined,
        ),
        loading: false,
      }));
      await get().refreshUnreadCounts();
    } catch (err) {
      if (sessionKey() !== scope) return;
      if (isUnauthorizedError(err)) return;
      log.error('notification', 'Failed to mark all notifications read', err);
      set({ error: 'layout.notifications.actionFailed' });
    } finally {
      if (sessionKey() === scope) set({ markingAllRead: false });
    }
  },

  deleteNotifications: async (ids: string[]) => {
    const scope = sessionKey();
    if (!scope || ids.some((id) => get().pendingIds.includes(id))) return;
    set((state) => ({ pendingIds: [...state.pendingIds, ...ids], error: null }));
    try {
      await api.notificationDelete(ids);
      if (sessionKey() !== scope) return;
      listGeneration += 1;
      countsGeneration += 1;

      set((prev) => ({
        notifications: deleteChatNotifications(prev.notifications, ids),
        loading: false,
      }));
      await Promise.all([get().refreshUnreadCounts(), get().loadNotifications()]);
    } catch (err) {
      if (sessionKey() !== scope) return;
      if (isUnauthorizedError(err)) return;
      log.error('notification', 'Failed to delete notifications', err);
      set({ error: 'layout.notifications.actionFailed' });
    } finally {
      if (sessionKey() === scope) {
        set((state) => ({ pendingIds: state.pendingIds.filter((id) => !ids.includes(id)) }));
      }
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
  const parsed = notification.createdAt ? Date.parse(notification.createdAt) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}
