import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Icon,
  IconButton,
  Spin,
  Text,
  type IconId,
} from '@peers-touch/ui';

import { useMobileI18n } from '../app/mobileI18n';
import { notifyError } from '../app/feedback/mobileFeedback';
import type { MobileDetailRoute } from '../app/navigation';
import { BoundedList } from './BoundedList';
import { MobileNotice } from './MobileNotice';
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
const NOTIFICATION_TYPE_COMMENT_MENTION = 210;

interface MobileNotificationCenterProps {
  open: boolean;
  onClose: () => void;
  onOpenDetail: (route: MobileDetailRoute) => void;
  onOpenContacts: () => void;
}

const notificationKey = (notification: SocialNotification) => notification.id;

export function MobileNotificationCenter({ open, onClose, onOpenDetail, onOpenContacts }: MobileNotificationCenterProps) {
  const { t } = useMobileI18n();
  const notifications = useSocialStore((state) => state.notifications);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const conversationSettings = useSocialStore((state) => state.conversationSettings);
  const loading = useSocialStore((state) => state.notificationLoading);
  const error = useSocialStore((state) => state.notificationError);
  const refresh = useSocialStore((state) => state.refreshNotifications);
  const markNotificationRead = useSocialStore((state) => state.markNotificationRead);
  const markAllNotificationsRead = useSocialStore((state) => state.markAllNotificationsRead);
  const deleteNotification = useSocialStore((state) => state.deleteNotification);
  const loadMoreNotifications = useSocialStore((state) => state.loadMoreNotifications);
  const notificationHasMore = useSocialStore((state) => state.notificationHasMore);
  const authSession = useSocialStore((state) => state.authSession);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const operation = useRef<object | null>(null);
  useEffect(() => {
    operation.current = null;
    setPending(null);
    setActionError('');
    return () => { operation.current = null; };
  }, [authSession]);
  useEffect(() => {
    if (open && authSession) void refresh().catch(() => undefined);
  }, [open, authSession, refresh]);
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

  const operate = async (key: string, action: () => Promise<void>) => {
    if (operation.current) return;
    const scope = useSocialStore.getState().authSession;
    const token = {};
    operation.current = token;
    setPending(key);
    setActionError('');
    try {
      await action();
    } catch (caught) {
      if (operation.current === token && useSocialStore.getState().authSession === scope) {
        setActionError(caught instanceof Error ? caught.message : 'mobile.notifications.operationFailed');
      }
    } finally {
      if (operation.current === token && useSocialStore.getState().authSession === scope) {
        operation.current = null;
        setPending(null);
      }
    }
  };

  const openNotification = async (notification: SocialNotification) => {
    const scope = useSocialStore.getState().authSession;
    const route = notificationDetailRoute(notification);
    onClose();
    if (route) onOpenDetail(route);
    else if (isFriendRequestNotification(notification)) onOpenContacts();
    if (notification.status === 1) {
      try {
        await markNotificationRead(notification.id);
      } catch (caught) {
        if (useSocialStore.getState().authSession === scope) {
          notifyError(t(caught instanceof Error ? caught.message : 'mobile.notifications.operationFailed'));
        }
      }
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
            density="comfortable"
            leading={<Icon iconId="check-check" size={16} />}
            execution={pending === 'all' ? 'pending' : 'idle'}
            availability={pending ? { kind: 'disabled', reason: t('mobile.notifications.operationPending') } : undefined}
            onActivate={() => void operate('all', markAllNotificationsRead)}
          >
            {t('mobile.notifications.markAllRead')}
          </Button>
        ) : null
      }
    >
      {error || actionError ? <MobileNotice tone="error">
        {t(actionError || error?.message || 'mobile.notifications.operationFailed')}
        <Button actionId="notifications.retry" density="comfortable"
          onActivate={() => void operate('retry', refresh)}>{t('common.action.retry')}</Button>
      </MobileNotice> : null}
      <Spin active={loading && notifications.length === 0}>
        {visibleNotifications.length === 0 ? (
          <Empty description={t('mobile.notifications.empty')} />
        ) : (
          <BoundedList items={visibleNotifications} itemKey={notificationKey}
            surfaceKey="notifications:center" size={60}>
          {rows => <div className="notification-list">
            {rows.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onDelete={id => operate(id, () => deleteNotification(id))}
                onMarkRead={id => operate(id, () => markNotificationRead(id))}
                pending={pending}
                onOpen={openNotification}
                onResolveActor={requestSocialPeerProfile}
                peerProfiles={peerProfiles}
                friendRequestNames={friendRequestNames}
                t={t}
              />
            ))}
          </div>}
          </BoundedList>
        )}
        {notificationHasMore ? (
          <Button
            actionId="mobile-notifications-load-more"
            fullWidth
            className="notification-load-more"
            execution={loading ? 'pending' : 'idle'}
            density="comfortable"
            onActivate={() => void operate('more', loadMoreNotifications)}
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
  pending,
  peerProfiles,
  friendRequestNames,
  t,
}: {
  notification: SocialNotification;
  onDelete: (notificationId: string) => Promise<void>;
  onMarkRead: (notificationId: string) => Promise<void>;
  onOpen: (notification: SocialNotification) => Promise<void>;
  onResolveActor: (peerPtid: string) => Promise<void>;
  pending: string | null;
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
    if (actorKey && !(actorKey in peerProfiles)) void onResolveActor(actorKey).catch(() => undefined);
  }, [actorKey, onResolveActor, peerProfiles]);

  return (
    <div
      className="notification-item"
      data-notification-id={notification.id}
      data-scroll-anchor-id={notification.id}
      data-unread={unread}
    >
      <Button actionId={`notification.open.${notification.id}`} emphasis="quiet" fullWidth
        density="comfortable" onActivate={() => void onOpen(notification)}
        availability={!notificationDetailRoute(notification) && !isFriendRequestNotification(notification)
          ? { kind: 'disabled', reason: t('mobile.notifications.targetUnavailable') } : undefined}>
      <MobileAvatar
        identityKey={actorKey}
        name={actorName}
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
      </Button>
      <div className="notification-actions">
        {unread ? (
          <IconButton actionId={`notification.read.${notification.id}`} iconId="check"
            emphasis="quiet" density="comfortable" label={t('mobile.notifications.markRead')}
            execution={pending === notification.id ? 'pending' : 'idle'}
            availability={pending ? { kind: 'disabled', reason: t('mobile.notifications.operationPending') } : undefined}
            onActivate={() => void onMarkRead(notification.id)} />
        ) : null}
        <IconButton actionId={`notification.delete.${notification.id}`} iconId="delete"
          emphasis="quiet" density="comfortable" label={t('common.action.delete')}
          execution={pending === notification.id ? 'pending' : 'idle'}
          availability={pending ? { kind: 'disabled', reason: t('mobile.notifications.operationPending') } : undefined}
          onActivate={() => void onDelete(notification.id)} />
      </div>
    </div>
  );
}

