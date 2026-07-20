import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Tag, Table, Input, Typography, Collapse, Spin, message, theme, Modal, Popover, Select } from 'antd';
import type { InputRef } from 'antd';
import { Button } from '@lobehub/ui';
import {
  Settings, Bot, Wrench, HelpCircle,
  MessageSquare, Puzzle, Sparkles,
  BarChart3, Hash, Type,
  Activity as ActivityIcon, Trophy, Layers,
  Terminal, Users, BookOpen, Brain,
  Search, Key, Cpu, Globe, Zap, FileText,
  Code, PenTool, Clock, Shield, ShieldCheck, File,
  Edit, Package, Plus, Send, RefreshCw,
  GitBranch, Image, Trash2, Server, AlertTriangle, RotateCcw,
  Database, Network,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useProviderStore } from '../store/provider';
import { api, type Agent, type AppletInfo, type AvailableModel, type HelpCategoryGroup, type SearchProviderInfo, type StatisticsData } from '../services/desktop_api';
import { hasSettingsPanel, getAppletFrontend } from '../applets/registry';
import { getModulesWithSettings } from '../modules/registry';
import { PageHeader } from '../components/PageHeader';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';
import { log } from '../utils/logger';
import { SettingsContainer, SettingsSection, SettingsItemCard, SettingsRow } from '../components/settings/SettingsLayout';
import { FederationTab } from '../components/settings/FederationTab';
import { ModelProviderSelect } from '../components/ModelProviderSelect';
import { usePrefetch } from '../kernel/usePrefetch';
import { markRouteRequested, markRouteVisible } from '../kernel/frontendRuntimeProfiler';
import { SectionHost } from '../kernel/SectionHost';
import type { SectionDescriptor, SectionHostPolicy } from '../kernel/section';
import {
  DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  chatScreenshotShortcutFromKeyboardEvent,
  formatChatScreenshotShortcut,
} from '../utils/chatScreenshotShortcut';
import { useActiveSettingsSlice } from './useActiveSettingsStore';

const { Text } = Typography;

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
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    markRouteVisible(surfaceId, { surface });
  };
  const frame = window.requestAnimationFrame(report);
  const fallback = window.setTimeout(report, 120);
  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(fallback);
  };
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
  label: string;
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
        key: 'statistics',
        label: t('settings.tab.statistics'),
        icon: BarChart3,
        order: 50,
        policy: { cache: 'selected-only' },
        render: () => <StatisticsTab />,
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

function useTabGroups(): TabGroupDef[] {
  const { t } = useTranslation('settings');

  return useMemo(() => {
    const allSections = getModulesWithSettings().map((m) => m.id);

    const groups: TabGroupDef[] = [
      {
        key: 'general',
        label: t('settings.group.general'),
        icon: Settings,
        sectionKeys: ['account', 'federation', 'general'],
      },
      {
        key: 'ai',
        label: t('settings.group.ai'),
        icon: Sparkles,
        sectionKeys: ['providers', 'models', 'memory', 'skills', 'mcp', 'tts', 'tools'],
      },
      {
        key: 'channels',
        label: t('settings.group.channels'),
        icon: Send,
        sectionKeys: ['channels', 'connections'],
      },
      {
        key: 'applets',
        label: t('settings.group.applets'),
        icon: Puzzle,
        sectionKeys: ['applets'],
      },
      {
        key: 'data',
        label: t('settings.group.data'),
        icon: Database,
        sectionKeys: ['statistics', 'logs'],
      },
      {
        key: 'help',
        label: t('settings.group.help'),
        icon: HelpCircle,
        sectionKeys: ['help'],
      },
    ];

    // Only keep section keys that actually exist in the registry or local definitions
    const knownKeys = new Set([...allSections, 'federation', 'statistics', 'applets', 'general', 'tools', 'help']);
    return groups.map((g) => ({
      ...g,
      sectionKeys: g.sectionKeys.filter((k) => knownKeys.has(k)),
    })).filter((g) => g.sectionKeys.length > 0);
  }, [t]);
}

function findGroupForSection(groups: TabGroupDef[], sectionKey: string): string | undefined {
  return groups.find((g) => g.sectionKeys.includes(sectionKey))?.key;
}

