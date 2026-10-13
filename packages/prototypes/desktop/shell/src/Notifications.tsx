/**
 * Desktop shell — Notifications popover.
 *
 * One panel aligned to the rail bell, expanded on intent into a centered dialog.
 * Prototype-local mock data
 * with real outcomes (read state, per-item dismiss, invite decisions,
 * click-through navigation). Single-instance: the caller owns open state and
 * closes it on outside click / Escape / navigation.
 *
 * Relationship decisions (friend requests / group invites) reuse the canonical
 * RequestDecisionButtons from social-chat — the notification center never
 * invents its own accept/decline form.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button, Input, Modal } from '@lobehub/ui';
import { Pagination, type InputRef } from 'antd';
import { CheckCheck, ChevronRight, Search, X } from 'lucide-react';
import { T } from './theme';
import { RequestDecisionButtons } from '../../features/social-chat/src/components/RequestDecisionButtons';

export type NotifKind = 'friend' | 'group_invite' | 'reply' | 'reaction';

export interface NotifItem {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  time: string;
  read: boolean;
  initials: string;
  avatarBg: string;
  /** true only while an inbound invite still needs a decision */
  pending?: boolean;
  /** kernel page the item jumps to when opened */
  targetPage?: string;
}

export const INITIAL_NOTIFICATIONS: NotifItem[] = [
  {
    id: 'n-1', kind: 'group_invite', title: 'Sarah Kim',
    body: 'Invited you to join “Release Room”.', time: '2m', read: false,
    initials: 'SK', avatarBg: '#d69e2e', pending: true, targetPage: 'chat',
  },
  {
    id: 'n-2', kind: 'reply', title: 'Emma Wang',
    body: 'Replied to you in Design Review: “updated the mocks”.', time: '18m', read: false,
    initials: 'EW', avatarBg: '#38a169', targetPage: 'chat',
  },
  {
    id: 'n-3', kind: 'friend', title: 'David Liu',
    body: 'Accepted your friend request.', time: '1h', read: false,
    initials: 'DL', avatarBg: '#3182ce', targetPage: 'chat',
  },
  {
    id: 'n-4', kind: 'reaction', title: 'Bob',
    body: 'Reacted 👍 to “Sprint planning moved to Friday”.', time: '3h', read: true,
    initials: 'BO', avatarBg: '#6b5bd6', targetPage: 'chat',
  },
  {
    id: 'n-5', kind: 'reply', title: 'Carol',
    body: 'Replied in Release Room: “The desktop build is ready for review. Please check the release notes, the cross-station invitation flow, and keyboard navigation before tomorrow’s release. I added the latest screenshots to the review thread”.', time: 'Yesterday', read: true,
    initials: 'CA', avatarBg: '#3182ce', targetPage: 'chat',
  },
  {
    id: 'n-6', kind: 'friend', title: 'Dana Park',
    body: 'Accepted your friend request.', time: 'Yesterday', read: true,
    initials: 'DP', avatarBg: '#38a169', targetPage: 'chat',
  },
  {
    id: 'n-7', kind: 'reaction', title: 'Emma Wang',
    body: 'Reacted ❤️ to your Design Review update.', time: '2d', read: true,
    initials: 'EW', avatarBg: '#38a169', targetPage: 'chat',
  },
  {
    id: 'n-8', kind: 'reply', title: 'Sarah Kim',
    body: 'Mentioned you in Release Room: “Can you check the release notes?”', time: '2d', read: true,
    initials: 'SK', avatarBg: '#d69e2e', targetPage: 'chat',
  },
  {
    id: 'n-9', kind: 'reply', title: 'David Liu',
    body: 'Replied to your message about the network connection.', time: '3d', read: true,
    initials: 'DL', avatarBg: '#3182ce', targetPage: 'chat',
  },
  {
    id: 'n-10', kind: 'reaction', title: 'Bob',
    body: 'Reacted 👍 to your project update.', time: '3d', read: true,
    initials: 'BO', avatarBg: '#6b5bd6', targetPage: 'chat',
  },
];

interface NotificationActions {
  onOpenItem: (item: NotifItem) => void;
  onDismiss: (id: string) => void;
  onInviteDecision: (id: string, accept: boolean) => void;
}

