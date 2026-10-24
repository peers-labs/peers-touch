import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Modal, theme } from 'antd';
import { ArrowUpRight, CircleSlash, Hash, Loader2, Lock, MessageCircle, Search, Wrench, X } from 'lucide-react';
import { SearchKind, SourceState, type ResultItem } from '../../gen/proto/domain/search/search_pb';
import { useSearchStore } from '../../store/search';
import { searchActions } from '../../runtimes/searchRuntime';
import { resourceIdentity } from '../../services/search';
import { openMessagingResource } from '../../messaging/openResource';
import { messagingDomainRuntime } from '../../messaging/runtime';
import { useSocialChatStore } from '../../store/socialChat';
import type { Navigation } from '../../types/navigation';
import { SEARCH_FUNCTIONS, openSearchFunction, type SearchFunction } from './functions';
import './SearchOverlay.css';

type Row = { type: 'content'; item: ResultItem } | { type: 'function'; item: SearchFunction };

export function SearchOverlay({ navigation }: { navigation: Navigation }) {
  const { t, i18n } = useTranslation('search');
  const { token } = theme.useToken();
  const view = useSearchStore(useShallow(state => ({
    query: state.query, mode: state.mode, status: state.status, response: state.response,
    displayedQuery: state.displayedQuery, displayedMode: state.displayedMode, stalled: state.stalled,
    errorKey: state.errorKey, opening: state.opening, selectedIndex: state.selectedIndex,
    cursorEngaged: state.cursorEngaged,
  })));
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement);
  const navigating = useRef(false);
  const composing = useRef(false);
  const functions = useMemo(() => {
    const query = view.query.normalize('NFKC').trim().toLowerCase();
    return SEARCH_FUNCTIONS.filter(item => !query
      || `${t(item.titleKey)} ${t(item.detailKey)} ${item.keywords}`.toLowerCase().includes(query));
  }, [view.query, t]);
  const rows: Row[] = useMemo(() => view.mode === 'functions'
    ? functions.map(item => ({ type: 'function', item }))
    : (view.response?.items ?? []).map(item => ({ type: 'content', item })), [view.mode, functions, view.response]);
  const displayedQuery = view.mode === 'functions' ? view.query : view.displayedQuery;
  const initial = !displayedQuery && view.mode !== 'functions';
  const draftMatches = view.query.trim() === view.displayedQuery;

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      if (!navigating.current && opener.current instanceof HTMLElement && opener.current.isConnected) {
        opener.current.focus();
      }
    };
  }, []);
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = useSearchStore.getState().scrollTop;
  }, [view.response]);
  useEffect(() => {
    if (!view.cursorEngaged) return;
    bodyRef.current?.querySelector(`#pt-search-option-${view.selectedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [view.selectedIndex, view.cursorEngaged]);

  async function openRow(row: Row): Promise<void> {
    if (view.opening) return;
    if (row.type === 'function') {
      navigating.current = true;
      searchActions.close();
      openSearchFunction(row.item, navigation);
      return;
    }
    if (!row.item.resource) return;
    const scope = messagingDomainRuntime.captureScope();
    if (!scope) return;
    const resource = await searchActions.resolve(row.item.resource);
    if (!resource) return;
    const generation = searchActions.generation();
    useSearchStore.setState({ opening: true });
    try {
      const current = () => searchActions.generation() === generation && useSearchStore.getState().open;
      await openMessagingResource(resource, () => navigation.navigateTo('chat'), current);
      if (!messagingDomainRuntime.isCurrent(scope) || !current()) return;
      navigating.current = true;
      useSearchStore.setState({ returnAvailable: true });
      searchActions.close();
    } catch {
      if (searchActions.generation() === generation && useSearchStore.getState().open) {
        useSearchStore.setState({ opening: false, errorKey: 'search.error.resourceUnavailable' });
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      useSearchStore.setState({
        cursorEngaged: true,
        selectedIndex: view.cursorEngaged
          ? Math.max(0, Math.min(rows.length - 1, view.selectedIndex + delta)) : 0,
      });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = view.mode === 'functions' || (view.cursorEngaged && draftMatches)
        ? rows[view.selectedIndex] : undefined;
      if (row) void openRow(row);
      else if (view.mode !== 'functions' && view.query.trim()) searchActions.submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      searchActions.close();
    }
  }

  function renderRow(row: Row, index: number) {
    const isFunction = row.type === 'function';
    const content = row.type === 'content' ? row.item : null;
    const title = row.type === 'function' ? t(row.item.titleKey) : row.item.title || t('search.kind.message');
    const detail = row.type === 'function' ? t(row.item.detailKey) : row.item.snippet;
    const Icon = isFunction ? Wrench : content?.kind === SearchKind.CONVERSATION ? Hash : MessageCircle;
    const selected = view.cursorEngaged && index === view.selectedIndex;
    const sender = content?.authorPtid && content.resource
      ? useSocialChatStore.getState().getIMSenderProfile(
        useSocialChatStore.getState().conversations.find(conversation => conversation.conversationId === content.resource?.conversationId)?.kind === 2 ? 'group' : 'friend',
        content.resource.conversationId, content.authorPtid,
      ).name : '';
    return (
      <button key={row.type === 'function' ? row.item.id : resourceIdentity(row.item.resource)}
        type="button" className={`pt-search-row${selected ? ' active' : ''}`}
        id={`pt-search-option-${index}`} role="option" aria-selected={selected} tabIndex={-1}
        disabled={view.opening} onMouseEnter={() => useSearchStore.setState({ cursorEngaged: true, selectedIndex: index })}
        onClick={() => { void openRow(row); }}>
        <span className="pt-search-row-icon"><Icon size={15} /></span>
        <span className="pt-search-main">
          <span className="pt-search-title">{highlight(title, displayedQuery)}</span>
          {detail && <span className="pt-search-snippet">{highlight(detail, displayedQuery)}</span>}
          {content && <span className="pt-search-meta">
            {content.conversationTitle || sender}
            {content.conversationTitle && sender && ` · ${sender}`}
            {content.createdAtUnixMs > 0n && ` · ${new Date(Number(content.createdAtUnixMs)).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
          </span>}
        </span>
        {!isFunction && <span className="pt-search-zone"><Lock size={11} />{t('search.zone.device')}</span>}
        <ArrowUpRight size={14} className="pt-search-row-open" />
      </button>
    );
  }

  const partial = view.response?.coverage.some(source => source.state !== SourceState.READY);
  return (
    <Modal open getContainer={false} width={720} footer={null} closable={false} title={t('search.label')}
      onCancel={searchActions.close} focusTriggerAfterClose={false}
      rootClassName="pt-search-modal" rootStyle={{ position: 'absolute', inset: 0 }}
      style={{ top: 72, maxWidth: 'calc(100% - 48px)' }}
      styles={{ header: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }, body: { padding: 0 }, container: { padding: 0, overflow: 'hidden' }, mask: { position: 'absolute' }, wrapper: { position: 'absolute' } }}
      modalRender={node => <div aria-label={t('search.label')} style={{
        '--pt-search-surface': token.colorBgElevated, '--pt-search-subtle': token.colorFillQuaternary,
        '--pt-search-border': token.colorBorderSecondary, '--pt-search-text': token.colorText,
        '--pt-search-secondary': token.colorTextSecondary, '--pt-search-muted': token.colorTextTertiary,
        '--pt-search-primary': token.colorPrimary, '--pt-search-wash': token.colorPrimaryBg,
      } as React.CSSProperties}>{node}</div>}>
      <div className="pt-search-field-area">
        <div className="pt-search-field" data-focus-boundary>
          <Search size={17} aria-hidden="true" />
          <input ref={inputRef} value={view.query} maxLength={512} placeholder={t('search.input.placeholder')}
            aria-label={t('search.label')} role="combobox" aria-autocomplete="list"
            aria-controls="pt-search-results" aria-expanded
            aria-activedescendant={view.cursorEngaged && rows[view.selectedIndex] ? `pt-search-option-${view.selectedIndex}` : undefined}
            onKeyDown={onKeyDown}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={event => { composing.current = false; searchActions.query(event.currentTarget.value); }}
            onChange={event => {
              searchActions.query(event.target.value, !composing.current);
            }} />
          <span className="pt-search-progress">
            {view.stalled && <span className="pt-search-status" role="status" aria-label={t('search.loading')}>
              <Loader2 size={16} className="pt-search-spin" aria-hidden="true" />
            </span>}
          </span>
          <span className="pt-search-scope">{t('search.scope')}</span>
          <button type="button" className="pt-search-close" onClick={searchActions.close} aria-label={t('search.close')}><X size={15} /></button>
        </div>
      </div>
      <div className="pt-search-intents" role="tablist" aria-label={t('search.range')}>
        <button role="tab" aria-selected={view.mode !== 'functions'} className={view.mode !== 'functions' ? 'active' : ''}
          onClick={() => searchActions.mode('suggest')}>{t('search.tab.all')}</button>
        <button role="tab" aria-selected={view.mode === 'functions'} className={view.mode === 'functions' ? 'active' : ''}
          onClick={() => searchActions.mode('functions')}>{t('search.tab.functions')}</button>
        <span className="pt-search-boundary"><Lock size={12} />{t('search.boundary')}</span>
      </div>
      <div ref={bodyRef} className="pt-search-body" id="pt-search-results" role="listbox" aria-label={t('search.results')}
        aria-busy={view.status === 'loading'} data-displayed-query={displayedQuery}
        onScroll={event => {
          useSearchStore.setState({ scrollTop: event.currentTarget.scrollTop });
        }}>
        {rows.length > 0 && <div className="pt-search-group">
          <div className="pt-search-group-title">{t(initial ? 'search.recent' : view.mode === 'functions' ? 'search.tab.functions' : view.displayedMode === 'suggest' ? 'search.suggestions' : 'search.results')} · {rows.length}</div>
          {rows.map(renderRow)}
        </div>}
        {initial && <div className="pt-search-group">
          <div className="pt-search-group-title">{t('search.quickFunctions')}</div>
          {SEARCH_FUNCTIONS.slice(0, 4).map(item => <button key={item.id} className="pt-search-row"
            onClick={() => { navigating.current = true; searchActions.close(); openSearchFunction(item, navigation); }}>
            <span className="pt-search-row-icon"><Wrench size={15} /></span>
            <span className="pt-search-main"><span className="pt-search-title">{t(item.titleKey)}</span><span className="pt-search-meta">{t(item.detailKey)}</span></span>
            <ArrowUpRight size={14} />
          </button>)}
        </div>}
        {displayedQuery && view.displayedMode === 'suggest' && view.mode !== 'functions' && <p className="pt-search-hint">{t('search.enterHint')}</p>}
        {!initial && rows.length === 0 && (view.status !== 'loading' || !!view.response) && !view.errorKey && <div className="pt-search-empty">
          <CircleSlash size={28} /><strong>{t('search.empty.title', { query: displayedQuery })}</strong><span>{t('search.empty.detail')}</span>
        </div>}
        {view.errorKey && <div className="pt-search-error" role="alert">
          <span>{t(view.errorKey)}</span>
          <button onClick={() => searchActions.submit(true)}>{t('search.retry')}</button>
        </div>}
        {view.displayedMode === 'submit' && view.mode !== 'functions' && view.response?.hasMore && <button className="pt-search-more"
          disabled={view.status === 'loading' || !draftMatches} onClick={searchActions.more}>{t('search.more')}</button>}
      </div>
      <div className="pt-search-footer" aria-live="polite">
        <span>{t(partial ? 'search.coverage.partial' : 'search.coverage.device')}</span>
        {view.mode === 'submit' && <button type="button" disabled={view.status === 'loading' || view.opening}
          onClick={() => searchActions.submit(true)}>{t('search.refresh')}</button>}
        {view.opening ? <span><Loader2 size={12} className="pt-search-spin" /> {t('search.opening')}</span> : <span>↑↓ · Enter · Esc</span>}
      </div>
    </Modal>
  );
}

function highlight(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  const index = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (index < 0) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + needle.length)}</mark>{text.slice(index + needle.length)}</>;
}
