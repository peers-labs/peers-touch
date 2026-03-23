import { useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Tabs, Tag, Table, Button, Input, Typography, Collapse, Spin, message, theme, Modal } from 'antd';
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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSettingsStore } from '../store/settings';
import { useProviderStore } from '../store/provider';
import { api, type AppletInfo, type HelpCategoryGroup, type SearchProviderInfo, type StatisticsData } from '../services/api';
import { hasSettingsPanel, getAppletFrontend } from '../applets/registry';
import { getModulesWithSettings } from '../modules/registry';
import { PageHeader } from '../components/PageHeader';

const { Title, Text } = Typography;

interface SettingsPageProps {
  activeTab?: string;
  highlightId?: string;
  onNavConsumed?: () => void;
}

/**
 * Scroll an element with [data-item-id="id"] into view and flash-highlight it.
 */
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

export function SettingsPage({ activeTab, highlightId, onNavConsumed }: SettingsPageProps) {
  const { token } = theme.useToken();
  const [currentTab, setCurrentTab] = useState(activeTab || 'providers');

  useEffect(() => {
    if (activeTab) {
      setCurrentTab(activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!highlightId) return;

    // For providers tab: select the provider in the store so the detail panel updates
    if (currentTab === 'providers') {
      useProviderStore.getState().selectProvider(highlightId);
    }

    scrollAndHighlight(highlightId);
    onNavConsumed?.();
  }, [highlightId, currentTab, onNavConsumed]);

  // Build tabs from module registry (self-registered)
  const registryTabs = getModulesWithSettings().map((mod) => {
    const Icon = mod.icon;
    const Panel = mod.settingsPanel!;
    return {
      key: mod.id,
      order: mod.settingsEntry!.order,
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <Icon size={14} />
          {mod.settingsEntry?.label || mod.name}
        </Flexbox>
      ),
      children: <Panel />,
    };
  });

  // Internal tabs that remain in host code
  const localTabs = [
    {
      key: 'statistics',
      order: 50,
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <BarChart3 size={14} />
          Statistics
        </Flexbox>
      ),
      children: <StatisticsTab />,
    },
    {
      key: 'applets',
      order: 60,
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <Puzzle size={14} />
          Applets
        </Flexbox>
      ),
      children: <AppletsSettingsTab />,
    },
    {
      key: 'general',
      order: 70,
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <Settings size={14} />
          General
        </Flexbox>
      ),
      children: <GeneralTab />,
    },
    {
      key: 'tools',
      order: 90,
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <Wrench size={14} />
          Tools
        </Flexbox>
      ),
      children: <ToolsTab />,
    },
    {
      key: 'help',
      order: 100,
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <HelpCircle size={14} />
          Help & About
        </Flexbox>
      ),
      children: <HelpTab highlightId={currentTab === 'help' ? highlightId : undefined} />,
    },
  ];

  const items = [...registryTabs, ...localTabs].sort((a, b) => a.order - b.order);

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      <PageHeader
        title="Settings"
        icon={<Settings size={20} style={{ color: token.colorPrimary }} />}
      />

      <Tabs
        activeKey={currentTab}
        onChange={setCurrentTab}
        items={items}
        style={{ flex: 1, overflow: 'hidden' }}
        tabBarStyle={{ paddingInline: 24, marginBottom: 0 }}
        className="settings-tabs"
      />
    </Flexbox>
  );
}