export function SettingsPage({ activeTab, highlightId, onNavConsumed }: SettingsPageProps) {
  const { token } = theme.useToken();
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

  const showSidebar = groupSections.length > 1;
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
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      <PageHeader
        title={t('settings.title')}
        icon={<Settings size={20} style={{ color: token.colorPrimary }} />}
      />

      {/* Horizontal tab group bar */}
      <Flexbox
        horizontal
        align="center"
        gap={2}
        style={{
          padding: '6px 24px 0',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        {groups.map((group) => {
          const Icon = group.icon;
          const isActive = activeGroup === group.key;
          return (
            <Flexbox
              key={group.key}
              horizontal
              align="center"
              gap={6}
              role="tab"
              tabIndex={0}
              aria-selected={isActive}
              data-group-key={group.key}
              data-pt-secondary-tab={group.key}
              data-pt-secondary-tab-id={group.key}
              onClick={() => handleGroupChange(group.key)}
              style={{
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? token.colorPrimary : token.colorTextSecondary,
                borderBottom: isActive ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                marginBottom: -1,
                transition: 'all 0.2s',
                userSelect: 'none',
              }}
            >
              <Icon size={15} />
              <span>{group.label}</span>
            </Flexbox>
          );
        })}
      </Flexbox>

      {/* Content area: optional left sidebar + right content */}
      <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
        {showSidebar && (
          <Flexbox
            style={{
              width: 180,
              flexShrink: 0,
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              padding: '12px 0',
              overflowY: 'auto',
            }}
          >
            {groupSections.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.key;
              return (
                <Flexbox
                  key={section.key}
                  horizontal
                  align="center"
                  gap={8}
                  role="button"
                  tabIndex={0}
                  data-section-key={section.key}
                  data-pt-section-item={section.key}
                  data-pt-section-item-id={section.key}
                  onClick={() => handleSectionChange(section.key)}
                  style={{
                    padding: '8px 14px',
                    margin: '1px 8px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? token.colorPrimary : token.colorTextSecondary,
                    background: isActive ? token.colorPrimaryBg : 'transparent',
                    transition: 'all 0.2s',
                  }}
                >
                  <Icon size={14} />
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {section.label}
                  </span>
                </Flexbox>
              );
            })}
          </Flexbox>
        )}

        {/* SectionHost owns Settings section mount/cache policy. */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            scrollBehavior: 'smooth',
          }}
        >
          <SectionHost
            activeSectionId={activeSection}
            descriptors={sectionDescriptors}
            highlightId={activeSectionVisible ? highlightId : undefined}
            initialMountedSectionIds={['account']}
            surfacePrefix="settings:section-host"
          />
        </div>
      </Flexbox>
    </Flexbox>
  );
}

