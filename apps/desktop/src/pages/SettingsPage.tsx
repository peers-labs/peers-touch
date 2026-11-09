import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Empty,
  Flex,
  Select,
  Segmented,
  Spin,
  Tag,
  Text,
  TextField,
  type TableColumn,
  type Tone,
} from '@peers-touch/ui';
import {
  Settings, Bot, Wrench, HelpCircle,
  MessageSquare, Puzzle, Sparkles,
  Hash, Type, Activity as ActivityIcon, Trophy, Layers,
  Terminal, Users, BookOpen, Brain,
  Search, Key, Cpu, Globe, Zap, FileText,
  Code, PenTool, Clock, Shield, ShieldCheck, File,
  Edit, Package, Plus, Send, RefreshCw,
  GitBranch, HardDrive, Image, Trash2, Server, AlertTriangle, RotateCcw,
  Network, ChevronDown, ChevronRight, Info,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { useProviderStore } from '../store/provider';
import { api, type Agent, type AppletInfo, type HelpCategoryGroup, type StatisticsData, type ToolInfo } from '../services/desktop_api';
import { useSessionStore } from '../store/session';
import { SEARCH_FUNCTIONS } from '../components/search/functions';
import { hasSettingsPanel, getAppletFrontend } from '../applets/registry';
import { getModulesWithSettings } from '../modules/registry';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';
import { log } from '../utils/logger';
import { SettingsContainer, SettingsSection, SettingsRow } from '../components/settings/SettingsLayout';
import { ChatStorageSettings } from '../components/settings/ChatStorageSettings';
import { FederationTab } from '../components/settings/FederationTab';
import { RecoverySettings } from '../components/settings/RecoverySettings';
import { usePrefetch } from '../kernel/usePrefetch';
import {
  markInteractionStarted,
  markRouteRequested,
  markRouteVisible,
  scheduleAfterPaint,
} from '../kernel/frontendRuntimeProfiler';
import { SectionHost } from '../kernel/SectionHost';
import type { SectionDescriptor, SectionHostPolicy } from '../kernel/section';
import {
  DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  chatScreenshotShortcutFromKeyboardEvent,
  formatChatScreenshotShortcut,
} from '../utils/chatScreenshotShortcut';
import { useActiveSettingsSlice } from './useActiveSettingsStore';
import { confirmRequest, notifyError, notifySuccess } from '../ui/feedback';

interface SettingsPageProps {
  activeTab?: string;
  highlightId?: string;
  onNavConsumed?: () => void;
}

function scrollAndHighlight(id: string) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      const el = document.querySelector(`[data-item-id="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('search-highlight-flash');
      setTimeout(() => el.classList.remove('search-highlight-flash'), 2000);
    }, 300);
  });
}

function scheduleSettingsSurfaceVisible(surfaceId: string, surface: 'settings-group' | 'settings-section') {
  let cancelled = false;
  scheduleAfterPaint(() => {
    if (!cancelled) markRouteVisible(surfaceId, { surface });
  });
  return () => { cancelled = true; };
}

interface SectionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  order: number;
  policy?: SectionHostPolicy;
  render: (highlightId?: string) => React.ReactNode;
}

interface TabGroupDef {
  key: string;
  /** Resolved display label (filled from labelKey inside useTabGroups). */
  label?: string;
  /** i18n key for the static five-group catalog. */
  labelKey?: string;
  icon: LucideIcon;
  sectionKeys: string[];
}

function useSettingsSections(): SectionDef[] {
  const { t } = useTranslation('settings');

  return useMemo(() => {
    const registrySections: SectionDef[] = getModulesWithSettings().map((mod) => ({
      key: mod.id,
      label: t(`settings.module.${mod.id}`, { defaultValue: mod.settingsEntry?.label || mod.name }),
      icon: mod.icon,
      order: mod.settingsEntry!.order,
      policy: mod.settingsEntry?.sectionHostPolicy,
      render: () => {
        const Panel = mod.settingsPanel!;
        return <Panel />;
      },
    }));

    const localSections: SectionDef[] = [
      {
        key: 'security',
        label: t('settings.tab.security', { defaultValue: 'Security' }),
        icon: ShieldCheck,
        order: 15,
        render: () => <RecoverySettings />,
      },
      {
        key: 'federation',
        label: t('settings.tab.federation', { defaultValue: 'Federation' }),
        icon: Network,
        // Slot between built-in `account` (registry order, 5–10) and
        // `general` so the user sees their identity → federation
        // → general flow naturally.
        order: 20,
        render: () => <FederationTab />,
      },
      {
        key: 'storage',
        label: t('settings.tab.storage'),
        icon: HardDrive,
        order: 50,
        policy: { cache: 'selected-only' },
        render: () => <ChatStorageSettings />,
      },
      {
        key: 'applets',
        label: t('settings.tab.applets'),
        icon: Puzzle,
        order: 60,
        render: () => <AppletsSettingsTab />,
      },
      {
        key: 'general',
        label: t('settings.tab.general'),
        icon: Settings,
        order: 70,
        render: () => <GeneralTab />,
      },
      {
        key: 'tools',
        label: t('settings.tab.tools'),
        icon: Wrench,
        order: 90,
        policy: { cache: 'selected-only' },
        render: () => <ToolsTab />,
      },
      {
        key: 'help',
        label: t('settings.tab.help'),
        icon: HelpCircle,
        order: 100,
        policy: { cache: 'selected-only' },
        render: (hlId) => <HelpTab highlightId={hlId} />,
      },
    ];

    return [...registrySections, ...localSections].sort((a, b) => a.order - b.order);
  }, [t]);
}

// North-star settings IA: five groups absorb every reachable desktop section.
// The old 8-tab surface (federation/tools/applets/data/help as separate tabs)
// folds into network / ai / channels / advanced to match the confirmed
// prototype SettingsFeature anatomy.
const SETTINGS_GROUP_ORDER: TabGroupDef[] = [
  {
    key: 'general',
    labelKey: 'settings.group.general',
    icon: Settings,
    sectionKeys: ['account', 'security', 'general'],
  },
  {
    key: 'network',
    labelKey: 'settings.group.network',
    icon: Globe,
    sectionKeys: ['federation'],
  },
  {
    key: 'ai',
    labelKey: 'settings.group.ai',
    icon: Sparkles,
    sectionKeys: ['providers', 'models', 'discover', 'memory', 'skills', 'mcp', 'voice', 'cron'],
  },
  {
    key: 'channels',
    labelKey: 'settings.group.channels',
    icon: Send,
    sectionKeys: ['channels', 'connections', 'bots'],
  },
  {
    key: 'advanced',
    labelKey: 'settings.group.advanced',
    icon: Wrench,
    sectionKeys: ['storage', 'oss', 'logs', 'tools', 'command-menu', 'applets', 'help'],
  },
];

function useTabGroups(): TabGroupDef[] {
  const { t } = useTranslation('settings');

  return useMemo(() => {
    const allSections = getModulesWithSettings().map((m) => m.id);

    // Only keep section keys that actually exist in the registry or local definitions
    const knownKeys = new Set([
      ...allSections,
      'security', 'federation', 'storage', 'applets', 'general', 'tools', 'help',
    ]);
    return SETTINGS_GROUP_ORDER.map((g) => ({
      key: g.key,
      label: t(g.labelKey ?? g.key),
      icon: g.icon,
      sectionKeys: g.sectionKeys.filter((k) => knownKeys.has(k)),
    })).filter((g) => g.sectionKeys.length > 0);
  }, [t]);
}

function findGroupForSection(groups: TabGroupDef[], sectionKey: string): string | undefined {
  return groups.find((g) => g.sectionKeys.includes(sectionKey))?.key;
}

export function SettingsPage({ activeTab, highlightId, onNavConsumed }: SettingsPageProps) {
  const { t } = useTranslation('settings');
  const sections = useSettingsSections();
  const groups = useTabGroups();

  const [activeGroup, setActiveGroup] = useState('general');
  const [activeSection, setActiveSection] = useState('account');

  const groupSections = useMemo(() => {
    const groupDef = groups.find((g) => g.key === activeGroup);
    if (!groupDef) return [];
    return groupDef.sectionKeys
      .map((key) => sections.find((s) => s.key === key))
      .filter((s): s is SectionDef => !!s);
  }, [activeGroup, groups, sections]);

  const activeSectionVisible = groupSections.some((section) => section.key === activeSection);
  const sectionDescriptors = useMemo<SectionDescriptor[]>(
    () => sections.map((section) => ({
      id: section.key,
      policy: section.policy,
      render: ({ highlightId: activeHighlightId }) => section.render(activeHighlightId),
    })),
    [sections],
  );

  // Keep activeSection valid when switching groups
  useEffect(() => {
    const groupDef = groups.find((g) => g.key === activeGroup);
    if (!groupDef) return;
    if (!groupDef.sectionKeys.includes(activeSection)) {
      setActiveSection(groupDef.sectionKeys[0]);
    }
  }, [activeGroup, activeSection, groups]);

  useEffect(() => {
    const surfaceId = `settings:group:${activeGroup}`;
    return scheduleSettingsSurfaceVisible(surfaceId, 'settings-group');
  }, [activeGroup]);

  useEffect(() => {
    if (!activeSectionVisible) return;
    const surfaceId = `settings:section:${activeSection}`;
    return scheduleSettingsSurfaceVisible(surfaceId, 'settings-section');
  }, [activeSection, activeSectionVisible]);

  // Handle external navigation via activeTab prop
  useEffect(() => {
    if (!activeTab) return;

    const group = findGroupForSection(groups, activeTab);
    if (group) {
      setActiveGroup(group);
      setActiveSection(activeTab);
    }

    useProviderStore.getState().selectProvider(highlightId ?? '');

    if (highlightId) {
      setTimeout(() => scrollAndHighlight(highlightId), 500);
    }
    onNavConsumed?.();
  }, [activeTab, highlightId, onNavConsumed, groups]);

  const handleGroupChange = useCallback((groupKey: string) => {
    if (groupKey === activeGroup) return;
    const surfaceId = `settings:group:${groupKey}`;
    markInteractionStarted('shell', `secondary-tab:${groupKey}`, {
      pageId: 'settings',
      sectionId: groupKey,
      surface: 'settings-group',
    });
    markRouteRequested(surfaceId, { surface: 'settings-group' });
    setActiveGroup(groupKey);
  }, [activeGroup]);

  const handleSectionChange = useCallback((sectionKey: string) => {
    if (sectionKey === activeSection) return;
    const surfaceId = `settings:section:${sectionKey}`;
    markRouteRequested(surfaceId, { surface: 'settings-section' });
    setActiveSection(sectionKey);
  }, [activeSection]);

  return (
    <div className="sc-settings">
      {/* L1 group switcher: one compact peers-ui Segmented island, the same
          grammar as chat 消息/联系人 and moments 动态/圈友 (prototype
          sk-settings-groups parity). Carries both the north-star
          data-settings-group hooks and the legacy anchor inventory attrs. */}
      <div className="sc-settings__subbar">
        <Segmented<string>
          className="sc-settings__groups"
          density="compact"
          aria-label={t('settings.groupsAria')}
          value={activeGroup}
          onValueChange={(value) => handleGroupChange(value ?? 'general')}
          options={groups.map((group) => {
            const GroupIcon = group.icon;
            return {
              value: group.key,
              label: group.label ?? group.key,
              leading: <GroupIcon size={13} />,
              attributes: {
                'data-settings-group': group.key,
                'data-group-key': group.key,
                'data-pt-secondary-tab': group.key,
                'data-pt-secondary-tab-id': group.key,
              } as Record<string, string>,
            };
          })}
        />
      </div>

      {/* L2 section sidebar + content. The sidebar stays mounted for every
          group so section anchors remain stable for external navigation. */}
      <div className="sc-settings__body">
        <nav className="sc-settings__sidebar" aria-label={t('settings.sectionsAria')}>
          {groupSections.map((section) => {
            const SectionIcon = section.icon;
            const isActive = activeSection === section.key;
            return (
              <Button
                key={section.key}
                actionId={`settings.section.${section.key}`}
                className={isActive ? 'sc-settings__side is-active' : 'sc-settings__side'}
                emphasis="quiet"
                density="compact"
                fullWidth
                aria-current={isActive ? 'page' : undefined}
                leading={<SectionIcon size={15} />}
                label={section.label}
                data-settings-section={section.key}
                data-section-key={section.key}
                data-pt-section-item={section.key}
                data-pt-section-item-id={section.key}
                onActivate={() => handleSectionChange(section.key)}
              />
            );
          })}
        </nav>

        {/* SectionHost owns Settings section mount/cache policy. */}
        <div
          className="sc-settings__scroll"
          data-settings-content
          data-scroll-lock={activeSection === 'providers' ? 'true' : 'false'}
        >
          <SectionHost
            activeSectionId={activeSection}
            descriptors={sectionDescriptors}
            highlightId={activeSectionVisible ? highlightId : undefined}
            initialMountedSectionIds={['account']}
            surfacePrefix="settings:section-host"
          />
        </div>
      </div>
    </div>
  );
}

function appletStatusTone(status: string): Tone {
  if (status === 'active') return 'success';
  if (status === 'error') return 'danger';
  return 'neutral';
}

function AppletsSettingsTab() {
  const [applets, setApplets] = useState<AppletInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const { t } = useTranslation('settings');

  useEffect(() => {
    api.listApplets().then(setApplets).catch((e) => log.error('settings', 'Failed to list applets', e));
  }, []);

  const SettingsPanel = selected ? getAppletFrontend(selected)?.settingsPanel : undefined;

  if (SettingsPanel) {
    return (
      <Flex className="sc-applets-detail" style={{ overflow: 'hidden', padding: '0 24px' }}>
        <Flex
          direction="row"
          align="center"
          gap={8}
          className="sc-applets-detail__bar"
        >
          <Button
            actionId="applets-back"
            emphasis="quiet"
            density="compact"
            label={t('settings.applets.backToApplets')}
            onActivate={() => setSelected(null)}
          />
        </Flex>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SettingsPanel />
        </div>
      </Flex>
    );
  }

  return (
    <SettingsContainer>
      <Text tone="secondary" style={{ fontSize: 13 }}>
        {t('settings.applets.description')}
      </Text>

      <Flex gap={10}>
        {applets.map((applet) => {
          const hasSettings = hasSettingsPanel(applet.manifest.id);
          const IconComp = ICON_MAP[applet.manifest.icon];
          const cardContent = (
            <>
              <div className="sc-applet-card__icon">
                {IconComp ? <IconComp size={20} /> : <Puzzle size={20} />}
              </div>
              <Flex gap={2} flex={1}>
                <Flex direction="row" align="center" gap={8}>
                  <Text strong style={{ fontSize: 14 }}>{applet.manifest.name}</Text>
                  <Tag tone={appletStatusTone(applet.status)} className="sc-applet-card__tag">
                    {t(`settings.applets.status.${applet.status}`, { defaultValue: applet.status })}
                  </Tag>
                  <Tag className="sc-applet-card__tag">v{applet.manifest.version}</Tag>
                </Flex>
                <Text tone="secondary" style={{ fontSize: 12 }}>
                  {applet.manifest.description}
                </Text>
              </Flex>
              {hasSettings ? (
                <ChevronRight size={16} className="sc-applet-card__chevron" />
              ) : (
                <Text tone="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{t('settings.applets.noSettings')}</Text>
              )}
            </>
          );
          return hasSettings ? (
            <Button
              key={applet.manifest.id}
              actionId={`applets-open-${applet.manifest.id}`}
              emphasis="quiet"
              fullWidth
              className="sc-applet-card"
              data-has-settings="true"
              onActivate={() => setSelected(applet.manifest.id)}
            >
              {cardContent}
            </Button>
          ) : (
            <Flex
              key={applet.manifest.id}
              direction="row"
              align="center"
              gap={14}
              className="sc-applet-card"
            >
              {cardContent}
            </Flex>
          );
        })}
      </Flex>

      {applets.length === 0 && (
        <Empty
          icon={<Puzzle size={32} />}
          description={t('settings.applets.noApplets')}
        />
      )}
    </SettingsContainer>
  );
}

/* ─── Activity Heatmap ───────────────────────────────────────────────── */

function ActivityHeatmap({ activity }: { activity: { date: string; count: number }[] }) {
  const { t } = useTranslation('settings');

  const today = new Date();
  const startDate = new Date(today);
  startDate.setFullYear(startDate.getFullYear() - 1);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const totalDays = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const weeks = Math.ceil(totalDays / 7);

  const countMap = new Map<string, number>();
  for (const a of activity) {
    countMap.set(a.date, a.count);
  }

  const maxCount = Math.max(1, ...activity.map((a) => a.count));

  function getColor(count: number): string {
    // North-star heatmap grammar (.sk-heatmap): pine primary washes instead
    // of the off-palette GitHub-green ramp.
    if (count === 0) return 'var(--pt-subtle)';
    const ratio = count / maxCount;
    if (ratio <= 1 / 3) return 'color-mix(in srgb, var(--pt-primary) 25%, transparent)';
    if (ratio <= 2 / 3) return 'color-mix(in srgb, var(--pt-primary) 55%, transparent)';
    return 'var(--pt-primary)';
  }

  const months: { label: string; col: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + w * 7);
    const m = d.getMonth();
    if (m !== lastMonth) {
      months.push({
        label: d.toLocaleDateString(undefined, { month: 'short' }),
        col: w,
      });
      lastMonth = m;
    }
  }

  const cells: React.ReactNode[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let day = 0; day < 7; day++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + w * 7 + day);
      if (d > today) continue;
      const dateStr = d.toISOString().slice(0, 10);
      const count = countMap.get(dateStr) || 0;
      cells.push(
        <div
          key={dateStr}
          title={t('settings.statistics.heatmapTooltip', { date: dateStr, count })}
          style={{
            gridColumn: w + 1,
            gridRow: day + 1,
            width: 11,
            height: 11,
            borderRadius: 4,
            background: getColor(count),
            cursor: 'default',
          }}
        />,
      );
    }
  }

  const totalMessages = activity.reduce((s, a) => s + a.count, 0);

  return (
    <Flex gap={8}>
      <div style={{ position: 'relative', paddingTop: 16 }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 4, paddingLeft: 0, position: 'relative', height: 14 }}>
          {months.map((m) => (
            <span
              key={m.label + m.col}
              style={{
                position: 'absolute',
                left: m.col * 15,
                fontSize: 10,
                color: 'var(--pt-muted)',
              }}
            >
              {m.label}
            </span>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${weeks}, 11px)`,
            gridTemplateRows: 'repeat(7, 11px)',
            gap: 4,
          }}
        >
          {cells}
        </div>
      </div>
      <Flex direction="row" justify="space-between" align="center">
        <Text tone="secondary" style={{ fontSize: 12 }}>
          {t('settings.statistics.heatmapTotal', { count: totalMessages })}
        </Text>
        <Flex direction="row" align="center" gap={4}>
          <Text tone="secondary" style={{ fontSize: 10 }}>{t('settings.statistics.heatmapInactive')}</Text>
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
            <div
              key={i}
              style={{
                width: 10,
                height: 10,
                borderRadius: 4,
                background: getColor(r * maxCount),
              }}
            />
          ))}
          <Text tone="secondary" style={{ fontSize: 10 }}>{t('settings.statistics.heatmapActive')}</Text>
        </Flex>
      </Flex>
    </Flex>
  );
}

