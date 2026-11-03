import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionIcon, Empty } from '@lobehub/ui';
import { Bell, Check, CheckCheck, MessageSquareText, Trash2, UserCheck, UserPlus } from 'lucide-react';
import { Badge, Popover, Spin, Tooltip, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import type { TFunction } from 'i18next';

import { useNotificationStore } from '../store/notification';
import { useSessionStore } from '../store/session';
import { eventBus } from '../kernel/events';
import { EVENT } from '../kernel/events/catalog';
import { ensureMomentDetailProjection } from '../runtimes/momentsRuntime';
import { useMomentsNavigationStore } from '../store/momentsNavigation';
import { log } from '../utils/logger';
import type { NotificationData } from '../services/desktop_api';

const CATEGORY_LOCALE_KEYS: Record<number, string> = {
  1: 'desktop.notifications.category.social',
  2: 'desktop.notifications.category.chat',
  3: 'desktop.notifications.category.system',
  4: 'desktop.notifications.category.task',
};

const CATEGORY_SOCIAL = 1;
const TYPE_FRIEND_REQUEST = 200;
const TYPE_FRIEND_ACCEPTED = 201;
/** Station Social owner type for @-mentions on comments. */
const TYPE_SOCIAL_COMMENT_MENTION = 210;
const TARGET_SOCIAL_COMMENT = 'social-comment';

function isCommentMention(item: NotificationData): boolean {
  return item.type === TYPE_SOCIAL_COMMENT_MENTION
    || (item.category === CATEGORY_SOCIAL
      && item.targetType === TARGET_SOCIAL_COMMENT
      && Boolean(item.metadata?.post_id));
}

function formatTimeAgo(dateStr: string, t: TFunction<'common'>): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t('common.time.justNow');
  if (diffMin < 60) return t('common.time.minutesAgo', { count: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return t('common.time.hoursAgo', { count: diffH });
  const diffD = Math.floor(diffH / 24);
  return t('common.time.daysAgo', { count: diffD });
}

function notificationIcon(item: NotificationData) {
  switch (item.type) {
    case TYPE_FRIEND_REQUEST:
      return <UserPlus size={16} color="var(--ant-color-primary, #1677ff)" />;
    case TYPE_FRIEND_ACCEPTED:
      return <UserCheck size={16} color="var(--ant-color-primary, #1677ff)" />;
    case TYPE_SOCIAL_COMMENT_MENTION:
      return <MessageSquareText size={16} color="var(--ant-color-primary, #1677ff)" />;
    default:
      return <Bell size={16} />;
  }
}

function NotificationItem({
  item,
  onActivate,
  onMarkRead,
  onDelete,
}: {
  item: NotificationData;
  onActivate: (item: NotificationData) => void;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('common');
  const { t: tMoments } = useTranslation('moments');
  const isUnread = item.status === 1;
  const mention = isCommentMention(item);

  const title = item.title
    || item.metadata?.sender_name
    || (mention
      ? tMoments('moments.notification.commentMentionTitle')
      : t('desktop.notifications.unknown'));
  const body = item.body || (mention ? tMoments('moments.notification.commentMentionBody') : '');

  return (
    <Flexbox
      horizontal
      gap={10}
      align="flex-start"
      data-notification-type={item.type}
      data-notification-target={item.targetType}
      onClick={() => onActivate(item)}
      style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: isUnread ? token.colorFillQuaternary : 'transparent',
        cursor: mention ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: token.colorFillSecondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {notificationIcon(item)}
      </div>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal justify="space-between" align="center" style={{ minWidth: 0 }}>
          <span
            style={{
              fontWeight: isUnread ? 600 : 400,
              fontSize: 13,
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {title}
          </span>
          <span style={{ fontSize: 11, color: token.colorTextQuaternary, flexShrink: 0, marginLeft: 8 }}>
            {formatTimeAgo(item.createdAt, t)}
          </span>
        </Flexbox>
        {body && (
          <span
            style={{
              fontSize: 12,
              color: token.colorTextSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {body}
          </span>
        )}
        <Flexbox horizontal gap={4} style={{ marginTop: 2 }}>
          <span
            style={{
              fontSize: 10,
              color: token.colorTextQuaternary,
              background: token.colorFillSecondary,
              padding: '1px 6px',
              borderRadius: 3,
            }}
          >
            {t(CATEGORY_LOCALE_KEYS[item.category] || 'desktop.notifications.category.other')}
          </span>
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal gap={4} style={{ flexShrink: 0, marginTop: 2 }}>
        {isUnread && (
          <Tooltip title={t('desktop.notifications.markRead')}>
            <ActionIcon
              icon={Check}
              size="small"
              aria-label={t('desktop.notifications.markRead')}
              onClick={(event) => { event.stopPropagation(); onMarkRead(item.id); }}
            />
          </Tooltip>
        )}
        <Tooltip title={t('common.action.delete')}>
          <ActionIcon
            icon={Trash2}
            size="small"
            aria-label={t('common.action.delete')}
            onClick={(event) => { event.stopPropagation(); onDelete(item.id); }}
          />
        </Tooltip>
      </Flexbox>
    </Flexbox>
  );
}

export function NotificationBell() {
  const { token } = theme.useToken();
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const notifications = useNotificationStore((s) => s.notifications);
  const unreadTotal = useNotificationStore((s) => s.unreadTotal);
  const loading = useNotificationStore((s) => s.loading);
  const authenticatedActorPtid = useSessionStore((s) => (s.authenticated ? s.currentUser?.actorPtid ?? null : null));
  const startPolling = useNotificationStore((s) => s.startPolling);
  const stopPolling = useNotificationStore((s) => s.stopPolling);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const deleteNotifications = useNotificationStore((s) => s.deleteNotifications);
  const loadNotifications = useNotificationStore((s) => s.loadNotifications);

  useEffect(() => {
    if (!authenticatedActorPtid) {
      stopPolling();
      return;
    }
    startPolling();
    return () => stopPolling();
  }, [authenticatedActorPtid, startPolling, stopPolling]);

  const handleMarkRead = useCallback((id: string) => {
    markRead([id]);
  }, [markRead]);

  const handleDelete = useCallback((id: string) => {
    deleteNotifications([id]);
  }, [deleteNotifications]);

  const handleMarkAllRead = useCallback(() => {
    markAllRead();
  }, [markAllRead]);

  const handleOpen = useCallback(() => {
    if (!open) {
      loadNotifications();
    }
    setOpen(!open);
  }, [open, loadNotifications]);

  // Comment @-mentions deep-link into the Social moment detail view. The
  // detail projection re-authorizes through the owner read path; the
  // notification itself carries no content.
  const openCommentMention = useCallback((item: NotificationData) => {
    const postId = item.metadata?.post_id?.trim();
    const commentId = item.metadata?.comment_id?.trim() || undefined;
    if (!postId) {
      log.warn('NotificationBell', 'comment mention missing post id', { id: item.id });
      return;
    }
    eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'moments' });
    useMomentsNavigationStore.getState().setView((previous) => ({
      kind: 'detail',
      postId,
      commentId,
      from: previous.kind === 'tab' ? previous.tab : previous.from,
    }));
    void ensureMomentDetailProjection(postId, { origin: 'device', commentId })
      .catch((error) => log.warn(
        'NotificationBell',
        'comment mention projection failed',
        { postId, error: String(error) },
      ));
  }, []);

  const handleItemActivation = useCallback((item: NotificationData) => {
    if (!isCommentMention(item)) return;
    openCommentMention(item);
    setOpen(false);
    if (item.status === 1) markRead([item.id]);
  }, [markRead, openCommentMention]);

  const dropdownContent = (
    <div
      ref={panelRef}
      style={{
        width: 380,
        maxHeight: 480,
        background: token.colorBgElevated,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowSecondary,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('desktop.notifications.title')}</span>
        <Flexbox horizontal gap={8} align="center">
          {unreadTotal > 0 && (
            <Tooltip title={t('desktop.notifications.markAllRead')}>
              <ActionIcon
                icon={CheckCheck}
                size="small"
                aria-label={t('desktop.notifications.markAllRead')}
                onClick={handleMarkAllRead}
              />
            </Tooltip>
          )}
        </Flexbox>
      </Flexbox>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && notifications.length === 0 ? (
          <Flexbox align="center" justify="center" style={{ padding: 40 }}>
            <Spin size="small" />
          </Flexbox>
        ) : notifications.length === 0 ? (
          <Empty icon={Bell} title={t('desktop.notifications.empty')} padding="40px 16px" />
        ) : (
          notifications.map((item) => (
            <NotificationItem
              key={item.id}
              item={item}
              onActivate={handleItemActivation}
              onMarkRead={handleMarkRead}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="rightBottom"
      content={dropdownContent}
      arrow={false}
      overlayInnerStyle={{ padding: 0 }}
      align={{ offset: [8, 0] }}
    >
      <div>
        <Badge count={unreadTotal} size="small" offset={[-2, 2]}>
          <ActionIcon
            icon={Bell}
            size="large"
            onClick={handleOpen}
            title={t('desktop.notifications.title')}
            aria-label={t('desktop.notifications.title')}
          />
        </Badge>
      </div>
    </Popover>
  );
}

// Re-exported for tests / external notification flows.
export { TYPE_SOCIAL_COMMENT_MENTION, TARGET_SOCIAL_COMMENT };
