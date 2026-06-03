import { useMemo } from 'react';
import { Avatar, Button, Drawer, Empty, List, Spin, Typography } from 'antd';
import { Bell, Check, CheckCheck, MessageCircle, Trash2, UserCheck, UserPlus } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import {
  useSocialStore,
} from '../features/social/socialStore';
import { timestampMillis } from '../features/social/socialNormalizers';
import { selectUnreadSocialNotifications } from '../features/social/socialSelectors';
import type { SocialNotification } from '../features/social/socialTypes';

const { Text } = Typography;
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
  const unread = useSocialStore(selectUnreadSocialNotifications);
  const loading = useSocialStore((state) => state.loading);
  const markNotificationRead = useSocialStore((state) => state.markNotificationRead);
  const markAllNotificationsRead = useSocialStore((state) => state.markAllNotificationsRead);
  const deleteNotification = useSocialStore((state) => state.deleteNotification);
  const loadMoreNotifications = useSocialStore((state) => state.loadMoreNotifications);
  const notificationHasMore = useSocialStore((state) => state.notificationHasMore);
  const selectSession = useSocialStore((state) => state.selectSession);
  const unreadCount = useMemo(() => unread.length, [unread]);

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
      className="notification-drawer"
      title={t('mobile.notifications.title')}
      placement="bottom"
      height="78dvh"
      open={open}
      onClose={onClose}
      extra={
        unreadCount > 0 ? (
          <Button
            type="text"
            icon={<CheckCheck size={16} />}
            onClick={() => markAllNotificationsRead()}
          >
            {t('mobile.notifications.markAllRead')}
          </Button>
        ) : null
      }
    >
      <Spin spinning={loading && notifications.length === 0}>
        {notifications.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.notifications.empty')} />
        ) : (
          <List
            className="notification-list"
            dataSource={notifications}
            renderItem={(notification) => (
              <NotificationItem
                notification={notification}
                onDelete={deleteNotification}
                onMarkRead={markNotificationRead}
                onOpen={openNotification}
                t={t}
              />
            )}
          />
        )}
        {notificationHasMore ? (
          <Button className="notification-load-more" block onClick={() => loadMoreNotifications()} loading={loading}>
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
  t,
}: {
  notification: SocialNotification;
  onDelete: (notificationId: string) => Promise<void>;
  onMarkRead: (notificationId: string) => Promise<void>;
  onOpen: (notification: SocialNotification) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const unread = notification.status === 1;
  const Icon = notificationIcon(notification.type);
  const title = notification.title || notificationTitle(notification, t);
  const body = notification.body || notificationBody(notification, t);

  return (
    <List.Item className={`notification-item ${unread ? 'unread' : ''}`} onClick={() => onOpen(notification)}>
      <Avatar className="notification-icon" icon={<Icon size={16} />} />
      <div className="notification-copy">
        <div className="notification-title-row">
          <Text strong={unread} ellipsis>{title}</Text>
          <Text type="secondary" className="notification-time">
            {formatRelativeTime(timestampMillis(notification.createdAt), t)}
          </Text>
        </div>
        <Text type="secondary" ellipsis>{body}</Text>
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
            <Check size={15} />
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
          <Trash2 size={15} />
        </button>
      </div>
    </List.Item>
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

function notificationIcon(type: number) {
  if (type === NOTIFICATION_TYPE_FRIEND_REQUEST) return UserPlus;
  if (type === NOTIFICATION_TYPE_FRIEND_ACCEPTED) return UserCheck;
  if (type === NOTIFICATION_TYPE_FRIEND_MESSAGE) return MessageCircle;
  return Bell;
}

function notificationTitle(notification: SocialNotification, t: (key: string) => string): string {
  if (notification.type === NOTIFICATION_TYPE_FRIEND_REQUEST) return t('mobile.notifications.friendRequest');
  if (notification.type === NOTIFICATION_TYPE_FRIEND_ACCEPTED) return t('mobile.notifications.friendAccepted');
  if (notification.type === NOTIFICATION_TYPE_FRIEND_MESSAGE) return t('mobile.notifications.friendMessage');
  return t('mobile.notifications.unknown');
}

function notificationBody(notification: SocialNotification, t: (key: string) => string): string {
  return notification.metadata.actor_display_name || notification.actorId || t('mobile.notifications.openHint');
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
