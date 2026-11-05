/**
 * GlobalSearchOverlay — closed-domain Peers search (desktop SearchOverlay
 * parity), north-star frame edition.
 *
 * Product semantics:
 * - Invoked from the rail search button or ⌘K/⌘F; an overlay, never a page.
 * - Indexes only Peers domain objects backed by real prototype seeds:
 *   people / conversations / messages / moments / settings functions.
 *   No web results, no OS files, no external connectors.
 * - Opening a result navigates back to the object (chat conversation/person,
 *   moment, or a settings group/section); the opener owns the routing.
 *
 * Visual grammar follows the frame (松绿 glass + hairlines), not SaaS purple
 * cards: one quiet top-anchored panel, tertiary group labels, row wash on
 * hover/keyboard focus.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight, Bell, Bot as BotIcon, Brain, ChevronRight, Clock3, Command as CommandIcon,
  Database, Globe, Hash, Info, Lock, MessageCircle, MonitorSmartphone, Network, Plug,
  Radio, Search as SearchIcon, Server, SlidersHorizontal,
  Sparkles, User, Users, Wrench, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useT } from '../prefs';
import type { StringKey } from '../prefs';
import { CONVERSATIONS, PEOPLE, SEED_MESSAGES } from '../chat/chat-data';
import { MOMENT_SEEDS } from '../moments/moments-data';
import type { SettingsGroup, SettingsSectionKey } from '../settings/SettingsFeature';
import './global-search.css';

export type GlobalSearchTarget =
  | { kind: 'conversation'; conversationId: string; messageId?: string }
  | { kind: 'person'; personId: string }
  | { kind: 'moment'; momentId: string }
  | { kind: 'settings'; group: SettingsGroup; section: SettingsSectionKey }
  | { kind: 'action'; action: 'new-chat' | 'new-moment' };

type ResultKind = 'person' | 'conversation' | 'message' | 'moment' | 'function';

interface ResultRow {
  id: string;
  kind: ResultKind;
  title: string;
  snippet?: string;
  meta: string;
  target: GlobalSearchTarget;
  icon?: LucideIcon;
}

const KIND_ORDER: ResultKind[] = ['person', 'conversation', 'message', 'moment', 'function'];

const KIND_ICON: Record<ResultKind, LucideIcon> = {
  person: Users,
  conversation: Hash,
  message: MessageCircle,
  moment: Sparkles,
  function: Wrench,
};

/* Settings function index (keyed by the real IA destinations). */
const SETTINGS_FUNCTIONS: { titleKey: StringKey; group: SettingsGroup; section: SettingsSectionKey; icon: LucideIcon; keywords: string }[] = [
  { titleKey: 'sec.account', group: 'general', section: 'account', icon: User, keywords: '账号 身份 头像 资料 PTID account profile' },
  { titleKey: 'sec.notifications', group: 'general', section: 'notifications', icon: Bell, keywords: '消息通知 铃声 提醒 免打扰 notifications sound' },
  { titleKey: 'sec.privacy', group: 'general', section: 'privacy', icon: Lock, keywords: '隐私 安全 PIN 在线 已读 恢复 密钥 privacy security' },
  { titleKey: 'sec.appearance', group: 'general', section: 'appearance', icon: SlidersHorizontal, keywords: '外观 语言 主题 密度 消息对齐 appearance language theme' },
  { titleKey: 'sec.station', group: 'network', section: 'station', icon: Server, keywords: '站点 设备 关联 station device' },
  { titleKey: 'sec.discovery', group: 'network', section: 'discovery', icon: Globe, keywords: '发现 句柄 可发现 discovery handle' },
  { titleKey: 'sec.federation', group: 'network', section: 'federation', icon: Network, keywords: '联邦 federation' },
  { titleKey: 'sec.providers', group: 'ai', section: 'providers', icon: Server, keywords: '供应商 模型 API Key providers' },
  { titleKey: 'sec.models', group: 'ai', section: 'models', icon: Brain, keywords: '默认模型 models' },
  { titleKey: 'sec.discover', group: 'ai', section: 'discover', icon: Sparkles, keywords: '发现 技能 智能体 discover agent skill' },
  { titleKey: 'sec.memory', group: 'ai', section: 'memory', icon: Brain, keywords: '记忆 向量 memory embedding' },
  { titleKey: 'sec.skills', group: 'ai', section: 'skills', icon: CommandIcon, keywords: '技能 导入 skills' },
  { titleKey: 'sec.mcp', group: 'ai', section: 'mcp', icon: Plug, keywords: 'MCP 服务器 mcp' },
  { titleKey: 'sec.bots', group: 'channels', section: 'bots', icon: BotIcon, keywords: '机器人 bots' },
  { titleKey: 'sec.lark', group: 'channels', section: 'lark', icon: Radio, keywords: '飞书 lark 通道' },
  { titleKey: 'sec.dataStorage', group: 'advanced', section: 'storage', icon: Database, keywords: '存储 缓存 导出 storage cache' },
  { titleKey: 'sec.statistics', group: 'advanced', section: 'statistics', icon: MonitorSmartphone, keywords: '统计 热力图 statistics' },
  { titleKey: 'sec.logs', group: 'advanced', section: 'logs', icon: Clock3, keywords: '日志 logs 诊断' },
  { titleKey: 'sec.cron', group: 'ai', section: 'cron', icon: Clock3, keywords: '定时任务 scheduled tasks agent 调度' },
  { titleKey: 'sec.commandMenu', group: 'advanced', section: 'command-menu', icon: CommandIcon, keywords: '命令面板 command palette' },
  { titleKey: 'sec.about', group: 'advanced', section: 'about', icon: Info, keywords: '关于 about 版本' },
];