function AppletsSettingsTab() {
  const [applets, setApplets] = useState<AppletInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');

  useEffect(() => {
    api.listApplets().then(setApplets).catch((e) => log.error('settings', 'Failed to list applets', e));
  }, []);

  const SettingsPanel = selected ? getAppletFrontend(selected)?.settingsPanel : undefined;

  if (SettingsPanel) {
    return (
      <Flexbox style={{ overflow: 'hidden', padding: '0 24px' }}>
        <Flexbox
          horizontal
          align="center"
          gap={8}
          style={{
            padding: '12px 0',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
          }}
        >
          <div
            onClick={() => setSelected(null)}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 13,
              color: token.colorPrimary,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => { (e.currentTarget).style.background = token.colorPrimaryBg; }}
            onMouseLeave={(e) => { (e.currentTarget).style.background = 'transparent'; }}
          >
            {t('settings.applets.backToApplets')}
          </div>
        </Flexbox>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SettingsPanel />
        </div>
      </Flexbox>
    );
  }

  return (
    <SettingsContainer>
      <Text type="secondary" style={{ fontSize: 13 }}>
        {t('settings.applets.description')}
      </Text>

      <Flexbox gap={10}>
        {applets.map((applet) => {
          const hasSettings = hasSettingsPanel(applet.manifest.id);
          const IconComp = ICON_MAP[applet.manifest.icon];
          return (
            <Flexbox
              key={applet.manifest.id}
              horizontal
              align="center"
              gap={14}
              onClick={hasSettings ? () => setSelected(applet.manifest.id) : undefined}
              style={{
                padding: '16px 20px',
                borderRadius: 12,
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
                cursor: hasSettings ? 'pointer' : 'default',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (hasSettings) {
                  (e.currentTarget).style.borderColor = token.colorPrimary;
                  (e.currentTarget).style.boxShadow = `0 2px 8px ${token.colorPrimaryBg}`;
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget).style.borderColor = token.colorBorderSecondary;
                (e.currentTarget).style.boxShadow = 'none';
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: `linear-gradient(135deg, ${token.colorPrimaryBg}, ${token.colorPrimary}20)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {IconComp ? <IconComp size={20} style={{ color: token.colorPrimary }} /> : <Puzzle size={20} style={{ color: token.colorPrimary }} />}
              </div>
              <Flexbox flex={1} gap={2}>
                <Flexbox horizontal align="center" gap={8}>
                  <Text strong style={{ fontSize: 14 }}>{applet.manifest.name}</Text>
                  <Tag
                    color={applet.status === 'active' ? 'success' : applet.status === 'error' ? 'error' : 'default'}
                    style={{ fontSize: 10, lineHeight: '16px', padding: '0 5px' }}
                  >
                    {t(`settings.applets.status.${applet.status}`, { defaultValue: applet.status })}
                  </Tag>
                  <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>
                    v{applet.manifest.version}
                  </Tag>
                </Flexbox>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {applet.manifest.description}
                </Text>
              </Flexbox>
              {hasSettings && (
                <Text type="secondary" style={{ fontSize: 18, flexShrink: 0 }}>›</Text>
              )}
              {!hasSettings && (
                <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{t('settings.applets.noSettings')}</Text>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>

      {applets.length === 0 && (
        <Flexbox align="center" justify="center" gap={8} style={{ padding: 40 }}>
          <Puzzle size={32} style={{ color: token.colorTextQuaternary }} />
          <Text type="secondary">{t('settings.applets.noApplets')}</Text>
        </Flexbox>
      )}
    </SettingsContainer>
  );
}

/* ─── Activity Heatmap ───────────────────────────────────────────────── */

function ActivityHeatmap({ activity }: { activity: { date: string; count: number }[] }) {
  const { token } = theme.useToken();
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
    if (count === 0) return token.colorFillQuaternary;
    const ratio = count / maxCount;
    if (ratio <= 0.25) return '#9be9a8';
    if (ratio <= 0.5) return '#40c463';
    if (ratio <= 0.75) return '#30a14e';
    return '#216e39';
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
            borderRadius: 2,
            background: getColor(count),
            cursor: 'default',
          }}
        />,
      );
    }
  }

  const totalMessages = activity.reduce((s, a) => s + a.count, 0);

  return (
    <Flexbox gap={8}>
      <div style={{ position: 'relative', paddingTop: 16 }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 4, paddingLeft: 0, position: 'relative', height: 14 }}>
          {months.map((m) => (
            <span
              key={m.label + m.col}
              style={{
                position: 'absolute',
                left: m.col * 14,
                fontSize: 10,
                color: token.colorTextTertiary,
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
            gap: 3,
          }}
        >
          {cells}
        </div>
      </div>
      <Flexbox horizontal justify="space-between" align="center">
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('settings.statistics.heatmapTotal', { count: totalMessages })}
        </Text>
        <Flexbox horizontal align="center" gap={4}>
          <Text type="secondary" style={{ fontSize: 10 }}>{t('settings.statistics.heatmapInactive')}</Text>
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
            <div
              key={i}
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: getColor(r * maxCount),
              }}
            />
          ))}
          <Text type="secondary" style={{ fontSize: 10 }}>{t('settings.statistics.heatmapActive')}</Text>
        </Flexbox>
      </Flexbox>
    </Flexbox>
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
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');

  if (!items || items.length === 0) {
    return (
      <Flexbox
        gap={8}
        style={{
          background: token.colorBgContainer,
          borderRadius: 12,
          padding: 20,
          border: `1px solid ${token.colorBorderSecondary}`,
          flex: 1,
          minWidth: 200,
        }}
      >
        <Flexbox horizontal align="center" gap={6}>
          {icon}
          <Text strong style={{ fontSize: 14 }}>{title}</Text>
        </Flexbox>
        <Flexbox align="center" justify="center" gap={8} style={{ padding: '24px 0' }}>
          <Layers size={32} style={{ color: token.colorTextQuaternary }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{t('settings.statistics.rankNoData')}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('settings.statistics.rankNoDataHint')}
          </Text>
        </Flexbox>
      </Flexbox>
    );
  }

  const maxVal = Math.max(1, ...items.map((i) => i.count));

  return (
    <Flexbox
      gap={8}
      style={{
        background: token.colorBgContainer,
        borderRadius: 12,
        padding: 20,
        border: `1px solid ${token.colorBorderSecondary}`,
        flex: 1,
        minWidth: 200,
      }}
    >
      <Flexbox horizontal align="center" gap={6}>
        {icon}
        <Text strong style={{ fontSize: 14 }}>{title}</Text>
      </Flexbox>
      <Flexbox horizontal justify="space-between" style={{ padding: '0 4px' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>{labelHeader}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{valueHeader}</Text>
      </Flexbox>
      {items.map((item, idx) => (
        <Flexbox key={item.name} gap={4}>
          <Flexbox horizontal justify="space-between" align="center" style={{ padding: '0 4px' }}>
            <Flexbox horizontal gap={6} align="center">
              <Text style={{ fontSize: 12, color: token.colorTextTertiary, width: 16, textAlign: 'right' }}>
                {idx + 1}
              </Text>
              <Text style={{ fontSize: 13 }}>{item.name}</Text>
            </Flexbox>
            <Text style={{ fontSize: 13, fontWeight: 500 }}>{item.count}</Text>
          </Flexbox>
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: token.colorFillSecondary,
              marginLeft: 24,
            }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 2,
                width: `${(item.count / maxVal) * 100}%`,
                background: 'linear-gradient(90deg, #667eea, #764ba2)',
                transition: 'width 0.6s ease',
              }}
            />
          </div>
        </Flexbox>
      ))}
    </Flexbox>
  );
}

/* ─── Statistics Tab ─────────────────────────────────────────────────── */

function StatisticsTab() {
  const { token } = theme.useToken();
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
      <Flexbox align="center" justify="center" style={{ padding: 80 }}>
        <Text type="secondary">{t('settings.statistics.loading')}</Text>
      </Flexbox>
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

  const summaryCards: { label: string; value: string | number; sub?: string; icon: React.ReactNode }[] = [
    {
      label: t('settings.statistics.sessions'),
      value: summary.sessions,
      icon: <MessageSquare size={20} style={{ color: token.colorPrimary }} />,
    },
    {
      label: t('settings.statistics.messages'),
      value: summary.messages,
      icon: <Hash size={20} style={{ color: '#52c41a' }} />,
    },
    {
      label: t('settings.statistics.totalWords'),
      value: summary.total_words >= 1000 ? `${(summary.total_words / 1000).toFixed(1)}K` : summary.total_words,
      icon: <Type size={20} style={{ color: '#fa8c16' }} />,
    },
    {
      label: t('settings.statistics.agents'),
      value: summary.agents,
      icon: <Bot size={20} style={{ color: '#722ed1' }} />,
    },
  ];

  return (
    <SettingsContainer fullHeight maxWidth={900}>
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" gap={8}>
          <span style={{ fontSize: 16, fontWeight: 600 }}
            dangerouslySetInnerHTML={{
              __html: t('settings.statistics.daysWithUs', { days: summary.days_with_us })
                .replace('<highlight>', `<span style="color: ${token.colorPrimary}; font-weight: 700; font-size: 20px">`)
                .replace('</highlight>', '</span>'),
            }}
          />
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('settings.statistics.firstActive', {
            date: summary.first_date ? new Date(summary.first_date).toLocaleDateString() : t('settings.statistics.firstActiveNA'),
          })}
        </Text>
      </Flexbox>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {summaryCards.map((card) => (
          <Flexbox
            key={card.label}
            gap={8}
            style={{
              background: token.colorBgContainer,
              borderRadius: 12,
              padding: 20,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Flexbox horizontal align="center" gap={8}>
              {card.icon}
              <Text type="secondary" style={{ fontSize: 13 }}>{card.label}</Text>
            </Flexbox>
            <Text style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{card.value}</Text>
          </Flexbox>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <RankList
          title={t('settings.statistics.modelRank')}
          icon={<Cpu size={16} style={{ color: '#1890ff' }} />}
          items={data.model_rank}
          labelHeader={t('settings.statistics.rankLabelModel')}
          valueHeader={t('settings.statistics.rankLabelMessages')}
        />
        <RankList
          title={t('settings.statistics.agentRank')}
          icon={<Bot size={16} style={{ color: '#722ed1' }} />}
          items={data.agent_rank}
          labelHeader={t('settings.statistics.rankLabelAgent')}
          valueHeader={t('settings.statistics.rankLabelMessages')}
        />
        <RankList
          title={t('settings.statistics.topicRank')}
          icon={<Trophy size={16} style={{ color: '#fa8c16' }} />}
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
  const { token } = theme.useToken();
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
          message.success(t('settings.security.pinSetSuccess', { defaultValue: 'PIN has been set successfully.' }));
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
          message.success(t('settings.security.pinChangedSuccess', { defaultValue: 'PIN has been changed successfully.' }));
          resetModal();
          return;
        }
      }

      if (modalMode === 'remove') {
        // Verify current PIN then remove it
        const pin = digits.join('');
        await api.accountRemovePin(accountId, pin);
        await refreshActiveAccount();
        message.success(t('settings.security.pinRemovedSuccess', { defaultValue: 'PIN has been removed.' }));
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

  const pinInputStyle: React.CSSProperties = {
    width: 44,
    height: 48,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 600,
    borderRadius: 10,
    border: `1.5px solid ${token.colorBorder}`,
    background: token.colorBgContainer,
    outline: 'none',
    caretColor: token.colorPrimary,
    transition: 'border-color 0.2s',
  };

  if (loading) {
    return (
      <SettingsSection
        icon={<ShieldCheck size={18} />}
        title={t('settings.security.title', { defaultValue: 'Security' })}
        subtitle={t('settings.security.subtitle', { defaultValue: 'Manage your account security settings.' })}
      >
        <Spin size="small" />
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
        <SettingsItemCard>
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal align="center" gap={12}>
              <Flexbox
                align="center"
                justify="center"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: hasPin ? token.colorSuccessBg : token.colorFillSecondary,
                }}
              >
                {hasPin ? (
                  <ShieldCheck size={18} style={{ color: token.colorSuccess }} />
                ) : (
                  <Shield size={18} style={{ color: token.colorTextTertiary }} />
                )}
              </Flexbox>
              <Flexbox gap={2}>
                <Text strong style={{ fontSize: 14 }}>
                  {t('settings.security.pinLabel', { defaultValue: 'PIN Lock' })}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {hasPin
                    ? t('settings.security.pinActive', { defaultValue: 'PIN is active. Your session is encrypted at rest.' })
                    : t('settings.security.pinInactive', { defaultValue: 'No PIN configured. Set a PIN to protect your session.' })
                  }
                </Text>
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal gap={8}>
              {hasPin ? (
                <>
                  <Button size="small" onClick={openChangePin}>
                    {t('settings.security.changePin', { defaultValue: 'Change' })}
                  </Button>
                  <Button size="small" danger onClick={openRemovePin}>
                    {t('settings.security.removePin', { defaultValue: 'Remove' })}
                  </Button>
                </>
              ) : (
                <Button type="primary" size="small" onClick={openSetPin}>
                  {t('settings.security.setPin', { defaultValue: 'Set PIN' })}
                </Button>
              )}
            </Flexbox>
          </Flexbox>
        </SettingsItemCard>
      </SettingsSection>

      {/* PIN entry modal — shared by set / change / remove flows */}
      <Modal
        open={!!modalMode}
        onCancel={resetModal}
        footer={null}
        centered
        width={360}
        destroyOnHidden
        styles={{ body: { padding: '32px 24px 24px' } }}
      >
        <Flexbox align="center" gap={20}>
          <Flexbox
            align="center"
            justify="center"
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: token.colorFillSecondary,
            }}
          >
            <ShieldCheck size={24} style={{ color: token.colorPrimary }} />
          </Flexbox>

          <Flexbox align="center" gap={4}>
            <Text strong style={{ fontSize: 18 }}>{modalTitle}</Text>
            <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
              {step === 'confirm'
                ? t('settings.security.confirmHint', { defaultValue: 'Enter the same PIN again to confirm.' })
                : step === 'verify'
                  ? t('settings.security.verifyHint', { defaultValue: 'Enter your current PIN to continue.' })
                  : t('settings.security.createHint', { defaultValue: 'Choose a 6-digit PIN.' })
              }
            </Text>
          </Flexbox>

          <Flexbox horizontal gap={8} justify="center" style={{ margin: '8px 0' }}>
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
                style={{
                  ...pinInputStyle,
                  borderColor: digits[i] ? token.colorPrimary : token.colorBorder,
                }}
              />
            ))}
          </Flexbox>

          {error && (
            <Text type="danger" style={{ fontSize: 13 }}>{error}</Text>
          )}

          {saving && <Spin size="small" />}
        </Flexbox>
      </Modal>
    </>
  );
}

// --- General Tab ---

function settingResultString(result: unknown): string {
  const value = (result as { data?: { value?: unknown }; value?: unknown })?.data?.value
    ?? (result as { value?: unknown })?.value;
  return typeof value === 'string' ? value : '';
}

function ChatShortcutSettingsSection() {
  const { t } = useTranslation('settings');
  const { shortcut, setShortcut } = useActiveSettingsSlice((s) => ({
    shortcut: s.chatScreenshotShortcut,
    setShortcut: s.setChatScreenshotShortcut,
  }));
  const inputRef = useRef<InputRef>(null);
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
    message.success(t('settings.general.chatShortcutSaved'));
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
        <Flexbox horizontal align="center" gap={8}>
          <Input
            ref={inputRef}
            readOnly
            value={recording
              ? t('settings.general.screenshotShortcutRecording')
              : formatChatScreenshotShortcut(shortcut)}
            onKeyDown={handleShortcutKeyDown}
            style={{ width: 190 }}
          />
          <Button size="small" onClick={() => setRecording(true)}>
            {recording ? t('settings.general.screenshotShortcutListening') : t('settings.general.screenshotShortcutRecord')}
          </Button>
          <Button
            size="small"
            onClick={() => {
              setShortcut(DEFAULT_CHAT_SCREENSHOT_SHORTCUT);
              message.success(t('settings.general.chatShortcutSaved'));
            }}
          >
            {t('settings.general.screenshotShortcutReset')}
          </Button>
        </Flexbox>
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
  const { value: modelResult } = usePrefetch('settings.agent.models', () => api.listAvailableModels());
  const models = modelResult?.models ?? [];
  const [defaultProvider, setDefaultProvider] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [defaultEffort, setDefaultEffort] = useState('medium');
  const [agentVisibilityFilter, setAgentVisibilityFilter] = useState('all');
  const providerOptions = Array.from(
    new Map(
      models.map((model) => [
        model.provider_id || model.provider_name,
        {
          label: model.provider_name || model.provider_id,
          value: model.provider_id || model.provider_name,
        },
      ]),
    ).values(),
  ).filter((option) => option.value);
  const defaultModelOptions = models
    .filter((model) => !defaultProvider || model.provider_id === defaultProvider)
    .map((model) => ({ label: model.display_name || model.id, value: model.id }));
  const visibleAgents = agentVisibilityFilter === 'all'
    ? agents
    : agents.filter((agent) => (agent.visibility || 'private') === agentVisibilityFilter);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.settingsGet({ key: 'settings.agent.defaultProvider' }).catch(() => ({ value: '' })),
      api.settingsGet({ key: 'settings.agent.defaultModel' }).catch(() => ({ value: '' })),
      api.settingsGet({ key: 'settings.agent.defaultEffort' }).catch(() => ({ value: 'medium' })),
    ]).then(([provider, model, effort]) => {
      if (cancelled) return;
      setDefaultProvider(settingResultString(provider));
      setDefaultModel(settingResultString(model));
      setDefaultEffort(settingResultString(effort) || 'medium');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveAgentDefault = async (key: string, value: string) => {
    await api.settingsSet({ key, value });
    message.success(t('settings.general.agentDefaultsSaved'));
  };

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<Globe size={18} />}
        title={t('settings.general.languageTitle')}
        subtitle={t('settings.general.languageDescription')}
        extra={<LanguageSwitcher />}
      >
        {/* Language section content managed by LanguageSwitcher in extra slot */}
        <></>
      </SettingsSection>

      <SettingsSection
        icon={<Cpu size={18} />}
        title={t('settings.general.agentDefaultsTitle')}
        subtitle={t('settings.general.agentDefaultsDescription')}
      >
        <Flexbox gap={12}>
          <Select
            allowClear
            value={defaultProvider || undefined}
            placeholder={t('settings.general.defaultProvider')}
            options={providerOptions}
            onChange={async (value) => {
              const nextProvider = value || '';
              setDefaultProvider(nextProvider);
              setDefaultModel('');
              await saveAgentDefault('settings.agent.defaultProvider', nextProvider);
              await saveAgentDefault('settings.agent.defaultModel', '');
            }}
          />
          <Select
            allowClear
            showSearch
            value={defaultModel || undefined}
            placeholder={t('settings.general.defaultModel')}
            options={defaultModelOptions}
            onChange={async (value) => {
              const nextModel = value || '';
              setDefaultModel(nextModel);
              await saveAgentDefault('settings.agent.defaultModel', nextModel);
            }}
            filterOption={(input, option) =>
              String(option?.label || '').toLowerCase().includes(input.toLowerCase())
            }
          />
          <Select
            value={defaultEffort}
            placeholder={t('settings.general.defaultEffort')}
            options={[
              { label: t('settings.agent.effort.low'), value: 'low' },
              { label: t('settings.agent.effort.medium'), value: 'medium' },
              { label: t('settings.agent.effort.high'), value: 'high' },
            ]}
            onChange={async (value) => {
              setDefaultEffort(value);
              await saveAgentDefault('settings.agent.defaultEffort', value);
            }}
          />
        </Flexbox>
      </SettingsSection>

      <SecuritySection />

      <ChatShortcutSettingsSection />

      <SettingsSection
        icon={<Bot size={18} />}
        title={t('settings.general.agentsTitle')}
        extra={
          <Select
            size="small"
            value={agentVisibilityFilter}
            style={{ minWidth: 140 }}
            options={[
              { label: t('settings.agent.visibility.all'), value: 'all' },
              { label: t('settings.agent.visibility.private'), value: 'private' },
              { label: t('settings.agent.visibility.workspace'), value: 'workspace' },
              { label: t('settings.agent.visibility.public'), value: 'public' },
            ]}
            onChange={setAgentVisibilityFilter}
          />
        }
      >
        {visibleAgents.length === 0 ? (
          <Text type="secondary">{t('settings.general.noAgents')}</Text>
        ) : (
          visibleAgents.map((agent) => <AgentCard key={agent.name} agent={agent} models={models} />)
        )}
      </SettingsSection>
    </SettingsContainer>
  );
}

function ToolsTab() {
  // Tool registry and search-provider list are read via `usePrefetch`
  // so the loader runs during the `pages:prewarm` idle window — by the
  // time the user clicks the Tools tab the cache is typically warm and
  // the panel paints synchronously.
  const { tools, error, loadTools } = useActiveSettingsSlice((s) => ({
    tools: s.tools,
    error: s.error,
    loadTools: s.loadTools,
  }));
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');
  const { value: toolsCache } = usePrefetch('settings.tools', () => loadTools());
  const { value: providersResult, loading: loadingProviders, reload: reloadProviders } = usePrefetch(
    'settings.searchProviders',
    () => api.listSearchProviders(),
  );
  const searchProviders: SearchProviderInfo[] = providersResult?.providers ?? [];
  const [primaryOverride, setPrimaryOverride] = useState<string | null>(null);
  const searchPrimary = primaryOverride ?? providersResult?.primary ?? '';

  // `usePrefetch` reads loadTools()'s return value (void); the side-effect
  // is the store update. Reference `toolsCache` so React/ESLint know we
  // intentionally consume the entry.
  void toolsCache;
  const loadingSP = loadingProviders;

  const handleSetPrimary = async (name: string) => {
    const newPrimary = name === searchPrimary ? '' : name;
    try {
      await api.setSearchPrimary(newPrimary);
      setPrimaryOverride(newPrimary);
      reloadProviders();
      message.success(newPrimary ? t('settings.tools.setPrimarySuccess', { name: newPrimary }) : t('settings.tools.clearPrimarySuccess'));
    } catch {
      message.error(t('settings.tools.setPrimaryFailed'));
    }
  };

  const toolColumns = [
    {
      title: t('settings.tools.columnName'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: t('settings.tools.columnCategory'),
      dataIndex: 'category',
      key: 'category',
      render: (cat: string) => {
        const colorMap: Record<string, string> = {
          filesystem: 'blue',
          shell: 'orange',
          web: 'green',
          memory: 'purple',
          mcp: 'cyan',
          agent: 'geekblue',
        };
        return <Tag color={colorMap[cat] || 'default'}>{cat}</Tag>;
      },
    },
    {
      title: t('settings.tools.columnApproval'),
      dataIndex: 'needs_approval',
      key: 'needs_approval',
      render: (v: boolean) =>
        v ? <Tag color="warning">{t('settings.tools.approvalRequired')}</Tag> : <Tag color="success">{t('settings.tools.approvalAuto')}</Tag>,
    },
  ];

  const configuredCount = searchProviders.filter((p) => p.available).length;

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<Globe size={18} />}
        title={t('settings.tools.searchEnginesTitle')}
        subtitle={t('settings.tools.searchEnginesDescription')}
        extra={
          <Tag color={configuredCount > 0 ? 'success' : 'default'}>
            {t('settings.tools.searchEnginesConfigured', { configured: configuredCount, total: searchProviders.length })}
          </Tag>
        }
      >
        {loadingSP ? (
          <Spin size="small" />
        ) : (
          <Flexbox gap={8}>
            {searchProviders.map((p) => (
              <SettingsItemCard
                key={p.name}
                style={{
                  border: `1px solid ${p.available ? token.colorSuccessBorder : token.colorBorderSecondary}`,
                  background: p.available ? token.colorSuccessBg : undefined,
                  opacity: p.available ? 1 : 0.6,
                  padding: '8px 12px',
                }}
              >
                <Flexbox horizontal align="center" justify="space-between">
                  <Flexbox horizontal align="center" gap={8}>
                    <Text strong style={{ fontSize: 13, textTransform: 'capitalize' }}>{p.name}</Text>
                    {p.available ? (
                      <Tag color="success" style={{ margin: 0 }}>{t('settings.tools.searchActive')}</Tag>
                    ) : (
                      <Tag style={{ margin: 0 }}>{t('settings.tools.searchNotConfigured')}</Tag>
                    )}
                  </Flexbox>
                  <Flexbox horizontal align="center" gap={8}>
                    {p.available && (
                      <Button
                        size="small"
                        type={searchPrimary === p.name ? 'primary' : 'default'}
                        onClick={() => handleSetPrimary(p.name)}
                      >
                        {searchPrimary === p.name ? t('settings.tools.primaryLabel') : t('settings.tools.setPrimary')}
                      </Button>
                    )}
                  </Flexbox>
                </Flexbox>
              </SettingsItemCard>
            ))}
          </Flexbox>
        )}
      </SettingsSection>

      <SettingsSection
        icon={<Wrench size={18} />}
        title={t('settings.tools.toolsTitle', { count: tools.length })}
      >
        {error && (
          <Alert
            type="error"
            showIcon
            message={t('settings.tools.operationFailed')}
            description={error}
            style={{ marginBottom: 12 }}
          />
        )}
        <Table
          dataSource={tools}
          columns={toolColumns}
          rowKey="name"
          size="small"
          pagination={false}
          style={{ borderRadius: 8, overflow: 'hidden' }}
          onRow={(record) => ({ 'data-item-id': record.name } as React.HTMLAttributes<HTMLElement>)}
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

function HelpTab({ highlightId }: { highlightId?: string }) {
  const [groups, setGroups] = useState<HelpCategoryGroup[]>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');

  useEffect(() => {
    api.getHelp().then((g) => {
      setGroups(g);
      setActiveKeys(g.map((gr) => gr.category.id));
    }).catch((e) => log.error('settings', 'Failed to load help', e));
  }, []);

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

  return (
    <SettingsContainer maxWidth={800}>
      <SettingsSection
        icon={<Sparkles size={18} />}
        title={t('settings.help.aboutTitle')}
        subtitle={t('settings.help.aboutDescription')}
        extra={<Tag style={{ fontSize: 11 }}>{t('settings.help.aboutTag')}</Tag>}
        style={{ background: 'linear-gradient(135deg, #667eea15, #764ba215)' }}
      >
        {/* About section — content is in subtitle */}
        <></>
      </SettingsSection>

      <Collapse
        activeKey={activeKeys}
        onChange={(keys) => setActiveKeys(keys as string[])}
        ghost
        items={groups.map((group) => ({
          key: group.category.id,
          label: (
            <Flexbox horizontal align="center" gap={8}>
              {getIcon(group.category.icon, 16)}
              <Text strong style={{ fontSize: 15 }}>{group.category.title}</Text>
              <Tag style={{ fontSize: 11 }}>{group.items.length}</Tag>
            </Flexbox>
          ),
          children: (
            <Flexbox gap={8}>
              {group.category.description && (
                <Text type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
                  {group.category.description}
                </Text>
              )}
              {group.items.map((item) => (
                <Flexbox
                  key={item.id}
                  data-item-id={item.id}
                  horizontal
                  gap={12}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    background: item.source === 'applet' ? token.colorWarningBg : token.colorFillQuaternary,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    transition: 'box-shadow 0.3s, border-color 0.3s',
                  }}
                >
                  <div style={{ color: token.colorPrimary, paddingTop: 2, flexShrink: 0 }}>
                    {getIcon(item.icon, 16) || <HelpCircle size={16} />}
                  </div>
                  <Flexbox gap={4} flex={1}>
                    <Flexbox horizontal align="center" gap={6}>
                      <Text strong style={{ fontSize: 14 }}>{item.title}</Text>
                      {item.source === 'applet' && (
                        <Tag color="orange" style={{ fontSize: 10 }}>{t('settings.help.appletTag')}</Tag>
                      )}
                    </Flexbox>
                    <Text type="secondary" style={{ fontSize: 13, lineHeight: '1.5' }}>
                      {item.description}
                    </Text>
                    {item.usage && (
                      <code
                        style={{
                          fontSize: 12,
                          background: token.colorFillSecondary,
                          padding: '4px 8px',
                          borderRadius: 4,
                          color: token.colorTextSecondary,
                          whiteSpace: 'pre-wrap',
                          display: 'block',
                          marginTop: 4,
                        }}
                      >
                        {item.usage}
                      </code>
                    )}
                  </Flexbox>
                </Flexbox>
              ))}
            </Flexbox>
          ),
        }))}
      />

      <Flexbox
        gap={8}
        style={{
          background: token.colorFillQuaternary,
          borderRadius: 12,
          padding: 16,
          border: `1px dashed ${token.colorBorderSecondary}`,
        }}
      >
        <Flexbox horizontal align="center" gap={6}>
          <Puzzle size={14} style={{ color: token.colorTextSecondary }} />
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
            {t('settings.help.extensionPointTitle')}
          </Text>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('settings.help.extensionPointDescription')}
        </Text>
      </Flexbox>

      <DangerZoneResetOnboarding />
    </SettingsContainer>
  );
}

function DangerZoneResetOnboarding() {
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');
  const [loading, setLoading] = useState(false);

  const handleReset = () => {
    Modal.confirm({
      title: t('settings.danger.confirmTitle'),
      icon: <AlertTriangle size={20} style={{ color: token.colorError }} />,
      content: (
        <Flexbox gap={8}>
          <Text>{t('settings.danger.confirmContent')}</Text>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>{t('settings.danger.confirmItem.session')}</li>
            <li>{t('settings.danger.confirmItem.oauth')}</li>
          </ul>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.danger.confirmNote')}
          </Text>
        </Flexbox>
      ),
      okText: t('settings.danger.confirmOk'),
      cancelText: t('settings.danger.confirmCancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        try {
          await api.resetOnboarding();
          // Clear warm-resume marker so reload lands on onboarding, not ready view
          const { clearWarmResume } = await import('../hooks/useAppLifecycle');
          clearWarmResume();
          message.success(t('settings.danger.resetSuccess'));
          window.location.hash = '';
          window.location.reload();
        } catch (e) {
          message.error(e instanceof Error ? e.message : t('settings.danger.resetFailed'));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  return (
    <Flexbox
      gap={12}
      style={{
        padding: 16,
        borderRadius: 12,
        border: `1px solid ${token.colorErrorBorder}`,
        background: token.colorErrorBg,
      }}
    >
      <Flexbox horizontal align="center" gap={8}>
        <AlertTriangle size={16} style={{ color: token.colorError }} />
        <Text strong style={{ color: token.colorError }}>{t('settings.danger.title')}</Text>
      </Flexbox>
      <Text type="secondary" style={{ fontSize: 13 }}>
        {t('settings.danger.description')}
      </Text>
      <Button
        danger
        icon={<RotateCcw size={14} />}
        loading={loading}
        onClick={handleReset}
      >
        {t('settings.danger.logoutButton')}
      </Button>
    </Flexbox>
  );
}

function AgentCard({
  agent,
  models,
}: {
  agent: Agent;
  models: AvailableModel[];
}) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(agent.description);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const { setDefaultAgent, updateAgent } = useActiveSettingsSlice((s) => ({
    setDefaultAgent: s.setDefaultAgent,
    updateAgent: s.updateAgent,
  }));
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');

  const handleSave = async () => {
    await updateAgent(agent.name, { description: desc });
    setEditing(false);
  };

  const handleDefault = async () => {
    await setDefaultAgent(agent.id);
    message.success(t('settings.agent.defaultSaved'));
  };

  const handleModelSelect = async (model: string, provider: string) => {
    await updateAgent(agent.name, { model, provider });
    setModelPickerOpen(false);
    message.success(t('settings.agent.modelSaved'));
  };

  const handleEffortChange = async (effort: string) => {
    await updateAgent(agent.name, { effort });
    message.success(t('settings.agent.effortSaved'));
  };

  const handleVisibilityChange = async (visibility: string) => {
    await updateAgent(agent.name, { visibility });
    message.success(t('settings.agent.visibilitySaved'));
  };

  const selectedModel = models.find((model) => model.id === agent.model && model.provider_id === agent.provider)
    ?? models.find((model) => model.id === agent.model);
  const modelLabel = selectedModel?.display_name || agent.model || t('settings.agent.defaultModel');

  return (
    <Flexbox
      gap={10}
      style={{
        padding: 16,
        borderRadius: 8,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flexbox horizontal justify="space-between" align="center">
        <Flexbox horizontal gap={8} align="center">
          <Text strong style={{ fontSize: 15 }}>{agent.title || agent.name}</Text>
          {agent.isDefault && <Tag color="green">{t('settings.agent.defaultAgent')}</Tag>}
          <Tag>{modelLabel}</Tag>
          <Tag>{t(`settings.agent.effort.${agent.effort || 'medium'}`)}</Tag>
          <Tag>{t(`settings.agent.visibility.${agent.visibility || 'private'}`)}</Tag>
        </Flexbox>
        <Flexbox horizontal gap={4}>
          {!agent.isDefault && (
            <Button size="small" onClick={handleDefault}>{t('settings.agent.setDefault')}</Button>
          )}
          {editing ? (
            <>
              <Button type="primary" size="small" onClick={handleSave}>{t('settings.agent.save')}</Button>
              <Button size="small" onClick={() => setEditing(false)}>{t('settings.agent.cancel')}</Button>
            </>
          ) : (
            <Button size="small" onClick={() => setEditing(true)}>{t('settings.agent.edit')}</Button>
          )}
        </Flexbox>
      </Flexbox>
      {editing ? (
        <Flexbox gap={10}>
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={t('settings.agent.descriptionPlaceholder')}
          />
          <Flexbox horizontal gap={8} wrap="wrap" align="center">
            <Popover
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
              trigger="click"
              placement="bottomLeft"
              content={(
                <ModelProviderSelect
                  models={models}
                  selectedModelId={agent.model}
                  onSelect={handleModelSelect}
                  onClose={() => setModelPickerOpen(false)}
                />
              )}
            >
              <Button size="small">{modelLabel}</Button>
            </Popover>
            <Select
              size="small"
              value={agent.effort || 'medium'}
              style={{ width: 132 }}
              onChange={handleEffortChange}
              options={[
                { value: 'low', label: t('settings.agent.effort.low') },
                { value: 'medium', label: t('settings.agent.effort.medium') },
                { value: 'high', label: t('settings.agent.effort.high') },
              ]}
            />
            <Select
              size="small"
              value={agent.visibility || 'private'}
              style={{ width: 132 }}
              onChange={handleVisibilityChange}
              options={[
                { value: 'private', label: t('settings.agent.visibility.private') },
                { value: 'workspace', label: t('settings.agent.visibility.workspace') },
              ]}
            />
          </Flexbox>
        </Flexbox>
      ) : (
        <Text type="secondary">{agent.description || t('settings.agent.noDescription')}</Text>
      )}
    </Flexbox>
  );
}