export function notificationDetailRoute(notification: SocialNotification): MobileDetailRoute | null {
  if (notification.type === NOTIFICATION_TYPE_COMMENT_MENTION || notification.targetType === 'social-comment') {
    const postId = notification.metadata.post_id || notification.metadata.postId;
    if (postId) return {
      routeId: 'detail:moment', postId,
      commentId: notification.metadata.comment_id || notification.metadata.commentId || notification.targetId || undefined,
    };
  }
  const sessionId = resolveSessionId(notification);
  if (sessionId) return {
    routeId: 'detail:chat-conversation', sessionUlid: sessionId,
    messageId: notification.metadata.message_id || notification.metadata.messageId || undefined,
  };
  const groupId = notification.metadata.group_ulid || notification.metadata.groupUlid;
  if (groupId) return { routeId: 'detail:group-conversation', groupUlid: groupId };
  if (['post', 'social_post', 'moment'].includes(notification.targetType) && notification.targetId) {
    return {
      routeId: 'detail:moment', postId: notification.targetId,
      commentId: notification.metadata.comment_id || notification.metadata.commentId || undefined,
    };
  }
  return null;
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
  if (type === NOTIFICATION_TYPE_COMMENT_MENTION) return 'message-circle';
  return 'bell';
}

function notificationTitle(notification: SocialNotification, t: (key: string) => string): string {
  if (notification.type === NOTIFICATION_TYPE_FRIEND_REQUEST) return t('mobile.notifications.friendRequest');
  if (notification.type === NOTIFICATION_TYPE_FRIEND_ACCEPTED) return t('mobile.notifications.friendAccepted');
  if (notification.type === NOTIFICATION_TYPE_FRIEND_MESSAGE) return t('mobile.notifications.friendMessage');
  if (notification.type === NOTIFICATION_TYPE_COMMENT_MENTION) return t('mobile.moments.reason.mentioned');
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
