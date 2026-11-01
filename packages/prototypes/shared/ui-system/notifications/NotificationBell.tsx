/**
 * NotificationBell — outer-rail notification entry for the north-star frame.
 *
 * Migrates the visible anatomy of desktop AppSideNav bottomActions: a bell
 * tile directly above settings with an unread badge, opening a right-anchored
 * popover (read/unread rows, category tags, per-row read/delete, mark-all).
 * Local seeds and local state only — no station polling.
 */
import { useState, type ComponentType } from 'react';
import {
  AtSign, Bell, CalendarCheck, Info, UserCheck, UserPlus,
  type LucideProps,
} from 'lucide-react';
import { Empty, IconButton, Popover, Tag } from '@peers-touch/ui';
import { useT, type Translate } from '../prefs';
import {
  NOTIFICATION_SEEDS,
  type AppNotification, type NotificationCategory, type NotificationKind,
} from './notifications-data';
import './notifications.css';

const KIND_ICON: Record<NotificationKind, ComponentType<LucideProps>> = {
  'friend-request': UserPlus,
  'friend-accepted': UserCheck,
  mention: AtSign,
  task: CalendarCheck,
  system: Info,
};

const CATEGORY_TONE: Record<NotificationCategory, 'neutral' | 'success'> = {
  social: 'neutral',
  chat: 'neutral',
  task: 'neutral',
  system: 'neutral',
};

function categoryLabel(t: Translate, category: NotificationCategory): string {
  return t(`notif.category.${category}`);
}

function NotificationPanel({ items, onRead, onReadAll, onDelete }: {
  items: AppNotification[];
  onRead: (id: string) => void;
  onReadAll: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useT();
  const unread = items.filter(item => item.unread).length;
  return (
    <div className="sk-notif-panel" data-notif-panel data-unread={unread}>
      <div className="sk-notif-head">
        <strong>{t('notif.title')}</strong>
        {unread > 0 && (
          <IconButton actionId="notification.read-all" iconId="check-check" iconSize={14}
            density="compact" emphasis="quiet" label={t('notif.markAllRead')}
            onActivate={onReadAll} />
        )}
      </div>
      <div className="sk-notif-list">
        {items.length === 0
          ? <Empty className="sk-notif-empty" description={t('notif.empty')} />
          : items.map(item => {
              const KindIcon = KIND_ICON[item.kind] ?? Bell;
              return (
                <div key={item.id} className={`sk-notif-item${item.unread ? ' is-unread' : ''}`}
                  data-notification-id={item.id} data-unread={item.unread ? 'true' : 'false'}>
                  <span className="sk-notif-icon" aria-hidden="true"><KindIcon size={14} /></span>
                  <span className="sk-notif-content">
                    <span className="sk-notif-line">
                      <strong className="sk-notif-name">{item.title}</strong>
                      <time>{item.at}</time>
                    </span>
                    {item.body && <span className="sk-notif-body">{item.body}</span>}
                    <Tag tone={CATEGORY_TONE[item.category]}>
                      {categoryLabel(t, item.category)}
                    </Tag>
                  </span>
                  <span className="sk-notif-actions">
                    {item.unread && (
                      <IconButton actionId={`notification.read.${item.id}`} iconId="check" iconSize={13}
                        density="compact" emphasis="quiet" label={t('notif.markRead')}
                        onActivate={() => onRead(item.id)} />
                    )}
                    <IconButton actionId={`notification.delete.${item.id}`} iconId="delete" iconSize={13}
                      density="compact" emphasis="quiet" className="is-danger" label={t('notif.delete')}
                      onActivate={() => onDelete(item.id)} />
                  </span>
                </div>
              );
            })}
      </div>
    </div>
  );
}

export function NotificationBell() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>(NOTIFICATION_SEEDS);
  const unread = items.filter(item => item.unread).length;

  return (
    <Popover open={open} onOpenChange={setOpen} placement="right" label={t('notif.title')}
      className="sk-notif-popover"
      content={
        <NotificationPanel items={items}
          onRead={id => setItems(list => list.map(item =>
            item.id === id ? { ...item, unread: false } : item))}
          onReadAll={() => setItems(list => list.map(item => ({ ...item, unread: false })))}
          onDelete={id => setItems(list => list.filter(item => item.id !== id))} />
      }>
      <span className={`sk-rail-notif${open ? ' is-open' : ''}`} data-notification-bell
        aria-expanded={open}>
        <IconButton actionId="nav.notifications" iconId="bell" iconSize={19}
          density="compact" emphasis="quiet" className="sk-rail-icon sk-rail-notif-btn"
          label={t('nav.notifications')} />
        {unread > 0 && (
          <span className="sk-rail-badge" data-notif-unread={unread}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </span>
    </Popover>
  );
}
