import { useCallback, useEffect, useState } from 'react';
import { Badge, Empty, Icon, IconButton, Popover, Tooltip } from '@peers-touch/ui';
import type { TFunction } from 'i18next';
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

  const panel = (
    <div className="ds-notify-panel">
      <div className="ds-notify-head">
        <span className="ds-notify-title">{t('moments.notification.title')}</span>
        <Tooltip label={t('moments.notification.markAllRead')} placement="left">
          <IconButton actionId="notification.mark-all-read" iconId="check-check" iconSize={15}
            density="compact" label={t('moments.notification.markAllRead')}
            onClick={() => markAllRead()} />
        </Tooltip>
      </div>
      <div className="ds-notify-list">
        {notifications.length === 0
          ? <Empty className="ds-notify-empty" description={t('moments.notification.empty')} />
          : notifications.map((item) => (
            <NotificationItem
              key={item.id}
              item={item}
              t={t}
              onActivate={handleItemActivation}
              onMarkRead={() => markRead([item.id])}
              onDelete={() => deleteNotifications([item.id])}
            />
          ))}
      </div>
    </div>
  );

  return (
    <span className="ds-rail-entry">
      <Popover open={open} onOpenChange={setOpen} placement="right-bottom"
        label={t('moments.notification.title')} content={panel}>
        <Badge count={unreadTotal} tone="danger" label={t('moments.notification.title')}>
          <IconButton actionId="notification.open" iconId="bell" iconSize={19}
            label={t('moments.notification.title')} aria-expanded={open || undefined} />
        </Badge>
      </Popover>
    </span>
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
  const isUnread = item.status === 1;
  const mention = isCommentMention(item);

  const title = item.title || defaultTitle(item, t);
  const body = item.body || (mention ? t('moments.notification.commentMentionBody') : '');
  const categoryLabel = CATEGORY_LABEL_KEY[item.category]
    ? t(CATEGORY_LABEL_KEY[item.category]!)
    : '';

  return (
    <div
      className={`ds-notify-item${isUnread ? ' is-unread' : ''}`}
      data-notification-type={item.type}
      data-notification-target={item.targetType}
      onClick={() => onActivate(item)}
      role={mention ? 'button' : undefined}
      tabIndex={mention ? 0 : undefined}
    >
      <span className="ds-notify-glyph">{notificationIcon(item)}</span>
      <span className="ds-notify-body">
        <span className="ds-notify-line">
          <span className="ds-notify-name">{title}</span>
          <span className="ds-notify-time">{formatTimeAgo(item.createdAt, t)}</span>
        </span>
        {body && <span className="ds-notify-text">{body}</span>}
        <span className="ds-notify-foot">
          {categoryLabel && <span className="ds-notify-tag">{categoryLabel}</span>}
          <span className="ds-notify-actions">
            {isUnread && (
              <Tooltip label={t('moments.notification.markRead')} placement="left">
                <IconButton actionId="notification.mark-read" iconId="check" iconSize={14}
                  density="compact" label={t('moments.notification.markRead')}
                  onClick={(event) => { event.stopPropagation(); onMarkRead(); }} />
              </Tooltip>
            )}
            <Tooltip label={t('moments.notification.delete')} placement="left">
              <IconButton actionId="notification.delete" iconId="delete" iconSize={14}
                density="compact" label={t('moments.notification.delete')}
                onClick={(event) => { event.stopPropagation(); onDelete(); }} />
            </Tooltip>
          </span>
        </span>
      </span>
    </div>
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
      return <Icon iconId="user-plus" size={16} />;
    case TYPE_FRIEND_ACCEPTED:
      return <Icon iconId="user-check" size={16} />;
    case TYPE_SOCIAL_COMMENT_MENTION:
      return <Icon iconId="message-square-text" size={16} />;
    default:
      return <Icon iconId="bell" size={16} />;
  }
}

// Re-exported for tests / external notification flows.
export { TYPE_SOCIAL_COMMENT_MENTION, TARGET_SOCIAL_COMMENT };
