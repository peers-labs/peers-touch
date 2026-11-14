import { useEffect, useState } from 'react';
import { log } from '@/utils/logger';
import {
  Alert,
  Button,
  Card,
  ConfirmAction,
  Dialog,
  Empty,
  Field,
  Flex,
  Icon,
  IconButton,
  Progress,
  Select,
  Spin,
  Switch,
  Tag,
  Text,
  TextArea,
  TextField,
  Tooltip,
  type Tone,
} from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import {
  CapabilityOperationStatus,
  type CapabilityOperation,
} from '../gen/proto/domain/agent/capability_pb';
import { api, type MCPServerItem, type MCPServerRecord } from '../services/desktop_api';
import {
  isMcpOperationActive,
  isMcpOperationRetryable,
  useMCPStore,
} from '../store/mcp';
import { SettingsContainer } from './settings/SettingsLayout';
import { notifyError, notifySuccess, notifyWarning } from '../ui/feedback';

type MCPTransport = MCPServerRecord['type'];

function transportTone(type: MCPTransport): Tone {
  if (type === 'stdio') return 'neutral';
  if (type === 'sse') return 'info';
  return 'success';
}

export function MCPTab() {
  const { t } = useTranslation('provider');
  const {
    servers,
    operationsByServer,
    loading,
    error,
    loadServers,
    createServer,
    updateServer,
    toggleServer,
    deleteServer,
    testServer,
    reconnectServer,
    recoverCleanup,
    cancelOperation,
    retryOperation,
  } = useMCPStore();
  const [addModal, setAddModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [detailName, setDetailName] = useState<string | null>(null);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await toggleServer(name, enabled);
    } catch (e: any) {
      notifyError(e.message);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteServer(name);
    } catch (e: any) {
      notifyError(e.message);
    }
  };

  const handleTest = async (name: string) => {
    try {
      await testServer(name);
    } catch (e: any) {
      notifyError(e.message);
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
            executionOwner: cfg.executionOwner === 'client' ? 'client' : 'station',
            enabled: cfg.enabled !== false,
          });
          imported++;
        } catch (err) {
          log.warn('mcp', `Import failed for ${name}`, { error: String(err) });
        }
      }
      notifySuccess(t('provider.mcp.import.success', { count: imported }));
      setImportModal(false);
    } catch (e: any) {
      notifyError(e.message || t('provider.mcp.import.failed'));
    }
  };

  return (
    <SettingsContainer tier="standard">
      <Flex direction="row" justify="space-between" align="center">
        <Flex>
          <Text strong style={{ fontSize: 15 }}>{t('provider.mcp.title')}</Text>
          <Text tone="secondary" style={{ fontSize: 12 }}>
            {t('provider.mcp.subtitle')}
          </Text>
        </Flex>
        <Flex direction="row" gap={8}>
          <Button
            actionId="mcp-import-open"
            density="compact"
            leading={<Icon iconId="upload" size={14} />}
            label={t('provider.mcp.import.button')}
            onActivate={() => setImportModal(true)}
          />
          <Button
            actionId="mcp-add-open"
            density="compact"
            emphasis="primary"
            leading={<Icon iconId="plus" size={14} />}
            label={t('provider.mcp.addServer')}
            onActivate={() => setAddModal(true)}
          />
        </Flex>
      </Flex>

      {error && (
        <Alert
          tone="danger"
          title={t('provider.mcp.operationFailed')}
          description={error}
        />
      )}

      {loading ? (
        <Flex align="center" justify="center" style={{ padding: 48 }}>
          <Spin active />
        </Flex>
      ) : servers.length === 0 ? (
        <Empty
          icon={<Icon iconId="puzzle" size={32} />}
          description={
            <span>
              {t('provider.mcp.noServers')}
              <br />
              {t('provider.mcp.noServersHint')}
            </span>
          }
          action={
            <Button
              actionId="mcp-add-empty"
              emphasis="primary"
              leading={<Icon iconId="plus" size={14} />}
              label={t('provider.mcp.addServer')}
              onActivate={() => setAddModal(true)}
            />
          }
        />
      ) : (
        <Flex gap={12}>
          {servers.map((srv) => (
            <MCPServerCard
              key={srv.name}
              server={srv}
              operation={operationsByServer[srv.name]}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onTest={handleTest}
              onCancel={cancelOperation}
              onReconnect={reconnectServer}
              onRecoverCleanup={recoverCleanup}
              onRetry={retryOperation}
              onEdit={() => setDetailName(srv.name)}
            />
          ))}
        </Flex>
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
          operation={operationsByServer[detailName]}
          onSave={updateServer}
          onTest={handleTest}
          onClose={() => { setDetailName(null); loadServers(); }}
        />
      )}
    </SettingsContainer>
  );
}

