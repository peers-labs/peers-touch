import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Button, Icon, IconButton, Segmented, Spin, TextField } from '@peers-touch/ui';
import { useMobileI18n } from '../app/mobileI18n';
import { useVisualKeyboardOverlap } from '../app/layout/useVisualKeyboardOverlap';
import type { MobileDetailRoute } from '../app/navigation';
import { BoundedList } from '../components/BoundedList';
import { findMobileSearchFunctions } from '../features/search/functions';
import { useMobileSearchStore, type MobileSearchFilter } from '../features/search/searchStore';
import { resolveSocialActorIdentity } from '../features/social/useSocialActorIdentity';
import { actorDisplayName } from '../features/social/socialProjection';
import { useSocialStore } from '../features/social/socialStore';
import { SourceState, type ResultItem } from '../gen/proto/domain/search/search_pb';
import { mobileSearchActions } from '../runtimes/searchRuntime';
import { mobileSearchResourceIdentity } from '../services/search';
import { MobileSearchResult } from './MobileSearchResult';
import './SearchPage.css';

const FILTERS: readonly MobileSearchFilter[] = ['all', 'messages', 'social', 'attachments', 'functions'];
const itemKey = (item: ResultItem) => mobileSearchResourceIdentity(item.resource);

function SearchResult({
  item, selected, opening, onOpen,
}: { item: ResultItem; selected: boolean; opening: boolean; onOpen: () => void }) {
  const { t } = useMobileI18n();
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
  return <MobileSearchResult resourceId={item.resource?.id} resourceKey={itemKey(item)}
    kind={item.kind} snippet={item.snippet} title={item.title} authorName={name}
    conversationTitle={conversationTitle} zone={item.zone} createdAtUnixMs={Number(item.createdAtUnixMs)}
    selected={selected} opening={opening} onOpen={onOpen} />;
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
          <Icon iconId="arrow-left" size={20} />
        </button>
        <h1 className="header-title compact">{t('search.mobile.entry')}</h1>
        <IconButton actionId="search.refresh" iconId="rotate-cw" iconSize={20} emphasis="quiet"
          density="comfortable" label={t('search.refresh')}
          onActivate={() => mobileSearchActions.submit(true)}
          availability={!view.query.trim() || view.opening
            ? { kind: 'disabled', reason: t(view.opening ? 'search.loading' : 'search.mobile.initial') } : undefined} />
      </header>
      <form className="mobile-search-controls" onSubmit={event => {
        event.preventDefault();
        mobileSearchActions.submit();
      }}>
        <label className="visually-hidden" htmlFor="mobile-search-input">{t('search.label')}</label>
        <div className="mobile-search-input-row">
          <span className="mobile-search-input">
            <TextField appearance="search" reveal density="comfortable" id="mobile-search-input"
              data-focus-id="search.input" value={view.query}
              leading={<Icon iconId="search" size={18} className="mobile-search-leading" />}
              clearable clearLabel={t('common.action.clear')} onClear={() => mobileSearchActions.query('')}
              placeholder={t('search.mobile.placeholder')} autoComplete="off" autoCorrect="off"
              autoCapitalize="none" spellCheck={false}
              onValueChange={value => mobileSearchActions.query(value)} />
          </span>
          <Button actionId="mobile-search-submit" behavior="submit" emphasis="primary"
            className="mobile-search-submit">
            {t('search.mobile.submit')}
          </Button>
        </div>
        <div className="mobile-search-filters" role="group" aria-label={t('search.range')}>
          <Segmented<MobileSearchFilter> label={t('search.range')} scrollable density="comfortable"
            value={view.filter} onValueChange={(filter) => mobileSearchActions.filter(filter)}
            options={FILTERS.map(filter => ({ value: filter, label: t(`search.tab.${filter}`),
              attributes: { 'data-search-filter': filter } as React.HTMLAttributes<HTMLButtonElement> }))} />
        </div>
        <div className="mobile-search-scope">
          <span className="mobile-search-scope-copy">{t(view.conversationId ? 'search.mobile.currentConversation' : 'search.mobile.allConversations')}</span>
          {view.conversationId ? <Button actionId="mobile-search-expand-scope" emphasis="quiet"
            onActivate={mobileSearchActions.allConversations}>{t('search.mobile.expandScope')}</Button> : null}
        </div>
      </form>
      <div ref={viewport} className="mobile-search-viewport" data-search-viewport
        onScroll={event => useMobileSearchStore.setState({ scrollTop: event.currentTarget.scrollTop })}>
        {view.errorKey ? <div className="mobile-search-notice" role="alert">
          <span>{t(view.errorKey)}</span>
          <Button actionId="mobile-search-retry" emphasis="secondary"
            onActivate={() => mobileSearchActions.submit()}>{t('common.action.retry')}</Button>
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
              <Button actionId="mobile-search-page-prev" emphasis="secondary"
                availability={view.page === 0 || view.status === 'loading'
                  ? { kind: 'disabled', reason: t('mobile.list.previous') }
                  : undefined}
                onActivate={() => mobileSearchActions.page(-1)}>{t('mobile.list.previous')}</Button>
              <Button actionId="mobile-search-page-next" emphasis="secondary"
                availability={!view.response.hasMore || view.page >= 31 || view.status === 'loading'
                  ? { kind: 'disabled', reason: t('mobile.list.next') }
                  : undefined}
                onActivate={() => mobileSearchActions.page(1)}>{t('mobile.list.next')}</Button>
            </div>
          ) : null}
        </> : null}
        {showFunctions && view.status !== 'concealed' ? <section aria-label={t('search.quickFunctions')} className="mobile-search-functions">
          <h2>{t('search.quickFunctions')}</h2>
          {functions.map(item => <button key={item.id} type="button" className="mobile-search-function"
            data-search-function={item.id} onClick={() => onOpenDetail({ routeId: 'detail:setting', settingId: item.id })}>
            <Icon iconId="settings" size={18} aria-hidden="true" /><span>{t(item.titleKey)}</span><Icon iconId="chevron-right" size={18} aria-hidden="true" />
          </button>)}
          {view.filter === 'functions' && functions.length === 0 ? <p role="status">{t('search.empty.title', { query: view.query })}</p> : null}
        </section> : null}
      </div>
    </div>
  );
}
