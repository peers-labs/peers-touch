import { useMemo, useState } from 'react';
import { Button, Input } from '@lobehub/ui';
import { Alert, Empty, Pagination, Spin, theme } from 'antd';
import { CheckCheck, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '../../store/notification';
import { useSocialChatStore } from '../../store/socialChat';
import { useSessionStore } from '../../store/session';
import type { NotificationData } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { NotificationRow, notificationText } from './NotificationRow';

const PAGE_SIZE = 6;

export function NotificationCenter({ expanded, onExpand }: {
  expanded: boolean;
  onExpand: () => void;
}) {
  const { t } = useTranslation('layout');
  const { token } = theme.useToken();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState(false);
  const items = useNotificationStore((state) => state.notifications);
  const loading = useNotificationStore((state) => state.loading);
  const error = useNotificationStore((state) => state.error);
  const countsError = useNotificationStore((state) => state.countsError);
  const hasMore = useNotificationStore((state) => state.hasMore);
  const unread = useNotificationStore((state) => state.unreadTotal);
  const pendingIds = useNotificationStore((state) => state.pendingIds);
  const markingAllRead = useNotificationStore((state) => state.markingAllRead);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? items.filter((item) => (
      `${notificationText(item, t)} ${item.body}`.toLocaleLowerCase().includes(term)
    )) : items;
  }, [items, query, t]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const visible = expanded
    ? filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : items.slice(0, 4);
  const refresh = async () => {
    const store = useNotificationStore.getState();
    await Promise.all([store.loadNotifications(), store.refreshUnreadCounts()]);
  };
  const decide = async (item: NotificationData, accept: boolean) => {
    if (decisionId) return;
    const session = useSessionStore.getState();
    const request = useSocialChatStore.getState().friendRequests.find((candidate) => (
      candidate.id === item.targetId && candidate.senderPtid === item.actorPtid
      && candidate.receiverPtid === session.currentUser?.actorPtid && candidate.status === 1
    ));
    if (!request) return;
    setDecisionId(item.id);
    setDecisionError(false);
    try {
      const social = useSocialChatStore.getState();
      await (accept ? social.acceptFriendRequest(request) : social.rejectFriendRequest(request));
      if (useSessionStore.getState().sessionEpoch !== session.sessionEpoch) return;
      await useNotificationStore.getState().markRead([item.id]);
    } catch (failure) {
      log.warn('notification', 'Relationship decision failed', failure);
      setDecisionError(true);
    } finally {
      setDecisionId(null);
    }
  };

  return (
    <section data-shell-notifications data-notification-mode={expanded ? 'all' : 'preview'}
      style={{
        width: expanded ? '100%' : 'min(360px, calc(100vw - 96px))',
        maxHeight: 'min(65vh, 520px)', display: 'flex', flexDirection: 'column',
        color: token.colorText,
      }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px' }}>
        {!expanded && <strong>{t('layout.notifications.title')}</strong>}
        {expanded && <Input allowClear aria-label={t('layout.notifications.search')}
          placeholder={t('layout.notifications.search')} prefix={<Search size={14} />}
          value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          style={{ flex: 1, minWidth: 0 }} />}
        <Button type="text" size="small" icon={CheckCheck} disabled={!unread}
          loading={markingAllRead} onClick={() => useNotificationStore.getState().markAllRead()}>
          {t('layout.notifications.markAllRead')}
        </Button>
      </header>
      {(error || countsError || decisionError) && <Alert type="warning" showIcon
        message={t(decisionError ? 'layout.notifications.decisionFailed' : error || countsError || '')}
        action={<Button size="small" icon={RefreshCw} onClick={refresh}>{t('layout.notifications.retry')}</Button>}
        style={{ margin: '0 14px 10px' }} />}
      {expanded && <div role="status" style={{ padding: '0 14px 10px', fontSize: 12, color: token.colorTextSecondary }}>
        {t('layout.notifications.resultCount', { count: filtered.length })}
        {hasMore && <span> · {t('layout.notifications.loadedSearch')}</span>}
      </div>}
      <div data-shell-notifications-list style={{ minHeight: 0, overflowY: 'auto', flex: 1 }}>
        {loading && !items.length ? <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>
          : !visible.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t(query ? 'layout.notifications.noMatches' : 'layout.notifications.empty')}
            style={{ padding: '24px 14px' }} />
            : <div data-ui-rows="notifications" style={{
              display: 'grid', gridTemplateColumns: '14px 34px minmax(0, 1fr) minmax(40px, max-content) 65px 14px',
            }}>
              {visible.map((item) => <NotificationRow key={item.id} item={item}
                busy={pendingIds.includes(item.id) || decisionId === item.id || markingAllRead}
                onRead={() => { void useNotificationStore.getState().markRead([item.id]); }}
                onDelete={() => { void useNotificationStore.getState().deleteNotifications([item.id]); }}
                onDecision={(accept) => { void decide(item, accept); }} />)}
            </div>}
      </div>
      <footer style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        {expanded ? <>
          <Pagination current={currentPage} pageSize={PAGE_SIZE} total={filtered.length}
            showSizeChanger={false} onChange={setPage} size="small" />
          {hasMore && <Button size="small" loading={loading}
            onClick={() => useNotificationStore.getState().loadMore()}>
            {t('layout.notifications.loadMore')}
          </Button>}
        </> : <Button type="text" icon={ChevronRight} onClick={onExpand} style={{ width: '100%' }}>
          {t('layout.notifications.more')}
        </Button>}
      </footer>
    </section>
  );
}
