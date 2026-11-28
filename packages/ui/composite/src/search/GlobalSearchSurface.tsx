import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Popover as PeersPopover } from '@peers-touch/ui';
import type { GlobalSearchSurfaceProps, SearchRegionKey, SearchResultRow, SearchGroup } from './search.types';
import './search.css';

/**
 * Rove keyboard navigation logic (pure — zero runtime/store dependency).
 * Moved from desktop `searchFrames.nextRovingIndex` (pure function already),
 * lifted into the composite since it only does array index math.
 */
function nextRovingIndex(current: number | null, delta: 1 | -1, count: number): number | null {
  if (count <= 0) return null;
  if (current === null) return delta === 1 ? 0 : null;
  const next = current + delta;
  if (next < 0 || next >= count) return null;
  return next;
}

function isPrintableCharacterKey(key: string): boolean {
  return key.length === 1;
}

/**
 * Walk all groups to produce a flat ordered list of row keys with their
 * parent group. Roving cursor navigates across group boundaries seamlessly;
 * the host owns grouping semantics.
 */
interface FlatRow { rowKey: string; index: number; group: SearchGroup; row: SearchResultRow; }

function flattenGroups(groups: SearchGroup[]): FlatRow[] {
  const flat: FlatRow[] = [];
  let idx = 0;
  for (const group of groups) {
    for (const row of group.rows) {
      flat.push({ rowKey: row.rowKey, index: idx, group, row });
      idx++;
    }
  }
  return flat;
}

/** Merge optional host-injected class names onto a composite region. */
function regionClass(base: string, hooks: GlobalSearchSurfaceProps['hooks'], key: SearchRegionKey): string {
  const host = hooks?.classNames?.[key];
  return host ? `${base} ${host}` : base;
}

/** Merge optional host-injected data attributes onto a composite region. */
function regionData(
  hooks: GlobalSearchSurfaceProps['hooks'] | undefined,
  key: SearchRegionKey,
): Record<string, string | boolean | undefined> | undefined {
  return hooks?.dataAttributes?.[key];
}

/**
 * Merge component-owned data attributes with host-injected hooks for the same
 * region. Component-owned attributes take precedence (they carry real domain
 * values), but hooks-provided attributes that the component did NOT set are
 * preserved — this is how gate selectors whose values live only in the host
 * survive the handoff.
 */