function NotificationList({
  items,
  onOpenItem,
  onDismiss,
  onInviteDecision,
  empty,
}: NotificationActions & {
  items: NotifItem[];
  empty: string;
}) {
  return (
    <div data-ui-rows="notifications" style={{
      display: 'grid',
      // Shared tracks keep metadata aligned across mixed action counts and
      // intrinsic time widths. Gutters belong to the list, not individual rows.
      gridTemplateColumns: '14px 34px minmax(0, 1fr) max-content 65px 14px',
    }}>
        {items.length === 0 ? (
          <div role="status" style={{ gridColumn: '1 / -1', padding: '48px 16px', textAlign: 'center', color: T.textSecondary, fontSize: 13 }}>
            {empty}
          </div>
        ) : items.map((item) => (
          <div
            key={item.id}
            data-shell-notification={item.id}
            data-ui-row
            data-ui-balance="inline block"
            data-entity={item.pending ? 'friend-request' : undefined}
            style={{
              display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid',
              alignItems: 'center', paddingBlock: 10,
              borderBottom: `1px solid ${T.border}`,
              background: item.read ? T.white : T.primaryWash,
            }}
          >
            <div
              aria-hidden
              data-ui-column="avatar"
              data-ui-column-align="start"
              data-ui-row-center
              style={{
                gridColumn: 2,
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                background: item.avatarBg, color: T.white,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
              }}
            >
              {item.initials}
            </div>
            <button
              type="button"
              data-row-button
              data-ui-column="content"
              data-ui-column-align="stretch"
              data-ui-row-center
              onClick={() => onOpenItem(item)}
              style={{
                gridColumn: 3, minWidth: 0, marginInline: 10, textAlign: 'left',
                border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 13, fontWeight: 600, color: T.text }}>{item.title}</span>
                {!item.read ? (
                  <span aria-label="Unread" style={{ width: 7, height: 7, borderRadius: '50%', background: T.primary, flexShrink: 0 }} />
                ) : null}
              </span>
              <span style={{ display: 'block', overflowWrap: 'anywhere', fontSize: 12, color: T.textSecondary, marginTop: 2, lineHeight: 1.4 }}>
                {item.body}
              </span>
            </button>
            <span data-ui-column="time" data-ui-column-align="end" data-ui-row-center
              style={{
                gridColumn: 4, marginInlineEnd: 10, textAlign: 'end', whiteSpace: 'nowrap',
                fontSize: 11, color: T.textTertiary, fontVariantNumeric: 'tabular-nums',
              }}>{item.time}</span>
            <div data-ui-column="actions" data-ui-column-align="stretch" data-ui-row-center
              data-ui-controls-align="end"
              style={{ gridColumn: 5, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            {item.pending ? (
              <RequestDecisionButtons
                targetName={item.title}
                onAccept={() => onInviteDecision(item.id, true)}
                onReject={() => onInviteDecision(item.id, false)}
              />
            ) : (
              <button
                type="button"
                aria-label={`Dismiss notification from ${item.title}`}
                onClick={() => onDismiss(item.id)}
                style={{
                  flexShrink: 0, width: 30, height: 30, padding: 0, border: 'none', borderRadius: 8,
                  background: 'transparent', color: T.textTertiary, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={14} />
              </button>
            )}
            </div>
          </div>
        ))}
    </div>
  );
}

const PREVIEW_LIMIT = 4;
const PAGE_SIZE = 6;

export function NotificationPanel({
  items, mode, anchorRef, onShowAll, onClose, onMarkAllRead, ...actions
}: NotificationActions & {
  items: NotifItem[];
  mode: 'preview' | 'all';
  anchorRef: RefObject<HTMLButtonElement | null>;
  onShowAll: () => void;
  onClose: () => void;
  onMarkAllRead: () => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [anchor, setAnchor] = useState({ left: 0, bottom: 0 });
  const previewRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<InputRef>(null);
  const unread = items.filter((item) => !item.read).length;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? items.filter(item =>
      `${item.title} ${item.body}`.toLocaleLowerCase().includes(term)) : items;
  }, [items, query]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const visible = mode === 'preview' ? items.slice(0, PREVIEW_LIMIT)
    : filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useLayoutEffect(() => {
    if (mode !== 'preview') return;
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ left: rect.right + 12, bottom: window.innerHeight - rect.bottom });
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchorRef.current) observer.observe(anchorRef.current);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, mode]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [currentPage, query, mode]);

  useEffect(() => {
    if (mode !== 'preview') return;
    previewRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [mode]);

  const markRead = (
    <Button
      type="text" icon={CheckCheck} data-shell-notifications-read-all
      disabled={!unread} onClick={onMarkAllRead}
      style={{ height: 28, borderRadius: 8, fontSize: 12, color: unread ? T.primary : T.textTertiary }}
    >Mark all read</Button>
  );
  const list = (
    <NotificationList items={visible} {...actions}
      empty={query.trim() ? 'No matching notifications. Try another search.' : 'You’re all caught up.'} />
  );

  if (mode === 'all') {
    return (
      <Modal
        open centered enableResponsive={false} width={760} footer={null}
        transitionName="" maskTransitionName=""
        title="All notifications" onCancel={onClose} destroyOnHidden
        afterOpenChange={(open) => { if (open) searchRef.current?.focus(); }}
        styles={{
          container: { borderRadius: T.radiusLg, padding: 20 },
          body: { padding: 0, overflow: 'hidden', maxHeight: 'none' },
        }}
        zIndex={70}
      >
        <div data-shell-notifications data-notification-mode="all" style={{
          height: 'min(65vh, 520px)', minHeight: 0, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '4px 0 14px', flexShrink: 0 }}>
            <Input
              ref={searchRef} allowClear aria-label="Search notifications" placeholder="Search notifications"
              prefix={<Search size={14} />} value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              style={{ flex: 1, minWidth: 0, height: 32, borderRadius: 8 }}
            />
            {markRead}
          </div>
          <div role="status" data-notification-result-count style={{
            fontSize: 12, color: T.textSecondary, paddingBottom: 10, flexShrink: 0,
          }}>
            {filtered.length} {filtered.length === 1 ? 'notification' : 'notifications'}
          </div>
          <div ref={listRef} data-shell-notifications-list style={{
            flex: 1, minHeight: 0, overflowY: 'auto', borderBlock: `1px solid ${T.border}`,
          }}>{list}</div>
          <div style={{ flexShrink: 0, paddingTop: 14, display: 'flex', justifyContent: 'center' }}>
            <Pagination
              current={currentPage} pageSize={PAGE_SIZE} total={filtered.length}
              showSizeChanger={false} hideOnSinglePage={false} onChange={setPage}
            />
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <>
      <div aria-hidden onClick={onClose} onWheel={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
      <div
        ref={previewRef} role="dialog" aria-label="Notifications" aria-modal="true"
        data-shell-notifications data-notification-mode="preview"
        data-floating-anchor-label="通知" data-floating-align="bottom"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'Tab') {
            const buttons = [...(previewRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}
        style={{
          position: 'fixed', left: anchor.left, bottom: anchor.bottom,
          width: 360, maxWidth: `calc(100vw - ${anchor.left + 12}px)`,
          maxHeight: `min(70vh, calc(100vh - ${anchor.bottom + 12}px))`,
          display: 'flex', flexDirection: 'column',
          background: T.white, border: `1px solid ${T.borderSoft}`, borderRadius: T.radiusLg,
          boxShadow: '0 12px 40px rgba(15,23,42,0.16)', zIndex: 60, overflow: 'hidden',
        }}
      >
        <header style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px', borderBottom: `1px solid ${T.border}`,
        }}>
          <strong style={{ fontSize: 14, color: T.text }}>Notifications</strong>
          {markRead}
        </header>
        <div ref={listRef} data-shell-notifications-list style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {list}
        </div>
        <footer style={{ padding: '8px 14px', borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
          <Button
            type="text" aria-label="More notifications" aria-haspopup="dialog"
            onClick={onShowAll} icon={ChevronRight}
            style={{ width: '100%', height: 32, borderRadius: 8, color: T.primary, fontSize: 12 }}
          >More notifications</Button>
        </footer>
      </div>
    </>
  );
}
