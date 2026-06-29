import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface AgentResourceManagementProps {
  agentName?: string;
  onBack?: () => void;
  onNavigateAgentProfile?: (name: string) => void;
  onStartChat?: (name: string) => void;
}

interface ApiRow {
  key: string;
  name: string;
  status: 'idle' | 'loading' | 'ok' | 'error';
  detail: string;
  count?: number;
}

interface AgentRecord {
  agentId?: string;
  agent_id?: string;
  name?: string;
  title?: string;
  description?: string;
  modelName?: string;
  model_name?: string;
}

const TAB_KEYS = ['Knowledge', 'Memory', 'Skills', 'Tools', 'MCP', 'Workspace'] as const;

const API_TARGETS = [
  { key: 'agents', name: 'Agents', path: '/agent/list', body: { page: 1, page_size: 20 } },
  { key: 'knowledge', name: 'Knowledge', path: '/config/knowledge/list', needsAgent: true },
  { key: 'memory', name: 'Memory', path: '/memory/list', needsAgent: true },
  { key: 'skills', name: 'Skills', path: '/config/skill/list', needsAgent: true },
  { key: 'tools', name: 'Tools', path: '/config/tool/get', needsAgent: true },
  { key: 'mcp', name: 'MCP', path: '/config/mcp/list', needsAgent: true },
  { key: 'workspace', name: 'Workspace', path: '/workspace/list', needsAgent: true },
  { key: 'config', name: 'Config', path: '/config/list', needsAgent: true },
  { key: 'offline', name: 'Offline Queue', path: '/offline-queue/list', needsAgent: true },
];

function agentID(agent?: AgentRecord | null): string {
  return agent?.agentId || agent?.agent_id || '';
}

function agentTitle(agent: AgentRecord): string {
  return agent.title || agent.name || agentID(agent) || 'Unnamed Agent';
}

