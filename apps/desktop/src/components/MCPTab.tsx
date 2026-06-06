import { useCallback, useEffect, useState } from 'react';
import { log } from '@/utils/logger';
import { Flexbox } from 'react-layout-kit';
import {
  Card, Modal, Switch, Empty,
  Typography, Select, message, Popconfirm, Spin, theme,
} from 'antd';
import { Button, Input, Tag, Tooltip } from '@lobehub/ui';
import {
  Plus, Trash2, Play,
  CheckCircle, XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type MCPServerItem, type MCPServerRecord } from '../services/desktop_api';
import { SettingsContainer } from './settings/SettingsLayout';

const { Text, Title } = Typography;

export function MCPTab() {
  const { t } = useTranslation('provider');
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
      message.success(enabled ? t('provider.mcp.serverEnabled') : t('provider.mcp.serverDisabled'));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.deleteMCPServer(name);
      setServers((prev) => prev.filter((s) => s.name !== name));
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
    } finally {
      loadServers();
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
        <Button
          size="small"
          type="primary"
          icon={<Plus size={14} />}
          onClick={() => setAddModal(true)}
        >
          {t('provider.mcp.addServer')}
        </Button>
      </Flexbox>

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
    </SettingsContainer>
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
              <Tag
                color={server.status === 'ok' ? 'green' : server.status === 'error' ? 'red' : 'default'}
                style={{ fontSize: 11, margin: 0 }}
              >
                {server.status || 'unknown'}
              </Tag>
              {server.needs_approval && (
                <Tag color="warning" style={{ fontSize: 11, margin: 0 }}>
                  {server.policy || 'approval'}
                </Tag>
              )}
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {server.description || server.name}
            </Text>
            {(server.lastTestedAt || server.lastError) && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {server.lastTestedAt ? t('provider.mcp.lastTested', { time: server.lastTestedAt }) : ''}
                {server.lastError ? ` · ${server.lastError}` : ''}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal gap={8} align="center">
          {server.toolCount > 0 && (
            <Tag color="green" style={{ margin: 0 }}>
              {t('provider.mcp.tools', { count: server.toolCount })}
            </Tag>
          )}
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
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('provider');
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
      message.warning(t('provider.mcp.add.nameRequired'));
      return;
    }
    if (type === 'stdio' && !command.trim()) {
      message.warning(t('provider.mcp.add.commandRequired'));
      return;
    }
    if (type === 'http' && !url.trim()) {
      message.warning(t('provider.mcp.add.urlRequired'));
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

function MCPServerDetailModal({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const [server, setServer] = useState<MCPServerRecord | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.getMCPServer(name).then(setServer).catch((err) => log.error('mcp', 'Failed to load MCP server', { error: String(err) }));
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
            {t('provider.mcp.testConnection')}
          </Button>
          <Button onClick={onClose}>{t('common.action.close', { ns: 'common' })}</Button>
        </Flexbox>
      }
    >
      <Flexbox gap={12} style={{ paddingBlock: 8 }}>
        <Flexbox horizontal gap={8} wrap="wrap">
          <Tag color={server.type === 'stdio' ? 'purple' : 'cyan'}>{server.type}</Tag>
          {server.version && <Tag>v{server.version}</Tag>}
          <Tag color={server.enabled ? 'green' : 'default'}>
            {server.enabled ? t('provider.mcp.detail.enabled') : t('provider.mcp.detail.disabled')}
          </Tag>
          <Tag color={server.status === 'ok' ? 'green' : server.status === 'error' ? 'red' : 'default'}>
            {server.status || 'unknown'}
          </Tag>
          {server.needs_approval && <Tag color="warning">{server.policy || 'approval'}</Tag>}
          {server.audit_event && <Tag>{server.audit_event}</Tag>}
        </Flexbox>

        {server.description && (
          <Text type="secondary">{server.description}</Text>
        )}

        {(server.lastTestedAt || server.lastError) && (
          <Flexbox
            style={{
              background: token.colorFillTertiary,
              borderRadius: 8,
              padding: 12,
            }}
            gap={4}
          >
            {server.lastTestedAt && (
              <Text style={{ fontSize: 12 }}>
                <Text strong>{t('provider.mcp.detail.lastTested')}</Text>{server.lastTestedAt}
              </Text>
            )}
            {server.lastError && (
              <Text type="danger" style={{ fontSize: 12 }}>
                <Text strong>{t('provider.mcp.detail.lastError')}</Text>{server.lastError}
              </Text>
            )}
          </Flexbox>
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
                <Text strong>{t('provider.mcp.detail.command')}</Text>{server.command}
              </Text>
              {server.args?.length > 0 && (
                <Text style={{ fontSize: 12 }}>
                  <Text strong>{t('provider.mcp.detail.args')}</Text>{server.args.join(' ')}
                </Text>
              )}
              {Object.keys(server.env || {}).length > 0 && (
                <Text style={{ fontSize: 12 }}>
                  <Text strong>{t('provider.mcp.detail.env')}</Text>
                  {Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join(', ')}
                </Text>
              )}
            </>
          ) : (
            <Text style={{ fontSize: 12 }}>
              <Text strong>{t('provider.mcp.detail.url')}</Text>{server.url}
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
