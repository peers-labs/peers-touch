/**
 * Search portal prototype — user-facing expression of the closed search
 * domain (D-19).
 *
 * Product semantics per docs/architecture/domains/search/product.md:
 * - Chat is the landing surface; Search is an overlay invoked from the nav
 *   button or ⌘K and never becomes a standalone page.
 * - Searches only Peers domain objects (messages / people / conversations /
 *   social posts / Agents / knowledge / in-domain attachments / functions).
 * - No web, no OS files, no external connectors; the boundary is visible.
 * - Results pass a simulated current-account read-policy; the demo actor
 *   switch hides unauthorized objects (private chats, personal Agents) from
 *   titles, snippets, counts, and suggestions.
 * - Opening a result navigates back to the object (message anchor / Agent
 *   turn / settings action).
 *
 * Pure prototype: mock data and in-browser state only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search as SearchIcon,
  X,
  MessageCircle,
  Users,
  Hash,
  Sparkles,
  Bot,
  BookOpen,
  Paperclip,
  Wrench,
  Lock,
  Server,
  Network,
  ArrowUpRight,
  CircleSlash,
  Loader2,
  Blocks,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  ACTORS,
  CONTENT_KINDS,
  KIND_LABEL,
  KIND_ORDER,
  QUICK_FUNCTIONS,
  recentObjects,
  searchResults,
  suggestions,
  type ActorId,
  type SearchKind,
  type SearchResult,
  type TrustZone,
  SOURCE_STATUS,
} from './searchMock';
import './SearchOverlay.css';

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  message: MessageCircle,
  person: Users,
  conversation: Hash,
  social: Sparkles,
  agent: Bot,
  knowledge: BookOpen,
  attachment: Paperclip,
  applet: Blocks,
  function: Wrench,
};

const ZONE_META: Record<TrustZone, { label: string; icon: LucideIcon; tone: string }> = {
  D: { label: '本机 · 端到端', icon: Lock, tone: 'zone-d' },
  S: { label: '本站', icon: Server, tone: 'zone-s' },
  F: { label: '联邦', icon: Network, tone: 'zone-f' },
};

type Intent = 'all' | 'functions';

export interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onOpenResult: (result: Pick<SearchResult, 'targetPage' | 'anchor' | 'title'>) => void;
}

const MIN_RESULT_HEIGHT = 380;

export function SearchOverlay({ open, onClose, onOpenResult }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState<Intent>('all');
  const [kindFilter, setKindFilter] = useState<SearchKind | 'all'>('all');
  const [actor, setActor] = useState<ActorId>('owner');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // 用户是否已用方向键/悬停“拿过”光标；未拿取前 Enter 始终提交完整检索。
  const [cursorEngaged, setCursorEngaged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingTimer = useRef<number | null>(null);

  // 每次打开重置为轻量首屏。
  useEffect(() => {
    if (open) {
      setQuery('');
      setIntent('all');
      setKindFilter('all');
      setSubmitted(false);
      setLoading(false);
      setActiveIndex(0);
      setCursorEngaged(false);
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => () => {
    if (loadingTimer.current) window.clearTimeout(loadingTimer.current);
  }, []);

  const suggestionItems = useMemo(
    () => (query.trim() && !loading ? suggestions(query, actor) : []),
    [query, loading, actor],
  );

  const submittedQuery = query;
  const results = useMemo(() => {
    if (!submitted || loading || !submittedQuery.trim()) return [];
    return searchResults(submittedQuery, actor, intent === 'functions' ? 'functions' : kindFilter);
  }, [submitted, submittedQuery, loading, actor, intent, kindFilter]);

  const recent = useMemo(() => recentObjects(actor), [actor]);

  // 平面可选行：输入态用建议，提交态按结果顺序，供键盘上下移动。
  const selectable: { targetPage: SearchResult['targetPage']; anchor: string; title: string }[] =
    loading || !query.trim()
      ? []
      : submitted && results.length > 0
        ? results.map((r) => ({ targetPage: r.targetPage, anchor: r.anchor, title: r.title }))
        : !submitted
          ? suggestionItems.map((s) => ({ targetPage: s.targetPage, anchor: s.anchor, title: s.label }))
          : [];

  useEffect(() => {
    setActiveIndex(0);
    setCursorEngaged(false);
  }, [query, intent, kindFilter, actor]);

  const runSearch = useCallback(() => {
    if (!query.trim()) return;
    setSubmitted(true);
    setLoading(true);
    setCursorEngaged(false);
    if (loadingTimer.current) window.clearTimeout(loadingTimer.current);
    // 原型用短延时表达真实检索的加载态（partial/coverage 的可见性）。
    loadingTimer.current = window.setTimeout(() => setLoading(false), 280);
  }, [query]);

  const openResult = useCallback(
    (item: { targetPage: SearchResult['targetPage']; anchor: string; title: string }) => {
      onOpenResult(item);
      onClose();
    },
    [onClose, onOpenResult],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursorEngaged(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(selectable.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursorEngaged(true);
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = cursorEngaged ? selectable[activeIndex] : undefined;
      if (target) openResult(target);
      else runSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  const counts = new Map<SearchKind, number>();
  for (const r of searchResults(query, actor, 'all')) {
    counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  }
  const showInitial = !loading && !query.trim();
  const showSuggestions = !loading && !submitted && query.trim().length > 0;
  const showEmpty = !loading && submitted && results.length === 0 && suggestionItems.length === 0;
  const unavailableSources = SOURCE_STATUS[actor].unavailable;
  let rowCursor = -1;
  const nextRowIndex = () => {
    rowCursor += 1;
    return rowCursor;
  };

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="Peers 搜索">
      <div className="search-overlay-backdrop" onClick={onClose} />
      <div className="search-overlay-panel">
        {/* Composite search field: one parent focus boundary (focus.css contract). */}
        <div className="search-input-area">
          <div className="search-input-wrap" data-focus-boundary>
            <SearchIcon size={17} className="search-input-icon" />
            <input
              ref={inputRef}
              className="search-input"
              placeholder="搜索消息、人、群、动态、Agent、收藏…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSubmitted(false); }}
              onKeyDown={onKeyDown}
              aria-label="搜索 Peers 内容"
              aria-controls="search-results-region"
              aria-expanded
              role="combobox"
              aria-autocomplete="list"
              aria-activedescendant={cursorEngaged && selectable.length > 0 ? `search-opt-${activeIndex}` : undefined}
            />
            <span className="search-scope-chip" title="封闭检索域：只包含你有权访问的 Peers 内容">
              Peers 内
            </span>
            <span className="search-input-divider" aria-hidden="true" />
            <button className="search-close" onClick={onClose} aria-label="关闭搜索 (Esc)" title="关闭 (Esc)">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 意图切换：综合 / 功能（没有“网络/本机文件”页签） */}
        <div className="search-intent-row" role="tablist" aria-label="搜索范围">
          <button
            type="button"
            role="tab"
            aria-selected={intent === 'all'}
            className={`search-intent ${intent === 'all' ? 'active' : ''}`}
            onClick={() => { setIntent('all'); setKindFilter('all'); }}
          >
            综合
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={intent === 'functions'}
            className={`search-intent ${intent === 'functions' ? 'active' : ''}`}
            onClick={() => { setIntent('functions'); setKindFilter('all'); }}
          >
            功能
          </button>
          <span className="search-boundary-hint">
            <Lock size={12} />
            仅当前账号有权访问的 Peers 内容 · 不含公网与本机文件
          </span>
        </div>

        {intent === 'all' && submitted && !loading && results.length > 0 && (
          <div className="search-kind-row" role="group" aria-label="内容类型筛选">
            <KindChip label="全部" active={kindFilter === 'all'} onClick={() => setKindFilter('all')} />
            {CONTENT_KINDS.map((k) => {
              const n = counts.get(k) ?? 0;
              if (n === 0) return null;
              return (
                <KindChip
                  key={k}
                  label={`${KIND_LABEL[k]} ${n}`}
                  active={kindFilter === k}
                  onClick={() => setKindFilter(kindFilter === k ? 'all' : k)}
                />
              );
            })}
          </div>
        )}

        {/* 结果区（各态共享等高容器，避免切换跳动） */}
        <div className="search-body" id="search-results-region" role="listbox" style={{ minHeight: MIN_RESULT_HEIGHT }}>
          {loading && <LoadingState />}

          {!loading && showInitial && (
            <InitialState
              recent={recent}
              quickFunctions={QUICK_FUNCTIONS}
              onOpenRecent={(r) => openResult({ targetPage: r.targetPage, anchor: r.anchor, title: r.label })}
              onOpen={(r) => openResult(r)}
            />
          )}

          {!loading && showSuggestions && suggestionItems.length > 0 && (
            <div className="search-group">
              <GroupTitle>建议（本机即时匹配，未提交远端）</GroupTitle>
              {suggestionItems.map((s) => {
                const idx = nextRowIndex();
                return (
                  <SuggestionRow
                    key={s.id}
                    suggestion={s}
                    rowId={`search-opt-${idx}`}
                    active={cursorEngaged && idx === activeIndex}
                    onHover={() => { setCursorEngaged(true); setActiveIndex(idx); }}
                    onOpen={() => openResult({ targetPage: s.targetPage, anchor: s.anchor, title: s.label })}
                  />
                );
              })}
              <div className="search-enter-hint">按 Enter 提交完整检索（含 Station 与已授权联邦来源）</div>
            </div>
          )}

          {!loading && showSuggestions && suggestionItems.length === 0 && (
            <div className="search-enter-hint">
              未发现即时匹配；按 Enter 检索 Station 与已授权联邦中的历史内容。
            </div>
          )}

          {!loading && submitted && results.length > 0 && (
            <ResultsState
              results={results}
              activeIndex={cursorEngaged ? activeIndex : -1}
              nextRowIndex={nextRowIndex}
              onHover={(i) => { setCursorEngaged(true); setActiveIndex(i); }}
              onOpen={(r) => openResult(r)}
              query={submittedQuery}
            />
          )}

          {!loading && showEmpty && <EmptyState query={query} />}
        </div>

        {/* 来源状态 + 演示用账号视角切换（权限链的用户可见表达） */}
        <div className="search-footer">
          <div className="search-source-status">
            {unavailableSources.length > 0 ? (
              <span className="source-partial">
                <CircleSlash size={12} />
                {unavailableSources.join('、')} 暂不可用，已从结果中排除
              </span>
            ) : (
              <span className="source-ok">本机 · 本站 · 已连接联邦来源均可用</span>
            )}
          </div>
          <div className="search-actor-switch" role="group" aria-label="演示：切换账号视角验证权限过滤">
            <span className="actor-label">原型演示视角</span>
            {ACTORS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`actor-btn ${actor === a.id ? 'active' : ''}`}
                onClick={() => setActor(a.id)}
                title={a.sub}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 子状态与行 ---------------- */