function MCPServerCard({
  server,
  operation,
  onToggle,
  onDelete,
  onTest,
  onCancel,
  onReconnect,
  onRecoverCleanup,
  onRetry,
  onEdit,
}: {
  server: MCPServerItem;
  operation?: CapabilityOperation;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
  onTest: (name: string) => void;
  onCancel: (name: string) => void;
  onReconnect: (name: string) => void;
  onRecoverCleanup: (name: string) => void;
  onRetry: (name: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation('provider');
  const active = operation ? isMcpOperationActive(operation.status) : false;
  const disconnected =
    operation?.status === CapabilityOperationStatus.DISCONNECTED
    || server.status === 'disconnected';
  const cleaning =
    operation?.status === CapabilityOperationStatus.SETTLING_CLEANUP;
  const retryable = isMcpOperationRetryable(operation);
  const statusName =
    operation && (
      isMcpOperationActive(operation.status)
      || operation.status !== CapabilityOperationStatus.SUCCEEDED
    )
      ? capabilityOperationStatusName(operation.status)
      : server.status || 'unknown';

  return (
    <Card
      flat
      data-pt-mcp-server={server.name}
      className="sc-mcp-card"
    >
      <Flex direction="row" justify="space-between" align="center">
        <Flex
          direction="row"
          gap={12}
          align="center"
          className="sc-mcp-card__identity"
          onClick={onEdit}
        >
          <span style={{ fontSize: 20 }}>
            {server.metaAvatar || (server.type === 'stdio' ? '💻' : '🌐')}
          </span>
          <Flex>
            <Flex direction="row" gap={6} align="center">
              <Text strong>{server.title || server.name}</Text>
              <Tag tone={transportTone(server.type)} className="sc-mcp-card__tag">
                {server.type}
              </Tag>
              <Tag
                className="sc-mcp-card__tag"
                leading={<Icon iconId={server.executionOwner === 'station' ? 'server' : 'monitor'} size={11} />}
              >
                {server.executionOwner === 'station' ? 'Station' : 'Desktop'}
              </Tag>
            </Flex>
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {server.description || server.name}
            </Text>
          </Flex>
        </Flex>
        <Flex direction="row" gap={8} align="center">
          {server.toolCount > 0 && (
            <Tag tone="success">{t('provider.mcp.tools', { count: server.toolCount })}</Tag>
          )}
          <Tooltip label={t('provider.mcp.editServer')}>
            <IconButton
              actionId={`mcp-edit-${server.name}`}
              iconId="pencil-line"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              availability={active ? { kind: 'disabled', reason: '' } : undefined}
              label={t('provider.mcp.editServer')}
              onActivate={onEdit}
            />
          </Tooltip>
          <Tooltip label={t('provider.mcp.testConnection')}>
            <IconButton
              actionId={`mcp-test-${server.name}`}
              iconId="play"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              execution={active && operation?.operationKind === 'test' ? 'pending' : 'idle'}
              availability={active ? { kind: 'disabled', reason: '' } : undefined}
              label={t('provider.mcp.testConnection')}
              onActivate={() => onTest(server.name)}
            />
          </Tooltip>
          <Tooltip label={server.enabled ? t('provider.mcp.disable') : t('provider.mcp.enable')}>
            <Switch
              checked={server.enabled}
              disabled={active}
              aria-label={server.enabled ? t('provider.mcp.disable') : t('provider.mcp.enable')}
              onCheckedChange={(checked) => onToggle(server.name, checked)}
            />
          </Tooltip>
          <ConfirmAction
            actionId={`mcp-delete-${server.name}`}
            title={t('provider.mcp.deleteConfirm')}
            confirmLabel={t('common.action.delete', { ns: 'common' })}
            cancelLabel={t('common.action.cancel', { ns: 'common' })}
            onConfirm={() => onDelete(server.name)}
          >
            <IconButton
              actionId={`mcp-delete-trigger-${server.name}`}
              iconId="delete"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              tone="danger"
              availability={active ? { kind: 'disabled', reason: '' } : undefined}
              label={t('provider.mcp.deleteConfirm')}
            />
          </ConfirmAction>
        </Flex>
      </Flex>
      {(operation || disconnected) && (
        <Flex
          gap={8}
          className="sc-mcp-operation"
          data-pt-mcp-operation-id={operation?.operationId || undefined}
          data-pt-mcp-operation-status={statusName}
        >
          <Flex direction="row" align="center" justify="space-between" gap={8}>
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {t(`provider.mcp.operation.status.${statusName}`, {
                action: operation?.operationKind || 'reconnect',
              })}
            </Text>
            <Flex direction="row" gap={6}>
              {disconnected && (
                <Button
                  actionId={`mcp-reconnect-${server.name}`}
                  density="compact"
                  leading={<Icon iconId="rotate-ccw" size={13} />}
                  label={t('provider.mcp.operation.reconnect')}
                  onActivate={() => onReconnect(server.name)}
                />
              )}
              {retryable && (
                <Button
                  actionId={`mcp-retry-${server.name}`}
                  density="compact"
                  leading={<Icon iconId="rotate-ccw" size={13} />}
                  label={t('provider.mcp.operation.retry')}
                  onActivate={() => onRetry(server.name)}
                />
              )}
              {cleaning && (
                <Button
                  actionId={`mcp-recover-${server.name}`}
                  density="compact"
                  leading={<Icon iconId="rotate-ccw" size={13} />}
                  label={t('provider.mcp.operation.recoverCleanup')}
                  onActivate={() => onRecoverCleanup(server.name)}
                />
              )}
              {active && !disconnected && !cleaning && (
                <Button
                  actionId={`mcp-cancel-${server.name}`}
                  tone="danger"
                  density="compact"
                  leading={<Icon iconId="square" size={13} />}
                  label={t('provider.mcp.operation.cancel')}
                  onActivate={() => onCancel(server.name)}
                />
              )}
            </Flex>
          </Flex>
          {operation && active && operation.progressPercent > 0 && (
            <Progress
              value={operation.progressPercent}
              maximum={100}
              showValue={operation.progressPercent > 0}
            />
          )}
          {operation?.error && (
            <Text tone="danger" style={{ fontSize: 12 }}>
              {t('provider.mcp.operation.error', {
                code: operation.error.code,
                action: operation.error.recoveryAction,
              })}
            </Text>
          )}
        </Flex>
      )}
    </Card>
  );
}

function capabilityOperationStatusName(
  status: CapabilityOperationStatus,
): string {
  switch (status) {
    case CapabilityOperationStatus.PENDING:
      return 'pending';
    case CapabilityOperationStatus.DISPATCHED:
      return 'dispatched';
    case CapabilityOperationStatus.RUNNING:
      return 'running';
    case CapabilityOperationStatus.DISCONNECTED:
      return 'disconnected';
    case CapabilityOperationStatus.RECONNECTING:
      return 'reconnecting';
    case CapabilityOperationStatus.CANCELLING:
      return 'cancelling';
    case CapabilityOperationStatus.SETTLING_CLEANUP:
      return 'cleaning';
    case CapabilityOperationStatus.SUCCEEDED:
      return 'succeeded';
    case CapabilityOperationStatus.CANCELLED:
      return 'cancelled';
    case CapabilityOperationStatus.TIMED_OUT:
      return 'timedOut';
    case CapabilityOperationStatus.CLEANUP_FAILED:
      return 'cleanupFailed';
    case CapabilityOperationStatus.UNKNOWN_SIDE_EFFECT:
      return 'unknownSideEffect';
    case CapabilityOperationStatus.FAILED:
      return 'failed';
    default:
      return 'unknown';
  }
}

const TRANSPORT_OPTIONS: ReadonlyArray<{ value: MCPTransport; label: string }> = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'HTTP' },
  { value: 'sse', label: 'SSE' },
];

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
  const [executionOwner, setExecutionOwner] = useState<'station' | 'client'>('station');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    if (!name.trim()) {
      notifyWarning(t('provider.mcp.add.nameRequired'));
      return;
    }
    if (type === 'stdio' && !command.trim()) {
      notifyWarning(t('provider.mcp.add.commandRequired'));
      return;
    }
    if ((type === 'http' || type === 'sse') && !url.trim()) {
      notifyWarning(t('provider.mcp.add.urlRequired'));
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
        executionOwner,
      });
      notifySuccess(t('provider.mcp.add.success', { name }));
      onDone();
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onDismiss={onCancel}
      title={t('provider.mcp.add.title')}
      width={560}
      closeLabel={t('common.action.cancel', { ns: 'common' })}
      footer={
        <>
          <Button
            actionId="mcp-add-cancel"
            emphasis="quiet"
            label={t('common.action.cancel', { ns: 'common' })}
            onActivate={onCancel}
          />
          <Button
            actionId="mcp-add-confirm"
            emphasis="primary"
            execution={loading ? 'pending' : 'idle'}
            label={t('common.action.add', { ns: 'common' })}
            onActivate={() => void handleOk()}
          />
        </>
      }
    >
      <div className="sc-provider-form">
        <TextField
          autoFocus
          placeholder={t('provider.mcp.add.namePlaceholder')}
          value={name}
          onValueChange={setName}
        />
        <TextField
          placeholder={t('provider.mcp.add.titlePlaceholder')}
          value={title}
          onValueChange={setTitle}
        />
        <TextField
          placeholder={t('provider.mcp.add.descPlaceholder')}
          value={description}
          onValueChange={setDescription}
        />

        <Field
          label={t('provider.mcp.add.transport')}
          className="sc-mcp-modal-field"
        >
          <Select<MCPTransport>
            value={type}
            style={{ width: 140 }}
            options={TRANSPORT_OPTIONS}
            onValueChange={(value) => {
              if (typeof value === 'string') setType(value);
            }}
          />
        </Field>
        <Field
          label={t('provider.mcp.runtime.label')}
          className="sc-mcp-modal-field"
        >
          <Select<'station' | 'client'>
            value={executionOwner}
            style={{ width: 140 }}
            options={[
              { value: 'station', label: t('provider.mcp.runtime.station') },
              { value: 'client', label: t('provider.mcp.runtime.client') },
            ]}
            onValueChange={(value) => {
              if (value === 'station' || value === 'client') setExecutionOwner(value);
            }}
          />
        </Field>

        {type === 'stdio' ? (
          <>
            <TextField
              placeholder={t('provider.mcp.add.commandPlaceholder')}
              value={command}
              onValueChange={setCommand}
            />
            <TextField
              placeholder={t('provider.mcp.add.argsPlaceholder')}
              value={args}
              onValueChange={setArgs}
            />
          </>
        ) : (
          <TextField
            placeholder={t('provider.mcp.add.urlPlaceholder')}
            value={url}
            onValueChange={setUrl}
          />
        )}
      </div>
    </Dialog>
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
      notifyWarning(t('provider.mcp.import.empty'));
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
    <Dialog
      open
      onDismiss={onCancel}
      title={t('provider.mcp.import.title')}
      width={640}
      closeLabel={t('common.action.cancel', { ns: 'common' })}
      footer={
        <>
          <Button
            actionId="mcp-import-cancel"
            emphasis="quiet"
            label={t('common.action.cancel', { ns: 'common' })}
            onActivate={onCancel}
          />
          <Button
            actionId="mcp-import-confirm"
            emphasis="primary"
            execution={loading ? 'pending' : 'idle'}
            label={t('provider.mcp.import.confirm')}
            onActivate={() => void handleOk()}
          />
        </>
      }
    >
      <div className="sc-provider-form">
        <Text tone="secondary" style={{ fontSize: 12 }}>
          {t('provider.mcp.import.hint')}
        </Text>
        <TextArea
          className="sc-mcp-import-area"
          value={text}
          onValueChange={setText}
          placeholder={t('provider.mcp.import.placeholder')}
          rows={12}
        />
      </div>
    </Dialog>
  );
}

