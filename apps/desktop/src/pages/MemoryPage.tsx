import { useCallback, useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Badge,
  Button,
  Card,
  Empty,
  Input,
  message,
  Pagination,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  Brain,
  Search,
  User,
  Activity,
  Trash2,
  Clock,
  Database,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { ConfigBadge } from '../components/ConfigBadge';
import {
  api,
  type Agent,
  type Memory,
  type MemoryStats,
  type Persona,
  type ScoredMemory,
  type MemoryEvent,
} from '../services/api';
import { useChatStore } from '../store/chat';

const { Text } = Typography;

const LAYERS = ['identity', 'context', 'experience', 'preference', 'activity'] as const;
const LAYER_COLORS: Record<string, string> = {
  identity: 'blue',
  context: 'green',
  experience: 'orange',
  preference: 'purple',
  activity: 'cyan',
};
const TIME_WINDOWS = [
  { value: '', label: 'All time' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7d' },
  { value: '30d', label: 'Last 30d' },
  { value: '90d', label: 'Last 90d' },
] as const;
type TimeWindowValue = (typeof TIME_WINDOWS)[number]['value'];
type BrowseViewMode = 'list' | 'timeline';
type TimelineGroupBy = 'day' | 'week' | 'month';

function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function formatTimelineHeader(date: Date, groupBy: TimelineGroupBy): string {
  if (groupBy === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  if (groupBy === 'week') {
    const start = new Date(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  }
  return date.toLocaleDateString();
}

function timelineGroupKey(iso: string, groupBy: TimelineGroupBy): string {
  const date = new Date(iso);
  if (groupBy === 'month') {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }
  if (groupBy === 'week') {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-w${weekNo}`;
  }
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function groupMemoriesByPeriod(memories: Memory[], groupBy: TimelineGroupBy): Array<{ key: string; label: string; items: Memory[] }> {
  const map = new Map<string, { label: string; items: Memory[]; ts: number }>();
  for (const memory of memories) {
    const key = timelineGroupKey(memory.created_at, groupBy);
    const date = new Date(memory.created_at);
    const existing = map.get(key);
    if (existing) {
      existing.items.push(memory);
    } else {
      map.set(key, {
        label: formatTimelineHeader(date, groupBy),
        items: [memory],
        ts: date.getTime(),
      });
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1].ts - a[1].ts)
    .map(([key, value]) => ({
      key,
      label: value.label,
      items: value.items.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    }));
}

export function MemoryPage() {
  const { token } = theme.useToken();
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const s = await api.getMemoryStats();
      setStats(s);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return (
    <Flexbox gap={0} style={{ height: '100%', overflow: 'hidden' }}>
      <PageHeader
        title="Memory System"
        subtitle="Browse, search, and manage agent memories across layers."
        icon={<Brain size={20} />}
        extra={<ConfigBadge section="memory" label="Memory" />}
        actions={<>
          {statsLoading ? (
            <Spin size="small" />
          ) : stats ? (
            <>
              <Badge
                count={stats.total}
                showZero
                style={{ backgroundColor: token.colorPrimary }}
              >
                <span style={{ marginRight: 8, fontSize: 13 }}>Memories</span>
              </Badge>
              <Flexbox horizontal align="center" gap={4}>
                <Database size={14} style={{ color: token.colorTextSecondary }} />
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {formatStorage(stats.storage_bytes)}
                </Text>
              </Flexbox>
            </>
          ) : null}
        </>}
      />

      {/* Tabs */}
      <Flexbox flex={1} style={{ overflow: 'hidden', padding: 24 }}>
        <Tabs
          defaultActiveKey="browse"
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          items={[
            {
              key: 'browse',
              label: (
                <Flexbox horizontal align="center" gap={6}>
                  <Brain size={14} />
                  Browse
                </Flexbox>
              ),
              children: <BrowseTab onDelete={loadStats} />,
            },
            {
              key: 'search',
              label: (
                <Flexbox horizontal align="center" gap={6}>
                  <Search size={14} />
                  Search
                </Flexbox>
              ),
              children: <SearchTab />,
            },
            {
              key: 'persona',
              label: (
                <Flexbox horizontal align="center" gap={6}>
                  <User size={14} />
                  Persona
                </Flexbox>
              ),
              children: <PersonaTab />,
            },
            {
              key: 'events',
              label: (
                <Flexbox horizontal align="center" gap={6}>
                  <Activity size={14} />
                  Events
                </Flexbox>
              ),
              children: <EventsTab />,
            },
          ]}
        />
      </Flexbox>
    </Flexbox>
  );
}

/* ─── Browse Tab ─── */

function BrowseTab({ onDelete }: { onDelete: () => void }) {
  const { token } = theme.useToken();
  const { agents, loadAgents } = useChatStore();
  const [layer, setLayer] = useState<string | undefined>();
  const [agentFilter, setAgentFilter] = useState<string | undefined>();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [timeWindow, setTimeWindow] = useState<TimeWindowValue>('30d');
  const [viewMode, setViewMode] = useState<BrowseViewMode>('list');
  const [groupBy, setGroupBy] = useState<TimelineGroupBy>('day');
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 20;

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page: page - 1,
        page_size: pageSize,
        order_by: 'created_at',
      };
      if (layer) params.layer = layer;
      if (agentFilter) params.agent_id = agentFilter;
      if (timeWindow) params.period = timeWindow;
      const res = await api.listMemories(params);
      setMemories(res.memories || []);
      setTotal(res.total);
    } catch {
      setMemories([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [layer, page, agentFilter, timeWindow]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteMemory(id);
      message.success('Memory deleted');
      load();
      onDelete();
    } catch (err: unknown) {
      message.error(
        err instanceof Error ? err.message : 'Failed to delete memory',
      );
    }
  };

  const renderMemoryCard = (m: Memory) => (
    <Card
      key={m.id}
      size="small"
      hoverable
      style={{ cursor: 'pointer' }}
      onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
    >
      <Flexbox horizontal align="flex-start" justify="space-between">
        <Flexbox flex={1} gap={4}>
          <Flexbox horizontal align="center" gap={8}>
            <Tag color={LAYER_COLORS[m.layer] || 'default'}>
              {m.layer}
            </Tag>
            <Tag color="default">{m.source}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDate(m.created_at)}
            </Text>
            <Flexbox horizontal align="center" gap={4}>
              <Clock size={12} style={{ color: token.colorTextTertiary }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {m.access_count} accesses
              </Text>
            </Flexbox>
          </Flexbox>
          <Text style={{ fontSize: 13 }}>{m.summary || '(no summary)'}</Text>
          {expandedId === m.id && (
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                background: token.colorFillQuaternary,
                borderRadius: 8,
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 200,
              }}
            >
              {JSON.stringify(m.content, null, 2)}
            </pre>
          )}
        </Flexbox>
        <Popconfirm
          title="Delete this memory?"
          onConfirm={(e) => {
            e?.stopPropagation();
            handleDelete(m.id);
          }}
          onCancel={(e) => e?.stopPropagation()}
        >
          <Button
            size="small"
            danger
            icon={<Trash2 size={14} />}
            onClick={(e) => e.stopPropagation()}
          />
        </Popconfirm>
      </Flexbox>
    </Card>
  );

  const timelineGroups = groupMemoriesByPeriod(memories, groupBy);
  const primaryTint = `${token.colorPrimary}1A`;
  const primaryBorder = `${token.colorPrimary}66`;
  const layerChipStyle = (selected: boolean) => ({
    height: 28,
    padding: '0 12px',
    borderRadius: 999,
    border: `1px solid ${selected ? primaryBorder : token.colorBorderSecondary}`,
    background: selected ? primaryTint : token.colorBgContainer,
    color: selected ? token.colorPrimary : token.colorText,
    fontSize: 13,
    lineHeight: '26px',
    fontWeight: 500,
    letterSpacing: 0.1,
    cursor: 'pointer',
    userSelect: 'none' as const,
    boxShadow: selected ? `0 0 0 1px ${token.colorPrimaryBorder}` : 'none',
    transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease',
  });
  const handleLayerKeyDown = (e: React.KeyboardEvent<HTMLElement>, value?: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    setLayer(value);
    setPage(1);
  };

  return (
    <Flexbox gap={16} style={{ height: '100%', overflow: 'auto' }}>
      {/* Agent + Layer filters */}
      <Flexbox horizontal gap={12} align="center" style={{ flexWrap: 'wrap' }}>
        <Select
          placeholder="All agents"
          value={agentFilter}
          onChange={(v) => { setAgentFilter(v); setPage(1); }}
          allowClear
          onClear={() => { setAgentFilter(undefined); setPage(1); }}
          style={{ minWidth: 160 }}
          size="small"
          options={agents.map((a: Agent) => ({
            value: a.name,
            label: (
              <Flexbox horizontal align="center" gap={6}>
                <span>{a.avatar || '🤖'}</span>
                <span>{a.title || a.name}</span>
              </Flexbox>
            ),
          }))}
        />
        <Select
          value={timeWindow}
          onChange={(v) => { setTimeWindow(v as TimeWindowValue); setPage(1); }}
          style={{ minWidth: 140 }}
          size="small"
          options={TIME_WINDOWS.map((item) => ({ value: item.value, label: item.label }))}
        />
        <Select
          value={viewMode}
          onChange={(v) => setViewMode(v as BrowseViewMode)}
          style={{ minWidth: 120 }}
          size="small"
          options={[
            { value: 'list', label: 'List' },
            { value: 'timeline', label: 'Timeline' },
          ]}
        />
        {viewMode === 'timeline' && (
          <Select
            value={groupBy}
            onChange={(v) => setGroupBy(v as TimelineGroupBy)}
            style={{ minWidth: 120 }}
            size="small"
            options={[
              { value: 'day', label: 'By Day' },
              { value: 'week', label: 'By Week' },
              { value: 'month', label: 'By Month' },
            ]}
          />
        )}
      </Flexbox>
      <Flexbox horizontal gap={10} wrap="wrap">
        <span
          role="button"
          tabIndex={0}
          style={layerChipStyle(layer === undefined)}
          onClick={() => setLayer(undefined)}
          onKeyDown={(e) => handleLayerKeyDown(e, undefined)}
        >
          All
        </span>
        {LAYERS.map((l) => (
          <span
            key={l}
            role="button"
            tabIndex={0}
            style={layerChipStyle(layer === l)}
            onClick={() => {
              setLayer(l);
              setPage(1);
            }}
            onKeyDown={(e) => handleLayerKeyDown(e, l)}
          >
            {l}
          </span>
        ))}
      </Flexbox>

      {/* Memory list */}
      {loading ? (
        <Flexbox align="center" justify="center" style={{ padding: 48 }}>
          <Spin size="large" />
        </Flexbox>
      ) : memories.length === 0 ? (
        <Empty
          description="No memories found"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <Flexbox gap={8}>
          {viewMode === 'list' ? memories.map(renderMemoryCard) : timelineGroups.map((group) => (
            <Flexbox key={group.key} gap={8}>
              <Text strong style={{ fontSize: 13 }}>
                {group.label} ({group.items.length})
              </Text>
              {group.items.map(renderMemoryCard)}
            </Flexbox>
          ))}
          {total > pageSize && (
            <Pagination
              current={page}
              total={total}
              pageSize={pageSize}
              showSizeChanger={false}
              onChange={setPage}
            />
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
}

/* ─── Search Tab ─── */

function SearchTab() {
  const { agents, loadAgents } = useChatStore();
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState<string | undefined>();
  const [timeWindow, setTimeWindow] = useState<TimeWindowValue>('30d');
  const [results, setResults] = useState<ScoredMemory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await api.searchMemories(
        query.trim(),
        undefined,
        20,
        agentFilter,
        timeWindow ? { period: timeWindow } : undefined,
      );
      setResults(res.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, agentFilter, timeWindow]);

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal gap={8}>
        <Input.Search
          placeholder="Search memories..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={handleSearch}
          enterButton="Search"
          style={{ maxWidth: 400 }}
        />
        <Select
          placeholder="All agents"
          value={agentFilter}
          onChange={setAgentFilter}
          allowClear
          onClear={() => setAgentFilter(undefined)}
          style={{ minWidth: 150 }}
          options={agents.map((a: Agent) => ({
            value: a.name,
            label: `${a.avatar || '🤖'} ${a.title || a.name}`,
          }))}
        />
        <Select
          value={timeWindow}
          onChange={(v) => setTimeWindow(v as TimeWindowValue)}
          style={{ minWidth: 140 }}
          options={TIME_WINDOWS.map((item) => ({ value: item.value, label: item.label }))}
        />
      </Flexbox>
      {loading ? (
        <Flexbox align="center" justify="center" style={{ padding: 48 }}>
          <Spin size="large" />
        </Flexbox>
      ) : results.length === 0 && query ? (
        <Empty description="No results" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Flexbox gap={8}>
          {results.map(({ memory, score, explain }) => (
            <Card key={memory.id} size="small">
              <Flexbox gap={4}>
                <Flexbox horizontal align="center" gap={8}>
                  <Tag color={LAYER_COLORS[memory.layer] || 'default'}>
                    {memory.layer}
                  </Tag>
                  <Tag color="blue">score: {(score * 100).toFixed(0)}%</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDate(memory.created_at)}
                  </Text>
                </Flexbox>
                <Text>{memory.summary || '(no summary)'}</Text>
                {explain && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {`V:${(explain.vector_score * 100).toFixed(0)}% `}
                    {`K:${(explain.keyword_score * 100).toFixed(0)}% `}
                    {`W:${(explain.weighted_score * 100).toFixed(0)}% `}
                    {`D:${(explain.decay_factor ?? 1).toFixed(2)} `}
                    {`R:${((explain.after_rerank ?? explain.final_score) * 100).toFixed(0)}% `}
                    {`F:${(explain.final_score * 100).toFixed(0)}%`}
                  </Text>
                )}
              </Flexbox>
            </Card>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
}

/* ─── Persona Tab ─── */

function PersonaTab() {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPersona();
      setPersona(res.persona);
    } catch {
      setPersona(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 48 }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  if (!persona) {
    return (
      <Empty
        description="No persona data yet"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          Persona is derived from identity-layer memories. Chat with agents to
          build up your persona over time.
        </Text>
        <Flexbox horizontal align="center" gap={8} style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Refresh is not yet implemented — persona updates automatically.
          </Text>
          <Button size="small" icon={<RefreshCw size={14} />} onClick={load}>
            Refresh
          </Button>
        </Flexbox>
      </Empty>
    );
  }

  return (
    <Flexbox gap={16}>
      <Card title="Tagline" size="small">
        <Text>{persona.tagline || '(empty)'}</Text>
      </Card>
      <Card title="Narrative" size="small">
        <Text style={{ whiteSpace: 'pre-wrap' }}>
          {persona.narrative || '(empty)'}
        </Text>
      </Card>
      <Flexbox horizontal align="center" gap={8}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Updated: {formatDate(persona.updated_at)}
        </Text>
        <Button size="small" icon={<RefreshCw size={14} />} onClick={load}>
          Refresh
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

/* ─── Events Tab ─── */

function EventsTab() {
  const { agents, loadAgents } = useChatStore();
  const [agentFilter, setAgentFilter] = useState<string | undefined>();
  const [timeWindow, setTimeWindow] = useState<TimeWindowValue>('24h');
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMemoryEvents({
        limit: 50,
        agent_id: agentFilter,
        period: timeWindow || undefined,
      });
      setEvents(res.events || []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [agentFilter, timeWindow]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox horizontal align="center" gap={8}>
          <Text type="secondary">Event log (auto-refresh every 10s)</Text>
          <Select
            placeholder="All agents"
            value={agentFilter}
            onChange={setAgentFilter}
            allowClear
            onClear={() => setAgentFilter(undefined)}
            style={{ minWidth: 150 }}
            size="small"
            options={agents.map((a: Agent) => ({
              value: a.name,
              label: `${a.avatar || '🤖'} ${a.title || a.name}`,
            }))}
          />
          <Select
            value={timeWindow}
            onChange={(v) => setTimeWindow(v as TimeWindowValue)}
            style={{ minWidth: 140 }}
            size="small"
            options={TIME_WINDOWS.map((item) => ({ value: item.value, label: item.label }))}
          />
        </Flexbox>
        <Button size="small" icon={<RefreshCw size={14} />} onClick={load} loading={loading}>
          Refresh
        </Button>
      </Flexbox>
      {loading && events.length === 0 ? (
        <Flexbox align="center" justify="center" style={{ padding: 48 }}>
          <Spin size="large" />
        </Flexbox>
      ) : events.length === 0 ? (
        <Empty description="No events yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          size="small"
          dataSource={events}
          rowKey="id"
          pagination={{ pageSize: 20 }}
          columns={[
            {
              title: 'Type',
              dataIndex: 'type',
              key: 'type',
              width: 120,
              render: (t: string) => <Tag>{t}</Tag>,
            },
            {
              title: 'Layer',
              dataIndex: 'layer',
              key: 'layer',
              width: 100,
              render: (l: string) => (
                <Tag color={LAYER_COLORS[l] || 'default'}>{l}</Tag>
              ),
            },
            {
              title: 'Latency',
              dataIndex: 'latency_ms',
              key: 'latency_ms',
              width: 90,
              render: (ms: number) =>
                ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`,
            },
            {
              title: 'Detail',
              key: 'detail',
              render: (_, event: MemoryEvent) => {
                const detail = event.detail || {};
                if (event.type === 'retrieval') {
                  const query = typeof detail.query === 'string' ? detail.query : '';
                  const hitCount = typeof detail.result_count === 'number' ? detail.result_count : undefined;
                  const topHits = Array.isArray(detail.top_hits) ? detail.top_hits.length : 0;
                  const q = query.length > 30 ? `${query.slice(0, 30)}...` : query;
                  return (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {`q:${q || '-'} · hits:${hitCount ?? 0}${topHits > 0 ? ` · top:${topHits}` : ''}`}
                    </Text>
                  );
                }
                return (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {Object.keys(detail).length > 0 ? 'has detail' : '-'}
                  </Text>
                );
              },
            },
            {
              title: 'Timestamp',
              dataIndex: 'timestamp',
              key: 'timestamp',
              render: (ts: string) => formatDate(ts),
            },
          ]}
        />
      )}
    </Flexbox>
  );
}
