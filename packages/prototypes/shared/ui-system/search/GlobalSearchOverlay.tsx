/**
 * GlobalSearchOverlay — prototype-side adapter for @peers-touch/ui-composite.
 *
 * This file OWNS:
 *   - Seed index construction (buildIndex from PEOPLE / CONVERSATIONS / MOMENT_SEEDS)
 *   - Query → filtered groups / recents / quickFunctions
 *   - Prototype STRINGS (useT) → composite t() translation bridge
 *   - Legacy sk-search-* class injection via SurfaceHooks (CMP-D03 / data-model.md §2.3)
 *   - data-grammar / data-search-open prototype DOM-契约
 *
 * This file does NOT own:
 *   - Presence lifecycle (mounted/closing) — GlobalSearchSurface handles open/close phase
 *   - Keyboard navigation (ArrowUp/Down/Enter/Escape/IME) — GlobalSearchSurface handles
 *   - Focus management — GlobalSearchSurface handles input focus + roving row focus
 *   - Overlay/panel/input/row DOM rendering — GlobalSearchSurface renders ptc-* tree
 *   - Highlight mark rendering — GlobalSearchSurface renders <mark> against displayedQuery
 *
 * Visual grammar follows the pine-glass frame; prototype sk-search-* classes are
 * injected alongside component ptc-* classes through SurfaceHooks so both CSS
 * namespaces apply to the same DOM nodes. See global-search.css for sk-search-*
 * tokens.
 */
import { useMemo, useState } from 'react';
import {
  ArrowUpRight, Bell, Bot as BotIcon, Brain, ChevronRight, Clock3, Command as CommandIcon,
  Database, Globe, Hash, Lock, MessageCircle, MonitorSmartphone, Network, Plug,
  Radio, Server, SlidersHorizontal, Sparkles, User, Users, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useT } from '../prefs';
import type { StringKey } from '../prefs';
import { CONVERSATIONS, PEOPLE, SEED_MESSAGES } from '../chat/chat-data';
import { MOMENT_SEEDS } from '../moments/moments-data';
import type { SettingsGroup, SettingsSectionKey } from '../settings/SettingsFeature';

// Composite package imports — thin adapter boundary (CMP-D01 / CMP-D06)
import { GlobalSearchSurface } from '@peers-touch/ui-composite';
import type {
  CompositeTranslate, SearchSurfaceModel, SearchSurfaceIntents, SearchRegionKey,
  SurfaceHooks, SearchResultRow as CompositeRow,
} from '@peers-touch/ui-composite';

import './global-search.css';

// ── Public exports ───────────────────────────────────────────────────────

export type GlobalSearchTarget =
  | { kind: 'conversation'; conversationId: string; messageId?: string }
  | { kind: 'person'; personId: string }
  | { kind: 'moment'; momentId: string }
  | { kind: 'settings'; group: SettingsGroup; section: SettingsSectionKey }
  | { kind: 'action'; action: 'new-chat' | 'new-moment' };

export type CommandGrammar = 'glass' | 'linear-light' | 'linear-dark';

// ── Host-owned seed index (never leaks into composite) ────────────────────

type RowKind = CompositeRow['kind'];

const KIND_ORDER: RowKind[] = ['person', 'conversation', 'message', 'moment', 'function'];

const KIND_ICON: Record<RowKind, LucideIcon> = {
  person: Users,
  conversation: Hash,
  message: MessageCircle,
  moment: Sparkles,
  function: Wrench,
  content: Hash, // prototype has no content kind; fallback for type completeness
};

interface HostRow {
  id: string;
  kind: RowKind;
  title: string;
  snippet?: string;
  meta: string;
  target: GlobalSearchTarget;
  icon?: LucideIcon;
}

/* Settings function index — owned by host; composite receives already-shaped rows. */
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
  { titleKey: 'sec.about', group: 'advanced', section: 'about', icon: CommandIcon, keywords: '关于 about 版本' },
];

const RECENT_IDS = ['recent-1', 'recent-2', 'recent-3', 'recent-5'];

