import { useEffect, useState } from 'react';
import { log } from '@/utils/logger';
import { Flexbox } from 'react-layout-kit';
import {
  Alert, Card, Modal, Switch, Empty,
  Typography, Select, message, Popconfirm, Spin, theme, Input as AntInput,
} from 'antd';
import { Button, Input, Tag, Tooltip } from '@lobehub/ui';
import {
  Plus, Trash2, Play, Pencil, Upload,
  CheckCircle, XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type MCPServerItem, type MCPServerRecord } from '../services/desktop_api';
import { useMCPStore } from '../store/mcp';
import { SettingsContainer } from './settings/SettingsLayout';

const { Text, Title } = Typography;
const { TextArea } = AntInput;
type MCPTransport = MCPServerRecord['type'];

function transportColor(type: MCPTransport) {
  if (type === 'stdio') return 'purple';
  if (type === 'sse') return 'blue';
  return 'cyan';
}

export function MCPTab() {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const { servers, loading, error, loadServers, createServer, updateServer, toggleServer, deleteServer } = useMCPStore();
  const [addModal, setAddModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [detailName, setDetailName] = useState<string | null>(null);

  useEffect(() => { loadServers(); }, [loadServers]);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await toggleServer(name, enabled);
      message.success(enabled ? t('provider.mcp.serverEnabled') : t('provider.mcp.serverDisabled'));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteServer(name);
      message.success(t('provider.mcp.serverDeleted'));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleTest = async (name: string) => {
    try {
      const result = await api.testMCPServer(name);
      if (result.ok) {
        message.success(t('provider.mcp.testPassed', { count: result.tools?.length || 0 }));
      } else {
        message.error(t('provider.mcp.testFailed', { error: result.error }));
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleImport = async (configText: string) => {
    try {
      const parsed = JSON.parse(configText);
      const mcpServers = parsed.mcpServers || parsed.servers || parsed;
      if (!mcpServers || typeof mcpServers !== 'object') {
        throw new Error(t('provider.mcp.import.invalidFormat'));
      }
      let imported = 0;
      for (const [name, entry] of Object.entries(mcpServers)) {
        const cfg = entry as Record<string, any>;
        if (!cfg || typeof cfg !== 'object') continue;
        const isHttp = cfg.url || cfg.url === '';
        const type: MCPTransport = isHttp ? (cfg.type === 'sse' ? 'sse' : 'http') : 'stdio';
        const command = typeof cfg.command === 'string' ? cfg.command : '';
        const args = Array.isArray(cfg.args)
          ? cfg.args.map((a: unknown) => String(a))
          : typeof cfg.args === 'string' && cfg.args
            ? cfg.args.split(/\s+/).filter(Boolean)
            : [];
        const url = typeof cfg.url === 'string' ? cfg.url : '';
        const env = cfg.env && typeof cfg.env === 'object' ? cfg.env : {};
        try {
          await createServer({
            name,
            title: name,
            description: '',
            type,
            command,
            args,
            url,
            env,
            enabled: cfg.enabled !== false,
          });
          imported++;
        } catch (err) {
          log.warn('mcp', `Import failed for ${name}`, { error: String(err) });
        }
      }
      message.success(t('provider.mcp.import.success', { count: imported }));
      setImportModal(false);
    } catch (e: any) {
      message.error(e.message || t('provider.mcp.import.failed'));
    }
  };

  return (
    <SettingsContainer fullHeight>
      <Flexbox horizontal justify="space-between" align="center">
        <Flexbox>
          <Title level={5} style={{ margin: 0 }}>{t('provider.mcp.title')}</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('provider.mcp.subtitle')}
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Button
            size="small"
            icon={<Upload size={14} />}
            onClick={() => setImportModal(true)}
          >
            {t('provider.mcp.import.button')}
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<Plus size={14} />}
            onClick={() => setAddModal(true)}
          >
            {t('provider.mcp.addServer')}
          </Button>
        </Flexbox>
      </Flexbox>

      {error && (
        <Alert
          type="error"
          showIcon
          message={t('provider.mcp.operationFailed')}
          description={error}
        />
      )}

      {loading ? (
        <Flexbox align="center" style={{ padding: 48 }}>
          <Spin />
        </Flexbox>
      ) : servers.length === 0 ? (
        <Empty description={t('provider.mcp.noServers')} />
      ) : (
        <Flexbox gap={12}>
          {servers.map((srv) => (
            <MCPServerCard
              key={srv.name}
              server={srv}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onTest={handleTest}
              onEdit={() => setDetailName(srv.name)}
              token={token}
            />
          ))}
        </Flexbox>
      )}

      {addModal && (
        <AddMCPServerModal
          onCreate={createServer}
          onDone={() => { setAddModal(false); }}
          onCancel={() => setAddModal(false)}
        />
      )}

      {importModal && (
        <ImportMCPModal
          onImport={handleImport}
          onCancel={() => setImportModal(false)}
        />
      )}

      {detailName && (
        <MCPServerEditModal
          name={detailName}
          onSave={updateServer}
          onClose={() => { setDetailName(null); loadServers(); }}
        />
      )}
    </SettingsContainer>
  );
}

function MCPServerCard({
  server,
  onToggle,
  onDelete,
  onTest,
  onEdit,
  token,
}: {
  server: MCPServerItem;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
  onTest: (name: string) => void;
  onEdit: () => void;
  token: any;
}) {
  const { t } = useTranslation('provider');
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
          onClick={onEdit}
        >
          <span style={{ fontSize: 20 }}>
            {server.metaAvatar || (server.type === 'stdio' ? '💻' : '🌐')}
          </span>
          <Flexbox>
            <Flexbox horizontal gap={6} align="center">
              <Text strong>{server.title || server.name}</Text>
              <Tag
                color={transportColor(server.type)}
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
              {t('provider.mcp.tools', { count: server.toolCount })}
            </Tag>
          )}
          <Tooltip title={t('provider.mcp.editServer')}>
            <Button
              type="text"
              size="small"
              icon={<Pencil size={14} />}
              onClick={onEdit}
            />
          </Tooltip>
          <Tooltip title={t('provider.mcp.testConnection')}>
            <Button
              type="text"
              size="small"
              icon={<Play size={14} />}
              loading={testing}
              onClick={handleTest}
            />
          </Tooltip>
          <Tooltip title={server.enabled ? t('provider.mcp.disable') : t('provider.mcp.enable')}>
            <Switch
              size="small"
              checked={server.enabled}
              onChange={(checked) => onToggle(server.name, checked)}
            />
          </Tooltip>
          <Popconfirm
            title={t('provider.mcp.deleteConfirm')}
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
  onCreate,
  onDone,
  onCancel,
}: {
  onCreate: (data: Partial<MCPServerRecord>) => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('provider');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<MCPTransport>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    if (!name.trim()) {
      message.warning(t('provider.mcp.add.nameRequired'));
      return;
    }
    if (type === 'stdio' && !command.trim()) {
      message.warning(t('provider.mcp.add.commandRequired'));
      return;
    }
    if ((type === 'http' || type === 'sse') && !url.trim()) {
      message.warning(t('provider.mcp.add.urlRequired'));
      return;
    }

    setLoading(true);
    try {
      const parsedArgs = args.trim()
        ? args.split(/\s+/).filter(Boolean)
        : [];

      await onCreate({
        name: name.trim(),
        title: title.trim(),
        description: description.trim(),
        type,
        command: command.trim(),
        args: parsedArgs,
        url: url.trim(),
      });
      message.success(t('provider.mcp.add.success', { name }));
      onDone();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('provider.mcp.add.title')}
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText={t('common.action.add', { ns: 'common' })}
      width={560}
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Input
          placeholder={t('provider.mcp.add.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Input
          placeholder={t('provider.mcp.add.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          placeholder={t('provider.mcp.add.descPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <Flexbox horizontal gap={8} align="center">
          <Text style={{ width: 80 }}>{t('provider.mcp.add.transport')}</Text>
          <Select
            value={type}
            onChange={setType}
            style={{ width: 140 }}
            options={[
              { value: 'stdio', label: 'stdio' },
              { value: 'http', label: 'HTTP' },
              { value: 'sse', label: 'SSE' },
            ]}
          />
        </Flexbox>

        {type === 'stdio' ? (
          <>
            <Input
              placeholder={t('provider.mcp.add.commandPlaceholder')}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <Input
              placeholder={t('provider.mcp.add.argsPlaceholder')}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </>
        ) : (
          <Input
            placeholder={t('provider.mcp.add.urlPlaceholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
      </Flexbox>
    </Modal>
  );
}

function ImportMCPModal({
  onImport,
  onCancel,
}: {
  onImport: (text: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation('provider');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    if (!text.trim()) {
      message.warning(t('provider.mcp.import.empty'));
      return;
    }
    setLoading(true);
    try {
      await onImport(text);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('provider.mcp.import.title')}
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText={t('provider.mcp.import.confirm')}
      width={640}
    >
      <Flexbox gap={10} style={{ paddingBlock: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('provider.mcp.import.hint')}
        </Text>
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('provider.mcp.import.placeholder')}
          autoSize={{ minRows: 10, maxRows: 20 }}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Flexbox>
    </Modal>
  );
}

function MCPServerEditModal({
  name,
  onSave,
  onClose,
}: {
  name: string;
  onSave: (name: string, data: Partial<MCPServerRecord>) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const [server, setServer] = useState<MCPServerRecord | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<MCPTransport>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [envText, setEnvText] = useState('');

  useEffect(() => {
    api.getMCPServer(name).then((s) => {
      setServer(s);
      setTitle(s.title || '');
      setDescription(s.description || '');
      setType(s.type || 'stdio');
      setCommand(s.command || '');
      setArgs(s.args?.join(' ') || '');
      setUrl(s.url || '');
      setEnvText(s.env ? JSON.stringify(s.env, null, 2) : '{}');
    }).catch((err) => log.error('mcp', 'Failed to load MCP server', { error: String(err) }));
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

  const handleSave = async () => {
    setSaving(true);
    try {
      let env: Record<string, string> = {};
      if (envText.trim()) {
        try {
          env = JSON.parse(envText);
        } catch {
          message.warning(t('provider.mcp.edit.envInvalid'));
          setSaving(false);
          return;
        }
      }
      const parsedArgs = args.trim() ? args.split(/\s+/).filter(Boolean) : [];
      await onSave(name, {
        title: title.trim(),
        description: description.trim(),
        type,
        command: command.trim(),
        args: parsedArgs,
        url: url.trim(),
        env,
      });
      message.success(t('provider.mcp.edit.saved'));
      onClose();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!server) return null;

  return (
    <Modal
      title={t('provider.mcp.edit.title', { name: server.title || server.name })}
      open
      onCancel={onClose}
      width={640}
      footer={
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button onClick={handleTest} loading={testing} icon={<Play size={14} />}>
            {t('provider.mcp.testConnection')}
          </Button>
          <Button onClick={onClose}>{t('common.action.close', { ns: 'common' })}</Button>
          <Button type="primary" onClick={handleSave} loading={saving}>
            {t('provider.mcp.edit.save')}
          </Button>
        </Flexbox>
      }
    >
      <Flexbox gap={12} style={{ paddingBlock: 8, maxHeight: '70vh', overflow: 'auto' }}>
        <Flexbox horizontal gap={8} wrap="wrap">
          <Tag color={transportColor(server.type)}>{server.type}</Tag>
          {server.version && <Tag>v{server.version}</Tag>}
          <Tag color={server.enabled ? 'green' : 'default'}>
            {server.enabled ? t('provider.mcp.detail.enabled') : t('provider.mcp.detail.disabled')}
          </Tag>
        </Flexbox>

        <div>
          <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('provider.mcp.add.title')}</Text>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginTop: 4 }} />
        </div>
        <div>
          <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('provider.mcp.add.descPlaceholder')}</Text>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} style={{ marginTop: 4 }} />
        </div>

        <Flexbox horizontal gap={8} align="center">
          <Text style={{ width: 80, fontSize: 12 }}>{t('provider.mcp.add.transport')}</Text>
          <Select
            value={type}
            onChange={setType}
            style={{ width: 140 }}
            options={[
              { value: 'stdio', label: 'stdio' },
              { value: 'http', label: 'HTTP' },
              { value: 'sse', label: 'SSE' },
            ]}
          />
        </Flexbox>

        {type === 'stdio' ? (
          <>
            <div>
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('provider.mcp.detail.command')}</Text>
              <Input value={command} onChange={(e) => setCommand(e.target.value)} style={{ marginTop: 4 }} />
            </div>
            <div>
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('provider.mcp.detail.args')}</Text>
              <Input value={args} onChange={(e) => setArgs(e.target.value)} style={{ marginTop: 4 }} placeholder="arg1 arg2 ..." />
            </div>
            <div>
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('provider.mcp.detail.env')}</Text>
              <TextArea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 12 }}
                autoSize={{ minRows: 3, maxRows: 8 }}
                placeholder='{"KEY": "value"}'
              />
            </div>
          </>
        ) : (
          <div>
            <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('provider.mcp.detail.url')}</Text>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} style={{ marginTop: 4 }} />
          </div>
        )}

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
                  ? t('provider.mcp.connected', { count: testResult.tools?.length || 0 })
                  : t('provider.mcp.connectionFailed')}
              </Text>
            </Flexbox>
            {testResult.ok && testResult.tools && testResult.tools.length > 0 && (
              <Flexbox horizontal gap={4} wrap="wrap" style={{ marginTop: 4 }}>
                {testResult.tools.map((tool) => (
                  <Tag key={tool} style={{ fontSize: 11 }}>{tool}</Tag>
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
