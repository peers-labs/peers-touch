/**
 * notificationGateway.ts — Notification domain API gateway
 *
 * Wraps notification list, read/delete, and unread count APIs behind a
 * typed gateway with JSON quarantine and command outcome adapters.
 */

import type { MobileAuthSession } from '../../features/auth/authSession';
import { normalizeNotification, normalizeUnreadCounts } from '../../features/social/socialNormalizers';
import type { SocialNotification, UnreadCounts } from '../../features/social/socialTypes';
import {
  createGatewayTransport,
  type CommandOutcome,
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// Raw JSON shapes from Station (quarantined)
// ---------------------------------------------------------------------------

interface ListNotificationsRaw {
  notifications?: Partial<SocialNotification>[];
  nextCursor?: string;
  next_cursor?: string;
  totalCount?: number;
  total_count?: number;
  unreadCount?: number;
  unread_count?: number;
}

interface UnreadCountsRaw {
  total?: number;
  byCategory?: Record<string, number>;
  by_category?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Gateway output types
// ---------------------------------------------------------------------------

export interface NotificationListResult {
  readonly notifications: SocialNotification[];
  readonly nextCursor: string;
  readonly totalCount: number;
  readonly unreadCount: number;
}

// ---------------------------------------------------------------------------
// Notification gateway interface
// ---------------------------------------------------------------------------

export interface NotificationGateway {
  listNotifications: (limit?: number, cursor?: string) => Promise<CommandOutcome<NotificationListResult>>;
  getUnreadCounts: () => Promise<CommandOutcome<UnreadCounts>>;
  markNotificationsRead: (notificationIds: string[]) => Promise<CommandOutcome<Record<string, unknown>>>;
  markAllNotificationsRead: (category?: number) => Promise<CommandOutcome<Record<string, unknown>>>;
  deleteNotifications: (notificationIds: string[]) => Promise<CommandOutcome<Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createNotificationGateway(session: MobileAuthSession): NotificationGateway {
  const { command } = createGatewayTransport(session, 'notification');

  return {
    listNotifications: async (limit = 30, cursor) => {
      const result = await command<ListNotificationsRaw>({
        method: 'GET',
        path: '/notification/list',
        query: { limit, cursor },
      });
      if (!result.ok) return result;
      // JSON quarantine: normalize each notification
      const notifications = (result.data.notifications ?? []).map(normalizeNotification);
      return {
        ok: true,
        data: {
          notifications,
          nextCursor: String(result.data.nextCursor ?? result.data.next_cursor ?? ''),
          totalCount: Number(result.data.totalCount ?? result.data.total_count ?? 0),
          unreadCount: Number(result.data.unreadCount ?? result.data.unread_count ?? 0),
        },
      };
    },

    getUnreadCounts: async () => {
      const result = await command<UnreadCountsRaw>({
        method: 'GET',
        path: '/notification/unread-counts',
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizeUnreadCounts(result.data as UnreadCounts) };
    },

    markNotificationsRead: (notificationIds) =>
      command({
        method: 'POST',
        path: '/notification/mark-read',
        body: { notification_ids: notificationIds },
      }),

    markAllNotificationsRead: (category = 0) =>
      command({
        method: 'POST',
        path: '/notification/mark-all-read',
        body: { category },
      }),

    deleteNotifications: (notificationIds) =>
      command({
        method: 'POST',
        path: '/notification/delete',
        body: { notification_ids: notificationIds },
      }),
  };
}
