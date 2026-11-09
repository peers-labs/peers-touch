import { useEffect, useMemo } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Icon,
  Spin,
  Text,
  type IconId,
} from '@peers-touch/ui';

import { useMobileI18n } from '../app/mobileI18n';
import { MobileAvatar } from './MobileAvatar';
import {
  useSocialStore,
} from '../features/social/socialStore';
import { requestSocialPeerProfile } from '../features/social/socialRuntime';
import { timestampMillis } from '../features/social/socialNormalizers';
import { projectUnreadNotifications } from '../features/social/socialProjection';
import type { SocialNotification } from '../features/social/socialTypes';

const NOTIFICATION_TYPE_FRIEND_REQUEST = 200;
const NOTIFICATION_TYPE_FRIEND_ACCEPTED = 201;
const NOTIFICATION_TYPE_FRIEND_MESSAGE = 202;

interface MobileNotificationCenterProps {
  open: boolean;
  onClose: () => void;
  onOpenChat: () => void;
  onOpenContacts: () => void;
}

export function MobileNotificationCenter({ open, onClose, onOpenChat, onOpenContacts }: MobileNotificationCenterProps) {
  const { t } = useMobileI18n();
  const notifications = useSocialStore((state) => state.notifications);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const conversationSettings = useSocialStore((state) => state.conversationSettings);
  const loading = useSocialStore((state) => state.loading);
  const markNotificationRead = useSocialStore((state) => state.markNotificationRead);
  const markAllNotificationsRead = useSocialStore((state) => state.markAllNotificationsRead);
  const deleteNotification = useSocialStore((state) => state.deleteNotification);
  const loadMoreNotifications = useSocialStore((state) => state.loadMoreNotifications);
  const notificationHasMore = useSocialStore((state) => state.notificationHasMore);
  const selectSession = useSocialStore((state) => state.selectSession);
  const visibleNotifications = useMemo(
    () => notifications.filter((notification) => !notificationSuppressedBySettings(notification, conversationSettings)),
    [conversationSettings, notifications],
  );
  const unread = useMemo(() => projectUnreadNotifications(visibleNotifications), [visibleNotifications]);
  const unreadCount = useMemo(() => unread.length, [unread]);
  const friendRequestNames = useMemo(() => {
    return friendRequests.reduce<Record<string, { name: string; avatar: string }>>((next, request) => {
      const name = request.senderDisplayName || request.receiverDisplayName;
      const avatar = request.senderAvatar || request.receiverAvatar;
      [request.requestId, request.id, request.senderPtid].filter(Boolean).forEach((key) => {
        next[String(key)] = { name, avatar };
      });
      return next;
    }, {});
  }, [friendRequests]);

  const openNotification = async (notification: SocialNotification) => {
    if (notification.status === 1) {
      await markNotificationRead(notification.id);
    }

    const sessionId = resolveSessionId(notification);
    if (sessionId) {
      await selectSession(sessionId);
      onClose();
      onOpenChat();
      return;
    }

    if (isFriendRequestNotification(notification)) {
      onClose();
      onOpenContacts();
    }
  };

  return (
    <Drawer
      side="bottom"
      className="notification-drawer"
      title={t('mobile.notifications.title')}
      style={{ height: '78dvh' }}
      contentStyle={{ padding: '0 14px calc(var(--pt-m-safe-area-bottom, 0px) + 14px)' }}
      open={open}
      onDismiss={onClose}
      closeLabel={t('common.action.close')}
      extra={
        unreadCount > 0 ? (
          <Button
            actionId="mobile-notifications-mark-all-read"
            emphasis="quiet"
            density="compact"
            leading={<Icon iconId="check-check" size={16} />}
            onActivate={() => markAllNotificationsRead()}
          >
            {t('mobile.notifications.markAllRead')}
          </Button>
        ) : null
      }
    >
      <Spin active={loading && notifications.length === 0}>
        {visibleNotifications.length === 0 ? (
          <Empty description={t('mobile.notifications.empty')} />
        ) : (
          <div className="notification-list">
            {visibleNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onDelete={deleteNotification}
                onMarkRead={markNotificationRead}
                onOpen={openNotification}
                onResolveActor={requestSocialPeerProfile}
                peerProfiles={peerProfiles}
                friendRequestNames={friendRequestNames}
                t={t}
              />
            ))}
          </div>
        )}
        {notificationHasMore ? (
          <Button
            actionId="mobile-notifications-load-more"
            fullWidth
            className="notification-load-more"
            execution={loading ? 'pending' : 'idle'}
            onActivate={() => loadMoreNotifications()}
          >
            {t('mobile.notifications.loadMore')}
          </Button>
        ) : null}
      </Spin>
    </Drawer>
  );
}

