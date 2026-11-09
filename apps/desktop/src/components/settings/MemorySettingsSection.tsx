import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  ConfirmAction,
  DataTable,
  Dialog,
  Empty,
  Flex,
  Icon,
  IconButton,
  Pagination,
  Segmented,
  Select,
  Spin,
  Tag,
  Text,
  TextArea,
  TextField,
  type IconId,
  type TableColumn,
  type Tone,
} from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import {
  api,
  type Agent,
  type Memory,
  type MemoryStats,
  type Persona,
  type ScoredMemory,
  type MemoryEvent,
} from '../../services/desktop_api';
import { useAgentStore } from '../../store/agent';
import { AgentIconTile } from '../agent/AgentIconTile';
import { PageColumn } from '../../layout/PageColumn';
import { MemorySettingsTab } from './MemorySettingsTab';
import { notifyError, notifySuccess } from '../../ui/feedback';

const LAYERS = ['identity', 'context', 'experience', 'preference', 'activity'] as const;
const LAYER_TONES: Record<string, Tone> = {
  identity: 'info',
  context: 'success',
  experience: 'warning',
  preference: 'neutral',
  activity: 'info',
};
const TIME_WINDOW_VALUES = ['', '24h', '7d', '30d', '90d'] as const;
const TIME_WINDOW_LABEL_KEYS: Record<string, string> = {
  '': 'memory.time.allTime',
  '24h': 'memory.time.last24h',
  '7d': 'memory.time.last7d',
  '30d': 'memory.time.last30d',
  '90d': 'memory.time.last90d',
};
type TimeWindowValue = (typeof TIME_WINDOW_VALUES)[number];
type BrowseViewMode = 'list' | 'timeline';
type TimelineGroupBy = 'day' | 'week' | 'month';
type MemoryTabKey = 'browse' | 'search' | 'persona' | 'events' | 'configuration';

const MEMORY_TABS: ReadonlyArray<{ key: MemoryTabKey; icon: IconId; labelKey: string }> = [
  { key: 'browse', icon: 'brain', labelKey: 'memory.tab.browse' },
  { key: 'search', icon: 'search', labelKey: 'memory.tab.search' },
  { key: 'persona', icon: 'user', labelKey: 'memory.tab.persona' },
  { key: 'events', icon: 'activity', labelKey: 'memory.tab.events' },
  { key: 'configuration', icon: 'sliders-horizontal', labelKey: 'memory.tab.configuration' },
];

type Translate = (key: string, options?: Record<string, unknown>) => string;

function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string, t: Translate): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return t('memory.time.justNow');
  if (diffMins < 60) return t('memory.time.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('memory.time.hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('memory.time.daysAgo', { count: diffDays });
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

function layerTone(layer: string): Tone {
  return LAYER_TONES[layer] ?? 'neutral';
}

function timeWindowOptions(t: Translate) {
  return TIME_WINDOW_VALUES.map((value) => ({
    value,
    label: t(TIME_WINDOW_LABEL_KEYS[value]),
  }));
}

function agentOptions(agents: Agent[]) {
  return agents.map((agent) => ({
    value: agent.name,
    label: agent.title || agent.name,
    leading: <AgentIconTile agent={agent} size={18} subtle />,
  }));
}

export function MemorySettingsSection() {
  const { t } = useTranslation('memory');
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [mutationVersion, setMutationVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<MemoryTabKey>('browse');

  const notifyMutation = useCallback(() => setMutationVersion((v) => v + 1), []);

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
  }, [loadStats, mutationVersion]);

  return (
    <div
      data-pt-memory-settings
      className="sc-memory"
    >
      <PageColumn
        tier="standard"
        style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0, height: '100%' }}
      >
        <header className="sc-memory__header">
          <div className="sc-memory__heading">
            <Text strong style={{ fontSize: 18 }}>{t('memory.header.title')}</Text>
            <Text tone="secondary" style={{ fontSize: 13 }}>
              {t('memory.header.subtitle')}
            </Text>
          </div>
          <div className="sc-memory__stats">
            {statsLoading ? (
              <Spin active size="small" />
            ) : stats ? (
              <>
                <Badge count={stats.total} showZero tone="info">
                  <span className="sc-memory__badge-label">{t('memory.header.memoriesLabel')}</span>
                </Badge>
                <span className="sc-memory__storage">
                  <Icon iconId="database" size={14} />
                  <Text tone="secondary" style={{ fontSize: 13 }}>
                    {formatStorage(stats.storage_bytes)}
                  </Text>
                </span>
              </>
            ) : null}
          </div>
        </header>

        <Segmented<MemoryTabKey>
          className="sc-memory__tabs"
          value={activeTab}
          onValueChange={(value) => {
            if (value) setActiveTab(value);
          }}
          options={MEMORY_TABS.map((tab) => ({
            value: tab.key,
            label: t(tab.labelKey),
            leading: <Icon iconId={tab.icon} size={14} />,
          }))}
        />

        <div className="sc-memory__panel">
          {activeTab === 'browse' && <BrowseTab onDelete={loadStats} onMutate={notifyMutation} />}
          {activeTab === 'search' && <SearchTab mutationVersion={mutationVersion} onMutate={notifyMutation} />}
          {activeTab === 'persona' && <PersonaTab />}
          {activeTab === 'events' && <EventsTab mutationVersion={mutationVersion} />}
          {activeTab === 'configuration' && <MemorySettingsTab />}
        </div>
      </PageColumn>
    </div>
  );
}

