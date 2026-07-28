import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon } from '@lobehub/ui';
import { Bell, Check, CheckCheck, Trash2, UserPlus, UserCheck } from 'lucide-react';
import { Badge, Empty, Popover, Spin, Tooltip, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { useNotificationStore } from '../store/notification';
import { useSessionStore } from '../store/session';
import type { NotificationData } from '../services/desktop_api';

const CATEGORY_LABELS: Record<number, string> = {
  1: 'Social',
  2: 'Chat',
  3: 'System',
  4: 'Task',
};

const TYPE_ICONS: Record<number, typeof Bell> = {
  200: UserPlus,
  201: UserCheck,
};

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function NotificationItem({
  item,
  onMarkRead,
  onDelete,
}: {
  item: NotificationData;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { token } = theme.useToken();
  const isUnread = item.status === 1;
  const Icon = TYPE_ICONS[item.type] || Bell;

  return (
    <Flexbox
      horizontal
      align="flex-start"
      gap={10}
      style={{
        padding: '10px 14px',
        background: isUnread ? token.colorFillQuaternary : 'transparent',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        cursor: 'default',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!isUnread) (e.currentTarget as HTMLElement).style.background = token.colorFillQuaternary;
      }}
      onMouseLeave={(e) => {
        if (!isUnread) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <Flexbox
        align="center"
        justify="center"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: isUnread ? token.colorPrimaryBg : token.colorFillSecondary,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <Icon size={16} color={isUnread ? token.colorPrimary : token.colorTextTertiary} />
      </Flexbox>

      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal justify="space-between" align="center">
          <span
            style={{
              fontWeight: isUnread ? 600 : 400,
              fontSize: 13,
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.title}
          </span>
          <span style={{ fontSize: 11, color: token.colorTextQuaternary, flexShrink: 0, marginLeft: 8 }}>
            {formatTimeAgo(item.createdAt)}
          </span>
        </Flexbox>

        {item.body && (
          <span
            style={{
              fontSize: 12,
              color: token.colorTextSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.body}
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
            {CATEGORY_LABELS[item.category] || 'Other'}
          </span>
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal gap={4} style={{ flexShrink: 0, marginTop: 2 }}>
        {isUnread && (
          <Tooltip title="Mark read">
            <ActionIcon
              icon={Check}
              size="small"
              onClick={(e) => { e.stopPropagation(); onMarkRead(item.id); }}
            />
          </Tooltip>
        )}
        <Tooltip title="Delete">
          <ActionIcon
            icon={Trash2}
            size="small"
            onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
          />
        </Tooltip>
      </Flexbox>
    </Flexbox>
  );
}

export function NotificationBell() {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const notifications = useNotificationStore((s) => s.notifications);
  const unreadTotal = useNotificationStore((s) => s.unreadTotal);
  const loading = useNotificationStore((s) => s.loading);
  const authenticatedActorId = useSessionStore((s) => (s.authenticated ? s.currentUser?.actorId ?? null : null));
  const startPolling = useNotificationStore((s) => s.startPolling);
  const stopPolling = useNotificationStore((s) => s.stopPolling);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const deleteNotifications = useNotificationStore((s) => s.deleteNotifications);
  const loadNotifications = useNotificationStore((s) => s.loadNotifications);

  useEffect(() => {
    if (!authenticatedActorId) {
      stopPolling();
      return;
    }
    startPolling();
    return () => stopPolling();
  }, [authenticatedActorId, startPolling, stopPolling]);

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
        <span style={{ fontWeight: 600, fontSize: 14 }}>Notifications</span>
        <Flexbox horizontal gap={8} align="center">
          {unreadTotal > 0 && (
            <Tooltip title="Mark all read">
              <ActionIcon icon={CheckCheck} size="small" onClick={handleMarkAllRead} />
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
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No notifications"
            style={{ padding: '40px 0' }}
          />
        ) : (
          notifications.map((item) => (
            <NotificationItem
              key={item.id}
              item={item}
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
            title="Notifications"
          />
        </Badge>
      </div>
    </Popover>
  );
}
