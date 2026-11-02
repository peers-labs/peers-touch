/**
 * NotificationBell — outer-rail notification entry for the north-star frame.
 *
 * Migrates the visible anatomy of desktop AppSideNav bottomActions: a bell
 * tile directly above settings with an unread badge, opening a right-anchored
 * popover (read/unread rows, category tags, per-row read/delete, mark-all).
 * Local seeds and local state only — no station polling.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  AtSign, Bell, CalendarCheck, Info, UserCheck, UserPlus,
  type LucideProps,
} from 'lucide-react';
import { Button, Empty, IconButton, Popover } from '@peers-touch/ui';
import { useT, type Translate } from '../prefs';
import {
  NOTIFICATION_SEEDS,
  type AppNotification, type NotificationCategory, type NotificationKind,
} from './notifications-data';
import './notifications.css';

// The popover shows the first page; older notifications load on demand. A
// real inbox paginates from the station rather than dumping every record
// into a 440px panel.
const NOTIF_PAGE_SIZE = 5;

const KIND_ICON: Record<NotificationKind, ComponentType<LucideProps>> = {
  'friend-request': UserPlus,
  'friend-accepted': UserCheck,
  mention: AtSign,
  task: CalendarCheck,
  system: Info,
};

function categoryLabel(t: Translate, category: NotificationCategory): string {
  return t(`notif.category.${category}`);
}

function NotificationPanel({ items, visibleCount, onShowMore, onRead, onReadAll, onDelete }: {
  items: AppNotification[];
  visibleCount: number;
  onShowMore: () => void;
  onRead: (id: string) => void;
  onReadAll: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const unread = items.filter(item => item.unread).length;
  const visibleItems = items.slice(0, visibleCount);
  const remaining = items.length - visibleItems.length;

  // Fade the list edge only while more rows exist below the fold.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setCanScroll(el.scrollHeight - el.clientHeight > 2);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleItems.length, remaining]);

  return (
    <div className="sk-notif-panel" data-notif-panel data-unread={unread} data-has-more={remaining > 0 ? 'true' : 'false'}>
      <div className="sk-notif-head">
        <strong>{t('notif.title')}</strong>
        {unread > 0 && (
          <IconButton actionId="notification.read-all" iconId="check-check" iconSize={14}
            density="compact" emphasis="quiet" label={t('notif.markAllRead')}
            onActivate={onReadAll} />
        )}
      </div>
      <div className="sk-notif-list" data-notif-list ref={listRef}
        data-can-scroll={canScroll ? 'true' : 'false'}>
        {visibleItems.length === 0
          ? <Empty className="sk-notif-empty" description={t('notif.empty')} />
          : visibleItems.map(item => {
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
                    {/* Category is a non-interactive label, mirroring desktop
                        (a quiet grey chip) — never a button-looking affordance. */}
                    <span className="sk-notif-chip">{categoryLabel(t, item.category)}</span>
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
        {remaining > 0 && (
          <div className="sk-notif-more">
            <Button actionId="notification.load-more" emphasis="quiet" density="compact"
              label={t('notif.loadMore', { n: remaining })}
              data-remaining={remaining}
              onActivate={onShowMore}>
              {t('notif.loadMore', { n: remaining })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function NotificationBell() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>(NOTIFICATION_SEEDS);
  const [visibleCount, setVisibleCount] = useState(NOTIF_PAGE_SIZE);
  const unread = items.filter(item => item.unread).length;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Reopening starts back at the first page — the bell is an at-a-glance
    // surface, not a growing list.
    if (next) setVisibleCount(NOTIF_PAGE_SIZE);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} placement="right-bottom" label={t('notif.title')}
      className="sk-notif-popover"
      content={
        <NotificationPanel items={items} visibleCount={visibleCount}
          onShowMore={() => setVisibleCount(count =>
            Math.min(count + NOTIF_PAGE_SIZE, items.length))}
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