function AppletsSettingsTab() {
  const [applets, setApplets] = useState<AppletInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const { token } = theme.useToken();

  useEffect(() => {
    api.listApplets().then(setApplets).catch(console.error);
  }, []);

  const SettingsPanel = selected ? getAppletFrontend(selected)?.settingsPanel : undefined;

  if (SettingsPanel) {
    return (
      <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
        <Flexbox
          horizontal
          align="center"
          gap={8}
          style={{
            padding: '12px 24px',
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
            ← Back to Applets
          </div>
        </Flexbox>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SettingsPanel />
        </div>
      </Flexbox>
    );
  }

  return (
    <Flexbox style={{ padding: 24, maxWidth: 700, overflow: 'auto', height: '100%' }} gap={16}>
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" gap={8}>
          <Puzzle size={18} style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>Applet Settings</Title>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Configure installed applets. Each applet may have its own settings panel.
        </Text>
      </Flexbox>

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
                    {applet.status}
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
                <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>No settings</Text>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>

      {applets.length === 0 && (
        <Flexbox align="center" justify="center" gap={8} style={{ padding: 40 }}>
          <Puzzle size={32} style={{ color: token.colorTextQuaternary }} />
          <Text type="secondary">No applets installed</Text>
        </Flexbox>
      )}
    </Flexbox>
  );
}

/* ─── Activity Heatmap ───────────────────────────────────────────────── */

function ActivityHeatmap({ activity }: { activity: { date: string; count: number }[] }) {
  const { token } = theme.useToken();

  const today = new Date();
  const startDate = new Date(today);
  startDate.setFullYear(startDate.getFullYear() - 1);
  // Align to the start of the week (Sunday)
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
        label: d.toLocaleDateString('en', { month: 'short' }),
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
          title={`${dateStr}: ${count} messages`}
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
        {/* Month labels */}
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
        {/* Grid */}
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
          A total of {totalMessages} messages sent in the past year
        </Text>
        <Flexbox horizontal align="center" gap={4}>
          <Text type="secondary" style={{ fontSize: 10 }}>Inactive</Text>
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
          <Text type="secondary" style={{ fontSize: 10 }}>Active</Text>
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
          <Text type="secondary" style={{ fontSize: 12 }}>No Data</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Please accumulate more chat data to view
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
      {/* Header */}
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

  useEffect(() => {
    api.getStatistics().then(setData).catch(console.error);
  }, []);

  if (!data) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 80 }}>
        <Text type="secondary">Loading statistics...</Text>
      </Flexbox>
    );
  }

  const { summary } = data;

  const summaryCards: { label: string; value: string | number; sub?: string; icon: React.ReactNode }[] = [
    {
      label: 'Sessions',
      value: summary.sessions,
      icon: <MessageSquare size={20} style={{ color: token.colorPrimary }} />,
    },
    {
      label: 'Messages',
      value: summary.messages,
      icon: <Hash size={20} style={{ color: '#52c41a' }} />,
    },
    {
      label: 'Total Words',
      value: summary.total_words >= 1000 ? `${(summary.total_words / 1000).toFixed(1)}K` : summary.total_words,
      icon: <Type size={20} style={{ color: '#fa8c16' }} />,
    },
    {
      label: 'Agents',
      value: summary.agents,
      icon: <Bot size={20} style={{ color: '#722ed1' }} />,
    },
  ];

  return (
    <Flexbox style={{ padding: 24, maxWidth: 900, overflow: 'auto', height: '100%' }} gap={20}>
      {/* Header with days count */}
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" gap={8}>
          <Text strong style={{ fontSize: 16 }}>
            This is your <span style={{ color: token.colorPrimary, fontWeight: 700, fontSize: 20 }}>{summary.days_with_us}</span> day with Agent Box
          </Text>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 12 }}>
          First active: {summary.first_date ? new Date(summary.first_date).toLocaleDateString() : 'N/A'}
        </Text>
      </Flexbox>

      {/* Summary cards */}
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

      {/* Activity heatmap */}
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
          <Text strong style={{ fontSize: 15 }}>Activity in the past year</Text>
        </Flexbox>
        <div style={{ overflowX: 'auto' }}>
          <ActivityHeatmap activity={data.activity || []} />
        </div>
      </Flexbox>

      {/* Rank panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <RankList
          title="Model Usage Rank"
          icon={<Cpu size={16} style={{ color: '#1890ff' }} />}
          items={data.model_rank}
          labelHeader="Model"
          valueHeader="Messages"
        />
        <RankList
          title="Agent Usage Rank"
          icon={<Bot size={16} style={{ color: '#722ed1' }} />}
          items={data.agent_rank}
          labelHeader="Agent"
          valueHeader="Messages"
        />
        <RankList
          title="Topic Content Rank"
          icon={<Trophy size={16} style={{ color: '#fa8c16' }} />}
          items={data.topic_rank}
          labelHeader="Topic"
          valueHeader="Messages"
        />
      </div>
    </Flexbox>
  );
}

function GeneralTab() {
  const { agents, loadAgents } = useSettingsStore();
  const { token } = theme.useToken();

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  return (
    <Flexbox style={{ padding: 24, maxWidth: 700, overflow: 'auto' }} gap={24}>
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
          <Title level={5} style={{ margin: 0 }}>Agents</Title>
        </Flexbox>

        {agents.length === 0 ? (
          <Text type="secondary">No agents configured. The default assistant agent will be used.</Text>
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
      message.success(newPrimary ? `Primary search engine set to ${newPrimary}` : 'Primary search engine cleared (auto-detect)');
    } catch {
      message.error('Failed to update');
    }
  };

  const toolColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: 'Category',
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
      title: 'Approval',
      dataIndex: 'needs_approval',
      key: 'needs_approval',
      render: (v: boolean) =>
        v ? <Tag color="warning">Required</Tag> : <Tag color="success">Auto</Tag>,
    },
  ];

  const sectionStyle = {
    background: token.colorBgContainer,
    borderRadius: 12,
    padding: 24,
    border: `1px solid ${token.colorBorderSecondary}`,
  };

  const configuredCount = searchProviders.filter((p) => p.available).length;

  return (
    <Flexbox style={{ padding: 24, maxWidth: 700, height: '100%', overflow: 'auto' }} gap={24}>
      {/* Search Providers */}
      <Flexbox gap={16} style={sectionStyle}>
        <Flexbox horizontal align="center" gap={8}>
          <Globe size={18} style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>Search Engines</Title>
          <Tag color={configuredCount > 0 ? 'success' : 'default'}>
            {configuredCount} / {searchProviders.length} configured
          </Tag>
        </Flexbox>

        <Text type="secondary" style={{ fontSize: 13 }}>
          Search engines are configured via environment variables. Set the corresponding API key to enable a provider.
          The primary provider is tried first; if it fails, others are used as fallback.
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
                    <Tag color="success" style={{ margin: 0 }}>Active</Tag>
                  ) : (
                    <Tag style={{ margin: 0 }}>Not configured</Tag>
                  )}
                </Flexbox>
                <Flexbox horizontal align="center" gap={8}>
                  {p.available && (
                    <Button
                      size="small"
                      type={searchPrimary === p.name ? 'primary' : 'default'}
                      onClick={() => handleSetPrimary(p.name)}
                    >
                      {searchPrimary === p.name ? '★ Primary' : 'Set Primary'}
                    </Button>
                  )}
                </Flexbox>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>

      {/* Tools List */}
      <Flexbox gap={16} style={sectionStyle}>
        <Flexbox horizontal align="center" gap={8}>
          <Wrench size={18} style={{ color: token.colorPrimary }} />
          <Title level={5} style={{ margin: 0 }}>Tools ({tools.length})</Title>
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

  useEffect(() => {
    api.getHelp().then((g) => {
      setGroups(g);
      setActiveKeys(g.map((gr) => gr.category.id));
    }).catch(console.error);
  }, []);

  // When highlightId changes, ensure the category containing it is expanded
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
    <Flexbox style={{ padding: 24, maxWidth: 800, overflow: 'auto', height: '100%' }} gap={20}>
      {/* About card */}
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
          <Title level={5} style={{ margin: 0 }}>Agent Box</Title>
          <Tag style={{ fontSize: 11 }}>dev</Tag>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Your personal AI assistant with file operations, shell commands, web search, multi-agent orchestration, long-term memory, and extensible agent applets.
        </Text>
      </Flexbox>

      {/* Help sections */}
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
                        <Tag color="orange" style={{ fontSize: 10 }}>Applet</Tag>
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

      {/* Applet extension note */}
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
            EXTENSION POINT
          </Text>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Agent Applets can declare help entries in their manifest. When installed, their documentation will automatically appear in the relevant categories above.
        </Text>
      </Flexbox>

      {/* Danger zone: re-enter initialization */}
      <DangerZoneResetOnboarding />
    </Flexbox>
  );
}

