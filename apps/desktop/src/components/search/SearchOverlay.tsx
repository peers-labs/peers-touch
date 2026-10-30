import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Modal, Popover, theme } from 'antd';
import {
  ArrowUpRight, CircleSlash, Copy, Hash, HelpCircle, Loader2, Lock, MessageCircle,
  Newspaper, Search, Wrench, X,
} from 'lucide-react';
import { SearchKind, SearchZone, type ResultItem } from '../../gen/proto/domain/search/search_pb';
import { useSearchStore } from '../../store/search';
import { searchActions } from '../../runtimes/searchRuntime';
import { searchRowKey } from '../../services/search';
import type { Navigation } from '../../types/navigation';
import { SEARCH_FUNCTIONS, openSearchFunction, type SearchFunction } from './functions';
import { SearchResultMeta } from './SearchResultMeta';
import {
  authorizedRowCopyText, clampQuery, coverageStatus, deliveredCoverage, isPrintableCharacterKey,
  nextRovingIndex, searchPresentation,
} from '../../runtimes/searchFrames';
import './SearchOverlay.css';

type Row = { type: 'content'; item: ResultItem } | { type: 'function'; item: SearchFunction };

function rowKey(row: Row): string {
  return row.type === 'function' ? `function:${row.item.id}` : searchRowKey(row.item.resource);
}

const CLICK_DRAG_PX = 4;

