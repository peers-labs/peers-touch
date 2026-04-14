import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Tag, Table, Input, Typography, Collapse, Spin, message, theme, Modal } from 'antd';
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
  Database,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSettingsStore } from '../store/settings';
import { useProviderStore } from '../store/provider';
import { api, type AppletInfo, type HelpCategoryGroup, type SearchProviderInfo, type StatisticsData } from '../services/desktop_api';
import { hasSettingsPanel, getAppletFrontend } from '../applets/registry';
import { getModulesWithSettings } from '../modules/registry';
import { PageHeader } from '../components/PageHeader';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';
import { log } from '../utils/logger';

const { Title, Text } = Typography;

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

interface SectionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  order: number;
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
      render: () => {
        const Panel = mod.settingsPanel!;
        return <Panel />;
      },
    }));

    const localSections: SectionDef[] = [
      {
        key: 'statistics',
        label: t('settings.tab.statistics'),
        icon: BarChart3,
        order: 50,
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
        render: () => <ToolsTab />,
      },
      {
        key: 'help',
        label: t('settings.tab.help'),
        icon: HelpCircle,
        order: 100,
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
        sectionKeys: ['account', 'general'],
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
    const knownKeys = new Set([...allSections, 'statistics', 'applets', 'general', 'tools', 'help']);
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

  // Sections that have been mounted at least once — kept alive via display:none
  const mountedSections = useRef(new Set<string>(['account']));

  const groupSections = useMemo(() => {
    const groupDef = groups.find((g) => g.key === activeGroup);
    if (!groupDef) return [];
    return groupDef.sectionKeys
      .map((key) => sections.find((s) => s.key === key))
      .filter((s): s is SectionDef => !!s);
  }, [activeGroup, groups, sections]);

  const showSidebar = groupSections.length > 1;

  // Keep activeSection valid when switching groups
  useEffect(() => {
    const groupDef = groups.find((g) => g.key === activeGroup);
    if (!groupDef) return;
    if (!groupDef.sectionKeys.includes(activeSection)) {
      setActiveSection(groupDef.sectionKeys[0]);
    }
  }, [activeGroup, activeSection, groups]);

  // Track mounted sections for keep-alive
  mountedSections.current.add(activeSection);

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
    setActiveGroup(groupKey);
    const groupDef = groups.find((g) => g.key === groupKey);
    if (groupDef) {
      setActiveSection(groupDef.sectionKeys[0]);
    }
  }, [groups]);

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
                  onClick={() => setActiveSection(section.key)}
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

        {/* Section content — keep-alive: mount on first visit, hide with display:none */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            scrollBehavior: 'smooth',
          }}
        >
          {sections.map((section) => {
            if (!mountedSections.current.has(section.key)) return null;
            const isActive = activeSection === section.key;
            return (
              <div key={section.key} style={{ display: isActive ? 'block' : 'none', height: '100%' }}>
                {section.render(isActive ? highlightId : undefined)}
              </div>
            );
          })}
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
    <Flexbox style={{ maxWidth: 700, padding: 24 }} gap={16}>
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
    </Flexbox>
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
  const [data, setData] = useState<StatisticsData | null>(null);
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');

  useEffect(() => {
    api.getStatistics().then(setData).catch((e) => log.error('settings', 'Failed to load statistics', e));
  }, []);

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
    <Flexbox style={{ maxWidth: 900, padding: 24 }} gap={20}>
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

      <Flexbox
        gap={8}
        style={{
          background: token.colorBgContainer,
          borderRadius: 12,
          padding: 20,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          <ActivityIcon size={16} style={{ color: token.colorPrimary }} />
          <Text strong style={{ fontSize: 15 }}>{t('settings.statistics.activityTitle')}</Text>
        </Flexbox>
        <div style={{ overflowX: 'auto' }}>
          <ActivityHeatmap activity={data.activity || []} />
        </div>
      </Flexbox>

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
    </Flexbox>
  );
}