function LoadingState() {
  return (
    <div className="search-loading" aria-live="polite">
      <Loader2 size={16} className="spin" />
      <span>正在检索有权访问的内容…</span>
      <div className="skeleton-list">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton-row" />)}
      </div>
    </div>
  );
}

function InitialState({
  recent,
  quickFunctions,
  onOpenRecent,
  onOpen,
}: {
  recent: ReturnType<typeof recentObjects>;
  quickFunctions: SearchResult[];
  onOpenRecent: (r: { targetPage: SearchResult['targetPage']; anchor: string; label: string }) => void;
  onOpen: (r: SearchResult) => void;
}) {
  return (
    <>
      <div className="search-group">
        <GroupTitle>最近</GroupTitle>
        {recent.map((r) => (
          <button type="button" key={r.id} className="result-row" onClick={() => onOpenRecent(r)}>
            <RowIcon kind={r.kind} />
            <div className="result-main">
              <div className="result-title">{r.label}</div>
              <div className="result-meta">{r.meta}</div>
            </div>
            <ArrowUpRight size={14} className="result-open" />
          </button>
        ))}
      </div>
      <div className="search-group">
        <GroupTitle>功能直达</GroupTitle>
        {quickFunctions.map((f) => (
          <button type="button" key={f.id} className="result-row" onClick={() => onOpen(f)}>
            <RowIcon kind="function" />
            <div className="result-main">
              <div className="result-title">{f.title}</div>
              <div className="result-meta">{f.snippet}</div>
            </div>
            <ArrowUpRight size={14} className="result-open" />
          </button>
        ))}
        <div className="search-scope-explainer">
          输入关键词检索消息、动态与收藏；输入 <code>隐私</code>、<code>通知</code>、<code>新建 Agent</code> 等可直达功能。
        </div>
      </div>
    </>
  );
}

