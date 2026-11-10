import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
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
function highlight(text: string, query: string): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

const CLICK_DRAG_PX = 4;

export function GlobalSearchSurface({ open, model, intents, t, hooks, infoPopoverSlot }: GlobalSearchSurfaceProps) {
  // ── UI-transient state only (CMP-D02) ──────────────────────────────────
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const composing = useRef(false);
  const press = useRef<{ x: number; y: number } | null>(null);

  // Roving cursor — internal transient, onCursorChange notifies host.
  const [cursor, setCursor] = useState<number | null>(null);

  const flatRows = flattenGroups(model.groups);

  // Presence lifecycle: enter mounts immediately, exit lingers the soft fade-out.
  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement;
      setClosing(false);
      setCursor(null);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(timer);
    }
    if (!closing) return;
    const timer = window.setTimeout(() => setClosing(false), 110);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-close: open→false kicks off closing phase.
  useEffect(() => {
    if (!open && !closing) {
      setClosing(true);
    }
  }, [open, closing]);

  // ── Keyboard handlers ──────────────────────────────────────────────────

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = nextRovingIndex(cursor, 1, flatRows.length);
      setCursor(next);
      if (next !== null) focusRow(next);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nextRovingIndex(cursor, -1, flatRows.length);
      setCursor(next);
      if (next !== null) focusRow(next);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (cursor !== null && flatRows[cursor]) {
        void intents.onOpenRow(flatRows[cursor].rowKey);
      } else if (model.query.trim() && !model.isProgressive) {
        intents.onSubmit();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      intents.onClose();
    }
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLDivElement>, rowKey: string): void {
    if (event.nativeEvent.keyCode === 229) {
      event.preventDefault();
      setCursor(null);
      inputRef.current?.focus();
      return;
    }
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const currentIndex = flatRows.findIndex(r => r.rowKey === rowKey);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = nextRovingIndex(currentIndex >= 0 ? currentIndex : null, delta, flatRows.length);
      setCursor(next);
      if (next !== null) focusRow(next);
      else inputRef.current?.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void intents.onOpenRow(rowKey);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      setCursor(null);
      inputRef.current?.focus();
      return;
    }
    if (isPrintableCharacterKey(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      // Hand a printable character from the focused row back to the input.
      const input = inputRef.current;
      setCursor(null);
      if (!input) return;
      const value = input.value;
      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? value.length;
      const next = value.slice(0, start) + event.key + value.slice(end);
      intents.onQueryChange(next, true);
      requestAnimationFrame(() => {
        const caret = Math.min(start + 1, Array.from(next).length);
        input.setSelectionRange(caret, caret);
      });
    }
  }

  function focusRow(index: number): void {
    requestAnimationFrame(() => {
      document.getElementById(`ptc-search-row-${index}`)?.focus();
      document.getElementById(`ptc-search-row-${index}`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onRowMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY };
  }

  function onRowClick(rowKey: string, event: MouseEvent): void {
    if (event.button !== 0) return;
    if ((window.getSelection()?.toString().length ?? 0) > 0) return;
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_DRAG_PX) return;
    void intents.onOpenRow(rowKey);
  }

  // ── Render helpers ─────────────────────────────────────────────────────

  function renderRow(row: SearchResultRow, index: number) {
    const selected = cursor === index;
    const titleId = `ptc-search-title-${index}`;
    const copyLabelId = `ptc-search-copy-label-${index}`;
    return (
      <li
        key={row.rowKey}
        role="listitem"
        className={regionClass(`ptc-search-row${selected ? ' is-active' : ''}`, hooks, 'row')}
        aria-selected={selected}
        {...mergeData('row', {
          'data-resource-id': row.resource?.id,
          'data-source-id': row.resource?.sourceId,
          'data-resource-kind': row.resource?.kind,
        }, hooks)}
      >
        <div
          role="button"
          tabIndex={selected ? 0 : -1}
          className={regionClass('ptc-search-row-target', hooks, 'rowTarget')}
          aria-disabled={model.opening}
          id={`ptc-search-row-${index}`}
          onKeyDown={event => onRowKeyDown(event, row.rowKey)}
          onMouseDown={onRowMouseDown}
          onClick={event => onRowClick(row.rowKey, event)}
        >
          <span className={regionClass('ptc-search-row-icon', hooks, 'rowIcon')} {...regionData(hooks, 'rowIcon')}>
            {/* Host decides what icon to render via row.kind — composite passes iconId through if given */}
          </span>
          <span className="ptc-search-main">
            <span id={titleId} className={regionClass('ptc-search-row-title', hooks, 'rowTitle')} {...regionData(hooks, 'rowTitle')}>
              {highlight(row.title, model.displayedQuery ?? model.query)}
            </span>
            {row.snippet && (
              <span className="ptc-search-row-snippet">{highlight(row.snippet, model.displayedQuery ?? model.query)}</span>
            )}
            {row.meta && <span className={regionClass('ptc-search-row-meta', hooks, 'rowSnippet')}>{row.meta}</span>}
          </span>
          <span className={regionClass('ptc-search-row-zone', hooks, 'rowZone')} {...regionData(hooks, 'rowZone')}>
            {model.coverage.length > 0 ? t(model.coverage[0].detailKey ?? 'search.zone.device') : null}
          </span>
          <span className={regionClass('ptc-search-row-open', hooks, 'rowOpen')} {...regionData(hooks, 'rowOpen')} />
        </div>
        {intents.onCopyRow && (
          <button
            type="button"
            className={regionClass('ptc-search-copy', hooks, 'copyButton')}
            aria-labelledby={`${titleId} ${copyLabelId}`}
            onClick={() => intents.onCopyRow?.(row.rowKey)}
          >
            <span id={copyLabelId} className="ptc-search-visuallyhidden">{t('search.copy.label')}</span>
          </button>
        )}
      </li>
    );
  }

  function renderGroup(group: SearchGroup, startIndex: number) {
    return (
      <div key={group.key} className={regionClass('ptc-search-group', hooks, 'group')} {...regionData(hooks, 'group')}>
        <div className="ptc-search-group-title">
          {t(group.labelKey)} · {group.rows.length}
        </div>
        <ul
          role="list"
          className="ptc-search-list"
          aria-label={t('search.results')}
        >
          {group.rows.map((row, i) => renderRow(row, startIndex + i))}
        </ul>
      </div>
    );
  }

  // ── Empty state: recent/quick when query is blank ──────────────────────

  const showEmptyState = model.showEmpty && flatRows.length === 0 && !model.isProgressive;

  const mounted = open || closing;
  if (!mounted) return null;

  // ── Assemble groups with their starting flat index ─────────────────────

  let cursorCounter = 0;
  const renderedGroups = model.groups.map(group => {
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
      {...regionData(hooks, 'overlay')}
    >
      <div
        className={regionClass('ptc-search-scrim', hooks, 'scrim')}
        onClick={intents.onClose}
        {...regionData(hooks, 'scrim')}
      />
      <div className={regionClass('ptc-search-panel', hooks, 'panel')} {...regionData(hooks, 'panel')}>
        {/* Field area */}
        <div className="ptc-search-field-area">
          <div className={regionClass('ptc-search-field', hooks, 'field')} data-focus-boundary {...regionData(hooks, 'field')}>
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
            {model.status === 'loading' && (
              <span className="ptc-search-status" role="status" aria-label={t('search.loading')} />
            )}
            <button
              type="button"
              className={regionClass('ptc-search-close', hooks, 'close')}
              onClick={intents.onClose}
              aria-label={t('search.close')}
              {...regionData(hooks, 'close')}
            />
          </div>
        </div>

        {/* Filter intents */}
        <div className={regionClass('ptc-search-intents', hooks, 'intents')} role="tablist" aria-label={t('search.range')}>
          {model.filters.map(filter => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={filter.active}
              data-search-filter={filter.id}
              className={filter.active ? 'active' : ''}
              onClick={() => intents.onFilterChange(filter.id)}
            >
              {t(filter.labelKey)}
            </button>
          ))}
        </div>

        {/* Results body */}
        <div
          ref={bodyRef}
          className={regionClass('ptc-search-body', hooks, 'body')}
          data-displayed-query={model.displayedQuery ?? model.query}
          aria-busy={model.isProgressive || model.status === 'loading'}
          {...regionData(hooks, 'body')}
        >
          {/* Recent + quickFunctions when query empty */}
          {!model.query.trim() && model.recentItems && model.recentItems.length > 0 && (
            <div className="ptc-search-group" data-search-group="recent">
              <div className="ptc-search-group-title">{t('search.recent')}</div>
              <ul className="ptc-search-list">
                {model.recentItems.map((row, i) => renderRow(row, flatRows.length + i))}
              </ul>
            </div>
          )}

          {/* Result groups */}
          {renderedGroups.map(({ group, startIndex }) => renderGroup(group, startIndex))}

          {/* Quick functions */}
          {model.quickFunctions && model.quickFunctions.length > 0 && (
            <div className="ptc-search-group" data-search-group="quick">
              <div className="ptc-search-group-title">{t('search.quickFunctions')}</div>
              <ul className="ptc-search-list">
                {model.quickFunctions.map(row => (
                  <li key={row.rowKey} role="listitem">
                    <button type="button" className="ptc-search-quick" onClick={() => intents.onOpenRow(row.rowKey)}>
                      <span className="ptc-search-row-main">
                        <span className="ptc-search-row-title">{row.title}</span>
                        {row.meta && <span className="ptc-search-row-meta">{row.meta}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Empty state */}
          {showEmptyState && (
            <div className={regionClass('ptc-search-empty', hooks, 'empty')} data-search-empty {...regionData(hooks, 'empty')}>
              <strong>{t(model.emptyTitleKey ?? 'search.empty.title', { query: model.query.trim() })}</strong>
              <span>{t('search.empty.detail')}</span>
            </div>
          )}

          {/* Error */}
          {model.errorKey && (
            <div className={regionClass('ptc-search-error', hooks, 'error')} role="alert" {...regionData(hooks, 'error')}>
              <span>{t(model.errorKey)}</span>
              <button type="button" onClick={intents.onRetry}>{t('search.retry')}</button>
            </div>
          )}

          {/* More */}
          {model.hasMore && model.query.trim() && (
            <button
              type="button"
              className={regionClass('ptc-search-more', hooks, 'more')}
              disabled={model.status === 'loading' || model.opening}
              onClick={intents.onMore}
            >
              {t('search.more')}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className={regionClass('ptc-search-footer', hooks, 'footer')} {...regionData(hooks, 'footer')}>
          <div className={regionClass('ptc-search-statusline', hooks, 'statusline')} aria-live="polite">
            {model.coverage.map((zone, i) => (
              <span
                key={i}
                className={regionClass(`ptc-search-status-${zone.status ?? ''}`, hooks, 'statusChip')}
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
            {model.isProgressive && <span className="ptc-search-opening">{t('search.opening')}</span>}
            {infoPopoverSlot && (
              <span className={regionClass('ptc-search-popover-slot', hooks, 'popoverSlot')} {...regionData(hooks, 'popoverSlot')}>
                {infoPopoverSlot}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
