import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Button, Input, Spin, Typography } from 'antd';
import { ArrowLeft, ChevronRight, FileText, MessageCircle, Newspaper, RefreshCw, Search, Settings } from 'lucide-react';
import { useMobileI18n } from '../app/mobileI18n';
import { useVisualKeyboardOverlap } from '../app/layout/useVisualKeyboardOverlap';
import type { MobileDetailRoute } from '../app/navigation';
import { BoundedList } from '../components/BoundedList';
import { findMobileSearchFunctions } from '../features/search/functions';
import { useMobileSearchStore, type MobileSearchFilter } from '../features/search/searchStore';
import { resolveSocialActorIdentity } from '../features/social/useSocialActorIdentity';
import { actorDisplayName } from '../features/social/socialProjection';
import { useSocialStore } from '../features/social/socialStore';
import { SearchKind, SearchZone, SourceState, type ResultItem } from '../gen/proto/domain/search/search_pb';
import { mobileSearchActions } from '../runtimes/searchRuntime';
import { mobileSearchResourceIdentity } from '../services/search';
import './SearchPage.css';

const FILTERS: readonly MobileSearchFilter[] = ['all', 'messages', 'social', 'attachments', 'functions'];
const itemKey = (item: ResultItem) => mobileSearchResourceIdentity(item.resource);

function SearchResult({
  item, selected, opening, onOpen,
}: { item: ResultItem; selected: boolean; opening: boolean; onOpen: () => void }) {
  const { t, language } = useMobileI18n();
  const profile = useSocialStore(state => item.authorPtid === state.currentUserPtid
    ? state.currentUserProfile : state.peerProfiles[item.authorPtid]);
  const currentUserPtid = useSocialStore(state => state.currentUserPtid);
  const session = useSocialStore(state => state.sessions.find(row => row.ulid === item.resource?.conversationId));
  const fallbackName = session?.participantAPtid === item.authorPtid
    ? session.participantADisplayName
    : session?.participantBPtid === item.authorPtid ? session.participantBDisplayName : '';
  const name = resolveSocialActorIdentity({ actorPtid: item.authorPtid, displayName: fallbackName }, profile).displayName
    || t('mobile.contacts.unknownUser');
  const conversationTitle = actorDisplayName(item.conversationTitle, '')
    || actorDisplayName(session?.participantAPtid === currentUserPtid
      ? session.participantBDisplayName : session?.participantADisplayName, '')
    || t('mobile.chat.title');
  const timestamp = Number(item.createdAtUnixMs);
  const isSocial = item.kind === SearchKind.SOCIAL_POST || item.kind === SearchKind.SOCIAL_COMMENT;
  return (
    <button
      type="button" className={`mobile-search-result${selected ? ' selected' : ''}`}
      data-entity="search-result" data-resource-id={item.resource?.id}
      data-scroll-anchor-id={itemKey(item)} data-focus-id={itemKey(item)}
      disabled={opening} onClick={onOpen}
    >
      <span className="mobile-search-result__icon" aria-hidden="true">
        {isSocial ? <Newspaper size={20} /> : item.kind === SearchKind.ATTACHMENT ? <FileText size={20} /> : <MessageCircle size={20} />}
      </span>
      <span className="mobile-search-result__body">
        <span className="mobile-search-result__title">{item.snippet || item.title}</span>
        <span className="mobile-search-result__meta">
          <span>{isSocial ? t(item.kind === SearchKind.SOCIAL_COMMENT ? 'search.kind.socialComment' : 'search.kind.socialPost') : conversationTitle} · {name}</span>
          <span>{t(item.zone === SearchZone.STATION ? 'search.zone.station' : 'search.zone.device')}</span>
          {timestamp > 0 ? <time dateTime={new Date(timestamp).toISOString()}>
            {new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp)}
          </time> : null}
        </span>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
}