export function SearchOverlay({ navigation }: { navigation: Navigation }) {
  const { t } = useTranslation('search');
  const { token } = theme.useToken();
  const view = useSearchStore(useShallow(state => ({
    query: state.query, mode: state.mode, status: state.status, response: state.response,
    displayedQuery: state.displayedQuery, displayedMode: state.displayedMode, stalled: state.stalled,
    errorKey: state.errorKey, opening: state.opening, selectedKey: state.selectedKey,
    contentFilter: state.contentFilter, displayedFilter: state.displayedFilter,
    progressive: state.progressive, progressiveRequestId: state.progressiveRequestId,
    progressiveSources: state.progressiveSources,
  })));
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement);
  const navigating = useRef(false);
  const composing = useRef(false);
  const press = useRef<{ x: number; y: number } | null>(null);
  const functions = useMemo(() => {
    const query = view.query.normalize('NFKC').trim().toLowerCase();
    return SEARCH_FUNCTIONS.filter(item => !query
      || `${t(item.titleKey)} ${t(item.detailKey)} ${item.keywords}`.toLowerCase().includes(query));
  }, [view.query, t]);
  const presentation = useMemo(() => searchPresentation({
    mode: view.mode, draft: view.query, displayedQuery: view.displayedQuery,
    contentFilter: view.contentFilter, displayedFilter: view.displayedFilter,
    status: view.status, errorKey: view.errorKey, response: view.response,
    progressive: view.progressive, progressiveRequestId: view.progressiveRequestId,
    progressiveSources: view.progressiveSources,
  }), [view.mode, view.query, view.displayedQuery, view.contentFilter, view.displayedFilter,
    view.status, view.errorKey, view.response, view.progressive,
    view.progressiveRequestId, view.progressiveSources]);
  const observation = presentation.observation;
  const rows: Row[] = useMemo(() => view.mode === 'functions'
    ? functions.map(item => ({ type: 'function', item }))
    : (observation?.items ?? []).map(item => ({ type: 'content', item })),
  [view.mode, functions, observation]);
  const selectedIndex = rows.findIndex(row => rowKey(row) === view.selectedKey);
  const displayedQuery = view.mode === 'functions' ? view.query : view.displayedQuery;
  const draftMatches = view.query.trim() === view.displayedQuery && view.contentFilter === view.displayedFilter;
  // Enter waits only while the FIND for this exact draft is in flight.
  const awaitingFinal = presentation.isProgressive;

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
  }, [observation]);

  async function openRow(row: Row): Promise<void> {
    if (view.opening) return;
    useSearchStore.setState({ selectedKey: rowKey(row) });
    if (row.type === 'function') {
      navigating.current = true;
      searchActions.close();
      openSearchFunction(row.item, navigation);
      return;
    }
    // Closing the overlay occurs inside the runtime before its Promise settles.
    // Focus restoration must already know that the original page owns focus.
    navigating.current = true;
    if (!await searchActions.openResult(row.item, navigation)) navigating.current = false;
  }

  async function copyContentRow(item: ResultItem): Promise<void> {
    const text = authorizedRowCopyText(item);
    if (!text || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard denial is non-modal; the row text remains selectable.
    }
  }

  function focusRow(index: number): void {
    requestAnimationFrame(() => {
      document.getElementById(`pt-search-row-${index}`)?.focus();
      document.getElementById(`pt-search-row-${index}`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  function moveRoving(delta: 1 | -1): void {
    const next = nextRovingIndex(selectedIndex >= 0 ? selectedIndex : null, delta, rows.length);
    if (next === null) {
      useSearchStore.setState({ selectedKey: null });
      inputRef.current?.focus();
      return;
    }
    useSearchStore.setState({ selectedKey: rowKey(rows[next]) });
    focusRow(next);
  }

  function returnToInput(): void {
    useSearchStore.setState({ selectedKey: null });
    inputRef.current?.focus();
  }

  /**
   * Move a printable character typed while a row owns focus back into the
   * input. Focus switching alone loses the character: the browser finishes
   * the key sequence on the originally focused row, so insert it at the
   * caret and admit the new draft through the normal stable-input path.
   */
  function returnCharacterToInput(event: KeyboardEvent<HTMLDivElement>): void {
    const input = inputRef.current;
    returnToInput();
    if (!input) return;
    const value = input.value;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    const next = clampQuery(value.slice(0, start) + event.key + value.slice(end));
    if (next === value) return; // at the 256 scalar boundary: drop the character
    searchActions.query(next, true);
    requestAnimationFrame(() => {
      const caret = Math.min(start + 1, Array.from(next).length);
      input.setSelectionRange(caret, caret);
    });
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveRoving(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveRoving(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = view.mode === 'functions' ? rows[Math.max(0, selectedIndex)]
        : draftMatches ? rows[selectedIndex] : undefined;
      if (row) void openRow(row);
      else if (view.mode !== 'functions' && view.query.trim() && !awaitingFinal) searchActions.submit();
      // During a progressive wait Enter is intentionally a no-op: the same
      // request's final frame settles automatically.
    } else if (event.key === 'Escape') {
      event.preventDefault();
      searchActions.close();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && !event.shiftKey) {
      if (hasTextSelection()) return;
      const row = selectedIndex >= 0 ? rows[selectedIndex] : undefined;
      if (row?.type === 'content') {
        event.preventDefault();
        void copyContentRow(row.item);
      }
    }
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLDivElement>, row: Row): void {
    // A composition key while a row has focus returns composition to the
    // input rather than being dropped on the non-editable target.
    if (event.nativeEvent.keyCode === 229) {
      event.preventDefault();
      returnToInput();
      return;
    }
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveRoving(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void openRow(row);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      returnToInput();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && !event.shiftKey) {
      if (hasTextSelection()) return;
      if (row.type === 'content') {
        event.preventDefault();
        void copyContentRow(row.item);
      }
      return;
    }
    if (isPrintableCharacterKey(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      returnCharacterToInput(event);
    }
  }

  function onRowMouseDown(event: MouseEvent): void {
    // Only the primary button can press or begin a drag threshold on a row.
    if (event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY };
  }

  function onRowClick(row: Row, event: MouseEvent): void {
    if (event.button !== 0) return;
    // Drag-selecting title/snippet text must not activate the row.
    if (hasTextSelection()) return;
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_DRAG_PX) return;
    void openRow(row);
  }

  function renderRow(row: Row, index: number) {
    const isFunction = row.type === 'function';
    const content = row.type === 'content' ? row.item : null;
    const title = row.type === 'function' ? t(row.item.titleKey) : row.item.title || t('search.kind.message');
    const detail = row.type === 'function' ? t(row.item.detailKey) : row.item.snippet;
    const Icon = isFunction ? Wrench : content?.kind === SearchKind.CONVERSATION ? Hash
      : content?.kind === SearchKind.SOCIAL_POST || content?.kind === SearchKind.SOCIAL_COMMENT ? Newspaper : MessageCircle;
    const selected = index === selectedIndex;
    const zoneKey = content?.zone === SearchZone.STATION ? 'search.zone.station'
      : content?.zone === SearchZone.FEDERATION ? 'search.zone.federation' : 'search.zone.device';
    const titleId = `pt-search-title-${index}`;
    const copyLabelId = `pt-search-copy-label-${index}`;
    return (
      <li key={rowKey(row)} role="listitem" className={`pt-search-row${selected ? ' active' : ''}`}
        data-resource-id={content?.resource?.id} data-source-id={content?.sourceId}
        data-resource-kind={content?.resource?.kind}>
        <div role="button" tabIndex={selected ? 0 : -1}
          className="pt-search-row-target" aria-disabled={view.opening}
          id={`pt-search-row-${index}`}
          onKeyDown={event => onRowKeyDown(event, row)}
          onMouseDown={onRowMouseDown}
          onClick={event => onRowClick(row, event)}>
          <span className="pt-search-row-icon"><Icon size={15} /></span>
          <span className="pt-search-main">
            <span className="pt-search-title" id={titleId}>{highlight(title, displayedQuery)}</span>
            {detail && <span className="pt-search-snippet">{highlight(detail, displayedQuery)}</span>}
            {content && <SearchResultMeta item={content} />}
          </span>
          {!isFunction && <span className="pt-search-zone"><Lock size={11} />{t(zoneKey)}</span>}
          <ArrowUpRight size={14} className="pt-search-row-open" />
        </div>
        {!isFunction && content && <button type="button" className="pt-search-copy"
          aria-labelledby={`${titleId} ${copyLabelId}`}
          onClick={() => { void copyContentRow(content); }}>
          <Copy size={13} aria-hidden="true" />
          <span id={copyLabelId} className="pt-search-visuallyhidden">{t('search.copy.label')}</span>
        </button>}
      </li>
    );
  }

  const pending = presentation.pendingSources;
  // Coverage the Popover may claim. During a progressive FIND only sources
  // that actually delivered are shown as coverage; outstanding sources are
  // listed as pending rather than implied complete.
  const claimedCoverage = deliveredCoverage(presentation, view.progressiveSources);
  const hasStation = (observation?.sources ?? []).some(source => source.sourceId === 'station.social.public');
  const coveragePopover = (
    <div className="pt-search-popover">
      <section>
        <h6>{t('search.popover.scopeTitle')}</h6>
        <p>{t('search.scope')}</p>
        <p>{t('search.boundary')}</p>
        <p>{t('search.popover.realtime')}</p>
        <p>{t('search.popover.privateCheck')}</p>
        <p>{t('search.coverage.historyBoundary')}</p>
      </section>
      <section>
        <h6>{t('search.popover.coverageTitle')}</h6>
        {claimedCoverage.length
          ? <ul>{claimedCoverage.map(source => <li key={source.sourceId}>{t(source.detailKey
            || 'search.coverage.device')}</li>)}</ul>
          : !presentation.isProgressive && <p>{t('search.coverage.device')}</p>}
        {pending.length > 0
          && <p className="pt-search-popover-pending">{t('search.coverage.pending')}</p>}
      </section>
      <section>
        <h6>{t('search.popover.keyboardTitle')}</h6>
        <p>{t('search.popover.keyboard')}</p>
        <p>{t('search.popover.copy')}</p>
      </section>
    </div>
  );

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
          <input ref={inputRef} value={view.query} maxLength={256} placeholder={t('search.input.placeholder')}
            aria-label={t('search.label')} role="searchbox" aria-autocomplete="list"
            aria-controls="pt-search-results" aria-expanded
            onKeyDown={onInputKeyDown}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={event => { composing.current = false; searchActions.query(event.currentTarget.value); }}
            onChange={event => {
              const nativeEvent = event.nativeEvent as InputEvent;
              if (composing.current && !nativeEvent.isComposing) {
                composing.current = false;
              }
              searchActions.query(event.target.value, !composing.current);
            }} />
          <span className="pt-search-progress">
            {view.stalled && <span className="pt-search-status" role="status" aria-label={t('search.loading')}>
              <Loader2 size={16} className="pt-search-spin" aria-hidden="true" />
            </span>}
          </span>
          <button type="button" className="pt-search-close" onClick={searchActions.close} aria-label={t('search.close')}><X size={15} /></button>
        </div>
      </div>
      <div className="pt-search-intents" role="tablist" aria-label={t('search.range')}>
        {(['all', 'messages', 'social', 'attachments'] as const).map(filter => <button key={filter}
          data-search-filter={filter}
          role="tab" aria-selected={view.mode !== 'functions' && view.contentFilter === filter}
          className={view.mode !== 'functions' && view.contentFilter === filter ? 'active' : ''}
          onClick={() => searchActions.filter(filter)}>{t(`search.tab.${filter}`)}</button>)}
        <button role="tab" data-search-filter="functions" aria-selected={view.mode === 'functions'} className={view.mode === 'functions' ? 'active' : ''}
          onClick={() => searchActions.mode('functions')}>{t('search.tab.functions')}</button>
      </div>
      <div ref={bodyRef} className="pt-search-body" data-displayed-query={displayedQuery}
        aria-busy={presentation.isProgressive || view.status === 'loading'}
        onScroll={event => {
          searchActions.scroll(event.currentTarget.scrollTop);
        }}>
        {rows.length > 0 && <div className="pt-search-group">
          <div className="pt-search-group-title">{t(presentation.groupTitle)} · {rows.length}</div>
          <ul id="pt-search-results" role="list" className="pt-search-list"
            aria-label={t('search.results')} aria-busy={presentation.isProgressive || view.status === 'loading'}>
            {rows.map(renderRow)}
          </ul>
        </div>}
        {presentation.showQuickFunctions && <div className="pt-search-group">
          <div className="pt-search-group-title">{t('search.quickFunctions')}</div>
          <ul role="list" className="pt-search-list">
            {SEARCH_FUNCTIONS.slice(0, 4).map(item => <li role="listitem" key={item.id}>
              <button type="button" className="pt-search-quick"
                onClick={() => { navigating.current = true; searchActions.close(); openSearchFunction(item, navigation); }}>
                <span className="pt-search-row-icon"><Wrench size={15} /></span>
                <span className="pt-search-main"><span className="pt-search-title">{t(item.titleKey)}</span><span className="pt-search-meta">{t(item.detailKey)}</span></span>
                <ArrowUpRight size={14} />
              </button>
            </li>)}
          </ul>
        </div>}
        {view.mode === 'suggest' && !!view.query.trim() && <p className="pt-search-hint">{t('search.enterHint')}</p>}
        {presentation.showEmpty && rows.length === 0 && <div className="pt-search-empty">
          <CircleSlash size={28} /><strong>{t('search.empty.title', { query: displayedQuery })}</strong><span>{t('search.empty.detail')}</span>
        </div>}
        {view.errorKey && <div className="pt-search-error" role="alert">
          <span>{t(view.errorKey)}</span>
          <button onClick={() => searchActions.submit(true)}>{t('search.retry')}</button>
        </div>}
        {view.displayedMode === 'submit' && view.mode !== 'functions' && view.response?.hasMore && <button className="pt-search-more"
          disabled={view.status === 'loading' || !draftMatches} onClick={searchActions.more}>{t('search.more')}</button>}
      </div>
      <div className="pt-search-footer">
        <div className="pt-search-statusline pt-search-coverage" aria-live="polite">
          <span className="pt-search-zone-chip"><Lock size={10} aria-hidden="true" />{t('search.status.device')}</span>
          {hasStation && <span className="pt-search-zone-chip"><Lock size={10} aria-hidden="true" />{t('search.status.station')}</span>}
          {pending.length > 0 && <span className="pt-search-status-pending">{t('search.coverage.pending')}</span>}
          {claimedCoverage.map(source => {
            const kind = coverageStatus(source);
            return kind ? <span key={source.sourceId} className={`pt-search-status-${kind}`}>
              {t(`search.status.${kind}`)}
            </span> : null;
          })}
        </div>
        <div className="pt-search-footer-actions">
          {view.mode === 'submit' && <button type="button" disabled={view.status === 'loading' || view.opening}
            onClick={() => searchActions.submit(true)}>{t('search.refresh')}</button>}
          {view.opening && <span className="pt-search-opening"><Loader2 size={12} className="pt-search-spin" /> {t('search.opening')}</span>}
          <Popover trigger={['hover', 'click', 'focus']} placement="bottomRight"
            title={t('search.popover.title')} content={coveragePopover}>
            <button type="button" className="pt-search-info" aria-label={t('search.moreInfo')}>
              <HelpCircle size={14} aria-hidden="true" />
            </button>
          </Popover>
        </div>
      </div>
    </Modal>
  );
}

function hasTextSelection(): boolean {
  return (window.getSelection()?.toString().length ?? 0) > 0;
}

function highlight(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  const index = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (index < 0) return text;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + needle.length)}</mark>{text.slice(index + needle.length)}</>;
}