const RECENT_IDS = ['recent-1', 'recent-2', 'recent-3', 'recent-5'];

function buildIndex(t: (k: StringKey) => string): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const person of PEOPLE) {
    rows.push({
      id: `person-${person.id}`, kind: 'person',
      title: person.name, snippet: person.bio, meta: person.station ?? '',
      target: { kind: 'person', personId: person.id },
    });
  }
  for (const conv of CONVERSATIONS) {
    rows.push({
      id: `conv-${conv.id}`, kind: 'conversation',
      title: conv.name, snippet: conv.last, meta: conv.lastAt ?? '',
      target: { kind: 'conversation', conversationId: conv.id },
    });
  }
  for (const [convId, messages] of Object.entries(SEED_MESSAGES)) {
    const conv = CONVERSATIONS.find(c => c.id === convId);
    for (const m of messages) {
      if (m.kind === 'service' || !m.text) continue;
      rows.push({
        id: `msg-${convId}-${m.id}`, kind: 'message',
        title: m.text.length > 42 ? `${m.text.slice(0, 42)}…` : m.text,
        snippet: conv?.name, meta: m.senderName ? `${m.senderName} · ${m.at}` : m.at,
        target: { kind: 'conversation', conversationId: convId, messageId: m.id },
      });
    }
  }
  for (const moment of MOMENT_SEEDS) {
    rows.push({
      id: `moment-${moment.id}`, kind: 'moment',
      title: moment.text.length > 42 ? `${moment.text.slice(0, 42)}…` : moment.text,
      snippet: moment.station, meta: `${moment.author} · ${moment.at}`,
      target: { kind: 'moment', momentId: moment.id },
    });
  }
  for (const fn of SETTINGS_FUNCTIONS) {
    rows.push({
      id: `fn-${fn.group}-${fn.section}`, kind: 'function',
      title: t(fn.titleKey), snippet: fn.keywords.split(/\s+/).slice(0, 4).join(' · '),
      meta: t(fn.group === 'general' ? 'group.general' : fn.group === 'network' ? 'group.network' : fn.group === 'ai' ? 'group.ai' : fn.group === 'channels' ? 'group.channels' : 'group.advanced'),
      target: { kind: 'settings', group: fn.group, section: fn.section }, icon: fn.icon,
    });
  }
  return rows;
}

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="sk-search-hit">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export type CommandGrammar = 'glass' | 'linear-light' | 'linear-dark';