function DangerZoneResetOnboarding() {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);

  const handleReset = () => {
    Modal.confirm({
      title: '重新进入初始化状态',
      icon: <AlertTriangle size={20} style={{ color: token.colorError }} />,
      content: (
        <Flexbox gap={8}>
          <Text>将清除以下初始化状态：</Text>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>是否已完成初始化</li>
            <li>向导进度（若使用自定义向导）</li>
          </ul>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Provider、模型、偏好等配置保留在 KV 中，重新初始化时会覆盖。确定继续？
          </Text>
        </Flexbox>
      ),
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        try {
          await api.resetOnboarding();
          message.success('已重置，即将刷新页面');
          window.location.reload();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '重置失败');
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
        <Text strong style={{ color: token.colorError }}>危险操作</Text>
      </Flexbox>
      <Text type="secondary" style={{ fontSize: 13 }}>
        重新进入初始化向导，用于验证配置或重新完成初始化流程。
      </Text>
      <Button
        danger
        icon={<RotateCcw size={14} />}
        loading={loading}
        onClick={handleReset}
      >
        重新进入初始化状态
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
          <Tag>{agent.model || 'default'}</Tag>
        </Flexbox>
        {editing ? (
          <Flexbox horizontal gap={4}>
            <Button type="primary" size="small" onClick={handleSave}>Save</Button>
            <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
          </Flexbox>
        ) : (
          <Button size="small" onClick={() => setEditing(true)}>Edit</Button>
        )}
      </Flexbox>
      {editing ? (
        <Input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Agent description"
        />
      ) : (
        <Text type="secondary">{agent.description || 'No description'}</Text>
      )}
    </Flexbox>
  );
}