function MCPServerEditModal({
  name,
  operation,
  onSave,
  onTest,
  onClose,
}: {
  name: string;
  operation?: CapabilityOperation;
  onSave: (name: string, data: Partial<MCPServerRecord>) => Promise<void>;
  onTest: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('provider');
  const [server, setServer] = useState<MCPServerRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<MCPTransport>('stdio');
  const [executionOwner, setExecutionOwner] = useState<'station' | 'client'>('station');
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
      setExecutionOwner(s.executionOwner || 'station');
      setCommand(s.command || '');
      setArgs(s.args?.join(' ') || '');
      setUrl(s.url || '');
      setEnvText(s.env ? JSON.stringify(s.env, null, 2) : '{}');
    }).catch((err) => log.error('mcp', 'Failed to load MCP server', { error: String(err) }));
  }, [name]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let env: Record<string, string> = {};
      if (envText.trim()) {
        try {
          env = JSON.parse(envText);
        } catch {
          notifyWarning(t('provider.mcp.edit.envInvalid'));
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
        executionOwner,
      });
      notifySuccess(t('provider.mcp.edit.saved'));
      onClose();
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!server) return null;

  const operationTone: Tone = operation
    ? operation.status === CapabilityOperationStatus.SUCCEEDED
      ? 'success'
      : isMcpOperationActive(operation.status)
        ? 'info'
        : 'danger'
    : 'neutral';

  return (
    <Dialog
      open
      onDismiss={onClose}
      title={t('provider.mcp.edit.title', { name: server.title || server.name })}
      width={640}
      closeLabel={t('common.action.close', { ns: 'common' })}
      footer={
        <>
          <Button
            actionId="mcp-edit-test"
            execution={operation && isMcpOperationActive(operation.status) ? 'pending' : 'idle'}
            leading={<Icon iconId="play" size={14} />}
            label={t('provider.mcp.testConnection')}
            onActivate={() => void onTest(name)}
          />
          <Button
            actionId="mcp-edit-close"
            emphasis="quiet"
            label={t('common.action.close', { ns: 'common' })}
            onActivate={onClose}
          />
          <Button
            actionId="mcp-edit-save"
            emphasis="primary"
            execution={saving ? 'pending' : 'idle'}
            label={t('provider.mcp.edit.save')}
            onActivate={() => void handleSave()}
          />
        </>
      }
    >
      <div className="sc-mcp-edit">
        <Flex direction="row" gap={8} wrap="wrap">
          <Tag tone={transportTone(server.type)}>{server.type}</Tag>
          {server.version && <Tag>v{server.version}</Tag>}
          <Tag tone={server.enabled ? 'success' : 'neutral'}>
            {server.enabled ? t('provider.mcp.detail.enabled') : t('provider.mcp.detail.disabled')}
          </Tag>
        </Flex>

        <Field label={t('provider.mcp.add.title')}>
          <TextField value={title} onValueChange={setTitle} />
        </Field>
        <Field label={t('provider.mcp.add.descPlaceholder')}>
          <TextField value={description} onValueChange={setDescription} />
        </Field>

        <Field label={t('provider.mcp.add.transport')} className="sc-mcp-modal-field">
          <Select<MCPTransport>
            value={type}
            style={{ width: 140 }}
            options={TRANSPORT_OPTIONS}
            onValueChange={(value) => {
              if (typeof value === 'string') setType(value);
            }}
          />
        </Field>
        <Field label={t('provider.mcp.runtime.label')} className="sc-mcp-modal-field">
          <Select<'station' | 'client'>
            value={executionOwner}
            style={{ width: 140 }}
            options={[
              { value: 'station', label: t('provider.mcp.runtime.station') },
              { value: 'client', label: t('provider.mcp.runtime.client') },
            ]}
            onValueChange={(value) => {
              if (value === 'station' || value === 'client') setExecutionOwner(value);
            }}
          />
        </Field>

        {type === 'stdio' ? (
          <>
            <Field label={t('provider.mcp.detail.command')}>
              <TextField value={command} onValueChange={setCommand} />
            </Field>
            <Field label={t('provider.mcp.detail.args')}>
              <TextField
                value={args}
                onValueChange={setArgs}
                placeholder={t('provider.mcp.add.argsPlaceholder')}
              />
            </Field>
            <Field label={t('provider.mcp.detail.env')}>
              <TextArea
                className="sc-mcp-env-area"
                value={envText}
                onValueChange={setEnvText}
                rows={4}
                placeholder='{"KEY": "value"}'
              />
              {server.envKeys && server.envKeys.length > 0 && (
                <Text tone="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                  {t('provider.mcp.edit.secretKeysStored', {
                    keys: server.envKeys.join(', '),
                  })}
                </Text>
              )}
            </Field>
          </>
        ) : (
          <Field label={t('provider.mcp.detail.url')}>
            <TextField value={url} onValueChange={setUrl} />
          </Field>
        )}

        {operation && (
          <Flex
            gap={4}
            className="sc-mcp-operation"
            data-tone={operationTone}
            data-pt-mcp-operation-id={operation.operationId}
            data-pt-mcp-operation-status={capabilityOperationStatusName(operation.status)}
          >
            <Flex direction="row" gap={6} align="center">
              <Text strong>
                {t(
                  `provider.mcp.operation.status.${capabilityOperationStatusName(operation.status)}`,
                  { action: operation.operationKind },
                )}
              </Text>
            </Flex>
            {operation.error && (
              <Text tone="danger" style={{ fontSize: 12 }}>
                {t('provider.mcp.operation.error', {
                  code: operation.error.code,
                  action: operation.error.recoveryAction,
                })}
              </Text>
            )}
          </Flex>
        )}
      </div>
    </Dialog>
  );
}