function ResultsState({
  results,
  activeIndex,
  nextRowIndex,
  onHover,
  onOpen,
  query,
}: {
  results: SearchResult[];
  activeIndex: number;
  nextRowIndex: () => number;
  onHover: (i: number) => void;
  onOpen: (r: SearchResult) => void;
  query: string;
}) {
  const groups = KIND_ORDER
    .map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length > 0);
  return (
    <>
      {groups.map((group) => (
        <div className="search-group" key={group.kind}>
          <GroupTitle>
            {KIND_LABEL[group.kind]}
            <span className="group-count">{group.items.length}</span>
          </GroupTitle>
          {group.items.map((r) => {
            const idx = nextRowIndex();
            return (
              <button
                type="button"
                key={r.id}
                id={`search-opt-${idx}`}
                className={`result-row ${idx === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => onHover(idx)}
                onClick={() => onOpen(r)}
                role="option"
                aria-selected={idx === activeIndex}
              >
                <RowIcon kind={r.kind} />
                <div className="result-main">
                  <div className="result-title">{highlight(r.title, query)}</div>
                  <div className="result-snippet">{highlight(r.snippet, query)}</div>
                  <div className="result-meta">
                    <span>{r.container}</span>
                    {r.author ? <span> · {r.author}</span> : null}
                    {r.time ? <span> · {r.time}</span> : null}
                  </div>
                </div>
                {/* Function shortcuts are local navigation: no trust-zone badge. */}
                {r.kind === 'function' ? null : (
                  <ZoneBadge zone={r.zone} devicePrivate={r.devicePrivate} />
                )}
                <ArrowUpRight size={14} className="result-open" />
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

function SuggestionRow({
  suggestion,
  active,
  rowId,
  onHover,
  onOpen,
}: {
  suggestion: ReturnType<typeof suggestions>[number];
  active: boolean;
  rowId: string;
  onHover: () => void;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      id={rowId}
      className={`result-row ${active ? 'active' : ''}`}
      onMouseEnter={onHover}
      onClick={onOpen}
      role="option"
      aria-selected={active}
    >
      <RowIcon kind={suggestion.kind} />
      <div className="result-main">
        <div className="result-title">{suggestion.label}</div>
        <div className="result-meta">{suggestion.meta}</div>
      </div>
      <ArrowUpRight size={14} className="result-open" />
    </button>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="search-empty">
      <CircleSlash size={28} className="empty-icon" />
      <div className="empty-title">没有找到「{query}」</div>
      <div className="empty-body">
        未命中你当前账号有权访问的 Peers 内容。换个关键词，或检查昵称、群名是否准确。
      </div>
      <div className="empty-scope">搜索不包含公网网页，也不包含 Peers 之外的本机文件。</div>
    </div>
  );
}

/* ---------------- 小件 ---------------- */

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <div className="search-group-title">{children}</div>;
}

function KindChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`kind-chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

function RowIcon({ kind }: { kind: SearchKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="result-icon">
      <Icon size={15} />
    </span>
  );
}

function ZoneBadge({ zone, devicePrivate }: { zone: TrustZone; devicePrivate?: boolean }) {
  const meta = ZONE_META[zone];
  const Icon = meta.icon;
  return (
    <span className={`zone-badge ${meta.tone}`} title={devicePrivate ? '端到端内容仅在本机可检索' : `信任区：${meta.label}`}>
      <Icon size={11} />
      {meta.label}
    </span>
  );
}

/** 命中词高亮（原型级，避免 dangerouslySetInnerHTML）。 */
function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-hit">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