function NotificationItem({
  notification,
  onDelete,
  onMarkRead,
  onOpen,
  onResolveActor,
  peerProfiles,
  friendRequestNames,
  t,
}: {
  notification: SocialNotification;
  onDelete: (notificationId: string) => Promise<void>;
  onMarkRead: (notificationId: string) => Promise<void>;
  onOpen: (notification: SocialNotification) => Promise<void>;
  onResolveActor: (peerPtid: string) => Promise<void>;
  peerProfiles: ReturnType<typeof useSocialStore.getState>['peerProfiles'];
  friendRequestNames: Record<string, { name: string; avatar: string }>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const unread = notification.status === 1;
  const typeIcon = notificationIcon(notification.type);
  const title = notification.title || notificationTitle(notification, t);
  const actorKey = notificationActorKey(notification);
  const actorProfile = actorKey ? peerProfiles[actorKey] : null;
  const requestDisplay = notificationRequestDisplay(notification, friendRequestNames);
  const actorName = requestDisplay?.name || actorProfile?.displayName || actorProfile?.username || notificationBody(notification, t);
  const body = shouldPreferActorDisplay(notification) ? actorName : (notification.body || actorName);

  useEffect(() => {
    if (actorKey && !(actorKey in peerProfiles)) void onResolveActor(actorKey);
  }, [actorKey, onResolveActor, peerProfiles]);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`notification-item ${unread ? 'unread' : ''}`}
      onClick={() => void onOpen(notification)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void onOpen(notification);
        }
      }}
    >
      <MobileAvatar
        className="notification-icon"
        src={requestDisplay?.avatar || actorProfile?.avatar}
        fallback={<Icon iconId={typeIcon} size={16} />}
      />
      <div className="notification-copy">
        <div className="notification-title-row">
          <Text strong={unread} truncate>{title}</Text>
          <Text tone="secondary" className="notification-time">
            {formatRelativeTime(timestampMillis(notification.createdAt), t)}
          </Text>
        </div>
        <Text tone="secondary" truncate>{body}</Text>
      </div>
      <div className="notification-actions">
        {unread ? (
          <button
            className="notification-action-button"
            type="button"
            aria-label={t('mobile.notifications.markRead')}
            onClick={(event) => {
              event.stopPropagation();
              void onMarkRead(notification.id);
            }}
          >
            <Icon iconId="check" size={15} />
          </button>
        ) : null}
        <button
          className="notification-action-button"
          type="button"
          aria-label={t('common.action.delete')}
          onClick={(event) => {
            event.stopPropagation();
            void onDelete(notification.id);
          }}
        >
          <Icon iconId="delete" size={15} />
        </button>
      </div>
    </div>
  );
}

function resolveSessionId(notification: SocialNotification): string {
  if (notification.type === NOTIFICATION_TYPE_FRIEND_ACCEPTED) {
    return notification.metadata.session_id || notification.metadata.sessionId || '';
  }
  if (notification.type === NOTIFICATION_TYPE_FRIEND_MESSAGE || notification.targetType === 'friend_chat_session') {
    return notification.metadata.session_id || notification.metadata.sessionId || notification.targetId;
  }
  return '';
}

function isFriendRequestNotification(notification: SocialNotification): boolean {
  return notification.type === NOTIFICATION_TYPE_FRIEND_REQUEST || notification.targetType === 'friend_request';
}

function notificationSuppressedBySettings(
  notification: SocialNotification,
  conversationSettings: ReturnType<typeof useSocialStore.getState>['conversationSettings'],
): boolean {
  const sessionId = resolveSessionId(notification);
  const settings = sessionId ? conversationSettings[sessionId] : undefined;
  return Boolean(settings?.isMuted || settings?.alertEnabled === false);
}

function shouldPreferActorDisplay(notification: SocialNotification): boolean {
  return isFriendRequestNotification(notification) || notification.type === NOTIFICATION_TYPE_FRIEND_ACCEPTED;
}

function notificationIcon(type: number): IconId {
  if (type === NOTIFICATION_TYPE_FRIEND_REQUEST) return 'user-plus';
  if (type === NOTIFICATION_TYPE_FRIEND_ACCEPTED) return 'user-check';
  if (type === NOTIFICATION_TYPE_FRIEND_MESSAGE) return 'message-circle';
  return 'bell';
}

function notificationTitle(notification: SocialNotification, t: (key: string) => string): string {
  if (notification.type === NOTIFICATION_TYPE_FRIEND_REQUEST) return t('mobile.notifications.friendRequest');
  if (notification.type === NOTIFICATION_TYPE_FRIEND_ACCEPTED) return t('mobile.notifications.friendAccepted');
  if (notification.type === NOTIFICATION_TYPE_FRIEND_MESSAGE) return t('mobile.notifications.friendMessage');
  return t('mobile.notifications.unknown');
}

function notificationBody(notification: SocialNotification, t: (key: string) => string): string {
  return notification.metadata.actor_display_name
    || notification.metadata.actorDisplayName
    || notification.metadata.sender_display_name
    || notification.metadata.senderDisplayName
    || notification.metadata.username
    || t('mobile.notifications.openHint');
}

function notificationActorKey(notification: SocialNotification): string {
  return notification.metadata.actor_ptid
    || notification.metadata.actorPtid
    || notification.metadata.sender_ptid
    || notification.metadata.senderPtid
    || notification.actorPtid
    || '';
}

function notificationRequestDisplay(
  notification: SocialNotification,
  friendRequestNames: Record<string, { name: string; avatar: string }>,
): { name: string; avatar: string } | null {
  const keys = [
    notification.targetId,
    notification.metadata.request_id,
    notification.metadata.requestId,
    notification.metadata.sender_ptid,
    notification.metadata.senderPtid,
    notification.actorPtid,
  ];
  for (const key of keys) {
    const display = key ? friendRequestNames[key] : null;
    if (display?.name) return display;
  }
  return null;
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!value) return '';
  const delta = Date.now() - value;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return t('common.time.justNow');
  if (minutes < 60) return t('common.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.time.hoursAgo', { count: hours });
  return new Date(value).toLocaleDateString();
}