function buildIndex(t: (k: StringKey) => string): HostRow[] {
  const rows: HostRow[] = [];
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

// ── Adapter: host HostRow → composite CompositeRow ───────────────────────

function toCompositeRow(row: HostRow): CompositeRow {
  const Icon = row.icon ?? KIND_ICON[row.kind];
  return {
    rowKey: row.id,
    kind: row.kind,
    title: row.title,
    snippet: row.snippet,
    meta: row.meta,
    icon: Icon ? <Icon size={14} /> : undefined,
  };
}

function kindLabelKey(kind: RowKind): string {
  switch (kind) {
    case 'person': return 'search.kind.people';
    case 'conversation': return 'search.kind.conversations';
    case 'message': return 'search.kind.messages';
    case 'moment': return 'search.kind.moments';
    case 'function': return 'search.kind.functions';
    default: return 'search.results';
  }
}

// ── Component ────────────────────────────────────────────────────────────

export function GlobalSearchOverlay({ open, grammar = 'glass', onClose, onNavigate }: {
  open: boolean;
  /** Prototype-only line-grammar experiment; 'glass' keeps the shipped look. */
  grammar?: CommandGrammar;
  onClose: () => void;
  onNavigate: (target: GlobalSearchTarget) => void;
}) {
  const { t: protoT } = useT();
  // Adapter boundary: CompositeTranslate accepts string keys; prototype's
  // Translate narrows to STRINGS['zh-CN'] literals. The cast is safe because
  // all composite hardcoded keys (search.*) are mirrored in STRINGS.
  const t: CompositeTranslate = protoT as CompositeTranslate;
  const [query, setQuery] = useState('');

  // Host owns the seed index; t is consumed during construction only.
  const index = useMemo(() => buildIndex(t), [t]);

  // ── Query → filtered grouped results ─────────────────────────────────────

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matched = index.filter(row =>
      `${row.title} ${row.snippet ?? ''} ${row.meta}`.toLowerCase().includes(q));
    return KIND_ORDER
      .map(kind => ({ kind, items: matched.filter(r => r.kind === kind) }))
      .filter(g => g.items.length > 0);
  }, [query, index]);

  const recents = useMemo<HostRow[]>(() => {
    const picks: HostRow[] = [];
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

  const quickFunctions = useMemo<HostRow[]>(() => [
    { id: 'qf-chat', kind: 'function', title: t('search.qf.newChat'), meta: t('search.actionHint'),
      target: { kind: 'action', action: 'new-chat' }, icon: MessageCircle },
    { id: 'qf-moment', kind: 'function', title: t('search.qf.newMoment'), meta: t('search.actionHint'),
      target: { kind: 'action', action: 'new-moment' }, icon: Sparkles },
    ...index.filter(r => r.kind === 'function').slice(0, 2),
  ], [index, t]);

  // ── Build composite SearchSurfaceModel ──────────────────────────────────

  const model: SearchSurfaceModel = useMemo(() => {
    const hasQuery = !!query.trim();
    return {
      query,
      status: 'ready',
      isProgressive: false,
      groups: filteredGroups.map(g => ({
        key: g.kind,
        labelKey: kindLabelKey(g.kind),
        rows: g.items.map(toCompositeRow),
      })),
      quickFunctions: !hasQuery ? quickFunctions.map(toCompositeRow) : undefined,
      recentItems: !hasQuery ? recents.map(toCompositeRow) : undefined,
      showEmpty: hasQuery && filteredGroups.length === 0,
      // emptyTitleKey intentionally NOT set → composite uses its hardcoded
      // 'search.empty.title' (which we also mirrored in prototype STRINGS).
      filters: [],
      pendingSources: [],
      coverage: [],
      hasMore: false,
      opening: false,
      groupTitleKey: 'search.results',
    };
  }, [query, filteredGroups, quickFunctions, recents]);

  // ── Build composite SearchSurfaceIntents ────────────────────────────────

  const intents: SearchSurfaceIntents = {
    onQueryChange(next) { setQuery(next); },
    onFilterChange() { /* prototype has no filter tabs */ },
    onSubmit() { /* prototype has no explicit submit */ },
    onRetry() { /* prototype has no error state */ },
    onMore() { /* prototype has no pagination */ },
    onOpenRow(rowKey) {
      // Resolve host-level GlobalSearchTarget from composite rowKey.
      const row = index.find(r => r.id === rowKey)
        ?? recents.find(r => r.id === rowKey)
        ?? quickFunctions.find(r => r.id === rowKey);
      if (row) {
        onNavigate(row.target);
        onClose();
      }
    },
    onClose() { onClose(); },
  };

  // ── SurfaceHooks: inject prototype sk-search-* classes + data attrs ────

  const hooks = useMemo<SurfaceHooks<SearchRegionKey>>(() => ({
    classNames: {
      overlay: 'sk-search-overlay',
      panel: 'sk-search-panel',
      field: 'sk-search-input-row',
      input: 'sk-search-input',
      close: 'sk-search-close',
      group: 'sk-search-group',
      row: 'sk-search-row',
      rowIcon: 'sk-search-row-icon',
      rowTitle: 'sk-search-row-title',
      rowSnippet: 'sk-search-row-meta',
      rowOpen: 'sk-search-row-open',
      rowZone: 'sk-search-row-tag',
      empty: 'sk-search-empty',
      footer: 'sk-search-footer',
      infoButton: 'sk-search-info',
    },
    dataAttributes: {
      overlay: { 'data-grammar': grammar, 'data-search-open': 'true' },
      field: { 'data-global-search': 'true' },
    },
  }), [grammar]);

  // ── infoPopoverSlot: prototype footer boundary + keyboard hints ─────────

  const infoPopoverSlot = (
    <>
      <span className="sk-search-boundary"><Lock size={11} /> {t('search.boundary')}</span>
      <span className="sk-search-keys">
        <kbd>↑</kbd><kbd>↓</kbd> {t('search.navigate')} · <kbd>↵</kbd> {t('common.confirm')}
      </span>
    </>
  );

  return (
    <GlobalSearchSurface
      open={open}
      model={model}
      intents={intents}
      t={t}
      hooks={hooks}
      infoPopoverSlot={infoPopoverSlot}
    />
  );
}