/* ─── Browse Tab ─── */

function BrowseTab({ onDelete, onMutate }: { onDelete: () => void; onMutate: () => void }) {
  const { t } = useTranslation('memory');
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
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
  const [editing, setEditing] = useState<Memory | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
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
      notifySuccess(t('memory.browse.deleteSuccess'));
      load();
      onDelete();
      onMutate();
    } catch (err: unknown) {
      notifyError(err instanceof Error ? err.message : t('memory.browse.deleteFailed'));
    }
  };

  const openEdit = (memory: Memory) => {
    setEditing(memory);
    setEditContent(
      typeof memory.content === 'string'
        ? memory.content
        : JSON.stringify(memory.content, null, 2),
    );
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateMemory(editing.id, editContent);
      notifySuccess(t('memory.browse.editSuccess'));
      setEditing(null);
      load();
      onMutate();
    } catch (err: unknown) {
      notifyError(err instanceof Error ? err.message : t('memory.browse.editFailed'));
    } finally {
      setSaving(false);
    }
  };

  const renderMemoryCard = (m: Memory) => (
    <Card
      key={m.id}
      flat
      className="sc-memory-card"
      onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
    >
      <div className="sc-memory-card__main">
        <div className="sc-memory-card__body">
          <div className="sc-memory-card__meta">
            <Tag tone={layerTone(m.layer)}>
              {t(`memory.layer.${m.layer}`, { defaultValue: m.layer })}
            </Tag>
            <Tag>{m.source}</Tag>
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {formatDate(m.created_at, t)}
            </Text>
            <span className="sc-memory-card__access">
              <Icon iconId="clock" size={12} />
              <Text tone="secondary" style={{ fontSize: 12 }}>
                {t('memory.browse.accessCount', { count: m.access_count })}
              </Text>
            </span>
          </div>
          <Text style={{ fontSize: 13 }}>{m.summary || t('memory.browse.noSummary')}</Text>
          {expandedId === m.id && (
            <pre className="sc-memory-card__content">
              {JSON.stringify(m.content, null, 2)}
            </pre>
          )}
        </div>
        <div className="sc-memory-card__actions" onClick={(e) => e.stopPropagation()}>
          <IconButton
            actionId={`memory-edit-${m.id}`}
            iconId="pencil-line"
            iconSize={14}
            density="compact"
            emphasis="quiet"
            label={t('memory.browse.editTitle')}
            onActivate={() => openEdit(m)}
          />
          <ConfirmAction
            actionId={`memory-delete-${m.id}`}
            title={t('memory.browse.deleteConfirm')}
            confirmLabel={t('memory.browse.delete')}
            cancelLabel={t('memory.browse.editCancel')}
            onConfirm={() => handleDelete(m.id)}
          >
            <IconButton
              actionId={`memory-delete-trigger-${m.id}`}
              iconId="delete"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              tone="danger"
              label={t('memory.browse.delete')}
            />
          </ConfirmAction>
        </div>
      </div>
    </Card>
  );

  const timelineGroups = groupMemoriesByPeriod(memories, groupBy);

  return (
    <div className="sc-memory-browse">
      <div className="sc-memory-filters">
        <Select
          clearable
          appearance="ghost"
          className="sc-memory-filters__control"
          placeholder={t('memory.browse.allAgents')}
          value={agentFilter}
          options={agentOptions(agents)}
          onValueChange={(value) => {
            setAgentFilter(typeof value === 'string' ? value : undefined);
            setPage(1);
          }}
        />
        <Select
          appearance="ghost"
          className="sc-memory-filters__control"
          value={timeWindow}
          options={timeWindowOptions(t)}
          onValueChange={(value) => {
            if (typeof value === 'string') {
              setTimeWindow(value as TimeWindowValue);
              setPage(1);
            }
          }}
        />
        <Select
          appearance="ghost"
          className="sc-memory-filters__control"
          value={viewMode}
          options={[
            { value: 'list', label: t('memory.browse.viewList') },
            { value: 'timeline', label: t('memory.browse.viewTimeline') },
          ]}
          onValueChange={(value) => {
            if (value === 'list' || value === 'timeline') setViewMode(value);
          }}
        />
        {viewMode === 'timeline' && (
          <Select
            appearance="ghost"
            className="sc-memory-filters__control"
            value={groupBy}
            options={[
              { value: 'day', label: t('memory.browse.groupByDay') },
              { value: 'week', label: t('memory.browse.groupByWeek') },
              { value: 'month', label: t('memory.browse.groupByMonth') },
            ]}
            onValueChange={(value) => {
              if (value === 'day' || value === 'week' || value === 'month') setGroupBy(value);
            }}
          />
        )}
      </div>

      <div className="sc-memory-layers">
        <Button
          actionId="memory-layer-all"
          emphasis="quiet"
          density="compact"
          aria-pressed={layer === undefined}
          data-selected={layer === undefined ? true : undefined}
          className="sc-memory-layer-chip"
          label={t('memory.layer.all')}
          onActivate={() => { setLayer(undefined); setPage(1); }}
        />
        {LAYERS.map((l) => (
          <Button
            key={l}
            actionId={`memory-layer-${l}`}
            emphasis="quiet"
            density="compact"
            aria-pressed={layer === l}
            data-selected={layer === l ? true : undefined}
            className="sc-memory-layer-chip"
            label={t(`memory.layer.${l}`)}
            onActivate={() => { setLayer(l); setPage(1); }}
          />
        ))}
      </div>

      {loading ? (
        <Flex align="center" justify="center" className="sc-memory__loading">
          <Spin active size="large" />
        </Flex>
      ) : memories.length === 0 ? (
        <Empty description={t('memory.browse.noMemories')} />
      ) : (
        <div className="sc-memory-list">
          {viewMode === 'list' ? memories.map(renderMemoryCard) : timelineGroups.map((group) => (
            <div key={group.key} className="sc-memory-timeline-group">
              <Text strong style={{ fontSize: 13 }}>
                {group.label} ({group.items.length})
              </Text>
              {group.items.map(renderMemoryCard)}
            </div>
          ))}
          {total > pageSize && (
            <Pagination
              page={page}
              total={total}
              pageSize={pageSize}
              previousLabel="‹"
              nextLabel="›"
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      <Dialog
        open={!!editing}
        onDismiss={() => setEditing(null)}
        title={t('memory.browse.editTitle')}
        width={620}
        closeLabel={t('memory.browse.editCancel')}
        footer={
          <>
            <Button
              actionId="memory-edit-cancel"
              emphasis="quiet"
              label={t('memory.browse.editCancel')}
              onActivate={() => setEditing(null)}
            />
            <Button
              actionId="memory-edit-save"
              emphasis="primary"
              execution={saving ? 'pending' : 'idle'}
              label={t('memory.browse.editSave')}
              onActivate={() => void handleSaveEdit()}
            />
          </>
        }
      >
        {editing && (
          <div className="sc-memory-edit">
            <div className="sc-memory-edit__meta">
              <Tag tone={layerTone(editing.layer)}>{editing.layer}</Tag>
              <Tag>{editing.source}</Tag>
              {editing.summary && (
                <Text tone="secondary" style={{ fontSize: 12 }}>{editing.summary}</Text>
              )}
            </div>
            <TextArea
              className="sc-memory-edit__area"
              rows={8}
              value={editContent}
              onValueChange={setEditContent}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}

/* ─── Search Tab ─── */

function SearchTab({ mutationVersion, onMutate }: { mutationVersion: number; onMutate: () => void }) {
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const { t } = useTranslation('memory');
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

  // Re-run the latest search after an edit/delete so results stay truthful.
  useEffect(() => {
    if (mutationVersion > 0 && query.trim()) void handleSearch();
  }, [mutationVersion]);

  const handleCardDelete = async (id: string) => {
    try {
      await api.deleteMemory(id);
      notifySuccess(t('memory.browse.deleteSuccess'));
      onMutate();
      void handleSearch();
    } catch (err: unknown) {
      notifyError(err instanceof Error ? err.message : t('memory.browse.deleteFailed'));
    }
  };

  return (
    <div className="sc-memory-search">
      <div className="sc-memory-search__bar">
        <TextField
          className="sc-memory-search__input"
          clearable
          leading={<Icon iconId="search" size={14} />}
          placeholder={t('memory.search.placeholder')}
          value={query}
          onValueChange={setQuery}
          onEnter={() => void handleSearch()}
        />
        <Button
          actionId="memory-search-run"
          emphasis="primary"
          execution={loading ? 'pending' : 'idle'}
          label={t('memory.search.button')}
          onActivate={() => void handleSearch()}
        />
        <Select
          clearable
          appearance="ghost"
          className="sc-memory-filters__control"
          placeholder={t('memory.search.allAgents')}
          value={agentFilter}
          options={agentOptions(agents)}
          onValueChange={(value) => setAgentFilter(typeof value === 'string' ? value : undefined)}
        />
        <Select
          appearance="ghost"
          className="sc-memory-filters__control"
          value={timeWindow}
          options={timeWindowOptions(t)}
          onValueChange={(value) => {
            if (typeof value === 'string') setTimeWindow(value as TimeWindowValue);
          }}
        />
      </div>
      {loading ? (
        <Flex align="center" justify="center" className="sc-memory__loading">
          <Spin active size="large" />
        </Flex>
      ) : results.length === 0 && query ? (
        <Empty description={t('memory.search.noResults')} />
      ) : (
        <div className="sc-memory-list">
          {results.map(({ memory, score, explain }) => (
            <Card key={memory.id} flat className="sc-memory-card">
              <div className="sc-memory-card__body">
                <div className="sc-memory-card__meta">
                  <Tag tone={layerTone(memory.layer)}>
                    {t(`memory.layer.${memory.layer}`, { defaultValue: memory.layer })}
                  </Tag>
                  <Tag tone="info">
                    {t('memory.search.scoreLabel')} {(score * 100).toFixed(0)}%
                  </Tag>
                  <Text tone="secondary" style={{ fontSize: 12 }}>
                    {formatDate(memory.created_at, t)}
                  </Text>
                </div>
                <Text>{memory.summary || t('memory.browse.noSummary')}</Text>
                {explain && (
                  <Text tone="secondary" style={{ fontSize: 12 }}>
                    {`V:${(explain.vector_score * 100).toFixed(0)}% `}
                    {`K:${(explain.keyword_score * 100).toFixed(0)}% `}
                    {`W:${(explain.weighted_score * 100).toFixed(0)}% `}
                    {`D:${(explain.decay_factor ?? 1).toFixed(2)} `}
                    {`R:${((explain.after_rerank ?? explain.final_score) * 100).toFixed(0)}% `}
                    {`F:${(explain.final_score * 100).toFixed(0)}%`}
                  </Text>
                )}
                <div className="sc-memory-card__actions">
                  <ConfirmAction
                    actionId={`memory-search-delete-${memory.id}`}
                    title={t('memory.browse.deleteConfirm')}
                    confirmLabel={t('memory.browse.delete')}
                    cancelLabel={t('memory.browse.editCancel')}
                    onConfirm={() => handleCardDelete(memory.id)}
                  >
                    <IconButton
                      actionId={`memory-search-delete-trigger-${memory.id}`}
                      iconId="delete"
                      iconSize={14}
                      density="compact"
                      emphasis="quiet"
                      tone="danger"
                      label={t('memory.browse.delete')}
                    />
                  </ConfirmAction>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Persona Tab ─── */

function PersonaTab() {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation('memory');

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
      <Flex align="center" justify="center" className="sc-memory__loading">
        <Spin active size="large" />
      </Flex>
    );
  }

  if (!persona) {
    return (
      <Empty
        description={t('memory.persona.noData')}
        action={
          <Button
            actionId="memory-persona-refresh-empty"
            leading={<Icon iconId="refresh-cw" size={14} />}
            label={t('memory.persona.refresh')}
            onActivate={() => void load()}
          />
        }
      >
        <Text tone="secondary" style={{ fontSize: 13 }}>
          {t('memory.persona.noDataHint')}
        </Text>
        <Text tone="secondary" style={{ fontSize: 12 }}>
          {t('memory.persona.autoUpdateHint')}
        </Text>
      </Empty>
    );
  }

  return (
    <div className="sc-memory-persona">
      <Card flat heading={t('memory.persona.tagline')}>
        <Text>{persona.tagline || t('memory.persona.empty')}</Text>
      </Card>
      <Card flat heading={t('memory.persona.narrative')}>
        <Text style={{ whiteSpace: 'pre-wrap' }}>
          {persona.narrative || t('memory.persona.empty')}
        </Text>
      </Card>
      <div className="sc-memory-persona__footer">
        <Text tone="secondary" style={{ fontSize: 12 }}>
          {t('memory.persona.updated', { time: formatDate(persona.updated_at, t) })}
        </Text>
        <Button
          actionId="memory-persona-refresh"
          density="compact"
          leading={<Icon iconId="refresh-cw" size={14} />}
          label={t('memory.persona.refresh')}
          onActivate={() => void load()}
        />
      </div>
    </div>
  );
}

/* ─── Events Tab ─── */

function EventsTab({ mutationVersion }: { mutationVersion: number }) {
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const { t } = useTranslation('memory');
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

  useEffect(() => {
    if (mutationVersion > 0) void load();
  }, [mutationVersion]);

  const columns: Array<TableColumn<MemoryEvent>> = [
    {
      id: 'type',
      label: t('memory.events.column.type'),
      width: 120,
      renderCell: (event) => <Tag>{event.type}</Tag>,
    },
    {
      id: 'layer',
      label: t('memory.events.column.layer'),
      width: 100,
      renderCell: (event) => (
        <Tag tone={layerTone(event.layer)}>
          {t(`memory.layer.${event.layer}`, { defaultValue: event.layer })}
        </Tag>
      ),
    },
    {
      id: 'latency_ms',
      label: t('memory.events.column.latency'),
      width: 90,
      renderCell: (event) =>
        event.latency_ms < 1000
          ? `${event.latency_ms}ms`
          : `${(event.latency_ms / 1000).toFixed(1)}s`,
    },
    {
      id: 'detail',
      label: t('memory.events.column.detail'),
      renderCell: (event) => {
        const detail = event.detail || {};
        if (event.type === 'retrieval') {
          const query = typeof detail.query === 'string' ? detail.query : '';
          const hitCount = typeof detail.result_count === 'number' ? detail.result_count : undefined;
          const topHits = Array.isArray(detail.top_hits) ? detail.top_hits.length : 0;
          const q = query.length > 30 ? `${query.slice(0, 30)}...` : query;
          return (
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {`q:${q || '-'} · hits:${hitCount ?? 0}${topHits > 0 ? ` · top:${topHits}` : ''}`}
            </Text>
          );
        }
        return (
          <Text tone="secondary" style={{ fontSize: 12 }}>
            {Object.keys(detail).length > 0 ? t('memory.browse.hasDetail') : '-'}
          </Text>
        );
      },
    },
    {
      id: 'timestamp',
      label: t('memory.events.column.timestamp'),
      renderCell: (event) => formatDate(event.timestamp, t),
    },
  ];

  return (
    <div className="sc-memory-events">
      <div className="sc-memory-events__bar">
        <div className="sc-memory-filters">
          <Text tone="secondary">{t('memory.events.title')}</Text>
          <Select
            clearable
            appearance="ghost"
            className="sc-memory-filters__control"
            placeholder={t('memory.events.allAgents')}
            value={agentFilter}
            options={agentOptions(agents)}
            onValueChange={(value) => setAgentFilter(typeof value === 'string' ? value : undefined)}
          />
          <Select
            appearance="ghost"
            className="sc-memory-filters__control"
            value={timeWindow}
            options={timeWindowOptions(t)}
            onValueChange={(value) => {
              if (typeof value === 'string') setTimeWindow(value as TimeWindowValue);
            }}
          />
        </div>
        <Button
          actionId="memory-events-refresh"
          density="compact"
          execution={loading ? 'pending' : 'idle'}
          leading={<Icon iconId="refresh-cw" size={14} />}
          label={t('memory.events.refresh')}
          onActivate={() => void load()}
        />
      </div>
      <DataTable<MemoryEvent>
        rows={events}
        columns={columns}
        rowKey="id"
        pageSize={20}
        loading={loading && events.length === 0}
        emptyLabel={t('memory.events.noEvents')}
      />
    </div>
  );
}
