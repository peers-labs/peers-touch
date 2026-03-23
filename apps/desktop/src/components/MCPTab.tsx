import { useCallback, useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Button, Card, Input, Modal, Switch, Tag, Empty,
  Typography, Select, message, Popconfirm, Tooltip, Spin, theme,
} from 'antd';
import {
  Plus, Trash2, Play,
  CheckCircle, XCircle,
} from 'lucide-react';
import { api, type MCPServerItem, type MCPServerRecord } from '../services/api';

const { Text, Title } = Typography;

export function MCPTab() {
  const { token } = theme.useToken();
  const [servers, setServers] = useState<MCPServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [detailName, setDetailName] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listMCPServers();
      setServers(list);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadServers(); }, [loadServers]);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await api.toggleMCPServer(name, enabled);
      setServers((prev) => prev.map((s) => s.name === name ? { ...s, enabled } : s));
      message.success(enabled ? 'Server enabled' : 'Server disabled');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.deleteMCPServer(name);
      setServers((prev) => prev.filter((s) => s.name !== name));
      message.success('Server deleted');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleTest = async (name: string) => {
    try {
      const result = await api.testMCPServer(name);
      if (result.ok) {
        message.success(`Connected! ${result.tools?.length || 0} tools available`);
      } else {
        message.error(`Connection failed: ${result.error}`);
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  return (
    <Flexbox style={{ padding: 24, height: '100%', overflow: 'auto' }} gap={24}>
      <Flexbox horizontal justify="space-between" align="center">
        <Flexbox>
          <Title level={5} style={{ margin: 0 }}>MCP Servers</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Manage Model Context Protocol server connections
          </Text>
        </Flexbox>
        <Button
          type="primary"
          icon={<Plus size={14} />}
          onClick={() => setAddModal(true)}
        >
          Add Server
        </Button>
      </Flexbox>

      {loading ? (
        <Flexbox align="center" style={{ padding: 48 }}>
          <Spin />
        </Flexbox>
      ) : servers.length === 0 ? (
        <Empty description="No MCP servers configured" />
      ) : (
        <Flexbox gap={12}>
          {servers.map((srv) => (
            <MCPServerCard
              key={srv.name}
              server={srv}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onTest={handleTest}
              onDetail={() => setDetailName(srv.name)}
              token={token}
            />
          ))}
        </Flexbox>
      )}

      {addModal && (
        <AddMCPServerModal
          onDone={() => { setAddModal(false); loadServers(); }}
          onCancel={() => setAddModal(false)}
        />
      )}

      {detailName && (
        <MCPServerDetailModal
          name={detailName}
          onClose={() => { setDetailName(null); loadServers(); }}
        />
      )}
    </Flexbox>
  );
}

function MCPServerCard({
  server,
  onToggle,
  onDelete,
  onTest,
  onDetail,
  token,
}: {
  server: MCPServerItem;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
  onTest: (name: string) => void;
  onDetail: () => void;
  token: any;
}) {
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    await onTest(server.name);
    setTesting(false);
  };

  return (
    <Card
      size="small"
      hoverable
      style={{ borderColor: token.colorBorderSecondary, cursor: 'default' }}
    >
      <Flexbox horizontal justify="space-between" align="center">
        <Flexbox
          horizontal gap={12} align="center"
          style={{ cursor: 'pointer', flex: 1 }}
          onClick={onDetail}
        >
          <span style={{ fontSize: 20 }}>
            {server.metaAvatar || (server.type === 'stdio' ? '💻' : '🌐')}
          </span>
          <Flexbox>
            <Flexbox horizontal gap={6} align="center">
              <Text strong>{server.title || server.name}</Text>
              <Tag
                color={server.type === 'stdio' ? 'purple' : 'cyan'}
                style={{ fontSize: 11, margin: 0 }}
              >
                {server.type}
              </Tag>
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {server.description || server.name}
            </Text>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal gap={8} align="center">
          {server.toolCount > 0 && (
            <Tag color="green" style={{ margin: 0 }}>
              {server.toolCount} tools
            </Tag>
          )}
          <Tooltip title="Test connection">
            <Button
              type="text"
              size="small"
              icon={<Play size={14} />}
              loading={testing}
              onClick={handleTest}
            />
          </Tooltip>
          <Tooltip title={server.enabled ? 'Disable' : 'Enable'}>
            <Switch
              size="small"
              checked={server.enabled}
              onChange={(checked) => onToggle(server.name, checked)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this server?"
            onConfirm={() => onDelete(server.name)}
          >
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
          </Popconfirm>
        </Flexbox>
      </Flexbox>
    </Card>
  );
}

function AddMCPServerModal({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'stdio' | 'http'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    if (!name.trim()) {
      message.warning('Name is required');
      return;
    }
    if (type === 'stdio' && !command.trim()) {
      message.warning('Command is required for stdio transport');
      return;
    }
    if (type === 'http' && !url.trim()) {
      message.warning('URL is required for HTTP transport');
      return;
    }

    setLoading(true);
    try {
      const parsedArgs = args.trim()
        ? args.split(/\s+/).filter(Boolean)
        : [];

      await api.createMCPServer({
        name: name.trim(),
        title: title.trim(),
        description: description.trim(),
        type,
        command: command.trim(),
        args: parsedArgs,
        url: url.trim(),
      });
      message.success(`Server "${name}" added`);
      onDone();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Add MCP Server"
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText="Add"
      width={560}
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Input
          placeholder="Server name (unique identifier)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Input
          placeholder="Display title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <Flexbox horizontal gap={8} align="center">
          <Text style={{ width: 80 }}>Transport:</Text>
          <Select
            value={type}
            onChange={setType}
            style={{ width: 140 }}
            options={[
              { value: 'stdio', label: 'stdio' },
              { value: 'http', label: 'HTTP' },
            ]}
          />
        </Flexbox>

        {type === 'stdio' ? (
          <>
            <Input
              placeholder="Command (e.g. npx, uvx, node)"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <Input
              placeholder="Arguments (space-separated, e.g. -y @modelcontextprotocol/server-filesystem)"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </>
        ) : (
          <Input
            placeholder="HTTP endpoint URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
      </Flexbox>
    </Modal>
  );
}

function MCPServerDetailModal({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const [server, setServer] = useState<MCPServerRecord | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.getMCPServer(name).then(setServer).catch(console.error);
  }, [name]);

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await api.testMCPServer(name);
      setTestResult(result);
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  if (!server) return null;

  return (
    <Modal
      title={server.title || server.name}
      open
      onCancel={onClose}
      width={600}
      footer={
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button onClick={handleTest} loading={testing} icon={<Play size={14} />}>
            Test Connection
          </Button>
          <Button onClick={onClose}>Close</Button>
        </Flexbox>
      }
    >
      <Flexbox gap={12} style={{ paddingBlock: 8 }}>
        <Flexbox horizontal gap={8} wrap="wrap">
          <Tag color={server.type === 'stdio' ? 'purple' : 'cyan'}>{server.type}</Tag>
          {server.version && <Tag>v{server.version}</Tag>}
          <Tag color={server.enabled ? 'green' : 'default'}>
            {server.enabled ? 'Enabled' : 'Disabled'}
          </Tag>
        </Flexbox>

        {server.description && (
          <Text type="secondary">{server.description}</Text>
        )}

        <Flexbox
          style={{
            background: token.colorFillTertiary,
            borderRadius: 8,
            padding: 12,
            fontFamily: 'monospace',
            fontSize: 13,
          }}
          gap={4}
        >
          {server.type === 'stdio' ? (
            <>
              <Text style={{ fontSize: 12 }}>
                <Text strong>Command: </Text>{server.command}
              </Text>
              {server.args?.length > 0 && (
                <Text style={{ fontSize: 12 }}>
                  <Text strong>Args: </Text>{server.args.join(' ')}
                </Text>
              )}
              {Object.keys(server.env || {}).length > 0 && (
                <Text style={{ fontSize: 12 }}>
                  <Text strong>Env: </Text>
                  {Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join(', ')}
                </Text>
              )}
            </>
          ) : (
            <Text style={{ fontSize: 12 }}>
              <Text strong>URL: </Text>{server.url}
            </Text>
          )}
        </Flexbox>

        {testResult && (
          <Flexbox
            style={{
              background: testResult.ok ? token.colorSuccessBg : token.colorErrorBg,
              borderRadius: 8,
              padding: 12,
            }}
            gap={4}
          >
            <Flexbox horizontal gap={6} align="center">
              {testResult.ok ? (
                <CheckCircle size={16} color={token.colorSuccess} />
              ) : (
                <XCircle size={16} color={token.colorError} />
              )}
              <Text strong>
                {testResult.ok
                  ? `Connected (${testResult.tools?.length || 0} tools)`
                  : 'Connection failed'}
              </Text>
            </Flexbox>
            {testResult.ok && testResult.tools && testResult.tools.length > 0 && (
              <Flexbox horizontal gap={4} wrap="wrap" style={{ marginTop: 4 }}>
                {testResult.tools.map((t) => (
                  <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>
                ))}
              </Flexbox>
            )}
            {testResult.error && (
              <Text type="danger" style={{ fontSize: 12 }}>{testResult.error}</Text>
            )}
          </Flexbox>
        )}
      </Flexbox>
    </Modal>
  );
}
