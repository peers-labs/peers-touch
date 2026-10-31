import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Popover, Tooltip } from '@lobehub/ui';
import { Badge, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import type { TFunction } from 'i18next';
import {
  Bell,
  Check,
  CheckCheck,
  MessageSquareText,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '../store/notification';
import { eventBus } from '../kernel/events';
import { EVENT } from '../kernel/events/catalog';
import type { NotificationData } from '../services/desktop_api';
import { ensureMomentDetailProjection } from '../runtimes/momentsRuntime';
import { useMomentsNavigationStore } from '../store/momentsNavigation';
import { log } from '../utils/logger';

const CATEGORY_SOCIAL = 1;
const TYPE_FRIEND_REQUEST = 200;
const TYPE_FRIEND_ACCEPTED = 201;
/** Station Social owner type for @-mentions on comments. */
const TYPE_SOCIAL_COMMENT_MENTION = 210;
const TARGET_SOCIAL_COMMENT = 'social-comment';

const CATEGORY_LABEL_KEY: Record<number, string> = {
  1: 'moments.notification.categorySocial',
  2: 'moments.notification.categoryChat',
  3: 'moments.notification.categoryTask',
  4: 'moments.notification.categorySystem',
};

function isCommentMention(item: NotificationData): boolean {
  return item.type === TYPE_SOCIAL_COMMENT_MENTION
    || (item.category === CATEGORY_SOCIAL
      && item.targetType === TARGET_SOCIAL_COMMENT
      && Boolean(item.metadata?.post_id));
}

function formatTimeAgo(dateStr: string, t: TFunction): string {
  const parsed = Date.parse(dateStr);
  if (Number.isNaN(parsed)) return '';
  const diffMs = Date.now() - parsed;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t('moments.notification.timeJustNow');
  if (diffMin < 60) return t('moments.notification.timeMinutesAgo', { count: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return t('moments.notification.timeHoursAgo', { count: diffH });
  const diffD = Math.floor(diffH / 24);
  return t('moments.notification.timeDaysAgo', { count: diffD });
}

export function NotificationBell() {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');
  const notifications = useNotificationStore((s) => s.notifications);
  const unreadTotal = useNotificationStore((s) => s.unreadTotal);
  const startPolling = useNotificationStore((s) => s.startPolling);
  const stopPolling = useNotificationStore((s) => s.stopPolling);
  const loadNotifications = useNotificationStore((s) => s.loadNotifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const deleteNotifications = useNotificationStore((s) => s.deleteNotifications);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadNotifications();
  }, [open, loadNotifications]);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  const openCommentMention = useCallback((item: NotificationData) => {
    const postId = item.metadata?.post_id?.trim();
    const commentId = item.metadata?.comment_id?.trim() || undefined;
    if (!postId) {
      log.warn('NotificationBell', 'comment mention missing post id', { id: item.id });
      return;
    }
    // Switch the shell to Social, then bind the moments detail view.
    // The detail projection re-authorizes through the owner read
    // path — the notification itself carries no content.
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
    if (item.status === 1) void markRead([item.id]);
  }, [markRead, openCommentMention]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="rightBottom"
      trigger="click"
      content={
        <div
          style={{ width: 380, maxHeight: 480, display: 'flex', flexDirection: 'column' }}
        >
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{ padding: '12px 14px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {t('moments.notification.title')}
            </span>
            <Tooltip title={t('moments.notification.markAllRead')}>
              <ActionIcon
                icon={CheckCheck}
                size="small"
                aria-label={t('moments.notification.markAllRead')}
                onClick={() => markAllRead()}
              />
            </Tooltip>
          </Flexbox>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <Flexbox align="center" justify="center" style={{ padding: '40px 0' }}>
                <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
                  {t('moments.notification.empty')}
                </span>
              </Flexbox>
            ) : (
              notifications.map((item) => (
                <NotificationItem
                  key={item.id}
                  item={item}
                  t={t}
                  onActivate={handleItemActivation}
                  onMarkRead={() => markRead([item.id])}
                  onDelete={() => deleteNotifications([item.id])}
                />
              ))
            )}
          </div>
        </div>
      }
    >
      <div>
        <Badge count={unreadTotal} size="small" offset={[-2, 2]}>
          <ActionIcon
            icon={Bell}
            size="large"
            active={open}
            title={t('moments.notification.title')}
            aria-label={t('moments.notification.title')}
          />
        </Badge>
      </div>
    </Popover>
  );
}

function NotificationItem({
  item,
  t,
  onActivate,
  onMarkRead,
  onDelete,
}: {
  item: NotificationData;
  t: TFunction;
  onActivate: (item: NotificationData) => void;
  onMarkRead: () => void;
  onDelete: () => void;
}) {
  const { token } = theme.useToken();
  const isUnread = item.status === 1;
  const mention = isCommentMention(item);

  const title = item.title || defaultTitle(item, t);
  const body = item.body || (mention ? t('moments.notification.commentMentionBody') : '');
  const categoryLabel = CATEGORY_LABEL_KEY[item.category]
    ? t(CATEGORY_LABEL_KEY[item.category]!)
    : '';

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
          <span style={{ fontSize: 11, color: token.colorTextQuaternary, marginLeft: 8, flexShrink: 0 }}>
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
          {categoryLabel && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                background: token.colorFillTertiary,
                borderRadius: 3,
                color: token.colorTextQuaternary,
              }}
            >
              {categoryLabel}
            </span>
          )}
          <Flexbox horizontal gap={4} style={{ marginLeft: 'auto' }}>
            {isUnread && (
              <Tooltip title={t('moments.notification.markRead')}>
                <ActionIcon
                  icon={Check}
                  size="small"
                  aria-label={t('moments.notification.markRead')}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMarkRead();
                  }}
                />
              </Tooltip>
            )}
            <Tooltip title={t('moments.notification.delete')}>
              <ActionIcon
                icon={Trash2}
                size="small"
                aria-label={t('moments.notification.delete')}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              />
            </Tooltip>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}

function defaultTitle(item: NotificationData, t: TFunction): string {
  if (isCommentMention(item)) {
    return t('moments.notification.commentMentionTitle');
  }
  switch (item.type) {
    case TYPE_FRIEND_REQUEST:
      return t('moments.notification.friendRequestTitle');
    case TYPE_FRIEND_ACCEPTED:
      return t('moments.notification.friendAcceptedTitle');
    default:
      return t('moments.notification.fallbackTitle');
  }
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

// Re-exported for tests / external notification flows.
export { TYPE_SOCIAL_COMMENT_MENTION, TARGET_SOCIAL_COMMENT };