/* ─── Rank List ──────────────────────────────────────────────────────── */

function RankList({
  title,
  icon,
  items,
  labelHeader,
  valueHeader,
}: {
  title: string;
  icon: React.ReactNode;
  items: { name: string; count: number }[] | null;
  labelHeader: string;
  valueHeader: string;
}) {
  const { t } = useTranslation('settings');

  if (!items || items.length === 0) {
    return (
      <div className="sc-rank-card">
        <strong className="sc-rank-card__title">
          <span className="sc-rank-card__title-icon">{icon}</span>
          {title}
        </strong>
        <div className="sc-rank-card__empty">
          <Layers size={32} className="sc-rank-card__empty-icon" />
          <span>{t('settings.statistics.rankNoData')}</span>
          <span className="sc-rank-card__empty-hint">{t('settings.statistics.rankNoDataHint')}</span>
        </div>
      </div>
    );
  }

  const maxVal = Math.max(1, ...items.map((i) => i.count));

  return (
    <div className="sc-rank-card">
      <strong className="sc-rank-card__title">
        <span className="sc-rank-card__title-icon">{icon}</span>
        {title}
      </strong>
      <div className="sc-rank-card__head">
        <span>{labelHeader}</span>
        <span>{valueHeader}</span>
      </div>
      <div className="sc-rank-card__rows">
        {items.map((item, idx) => (
          <div key={item.name} className="sc-rank-card__row">
            <div className="sc-rank-card__row-line">
              <span className="sc-rank-card__name">
                <span className="sc-rank-card__index">{idx + 1}</span>
                {item.name}
              </span>
              <span className="sc-rank-card__count">{item.count}</span>
            </div>
            <div className="sc-rank-card__track">
              <div
                className="sc-rank-card__bar"
                style={{ width: `${(item.count / maxVal) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Statistics Tab ─────────────────────────────────────────────────── */

export function StatisticsTab() {
  const { t } = useTranslation('settings');
  // Statistics is per-page heavy data: prefetched onto the idle window
  // by `kernel/usePrefetch` so the first click on the Statistics
  // section paints immediately if the cache is already warm.
  const { value: data, error } = usePrefetch<StatisticsData>(
    'settings.statistics',
    () => api.getStatistics(),
  );

  useEffect(() => {
    if (error) log.error('settings', 'Failed to load statistics', error);
  }, [error]);

  if (!data) {
    return (
      <Flex align="center" justify="center" style={{ padding: 80 }}>
        <Spin active />
      </Flex>
    );
  }

  const summary = data.summary ?? {
    sessions: 0,
    messages: 0,
    total_words: 0,
    agents: 0,
    days_with_us: 0,
    first_date: '',
  };

  const summaryCards: { label: string; value: string | number; icon: React.ReactNode }[] = [
    {
      label: t('settings.statistics.sessions'),
      value: summary.sessions,
      icon: <MessageSquare size={20} />,
    },
    {
      label: t('settings.statistics.messages'),
      value: summary.messages,
      icon: <Hash size={20} />,
    },
    {
      label: t('settings.statistics.totalWords'),
      value: summary.total_words >= 1000 ? `${(summary.total_words / 1000).toFixed(1)}K` : summary.total_words,
      icon: <Type size={20} />,
    },
    {
      label: t('settings.statistics.agents'),
      value: summary.agents,
      icon: <Bot size={20} />,
    },
  ];

  return (
    <SettingsContainer fullHeight tier="standard">
      <Flex gap={4}>
        <Flex direction="row" align="center" gap={8}>
          <span style={{ fontSize: 16, fontWeight: 600 }}
            dangerouslySetInnerHTML={{
              __html: t('settings.statistics.daysWithUs', { days: summary.days_with_us })
                .replace('<highlight>', '<span style="color: var(--pt-primary); font-weight: 700; font-size: 20px">')
                .replace('</highlight>', '</span>'),
            }}
          />
        </Flex>
        <Text tone="secondary" style={{ fontSize: 12 }}>
          {t('settings.statistics.firstActive', {
            date: summary.first_date ? new Date(summary.first_date).toLocaleDateString() : t('settings.statistics.firstActiveNA'),
          })}
        </Text>
      </Flex>

      <div className="sc-stat-grid" data-columns="4">
        {summaryCards.map((card) => (
          <div key={card.label} className="sc-stat-card">
            <span className="sc-stat-card__icon">{card.icon}</span>
            <strong className="sc-stat-card__value">{card.value}</strong>
            <span className="sc-stat-card__label">{card.label}</span>
          </div>
        ))}
      </div>

      <SettingsSection
        icon={<ActivityIcon size={16} />}
        title={t('settings.statistics.activityTitle')}
        style={{ padding: 20 }}
      >
        <div style={{ overflowX: 'auto' }}>
          <ActivityHeatmap activity={data.activity || []} />
        </div>
      </SettingsSection>

      <div className="sc-stat-grid" data-columns="3">
        <RankList
          title={t('settings.statistics.modelRank')}
          icon={<Cpu size={16} />}
          items={data.model_rank}
          labelHeader={t('settings.statistics.rankLabelModel')}
          valueHeader={t('settings.statistics.rankLabelMessages')}
        />
        <RankList
          title={t('settings.statistics.agentRank')}
          icon={<Bot size={16} />}
          items={data.agent_rank}
          labelHeader={t('settings.statistics.rankLabelAgent')}
          valueHeader={t('settings.statistics.rankLabelMessages')}
        />
        <RankList
          title={t('settings.statistics.topicRank')}
          icon={<Trophy size={16} />}
          items={data.topic_rank}
          labelHeader={t('settings.statistics.rankLabelTopic')}
          valueHeader={t('settings.statistics.rankLabelMessages')}
        />
      </div>
    </SettingsContainer>
  );
}

// --- Security Section: PIN management for GeneralTab ---

const PIN_LENGTH = 6;

function SecuritySection() {
  const { t } = useTranslation('settings');
  // Active account snapshot is owned by `runtimes/settingsRuntime.ts`;
  // reading from the store keeps this section synchronous and lets the
  // first paint of Settings happen without an extra `accountGetActive`
  // round-trip. PIN edits push canonical state through the runtime via
  // `refreshActiveAccount`.
  const { activeAccount, refreshActiveAccount } = useActiveSettingsSlice((s) => ({
    activeAccount: s.activeAccount,
    refreshActiveAccount: s.refreshActiveAccount,
  }));
  const hasPin = !!activeAccount?.has_pin;
  const accountId = activeAccount?.id ?? '';
  const loading = activeAccount === null;

  // Modal workflow states
  const [modalMode, setModalMode] = useState<'set' | 'change' | 'remove' | null>(null);
  const [step, setStep] = useState<'verify' | 'create' | 'confirm'>('verify');
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifiedPin, setVerifiedPin] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const resetModal = useCallback(() => {
    setModalMode(null);
    setStep('verify');
    setDigits(Array(PIN_LENGTH).fill(''));
    setError('');
    setSaving(false);
    setVerifiedPin('');
  }, []);

  const handleDigitChange = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    setDigits(prev => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    // Auto-advance to next input
    if (digit && index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      setDigits(prev => {
        // If current cell empty, move focus back and clear previous
        if (!prev[index] && index > 0) {
          inputRefs.current[index - 1]?.focus();
          const next = [...prev];
          next[index - 1] = '';
          return next;
        }
        return prev;
      });
    }
  }, []);

  // Centralized PIN submission handler — routes by mode + step
  const handleSubmit = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError('');

    try {
      if (modalMode === 'set') {
        if (step === 'create') {
          // Store the new PIN, advance to confirmation step
          const pin = digits.join('');
          setVerifiedPin(pin);
          setStep('confirm');
          setDigits(Array(PIN_LENGTH).fill(''));
          setTimeout(() => inputRefs.current[0]?.focus(), 50);
          setSaving(false);
          return;
        }
        if (step === 'confirm') {
          const confirm = digits.join('');
          if (confirm !== verifiedPin) {
            setError(t('settings.security.pinMismatch', { defaultValue: 'PINs do not match. Try again.' }));
            setStep('create');
            setDigits(Array(PIN_LENGTH).fill(''));
            setTimeout(() => inputRefs.current[0]?.focus(), 50);
            setSaving(false);
            return;
          }
          await api.accountSetPin(accountId, verifiedPin);
          await refreshActiveAccount();
          notifySuccess(t('settings.security.pinSetSuccess', { defaultValue: 'PIN has been set successfully.' }));
          resetModal();
          return;
        }
      }

      if (modalMode === 'change') {
        if (step === 'verify') {
          // Verify current PIN before allowing change
          const pin = digits.join('');
          await api.accountUnlock(accountId, pin);
          setStep('create');
          setDigits(Array(PIN_LENGTH).fill(''));
          setTimeout(() => inputRefs.current[0]?.focus(), 50);
          setSaving(false);
          return;
        }
        if (step === 'create') {
          const newPin = digits.join('');
          setVerifiedPin(newPin);
          setStep('confirm');
          setDigits(Array(PIN_LENGTH).fill(''));
          setTimeout(() => inputRefs.current[0]?.focus(), 50);
          setSaving(false);
          return;
        }
        if (step === 'confirm') {
          const confirm = digits.join('');
          if (confirm !== verifiedPin) {
            setError(t('settings.security.pinMismatch', { defaultValue: 'PINs do not match. Try again.' }));
            setStep('create');
            setDigits(Array(PIN_LENGTH).fill(''));
            setTimeout(() => inputRefs.current[0]?.focus(), 50);
            setSaving(false);
            return;
          }
          await api.accountSetPin(accountId, verifiedPin);
          notifySuccess(t('settings.security.pinChangedSuccess', { defaultValue: 'PIN has been changed successfully.' }));
          resetModal();
          return;
        }
      }

      if (modalMode === 'remove') {
        // Verify current PIN then remove it
        const pin = digits.join('');
        await api.accountRemovePin(accountId, pin);
        await refreshActiveAccount();
        notifySuccess(t('settings.security.pinRemovedSuccess', { defaultValue: 'PIN has been removed.' }));
        resetModal();
        return;
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Operation failed';
      setError(errorMessage);
      setDigits(Array(PIN_LENGTH).fill(''));
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    } finally {
      setSaving(false);
    }
  }, [modalMode, step, digits, verifiedPin, accountId, saving, resetModal, refreshActiveAccount, t]);

  // Auto-submit when all 6 digits are filled
  useEffect(() => {
    if (modalMode && digits.every(d => d !== '') && !saving) {
      handleSubmit();
    }
  }, [digits, modalMode, saving, handleSubmit]);

  const openSetPin = useCallback(() => {
    setModalMode('set');
    setStep('create');
    setDigits(Array(PIN_LENGTH).fill(''));
    setError('');
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }, []);

  const openChangePin = useCallback(() => {
    setModalMode('change');
    setStep('verify');
    setDigits(Array(PIN_LENGTH).fill(''));
    setError('');
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }, []);

  const openRemovePin = useCallback(() => {
    setModalMode('remove');
    setStep('verify');
    setDigits(Array(PIN_LENGTH).fill(''));
    setError('');
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }, []);

  const modalTitle = useMemo(() => {
    if (modalMode === 'set') {
      return step === 'confirm'
        ? t('settings.security.confirmPin', { defaultValue: 'Confirm PIN' })
        : t('settings.security.setPin', { defaultValue: 'Set PIN' });
    }
    if (modalMode === 'change') {
      if (step === 'verify') return t('settings.security.enterCurrentPin', { defaultValue: 'Enter Current PIN' });
      if (step === 'create') return t('settings.security.enterNewPin', { defaultValue: 'Enter New PIN' });
      return t('settings.security.confirmNewPin', { defaultValue: 'Confirm New PIN' });
    }
    if (modalMode === 'remove') {
      return t('settings.security.enterPinToRemove', { defaultValue: 'Enter PIN to Remove' });
    }
    return '';
  }, [modalMode, step, t]);

  if (loading) {
    return (
      <SettingsSection
        icon={<ShieldCheck size={18} />}
        title={t('settings.security.title', { defaultValue: 'Security' })}
        subtitle={t('settings.security.subtitle', { defaultValue: 'Manage your account security settings.' })}
      >
        <Spin active size="small" />
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        icon={<ShieldCheck size={18} />}
        title={t('settings.security.title', { defaultValue: 'Security' })}
        subtitle={t('settings.security.subtitle', { defaultValue: 'Manage your account security settings.' })}
      >
        <SettingsRow
          label={t('settings.security.pinLabel', { defaultValue: 'PIN Lock' })}
          description={hasPin
            ? t('settings.security.pinActive', { defaultValue: 'PIN is active. Your session is encrypted at rest.' })
            : t('settings.security.pinInactive', { defaultValue: 'No PIN configured. Set a PIN to protect your session.' })}
        >
          {hasPin ? (
            <Flex direction="row" gap={8}>
              <Button
                actionId="security-change-pin"
                density="compact"
                emphasis="quiet"
                label={t('settings.security.changePin', { defaultValue: 'Change' })}
                onActivate={openChangePin}
              />
              <Button
                actionId="security-remove-pin"
                density="compact"
                tone="danger"
                label={t('settings.security.removePin', { defaultValue: 'Remove' })}
                onActivate={openRemovePin}
              />
            </Flex>
          ) : (
            <Button
              actionId="security-set-pin"
              density="compact"
              emphasis="secondary"
              label={t('settings.security.setPin', { defaultValue: 'Set PIN' })}
              onActivate={openSetPin}
            />
          )}
        </SettingsRow>
      </SettingsSection>

      {/* PIN entry dialog — shared by set / change / remove flows */}
      <Dialog
        open={!!modalMode}
        onDismiss={resetModal}
        title={modalTitle}
        width={360}
        closeLabel={t('settings.danger.confirmCancel')}
        contentStyle={{ padding: '32px 24px 24px' }}
      >
        <Flex align="center" gap={20}>
          <span className="sc-pin-dialog__icon">
            <ShieldCheck size={24} />
          </span>

          <Flex align="center" gap={4}>
            <Text strong style={{ fontSize: 18 }}>{modalTitle}</Text>
            <Text tone="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
              {step === 'confirm'
                ? t('settings.security.confirmHint', { defaultValue: 'Enter the same PIN again to confirm.' })
                : step === 'verify'
                  ? t('settings.security.verifyHint', { defaultValue: 'Enter your current PIN to continue.' })
                  : t('settings.security.createHint', { defaultValue: 'Choose a 6-digit PIN.' })
              }
            </Text>
          </Flex>

          <Flex direction="row" gap={8} justify="center" style={{ margin: '8px 0' }}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={digits[i]}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onFocus={(e) => e.target.select()}
                className="sc-pin-input"
                data-filled={digits[i] ? true : undefined}
              />
            ))}
          </Flex>

          {error && (
            <Text tone="danger" style={{ fontSize: 13 }}>{error}</Text>
          )}

          {saving && <Spin active size="small" />}
        </Flex>
      </Dialog>
    </>
  );
}

// --- General Tab ---

function ChatShortcutSettingsSection() {
  const { t } = useTranslation('settings');
  const { shortcut, setShortcut } = useActiveSettingsSlice((s) => ({
    shortcut: s.chatScreenshotShortcut,
    setShortcut: s.setChatScreenshotShortcut,
  }));
  const inputRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);

  const handleShortcutKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }
    const nextShortcut = chatScreenshotShortcutFromKeyboardEvent(event);
    if (!nextShortcut) return;
    setShortcut(nextShortcut);
    setRecording(false);
    notifySuccess(t('settings.general.chatShortcutSaved'));
  };

  useEffect(() => {
    if (recording) inputRef.current?.focus();
  }, [recording]);

  return (
    <SettingsSection
      icon={<MessageSquare size={18} />}
      title={t('settings.general.chatTitle')}
      subtitle={t('settings.general.chatDescription')}
    >
      <SettingsRow
        label={t('settings.general.screenshotShortcutLabel')}
        description={t('settings.general.screenshotShortcutDescription')}
      >
        <Flex direction="row" align="center" gap={8}>
          <TextField
            ref={inputRef}
            readOnly
            value={recording
              ? t('settings.general.screenshotShortcutRecording')
              : formatChatScreenshotShortcut(shortcut)}
            onKeyDown={handleShortcutKeyDown}
            style={{ width: 190 }}
          />
          <Button
            actionId="shortcut-record"
            density="compact"
            label={recording ? t('settings.general.screenshotShortcutListening') : t('settings.general.screenshotShortcutRecord')}
            onActivate={() => setRecording(true)}
          />
          <Button
            actionId="shortcut-reset"
            density="compact"
            label={t('settings.general.screenshotShortcutReset')}
            onActivate={() => {
              setShortcut(DEFAULT_CHAT_SCREENSHOT_SHORTCUT);
              notifySuccess(t('settings.general.chatShortcutSaved'));
            }}
          />
        </Flex>
      </SettingsRow>
    </SettingsSection>
  );
}

function GeneralTab() {
  // Agents are bootstrapped + reconciled by `runtimes/settingsRuntime.ts`;
  // the page reads them synchronously from the store. No mount-time
  // fetch — runtime ownership is single.
  const agents = useActiveSettingsSlice((s) => s.agents);
  const { t } = useTranslation('settings');
  const [agentVisibilityFilter, setAgentVisibilityFilter] = useState('all');
  const visibleAgents = agentVisibilityFilter === 'all'
    ? agents
    : agents.filter((agent) => (agent.visibility || 'private') === agentVisibilityFilter);

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<Globe size={18} />}
        title={t('settings.general.languageTitle')}
        subtitle={t('settings.general.languageDescription')}
      >
        <SettingsRow label={t('settings.general.languageField')}>
          <LanguageSwitcher variant="ghostSelect" label={t('settings.general.languageField')} />
        </SettingsRow>
      </SettingsSection>

      <SecuritySection />

      <ChatShortcutSettingsSection />

      <SettingsSection
        icon={<Bot size={18} />}
        title={t('settings.general.agentsTitle')}
        extra={
          <Segmented<string>
            density="compact"
            aria-label={t('settings.agent.visibility.filter')}
            data-agent-visibility-filter
            options={[
              { label: t('settings.agent.visibility.all'), value: 'all' },
              { label: t('settings.agent.visibility.private'), value: 'private' },
              { label: t('settings.agent.visibility.workspace'), value: 'workspace' },
              { label: t('settings.agent.visibility.public'), value: 'public' },
            ]}
            value={agentVisibilityFilter}
            onValueChange={(value) => setAgentVisibilityFilter(value ?? 'all')}
          />
        }
      >
        {visibleAgents.length === 0 ? (
          <Text tone="secondary">{t('settings.general.noAgents')}</Text>
        ) : (
          visibleAgents.map((agent) => <AgentCard key={agent.name} agent={agent} />)
        )}
      </SettingsSection>
    </SettingsContainer>
  );
}

const TOOL_CATEGORY_TONES: Record<string, Tone> = {
  filesystem: 'info',
  shell: 'warning',
  web: 'success',
  memory: 'neutral',
  mcp: 'info',
  agent: 'info',
};

function ToolsTab() {
  const { tools, error, loadTools } = useActiveSettingsSlice((s) => ({
    tools: s.tools,
    error: s.error,
    loadTools: s.loadTools,
  }));
  const { t } = useTranslation('settings');
  const { value: toolsCache } = usePrefetch('settings.tools', () => loadTools());

  // `usePrefetch` reads loadTools()'s return value (void); the side-effect
  // is the store update. Reference `toolsCache` so React/ESLint know we
  // intentionally consume the entry.
  void toolsCache;

  const toolColumns: Array<TableColumn<ToolInfo>> = [
    {
      id: 'name',
      label: t('settings.tools.columnName'),
      renderCell: (tool) => <Text strong>{tool.name}</Text>,
    },
    {
      id: 'category',
      label: t('settings.tools.columnCategory'),
      renderCell: (tool) => (
        <Tag tone={TOOL_CATEGORY_TONES[tool.category] ?? 'neutral'}>{tool.category}</Tag>
      ),
    },
    {
      id: 'needs_approval',
      label: t('settings.tools.columnApproval'),
      renderCell: (tool) =>
        tool.needs_approval
          ? <Tag tone="warning">{t('settings.tools.approvalRequired')}</Tag>
          : <Tag tone="success">{t('settings.tools.approvalAuto')}</Tag>,
    },
  ];

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<Wrench size={18} />}
        title={t('settings.tools.toolsTitle', { count: tools.length })}
      >
        {error && (
          <Alert
            tone="danger"
            title={t('settings.tools.operationFailed')}
            description={error}
            className="sc-tools-alert"
          />
        )}
        <DataTable<ToolInfo>
          rows={tools}
          columns={toolColumns}
          rowKey="name"
          rowAttributes={(tool) => ({ 'data-item-id': tool.name } as React.HTMLAttributes<HTMLTableRowElement>)}
        />
      </SettingsSection>
    </SettingsContainer>
  );
}

const ICON_MAP: Record<string, LucideIcon> = {
  MessageSquare, Terminal, Wrench, Users, BookOpen, Brain,
  Search, Puzzle, Key, Cpu, Globe, Zap, FileText,
  Code, PenTool, Clock, Shield, ShieldCheck, File,
  Edit, Package, Plus, Send, RefreshCw, Sparkles,
  GitBranch, Image, Trash2, Server, Settings, HelpCircle,
  FileEdit: FileText,
};

function getIcon(name?: string, size = 16) {
  if (!name) return null;
  const Icon = ICON_MAP[name];
  return Icon ? <Icon size={size} /> : null;
}

// Prototype AboutSection meta grid, fed by real host facts (no fabricated
// build numbers): version comes from the Tauri app package, platform and
// rendering engine from the user agent, runtime is the shipped stack.
function detectHostPlatform(): string {
  const ua = navigator.userAgent;
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux|X11/i.test(ua)) return 'Linux';
  return navigator.platform || '';
}

function detectRenderEngine(): string {
  const ua = navigator.userAgent;
  if (/AppleWebKit/i.test(ua)) return 'WebKit';
  if (/Gecko\/\d/i.test(ua)) return 'Gecko';
  return '';
}

function AboutMetaSection() {
  const { t } = useTranslation('settings');
  const unknown = t('settings.help.aboutUnknown');
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        if (!cancelled) setVersion('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: ReadonlyArray<readonly [string, string]> = [
    [t('settings.help.aboutVersion'), version ? version : unknown],
    [t('settings.help.aboutPlatform'), detectHostPlatform() || unknown],
    [t('settings.help.aboutEngine'), detectRenderEngine() || unknown],
    [t('settings.help.aboutRuntime'), t('settings.help.aboutRuntimeValue')],
  ];

  return (
    <div className="sc-about-grid" data-about-meta>
      {rows.map(([label, value]) => (
        <SettingsRow key={label} label={label} description={<code className="sc-about-grid__value">{value}</code>}>
          <></>
        </SettingsRow>
      ))}
    </div>
  );
}

function HelpTab({ highlightId }: { highlightId?: string }) {
  const [activeKeys, setActiveKeys] = useState<string[]>(['search']);
  const { t } = useTranslation('settings');
  const groups: HelpCategoryGroup[] = useMemo(() => [{
    category: { id: 'search', title: t('search.label', { ns: 'search' }), icon: 'Search' },
    items: [
      { id: 'search', category: 'search', source: 'builtin', icon: 'Search',
        title: t('search.label', { ns: 'search' }),
        description: t('search.boundary', { ns: 'search' }), usage: '⌘ / Ctrl + K · ↑↓ · Enter · Esc' },
      ...SEARCH_FUNCTIONS.map(item => ({
        id: item.id, category: 'search', source: 'builtin', icon: 'Wrench',
        title: t(item.titleKey, { ns: 'search' }), description: t(item.detailKey, { ns: 'search' }),
      })),
    ],
  }], [t]);

  useEffect(() => {
    if (!highlightId || groups.length === 0) return;
    for (const group of groups) {
      if (group.items.some((item) => item.id === highlightId)) {
        setActiveKeys((prev) =>
          prev.includes(group.category.id) ? prev : [...prev, group.category.id]
        );
        break;
      }
    }
  }, [highlightId, groups]);

  const toggleKey = (key: string) => {
    setActiveKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<Info size={18} />}
        title={t('settings.help.aboutTitle')}
        subtitle={t('settings.help.aboutDescription')}
      >
        <AboutMetaSection />
      </SettingsSection>

      <div className="sc-help-accordion">
        {groups.map((group) => {
          const open = activeKeys.includes(group.category.id);
          return (
            <div key={group.category.id} className="sc-help-accordion__block">
              <Button
                actionId={`help-accordion-${group.category.id}`}
                className="sc-help-accordion__header"
                emphasis="quiet"
                aria-expanded={open}
                onActivate={() => toggleKey(group.category.id)}
                leading={open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              >
                <span className="sc-help-accordion__title">
                  {getIcon(group.category.icon, 16)}
                  <strong>{group.category.title}</strong>
                  <Tag className="sc-help-accordion__count">{group.items.length}</Tag>
                </span>
              </Button>
              {open && (
                <Flex gap={8} className="sc-help-accordion__body">
                  {group.category.description && (
                    <Text tone="secondary" className="sc-help-accordion__desc">
                      {group.category.description}
                    </Text>
                  )}
                  {group.items.map((item) => (
                    <Flex
                      key={item.id}
                      data-item-id={item.id}
                      gap={12}
                      className={item.source === 'applet' ? 'sc-help-item sc-help-item--applet' : 'sc-help-item'}
                    >
                      <div className="sc-help-item__icon">
                        {getIcon(item.icon, 16) || <HelpCircle size={16} />}
                      </div>
                      <Flex gap={4} flex={1}>
                        <Flex direction="row" align="center" gap={6}>
                          <strong className="sc-help-item__title">{item.title}</strong>
                          {item.source === 'applet' && (
                            <Tag tone="warning" className="sc-help-item__applet-tag">{t('settings.help.appletTag')}</Tag>
                          )}
                        </Flex>
                        <Text tone="secondary" className="sc-help-item__desc">
                          {item.description}
                        </Text>
                        {item.usage && (
                          <code className="sc-help-item__usage">
                            {item.usage}
                          </code>
                        )}
                      </Flex>
                    </Flex>
                  ))}
                </Flex>
              )}
            </div>
          );
        })}
      </div>

      <Flex gap={8} className="sc-help-extension">
        <Flex direction="row" align="center" gap={6}>
          <Puzzle size={14} />
          <Text tone="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
            {t('settings.help.extensionPointTitle')}
          </Text>
        </Flex>
        <Text tone="secondary" style={{ fontSize: 12 }}>
          {t('settings.help.extensionPointDescription')}
        </Text>
      </Flex>

      <DangerZoneResetOnboarding />
    </SettingsContainer>
  );
}

function DangerZoneResetOnboarding() {
  const { t } = useTranslation('settings');
  const [loading, setLoading] = useState(false);

  const handleReset = () => {
    void confirmRequest({
      tone: 'danger',
      title: t('settings.danger.confirmTitle'),
      description: (
        <Flex gap={8}>
          <Text>{t('settings.danger.confirmContent')}</Text>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>{t('settings.danger.confirmItem.session')}</li>
            <li>{t('settings.danger.confirmItem.oauth')}</li>
          </ul>
          <Text tone="secondary" style={{ fontSize: 12 }}>
            {t('settings.danger.confirmNote')}
          </Text>
        </Flex>
      ),
      confirmLabel: t('settings.danger.confirmOk'),
      cancelLabel: t('settings.danger.confirmCancel'),
      onConfirm: async () => {
        setLoading(true);
        try {
          await useSessionStore.getState().logout();
          await api.resetOnboarding();
          const { clearWarmResume } = await import('../hooks/useAppLifecycle');
          clearWarmResume();
          sessionStorage.clear();
          notifySuccess(t('settings.danger.resetSuccess'));
          window.location.hash = '';
          window.location.reload();
        } catch (e) {
          notifyError(e instanceof Error ? e.message : t('settings.danger.resetFailed'));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  return (
    <section className="sc-danger" data-danger-zone="reset-onboarding">
      <header className="sc-danger__head">
        <h3 className="sc-danger__title">
          <AlertTriangle size={15} className="sc-danger__icon" />
          {t('settings.danger.title')}
        </h3>
        <p className="sc-danger__desc">{t('settings.danger.description')}</p>
      </header>
      <Button
        actionId="danger-reset-onboarding"
        className="sc-danger__button"
        tone="danger"
        emphasis="primary"
        leading={<RotateCcw size={14} />}
        execution={loading ? 'pending' : 'idle'}
        label={t('settings.danger.logoutButton')}
        onActivate={handleReset}
      />
    </section>
  );
}

function AgentCard({
  agent,
}: {
  agent: Agent;
}) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(agent.description);
  const updateAgent = useActiveSettingsSlice((s) => s.updateAgent);
  const { t } = useTranslation('settings');

  const handleSave = async () => {
    await updateAgent(agent.name, { description: desc });
    setEditing(false);
  };

  const handleEffortChange = async (effort: string) => {
    await updateAgent(agent.name, { effort });
    notifySuccess(t('settings.agent.effortSaved'));
  };

  const handleVisibilityChange = async (visibility: string) => {
    await updateAgent(agent.name, { visibility });
    notifySuccess(t('settings.agent.visibilitySaved'));
  };

  return (
    <Flex gap={10} className="sc-agent-card">
      <Flex direction="row" justify="space-between" align="center">
        <Flex direction="row" gap={8} align="center">
          <Text strong style={{ fontSize: 15 }}>{agent.title || agent.name}</Text>
          <Tag>{t(`settings.agent.effort.${agent.effort || 'medium'}`)}</Tag>
          <Tag>{t(`settings.agent.visibility.${agent.visibility || 'private'}`)}</Tag>
        </Flex>
        <Flex direction="row" gap={4}>
          {editing ? (
            <>
              <Button
                actionId={`agent-save-${agent.name}`}
                density="compact"
                emphasis="primary"
                label={t('settings.agent.save')}
                onActivate={() => void handleSave()}
              />
              <Button
                actionId={`agent-cancel-${agent.name}`}
                density="compact"
                label={t('settings.agent.cancel')}
                onActivate={() => setEditing(false)}
              />
            </>
          ) : (
            <Button
              actionId={`agent-edit-${agent.name}`}
              density="compact"
              label={t('settings.agent.edit')}
              onActivate={() => setEditing(true)}
            />
          )}
        </Flex>
      </Flex>
      {editing ? (
        <Flex gap={10}>
          <TextField
            value={desc}
            onValueChange={setDesc}
            placeholder={t('settings.agent.descriptionPlaceholder')}
          />
          <Flex direction="row" gap={8} wrap="wrap" align="center">
            <Select<string>
              density="compact"
              value={agent.effort || 'medium'}
              style={{ width: 132 }}
              onValueChange={(value) => {
                if (typeof value === 'string') void handleEffortChange(value);
              }}
              options={[
                { value: 'low', label: t('settings.agent.effort.low') },
                { value: 'medium', label: t('settings.agent.effort.medium') },
                { value: 'high', label: t('settings.agent.effort.high') },
              ]}
            />
            <Select<string>
              density="compact"
              value={agent.visibility || 'private'}
              style={{ width: 132 }}
              onValueChange={(value) => {
                if (typeof value === 'string') void handleVisibilityChange(value);
              }}
              options={[
                { value: 'private', label: t('settings.agent.visibility.private') },
                { value: 'workspace', label: t('settings.agent.visibility.workspace') },
              ]}
            />
          </Flex>
        </Flex>
      ) : (
        <Text tone="secondary">{agent.description || t('settings.agent.noDescription')}</Text>
      )}
    </Flex>
  );
}