function GeneralTab() {
  const { agents, loadAgents } = useSettingsStore();
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  return (
    <Flexbox style={{ maxWidth: 700, padding: 24 }} gap={24}>
      <Flexbox
        gap={16}
        style={{
          background: token.colorBgContainer,
          borderRadius: 12,
          padding: 24,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flexbox horizontal align="center" justify="space-between">
          <Flexbox horizontal align="center" gap={8}>
            <Globe size={18} style={{ color: token.colorPrimary }} />
            <Title level={5} style={{ margin: 0 }}>{t('settings.general.languageTitle')}</Title>
          </Flexbox>
          <LanguageSwitcher />
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('settings.general.languageDescription')}
        </Text>
      </Flexbox>

      <Flexbox
        gap={16}
        style={{
          background: token.colorBgContainer,
          borderRadius: 12,
          padding: 24,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          <Bot size={18} style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>{t('settings.general.agentsTitle')}</Title>
        </Flexbox>

        {agents.length === 0 ? (
          <Text type="secondary">{t('settings.general.noAgents')}</Text>
        ) : (
          agents.map((agent) => <AgentCard key={agent.name} agent={agent} />)
        )}
      </Flexbox>
    </Flexbox>
  );
}

function ToolsTab() {
  const { tools, loadTools } = useSettingsStore();
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');
  const [searchProviders, setSearchProviders] = useState<SearchProviderInfo[]>([]);
  const [searchPrimary, setSearchPrimary] = useState('');
  const [loadingSP, setLoadingSP] = useState(true);

  useEffect(() => {
    loadTools();
    api.listSearchProviders().then((r) => {
      setSearchProviders(r.providers || []);
      setSearchPrimary(r.primary || '');
    }).catch(() => {}).finally(() => setLoadingSP(false));
  }, [loadTools]);

  const handleSetPrimary = async (name: string) => {
    const newPrimary = name === searchPrimary ? '' : name;
    try {
      await api.setSearchPrimary(newPrimary);
      setSearchPrimary(newPrimary);
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
    <Flexbox style={{ maxWidth: 700, padding: 24 }} gap={24}>
      <Flexbox gap={16}>
        <Flexbox horizontal align="center" gap={8}>
          <Globe size={18} style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>{t('settings.tools.searchEnginesTitle')}</Title>
          <Tag color={configuredCount > 0 ? 'success' : 'default'}>
            {t('settings.tools.searchEnginesConfigured', { configured: configuredCount, total: searchProviders.length })}
          </Tag>
        </Flexbox>

        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('settings.tools.searchEnginesDescription')}
        </Text>

        {loadingSP ? (
          <Spin size="small" />
        ) : (
          <Flexbox gap={8}>
            {searchProviders.map((p) => (
              <Flexbox
                key={p.name}
                horizontal
                align="center"
                justify="space-between"
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${p.available ? token.colorSuccessBorder : token.colorBorderSecondary}`,
                  background: p.available ? token.colorSuccessBg : token.colorFillQuaternary,
                  opacity: p.available ? 1 : 0.6,
                }}
              >
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
            ))}
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox gap={16}>
        <Flexbox horizontal align="center" gap={8}>
          <Wrench size={18} style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>{t('settings.tools.toolsTitle', { count: tools.length })}</Title>
        </Flexbox>

        <Table
          dataSource={tools}
          columns={toolColumns}
          rowKey="name"
          size="small"
          pagination={false}
          style={{ borderRadius: 8, overflow: 'hidden' }}
          onRow={(record) => ({ 'data-item-id': record.name } as React.HTMLAttributes<HTMLElement>)}
        />
      </Flexbox>
    </Flexbox>
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
    <Flexbox style={{ maxWidth: 800, padding: 24 }} gap={20}>
      <Flexbox
        gap={8}
        style={{
          background: 'linear-gradient(135deg, #667eea15, #764ba215)',
          borderRadius: 12,
          padding: 20,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          <Sparkles size={18} style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>{t('settings.help.aboutTitle')}</Title>
          <Tag style={{ fontSize: 11 }}>{t('settings.help.aboutTag')}</Tag>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('settings.help.aboutDescription')}
        </Text>
      </Flexbox>

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
    </Flexbox>
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
          message.success(t('settings.danger.resetSuccess'));
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
}: {
  agent: { name: string; title?: string; description: string; model: string; systemPrompt?: string; system_prompt?: string };
}) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(agent.description);
  const { updateAgent } = useSettingsStore();
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');

  const handleSave = async () => {
    await updateAgent(agent.name, { description: desc });
    setEditing(false);
  };

  return (
    <Flexbox
      gap={8}
      style={{
        padding: 16,
        borderRadius: 8,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flexbox horizontal justify="space-between" align="center">
        <Flexbox horizontal gap={8} align="center">
          <Text strong style={{ fontSize: 15 }}>{agent.name}</Text>
          <Tag>{agent.model || t('settings.agent.defaultModel')}</Tag>
        </Flexbox>
        {editing ? (
          <Flexbox horizontal gap={4}>
            <Button type="primary" size="small" onClick={handleSave}>{t('settings.agent.save')}</Button>
            <Button size="small" onClick={() => setEditing(false)}>{t('settings.agent.cancel')}</Button>
          </Flexbox>
        ) : (
          <Button size="small" onClick={() => setEditing(true)}>{t('settings.agent.edit')}</Button>
        )}
      </Flexbox>
      {editing ? (
        <Input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t('settings.agent.descriptionPlaceholder')}
        />
      ) : (
        <Text type="secondary">{agent.description || t('settings.agent.noDescription')}</Text>
      )}
    </Flexbox>
  );
}