function mergeData(
  region: SearchRegionKey,
  componentAttrs: Record<string, string | boolean | undefined>,
  hooks: GlobalSearchSurfaceProps['hooks'],
): Record<string, string | boolean | undefined> {
  const hookAttrs = hooks?.dataAttributes?.[region] ?? {};
  const merged: Record<string, string | boolean | undefined> = { ...hookAttrs };
  for (const [k, v] of Object.entries(componentAttrs)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

/** Highlight query matches inside plain text (component-owned, no runtime). */
function highlight(text: string, query: string, hooks: GlobalSearchSurfaceProps['hooks']): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={regionClass('ptc-search-hit', hooks, 'hit')}>{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

const CLICK_DRAG_PX = 4;

function Glyph({ kind }: { kind: 'search' | 'close' | 'open' | 'copy' | 'refresh' | 'info' }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    open: <path d="M7 17 17 7M7 7h10v10" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01" /></>,
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

export function GlobalSearchSurface({ open, model, intents, t, hooks, shouldRestoreFocus }: GlobalSearchSurfaceProps) {
  // ── UI-transient state only (CMP-D02) ──────────────────────────────────
  const [present, setPresent] = useState(open);
  const closing = present && !open;
  const [entering, setEntering] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const composing = useRef(false);
  const press = useRef<{ x: number; y: number } | null>(null);

  // Stable row selection; a host can retain it across overlay remounts.
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const selectedKey = model.selectedKey === undefined ? localSelection : model.selectedKey;
  const groups: SearchGroup[] = [
    ...(!model.query.trim() && model.recentItems?.length
      ? [{ key: 'recent', labelKey: 'search.recent', rows: model.recentItems }] : []),
    ...model.groups,
    ...(model.quickFunctions?.length
      ? [{ key: 'quick', labelKey: 'search.quickFunctions', rows: model.quickFunctions }] : []),
  ];
  const flatRows = flattenGroups(groups);
  const cursor = flatRows.findIndex(row => row.rowKey === selectedKey);
  const draftMatches = model.draftMatches ?? model.query.trim() === (model.displayedQuery ?? model.query).trim();
  const focusPolicy = useRef(shouldRestoreFocus);
  focusPolicy.current = shouldRestoreFocus;

  function select(rowKey: string | null) {
    setLocalSelection(rowKey);
    intents.onSelectionChange?.(rowKey);
  }
  function restoreFocus() {
    if (focusPolicy.current?.() === false) return;
    if (openerRef.current instanceof HTMLElement && openerRef.current.isConnected) openerRef.current.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    setPresent(true);
    const active = document.activeElement;
    if (!active?.closest('.ptc-search-overlay')) openerRef.current = active;
    inputRef.current?.focus();
    setEntering(document.visibilityState === 'visible'
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    // WKWebView can suspend an opacity animation while the window is hidden.
    // Do not re-arm it when the window becomes visible again.
    const settleHiddenEntrance = () => {
      if (document.visibilityState !== 'visible') setEntering(false);
    };
    document.addEventListener('visibilitychange', settleHiddenEntrance);
    const deadline = window.setTimeout(() => setEntering(false), 240);
    return () => {
      window.clearTimeout(deadline);
      document.removeEventListener('visibilitychange', settleHiddenEntrance);
    };
  }, [open]);

  // Only an actual open→closed transition retains an exit frame.
  useEffect(() => {
    if (open || !present) return;
    const timer = window.setTimeout(() => { setPresent(false); restoreFocus(); }, 110);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => () => restoreFocus(), []);
  useLayoutEffect(() => {
    if (open && bodyRef.current && model.scrollTop !== undefined) bodyRef.current.scrollTop = model.scrollTop;
  }, [open, model.groups, model.scrollTop]);
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, present]);

  function copySelected(event: KeyboardEvent, row: SearchResultRow | undefined): boolean {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c' || event.shiftKey) return false;
    if (window.getSelection()?.toString() || !row?.copyable || !intents.onCopyRow) return false;
    event.preventDefault();
    intents.onCopyRow(row.rowKey);
    return true;
  }

  function move(delta: 1 | -1) {
    const next = nextRovingIndex(cursor < 0 ? null : cursor, delta, flatRows.length);
    select(next === null ? null : flatRows[next].rowKey);
    if (next === null) inputRef.current?.focus();
    else focusRow(next);
  }

  // ── Keyboard handlers ──────────────────────────────────────────────────

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = model.functionsMode || model.activateFirstOnSubmit
        ? flatRows[Math.max(0, cursor)] : draftMatches ? flatRows[cursor] : undefined;
      if (row && !model.opening) {
        void intents.onOpenRow(row.rowKey);
      } else if (model.query.trim() && !model.isProgressive) {
        intents.onSubmit();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      intents.onClose();
    } else {
      copySelected(event, flatRows[cursor]?.row);
    }
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLButtonElement>, rowKey: string): void {
    if (event.nativeEvent.keyCode === 229) {
      event.preventDefault();
      select(null);
      inputRef.current?.focus();
      return;
    }
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!model.opening) void intents.onOpenRow(rowKey);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      select(null);
      inputRef.current?.focus();
      return;
    }
    if (copySelected(event, flatRows.find(row => row.rowKey === rowKey)?.row)) return;
    if (event.key !== ' ' && isPrintableCharacterKey(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      // Hand a printable character from the focused row back to the input.
      const input = inputRef.current;
      select(null);
      if (!input) return;
      input.focus();
      const value = input.value;
      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? value.length;
      const next = Array.from(value.slice(0, start) + event.key + value.slice(end)).slice(0, 256).join('');
      intents.onQueryChange(next, true);
      requestAnimationFrame(() => {
        const caret = Math.min(start + 1, Array.from(next).length);
        input.setSelectionRange(caret, caret);
      });
    }
  }

  function focusRow(index: number): void {
    const rowKey = flatRows[index]?.rowKey;
    requestAnimationFrame(() => {
      const row = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-search-row-key]') ?? [])]
        .find(node => node.dataset.searchRowKey === rowKey);
      const body = bodyRef.current;
      if (!row || !body) return;
      row.focus({ preventScroll: true });
      const rect = row.getBoundingClientRect(), viewport = body.getBoundingClientRect();
      if (rect.top < viewport.top) body.scrollTop += rect.top - viewport.top;
      else if (rect.bottom > viewport.bottom) body.scrollTop += rect.bottom - viewport.bottom;
    });
  }

  function onRowMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY };
  }

  function onRowClick(rowKey: string, event: MouseEvent): void {
    const start = press.current;
    press.current = null;
    if (event.button !== 0 || model.opening) return;
    if ((window.getSelection()?.toString().length ?? 0) > 0) return;
    if (event.detail > 0 && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_DRAG_PX) return;
    select(rowKey);
    void intents.onOpenRow(rowKey);
  }

  // ── Render helpers ─────────────────────────────────────────────────────

  function renderRow(row: SearchResultRow, index: number, suggestion: boolean) {
    const selected = selectedKey === row.rowKey;
    const titleId = `ptc-search-title-${index}`;
    const copyLabelId = `ptc-search-copy-label-${index}`;
    return (
      <li
        key={row.rowKey}
        role="listitem"
        className={`ptc-search-item${selected ? ' is-active' : ''}`}
      >
        <button
          type="button"
          tabIndex={selected ? 0 : -1}
          className={regionClass(`ptc-search-row${selected ? ' is-active active' : ''}`, hooks, 'row')}
          aria-disabled={model.opening}
          id={`ptc-search-row-${index}`}
          data-search-index={index}
          data-search-row-key={row.rowKey}
          data-search-result={suggestion ? undefined : row.kind}
          {...mergeData('row', {
            'data-resource-id': row.resource?.id,
            'data-source-id': row.resource?.sourceId,
            'data-resource-kind': row.resource?.kind,
          }, hooks)}
          onFocus={() => { if (selectedKey !== row.rowKey) select(row.rowKey); }}
          onKeyDown={event => onRowKeyDown(event, row.rowKey)}
          onMouseDown={onRowMouseDown}
          onMouseMove={() => { if (selectedKey !== row.rowKey) select(row.rowKey); }}
          onClick={event => onRowClick(row.rowKey, event)}
        >
          <span className={regionClass('ptc-search-row-target', hooks, 'rowTarget')}>
          <span className={regionClass('ptc-search-row-icon', hooks, 'rowIcon')} {...regionData(hooks, 'rowIcon')}>
            {row.icon}
          </span>
          <span className="ptc-search-main">
            <span id={titleId} className={regionClass('ptc-search-row-title', hooks, 'rowTitle')} {...regionData(hooks, 'rowTitle')}>
              {highlight(row.title, model.displayedQuery ?? model.query, hooks)}
            </span>
            {row.snippet && (
              <span className="ptc-search-row-snippet">{highlight(row.snippet, model.displayedQuery ?? model.query, hooks)}</span>
            )}
            {row.meta && <span className={regionClass('ptc-search-row-meta', hooks, 'rowSnippet')}>{row.meta}</span>}
          </span>
          {row.zoneKey && (
            <span className={regionClass('ptc-search-row-zone', hooks, 'rowZone')} {...regionData(hooks, 'rowZone')}>
              {t(row.zoneKey)}
            </span>
          )}
          <span className={regionClass('ptc-search-row-open', hooks, 'rowOpen')} {...regionData(hooks, 'rowOpen')}><Glyph kind="open" /></span>
          </span>
        </button>
        {row.copyable && intents.onCopyRow && (
          <button
            type="button"
            className={regionClass('ptc-search-copy', hooks, 'copyButton')}
            aria-labelledby={`${titleId} ${copyLabelId}`}
            disabled={model.opening}
            onClick={() => { intents.onCopyRow?.(row.rowKey); inputRef.current?.focus(); }}
          >
            <span id={copyLabelId} className="ptc-search-visuallyhidden">{t('search.copy.label')}</span>
            <Glyph kind="copy" />
          </button>
        )}
      </li>
    );
  }

  function renderGroup(group: SearchGroup, startIndex: number) {
    return (
      <div key={group.key} className={regionClass('ptc-search-group', hooks, 'group')}
        data-search-group={group.key} {...regionData(hooks, 'group')}>
        <div className="ptc-search-group-title">
          {t(group.labelKey)} · {group.rows.length}
        </div>
        <ul
          role="list"
          className="ptc-search-list"
          aria-label={t('search.results')}
        >
          {group.rows.map((row, i) => renderRow(row, startIndex + i, group.key === 'recent' || group.key === 'quick'))}
        </ul>
      </div>
    );
  }

  // ── Empty state: recent/quick when query is blank ──────────────────────

  const showEmptyState = model.showEmpty && flatRows.length === 0 && !model.isProgressive && !model.errorKey;

  const mounted = open || present;
  if (!mounted) return null;

  // ── Assemble groups with their starting flat index ─────────────────────

  let cursorCounter = 0;
  const renderedGroups = groups.map(group => {
    const startIndex = cursorCounter;
    cursorCounter += group.rows.length;
    return { group, startIndex };
  });

  return (
    <div
      className={regionClass('ptc-search-overlay', hooks, 'overlay')}
      data-closing={closing ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={t('search.label')}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); intents.onClose(); }
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled]), [tabindex="0"]')]
          .filter(element => element.tabIndex >= 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      {...regionData(hooks, 'overlay')}
    >
      <div
        className={regionClass('ptc-search-scrim', hooks, 'scrim')}
        onClick={intents.onClose}
        {...regionData(hooks, 'scrim')}
      />
      <div
        className={regionClass('ptc-search-panel', hooks, 'panel')}
        {...regionData(hooks, 'panel')}
        data-search-entering={open && entering ? 'true' : undefined}
        onAnimationEnd={event => {
          if (event.target === event.currentTarget) setEntering(false);
        }}
      >
        {/* Field area */}
        <div className="ptc-search-field-area">
          <div className={regionClass('ptc-search-field', hooks, 'field')} data-focus-boundary {...regionData(hooks, 'field')}>
            <span className="ptc-search-leading"><Glyph kind="search" /></span>
            <input
              ref={inputRef}
              type="search"
              className={regionClass('ptc-search-input', hooks, 'input')}
              value={model.query}
              maxLength={256}
              placeholder={t('search.input.placeholder')}
              aria-label={t('search.label')}
              role="searchbox"
              aria-autocomplete="list"
              aria-controls="ptc-search-results"
              aria-expanded={open}
              {...regionData(hooks, 'input')}
              onKeyDown={onInputKeyDown}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={event => {
                composing.current = false;
                intents.onQueryChange(event.currentTarget.value, true);
              }}
              onChange={event => {
                const nativeEvent = event.nativeEvent as InputEvent;
                if (composing.current && !nativeEvent.isComposing) composing.current = false;
                intents.onQueryChange(event.target.value, !composing.current);
              }}
            />
            <span className="ptc-search-loading-slot">
              {(model.loadingVisible ?? model.status === 'loading') && (
                <span className={regionClass('ptc-search-status', hooks, 'loading')} role="status" aria-label={t('search.loading')} />
              )}
            </span>
            <kbd className="ptc-search-kbd">Esc</kbd>
            <button
              type="button"
              className={regionClass('ptc-search-close', hooks, 'close')}
              onClick={intents.onClose}
              aria-label={t('search.close')}
              {...regionData(hooks, 'close')}
            ><Glyph kind="close" /></button>
          </div>
        </div>

        {/* Filter intents */}
        {model.filters.length > 0 && <div className={regionClass('ptc-search-intents', hooks, 'intents')} role="tablist" aria-label={t('search.range')}>
          {model.filters.map(filter => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={filter.active}
              data-search-filter={filter.id}
              className={filter.active ? 'active' : ''}
              onClick={() => { intents.onFilterChange(filter.id); inputRef.current?.focus(); }}
            >
              {t(filter.labelKey)}
            </button>
          ))}
        </div>}

        {/* Results body */}
        <div
          ref={bodyRef}
          id="ptc-search-results"
          className={regionClass('ptc-search-body', hooks, 'body')}
          data-displayed-query={model.displayedQuery ?? model.query}
          aria-busy={model.isProgressive || model.status === 'loading'}
          {...regionData(hooks, 'body')}
          onScroll={event => intents.onScrollChange?.(event.currentTarget.scrollTop)}
        >
          {renderedGroups.map(({ group, startIndex }) => renderGroup(group, startIndex))}

          {/* Empty state */}
          {showEmptyState && (
            <div className={regionClass('ptc-search-empty', hooks, 'empty')} data-search-empty {...regionData(hooks, 'empty')}>
              <strong>{t(model.emptyTitleKey ?? 'search.empty.title', { query: model.query.trim() })}</strong>
              <span>{t('search.empty.detail')}</span>
              <span className={regionClass('ptc-search-boundary-inline', hooks, 'emptyBoundary')}>{t('search.boundary')}</span>
            </div>
          )}

          {/* Error */}
          {model.errorKey && (
            <div className={regionClass('ptc-search-error', hooks, 'error')} role="alert" {...regionData(hooks, 'error')}>
              <span>{t(model.errorKey)}</span>
              <button type="button" onClick={() => { intents.onRetry(); inputRef.current?.focus(); }}>{t('search.retry')}</button>
            </div>
          )}

          {/* More */}
          {model.hasMore && model.query.trim() && (
            <button
              type="button"
              className={regionClass('ptc-search-more', hooks, 'more')}
              disabled={model.status === 'loading' || model.opening}
              onClick={() => { intents.onMore(); inputRef.current?.focus(); }}
            >
              {t('search.more')}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className={regionClass('ptc-search-footer', hooks, 'footer')} {...regionData(hooks, 'footer')}>
          <div className={regionClass('ptc-search-statusline', hooks, 'statusline')} tabIndex={0} aria-live="polite">
            <span className={regionClass('ptc-search-boundary', hooks, 'boundary')}>{t('search.boundary')}</span>
            {model.coverage.map((zone, i) => (
              <span
                key={i}
                className={regionClass(`ptc-search-status-chip ptc-search-status-${zone.status ?? 'ready'}`, hooks, 'statusChip')}
                {...regionData(hooks, 'statusChip')}
              >
                {t(zone.detailKey ?? 'search.zone.device')}
              </span>
            ))}
            {model.pendingSources.length > 0 && (
              <span className={regionClass('ptc-search-status-pending', hooks, 'statusPending')}>
                {t('search.coverage.pending')}
              </span>
            )}
          </div>
          <div className={regionClass('ptc-search-footer-actions', hooks, 'footerActions')}>
            {intents.onRefresh && <button type="button" className="ptc-search-refresh"
              aria-label={t('search.refresh')} disabled={model.opening || model.status === 'loading'}
              onClick={() => { intents.onRefresh?.(); inputRef.current?.focus(); }}>
              <Glyph kind="refresh" />
            </button>}
            <span className="ptc-search-keys"><kbd>↑</kbd><kbd>↓</kbd> · <kbd>↵</kbd></span>
            {model.opening && <span className="ptc-search-opening">{t('search.opening')}</span>}
            {model.info && (
              <span className={regionClass('ptc-search-popover-slot', hooks, 'popoverSlot')} {...regionData(hooks, 'popoverSlot')}>
                <PeersPopover placement="bottom" label={t('search.moreInfo')} className="ptc-search-explanation"
                  onOpenChange={next => { if (!next) inputRef.current?.focus(); }} content={
                  <div className="ptc-search-popover">
                    <h5 className="ptc-search-popover-title">{model.info.title}</h5>
                    {model.info.sections.map((section, index) => <section key={index}>
                      <h6>{section.title}</h6>
                      {section.paragraphs.map((text, i) => <p key={i}>{text}</p>)}
                      {section.items?.length ? <ul>{section.items.map((text, i) => <li key={i}>{text}</li>)}</ul> : null}
                    </section>)}
                  </div>
                }>
                  <button type="button" className={regionClass('ptc-search-info', hooks, 'infoButton')}
                    aria-label={t('search.moreInfo')}><Glyph kind="info" /></button>
                </PeersPopover>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