export function GlobalSearchOverlay({ open, grammar = 'glass', onClose, onNavigate }: {
  open: boolean;
  /** Prototype-only line-grammar experiment; 'glass' keeps the shipped look. */
  grammar?: CommandGrammar;
  onClose: () => void;
  onNavigate: (target: GlobalSearchTarget) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  // The panel stays mounted through its exit animation instead of vanishing
  // the moment open flips false; mounted tracks presence, closing the phase.
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<Element | null>(null);

  const index = useMemo(() => buildIndex(t), [t]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    setQuery('');
    setCursor(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      if (openerRef.current instanceof HTMLElement && openerRef.current.isConnected) {
        openerRef.current.focus();
      }
    };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matched = index.filter(row =>
      `${row.title} ${row.snippet ?? ''} ${row.meta}`.toLowerCase().includes(q));
    return KIND_ORDER.flatMap(kind => matched.filter(r => r.kind === kind));
  }, [query, index]);

  const recents = useMemo(() => {
    const picks: ResultRow[] = [];
    for (const id of RECENT_IDS) {
      const row = index.find(r =>
        id === 'recent-1' ? r.id === 'conv-cv-chenyu'
          : id === 'recent-2' ? r.id === 'moment-mo-1'
          : id === 'recent-3' ? r.id === 'person-p-zhouhe'
          : id === 'recent-4' ? r.id === 'person-p-ayan'
          : r.id === 'fn-general-notifications');
      if (row) picks.push(row);
    }
    return picks;
  }, [index]);

  const quickFunctions = useMemo<ResultRow[]>(() => [
    { id: 'qf-chat', kind: 'function', title: t('search.qf.newChat'), meta: t('search.actionHint'),
      target: { kind: 'action', action: 'new-chat' } },
    { id: 'qf-moment', kind: 'function', title: t('search.qf.newMoment'), meta: t('search.actionHint'),
      target: { kind: 'action', action: 'new-moment' } },
    ...index.filter(r => r.kind === 'function').slice(0, 2),
  ], [index, t]);

  useEffect(() => { setCursor(0); }, [query]);

  // Presence: enter mounts immediately, exit lingers one soft fade-out.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) { setClosing(false); return; }
    setClosing(true);
    // Must unmount within the gate's 120ms post-Esc budget; exit stays soft
    // but shorter than the entrance.
    const timer = window.setTimeout(() => { setMounted(false); setClosing(false); }, 110);
    return () => window.clearTimeout(timer);
    // mounted is intentionally read but not a dep: only open drives phases.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!mounted) return null;

  const flat = results;
  const openTarget = (target: GlobalSearchTarget) => {
    onNavigate(target);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor(i => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(i => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = flat[cursor] ?? flat[0];
      if (row) openTarget(row.target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const grouped = KIND_ORDER.map(kind => ({ kind, items: results.filter(r => r.kind === kind) }))
    .filter(g => g.items.length > 0);
  let flatIndex = -1;

  const kindLabel = (kind: ResultKind): string =>
    t(kind === 'person' ? 'search.kind.people'
      : kind === 'conversation' ? 'search.kind.conversations'
      : kind === 'message' ? 'search.kind.messages'
      : kind === 'moment' ? 'search.kind.moments' : 'search.kind.functions');

  return (
    <div className="sk-search-overlay" data-grammar={grammar}
      data-closing={closing ? 'true' : undefined}
      role="dialog" aria-modal="true" aria-label={t('search.title')}>
      <div className="sk-search-scrim" onClick={onClose} />
      <div className="sk-search-panel" data-search-open>
        <div className="sk-search-input-row">
          <SearchIcon size={17} className="sk-search-leading" />
          <input
            ref={inputRef}
            className="sk-search-input"
            data-global-search
            type="search"
            placeholder={t('search.placeholder')}
            aria-label={t('search.title')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            aria-controls="sk-search-results"
          />
          <kbd className="sk-search-kbd">esc</kbd>
          <button type="button" className="sk-search-close" aria-label={t('common.close')} onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="sk-search-body" id="sk-search-results" role="listbox">
          {!query.trim() && (
            <>
              <div className="sk-search-group" data-search-group="recent">
                <div className="sk-search-group-title">{t('search.recent')}</div>
                {recents.map(row => (
                  <button type="button" key={row.id} className="sk-search-row"
                    role="option" aria-selected="false"
                    onClick={() => openTarget(row.target)}>
                    <span className="sk-search-row-icon"><Clock3 size={14} /></span>
                    <span className="sk-search-row-main">
                      <span className="sk-search-row-title">{row.title}</span>
                      <span className="sk-search-row-meta">{row.snippet ?? row.meta}</span>
                    </span>
                    <ArrowUpRight size={14} className="sk-search-row-open" />
                  </button>
                ))}
              </div>
              <div className="sk-search-group" data-search-group="quick">
                <div className="sk-search-group-title">{t('search.quickFunctions')}</div>
                {quickFunctions.map(row => (
                  <button type="button" key={row.id} className="sk-search-row"
                    role="option" aria-selected="false"
                    onClick={() => openTarget(row.target)}>
                    <span className="sk-search-row-icon">
                      {row.id === 'qf-chat' ? <MessageCircle size={14} />
                        : row.id === 'qf-moment' ? <Sparkles size={14} />
                        : (() => { const fn = SETTINGS_FUNCTIONS.find(f => `fn-${f.group}-${f.section}` === row.id); const Icon = fn?.icon ?? Wrench; return <Icon size={14} />; })()}
                    </span>
                    <span className="sk-search-row-main">
                      <span className="sk-search-row-title">{row.title}</span>
                      <span className="sk-search-row-meta">{row.kind === 'function' ? row.meta : t('search.actionHint')}</span>
                    </span>
                    <ChevronRight size={14} className="sk-search-row-open" />
                  </button>
                ))}
              </div>
            </>
          )}

          {query.trim() && grouped.map(group => (
            <div className="sk-search-group" key={group.kind} data-search-group={group.kind}>
              <div className="sk-search-group-title">
                {kindLabel(group.kind)}
                <em>{group.items.length}</em>
              </div>
              {group.items.map(row => {
                flatIndex += 1;
                const idx = flatIndex;
                const active = idx === cursor;
                const Icon = row.icon ?? KIND_ICON[row.kind];
                return (
                  <button type="button" key={row.id}
                    className={`sk-search-row${active ? ' is-active' : ''}`}
                    id={`sk-search-opt-${idx}`}
                    role="option" aria-selected={active}
                    data-search-result={row.kind}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => openTarget(row.target)}>
                    <span className="sk-search-row-icon"><Icon size={14} /></span>
                    <span className="sk-search-row-main">
                      <span className="sk-search-row-title">{highlight(row.title, query)}</span>
                      {row.snippet && <span className="sk-search-row-meta">{highlight(row.snippet, query)}</span>}
                    </span>
                    <span className="sk-search-row-tag">{row.meta}</span>
                    <ArrowUpRight size={14} className="sk-search-row-open" />
                  </button>
                );
              })}
            </div>
          ))}

          {query.trim() && results.length === 0 && (
            <div className="sk-search-empty" data-search-empty>
              <strong>{t('search.emptyTitle', { q: query.trim() })}</strong>
              <p>{t('search.emptyBody')}</p>
              <span className="sk-search-boundary-inline"><Lock size={11} /> {t('search.boundary')}</span>
            </div>
          )}
        </div>

        <div className="sk-search-footer">
          <span className="sk-search-boundary"><Lock size={11} /> {t('search.boundary')}</span>
          <span className="sk-search-keys">
            <kbd>↑</kbd><kbd>↓</kbd> {t('search.navigate')} · <kbd>↵</kbd> {t('common.confirm')}
          </span>
        </div>
      </div>
    </div>
  );
}