/** One selected detail tree; execution/freshness belongs to Search and Messaging runtimes. */
export function SearchPage({
  onBack, onOpenDetail,
}: { onBack: () => void; onOpenDetail: (route: MobileDetailRoute) => void }) {
  const { t } = useMobileI18n();
  const view = useMobileSearchStore();
  const keyboardOverlapHeight = useVisualKeyboardOverlap();
  const style = { '--mobile-search-keyboard-overlap': `${keyboardOverlapHeight}px` } as CSSProperties;
  const viewport = useRef<HTMLDivElement>(null);
  const items = view.status === 'concealed' ? [] : view.response?.items ?? [];
  const functions = findMobileSearchFunctions(view.query);
  const showFunctions = view.filter === 'all' || view.filter === 'functions';
  const surfaceKey = `mobile-search:${view.displayedQuery}:${view.displayedFilter}:${view.conversationId}:${view.page}`;

  useLayoutEffect(() => {
    const root = viewport.current;
    if (!root || view.status !== 'ready') return;
    root.scrollTop = useMobileSearchStore.getState().scrollTop;
    const selected = Array.from(root.querySelectorAll<HTMLElement>('[data-resource-id]'))
      .find(row => row.dataset.resourceId === view.selectedId);
    selected?.focus({ preventScroll: true });
  }, [view.status, view.selectedId]);

  async function open(item: ResultItem) {
    await mobileSearchActions.open(item, onOpenDetail);
  }

  return (
    <div className="page-container mobile-search-page" style={style}
      data-product-surface="search.mobile" data-search-state={view.status}>
      <header className="page-header">
        <button type="button" className="header-action" onClick={onBack} aria-label={t('common.action.back')}>
          <ArrowLeft size={20} />
        </button>
        <h1 className="header-title compact">{t('search.mobile.entry')}</h1>
        <button type="button" className="header-action" aria-label={t('search.refresh')}
          onClick={() => mobileSearchActions.submit(true)} disabled={!view.query.trim() || view.opening}>
          <RefreshCw size={20} />
        </button>
      </header>
      <form className="mobile-search-controls" onSubmit={event => {
        event.preventDefault();
        mobileSearchActions.submit();
      }}>
        <label className="visually-hidden" htmlFor="mobile-search-input">{t('search.label')}</label>
        <div className="mobile-search-input-row">
          <Input id="mobile-search-input" data-focus-id="search.input" value={view.query}
            prefix={<Search size={18} />} allowClear
            placeholder={t('search.mobile.placeholder')} autoComplete="off" autoCorrect="off"
            autoCapitalize="none" spellCheck={false}
            onChange={event => mobileSearchActions.query(event.target.value)} />
          <Button type="primary" htmlType="submit">{t('search.mobile.submit')}</Button>
        </div>
        <div className="mobile-search-filters" role="group" aria-label={t('search.range')}>
          {FILTERS.map(filter => <button type="button" key={filter} aria-pressed={view.filter === filter}
            data-search-filter={filter}
            onClick={() => mobileSearchActions.filter(filter)}>{t(`search.tab.${filter}`)}</button>)}
        </div>
        <div className="mobile-search-scope">
          <Typography.Text type="secondary">{t(view.conversationId ? 'search.mobile.currentConversation' : 'search.mobile.allConversations')}</Typography.Text>
          {view.conversationId ? <Button type="text" onClick={mobileSearchActions.allConversations}>{t('search.mobile.expandScope')}</Button> : null}
        </div>
      </form>
      <div ref={viewport} className="mobile-search-viewport" data-search-viewport
        onScroll={event => useMobileSearchStore.setState({ scrollTop: event.currentTarget.scrollTop })}>
        {view.errorKey ? <div className="mobile-search-notice" role="alert">
          <span>{t(view.errorKey)}</span>
          <Button onClick={() => mobileSearchActions.submit()}>{t('common.action.retry')}</Button>
        </div> : null}
        {view.status === 'concealed' || view.status === 'loading' && view.stalled ? (
          <div className="mobile-search-state" role="status" aria-busy="true">
            <Spin /><span>{t(view.status === 'concealed' ? 'search.mobile.concealed' : 'search.loading')}</span>
          </div>
        ) : view.status === 'idle' ? <div className="mobile-search-state" role="status">{t('search.mobile.initial')}</div> : null}
        {view.status !== 'concealed' && view.response ? <>
          <div className="mobile-search-coverage" role="status">
            <span>{t('search.coverage.historyBoundary')}</span>
            {view.response.coverage.map(source => <span key={source.sourceId} data-source-state={source.state}>
              {t(source.detailKey || (source.state === SourceState.READY ? 'search.coverage.device_ready' : 'search.coverage.partial'))}
            </span>)}
          </div>
          <BoundedList surfaceKey={surfaceKey} items={items} itemKey={itemKey} size={100}>
            {rows => rows.map(item => <SearchResult key={itemKey(item)} item={item}
              selected={view.selectedId === item.resource?.id} opening={view.opening}
              onOpen={() => { void open(item); }} />)}
          </BoundedList>
          {items.length === 0 ? <div className="mobile-search-state" role="status">
            <strong>{t('search.empty.title', { query: view.displayedQuery })}</strong>
            <span>{t('search.empty.detail')}</span>
          </div> : null}
          {view.mode === 'submit' && (view.page > 0 || view.response.hasMore) ? (
            <div className="mobile-search-pagination">
              <Button disabled={view.page === 0 || view.status === 'loading'} onClick={() => mobileSearchActions.page(-1)}>{t('mobile.list.previous')}</Button>
              <Button disabled={!view.response.hasMore || view.page >= 31 || view.status === 'loading'} onClick={() => mobileSearchActions.page(1)}>{t('mobile.list.next')}</Button>
            </div>
          ) : null}
        </> : null}
        {showFunctions && view.status !== 'concealed' ? <section aria-label={t('search.quickFunctions')} className="mobile-search-functions">
          <h2>{t('search.quickFunctions')}</h2>
          {functions.map(item => <button key={item.id} type="button" className="mobile-search-function"
            data-search-function={item.id} onClick={() => onOpenDetail({ routeId: 'detail:setting', settingId: item.id })}>
            <Settings size={18} aria-hidden="true" /><span>{t(item.titleKey)}</span><ChevronRight size={18} aria-hidden="true" />
          </button>)}
          {view.filter === 'functions' && functions.length === 0 ? <p role="status">{t('search.empty.title', { query: view.query })}</p> : null}
        </section> : null}
      </div>
    </div>
  );
}