async function postAgentApi<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const e2eToken = import.meta.env.DEV ? window.sessionStorage.getItem('pt.agent.e2e.token') : null;
  if (e2eToken) {
    headers.Authorization = `Bearer ${e2eToken}`;
  }
  const res = await fetch(`/sub-agent${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return text ? JSON.parse(text) as T : ({} as T);
}

function extractRows(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  for (const key of ['agents', 'items', 'skills', 'workspaces', 'bindings', 'operations']) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function AgentResourceManagement({
  agentName,
  onBack,
  onNavigateAgentProfile,
  onStartChat,
}: AgentResourceManagementProps) {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selectedAgentID, setSelectedAgentID] = useState('');
  const [activeTab, setActiveTab] = useState<(typeof TAB_KEYS)[number]>('Knowledge');
  const [rows, setRows] = useState<ApiRow[]>([]);
  const [eventText, setEventText] = useState('SSE not connected');
  const [creating, setCreating] = useState(false);
  const [agentDraft, setAgentDraft] = useState(() => `e2e-agent-${Date.now()}`);
  const [memoryDraft, setMemoryDraft] = useState('E2E memory smoke item');
  const [workspaceDraft, setWorkspaceDraft] = useState(() => `e2e-workspace-${Date.now()}`);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agentID(agent) === selectedAgentID) ?? agents[0] ?? null,
    [agents, selectedAgentID],
  );

  async function loadAll(nextAgentID = selectedAgentID) {
    setRows(API_TARGETS.map((target) => ({ key: target.key, name: target.name, status: 'loading', detail: 'Loading' })));
    const results = await Promise.all(API_TARGETS.map(async (target): Promise<ApiRow> => {
      const body = target.needsAgent ? { agent_id: nextAgentID } : target.body;
      if (target.needsAgent && !nextAgentID) {
        return { key: target.key, name: target.name, status: 'idle', detail: 'Select or create an Agent first' };
      }
      try {
        const data = await postAgentApi<Record<string, unknown>>(target.path, body);
        const count = extractRows(data).length;
        if (target.key === 'agents') {
          const nextAgents = extractRows(data) as AgentRecord[];
          setAgents(nextAgents);
          if (!nextAgentID && nextAgents[0]) setSelectedAgentID(agentID(nextAgents[0]));
        }
        return { key: target.key, name: target.name, status: 'ok', detail: 'Loaded', count };
      } catch (error) {
        return {
          key: target.key,
          name: target.name,
          status: 'error',
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    setRows(results);
  }

  async function createAgent() {
    setCreating(true);
    try {
      const data = await postAgentApi<{ agent?: AgentRecord }>('/agent/create', {
        name: agentDraft,
        title: agentDraft,
        description: 'E2E Agent resource management smoke test',
        provider_id: 'openai',
        model_name: 'gpt-5.4-mini',
        effort: 'Medium',
        visibility: 'AGENT_VISIBILITY_PRIVATE',
      });
      const nextID = agentID(data.agent);
      if (nextID) setSelectedAgentID(nextID);
      message.success('Agent created');
      await loadAll(nextID);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }

  async function addMemory() {
    if (!selectedAgent) return;
    try {
      await postAgentApi('/agent/memory/import', {
        skip_duplicates: false,
        data: {
          version: '1.0',
          memories: [{
            agent_id: agentID(selectedAgent),
            target: 'memory',
            content: memoryDraft,
            source: 'e2e',
          }],
        },
      });
      message.success('Memory imported');
      await loadAll(agentID(selectedAgent));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function createWorkspace() {
    if (!selectedAgent) return;
    try {
      await postAgentApi('/workspace/create', {
        agent_id: agentID(selectedAgent),
        name: workspaceDraft,
        meta: { source: 'e2e' },
      });
      message.success('Workspace created');
      await loadAll(agentID(selectedAgent));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    setEventText(selectedAgentID ? 'SSE is verified by the backend E2E stream check' : 'Select or create an Agent first');
  }, [selectedAgentID]);

  const columns: ColumnsType<ApiRow> = [
    { title: 'Resource', dataIndex: 'name', key: 'name' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: ApiRow['status']) => <Tag color={status === 'ok' ? 'green' : status === 'error' ? 'red' : 'blue'}>{status}</Tag>,
    },
    { title: 'Count', dataIndex: 'count', key: 'count', render: (count?: number) => count ?? '-' },
    { title: 'Detail', dataIndex: 'detail', key: 'detail', ellipsis: true },
  ];

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <Space direction="vertical" size={4}>
        <Typography.Title level={2} style={{ margin: 0 }}>Agent Resource Management</Typography.Title>
        <Typography.Text type="secondary">Current agent: {agentName || agentTitle(selectedAgent || {})}</Typography.Text>
      </Space>

      <Space wrap>
        <Button onClick={onBack}>Back</Button>
        <Button onClick={() => selectedAgent?.name && onNavigateAgentProfile?.(selectedAgent.name)}>Profile</Button>
        <Button onClick={() => selectedAgent?.name && onStartChat?.(selectedAgent.name)}>Chat</Button>
        <Button onClick={() => loadAll(agentID(selectedAgent))}>Reload</Button>
      </Space>

      <Card title="E2E Actions">
        <Space wrap>
          <Input value={agentDraft} onChange={(event) => setAgentDraft(event.target.value)} style={{ width: 260 }} />
          <Button type="primary" loading={creating} onClick={createAgent}>Create Agent</Button>
          <Input value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} style={{ width: 260 }} />
          <Button disabled={!selectedAgent} onClick={addMemory}>Add Memory</Button>
          <Input value={workspaceDraft} onChange={(event) => setWorkspaceDraft(event.target.value)} style={{ width: 260 }} />
          <Button disabled={!selectedAgent} onClick={createWorkspace}>Create Workspace</Button>
        </Space>
      </Card>

      <Card title="Resource Tabs">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as (typeof TAB_KEYS)[number])}
          items={TAB_KEYS.map((key) => ({
            key,
            label: key,
            children: (
              <Table<ApiRow>
                rowKey="key"
                size="small"
                pagination={false}
                columns={columns}
                dataSource={rows.filter((row) => row.key === key.toLowerCase())}
              />
            ),
          }))}
        />
      </Card>

      <Card title="SSE Events">
        <Typography.Paragraph style={{ margin: 0 }}>{eventText}</Typography.Paragraph>
      </Card>

      <Card title="Agents">
        <Space direction="vertical" style={{ width: '100%' }}>
          {agents.map((agent) => (
            <Button
              key={agentID(agent)}
              type={agentID(agent) === selectedAgentID ? 'primary' : 'default'}
              onClick={() => setSelectedAgentID(agentID(agent))}
            >
              {agentTitle(agent)}
            </Button>
          ))}
        </Space>
      </Card>
    </div>
  );
}
