// Custom Plugins Page — UI for managing user-defined JSON Schema tool endpoints.
// Part of P3-M3 "Custom Plugins" milestone.

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Card, Form, Input, Select, Switch, Modal, Badge, Empty, Popconfirm, Collapse, theme } from 'antd';
import { Plus, Trash2, Play, Edit3, Plug } from 'lucide-react';
import { useCustomPluginsStore, type CustomPlugin, type AuthType, type HttpMethod } from '../store/customPlugins';

const { TextArea } = Input;
const { useToken } = theme;

// ── Plugin Form Modal ──

interface PluginFormValues {
  name: string;
  description: string;
  endpoint: string;
  method: HttpMethod;
  authType: AuthType;
  authValue: string;
  inputSchema: string;
  outputSchema: string;
  enabled: boolean;
}

interface PluginFormModalProps {
  open: boolean;
  editingPlugin: CustomPlugin | null;
  onClose: () => void;
  onSubmit: (values: PluginFormValues) => void;
}

function PluginFormModal({ open, editingPlugin, onClose, onSubmit }: PluginFormModalProps) {
  const { t } = useTranslation('agent');
  const [form] = Form.useForm<PluginFormValues>();

  useEffect(() => {
    if (open && editingPlugin) {
      form.setFieldsValue({
        name: editingPlugin.name,
        description: editingPlugin.description,
        endpoint: editingPlugin.endpoint,
        method: editingPlugin.method,
        authType: editingPlugin.authType,
        authValue: editingPlugin.authValue,
        inputSchema: editingPlugin.inputSchema,
        outputSchema: editingPlugin.outputSchema,
        enabled: editingPlugin.enabled,
      });
    } else if (open) {
      form.resetFields();
      form.setFieldsValue({
        method: 'POST',
        authType: 'none',
        authValue: '',
        enabled: true,
        inputSchema: '{\n  "type": "object",\n  "properties": {}\n}',
        outputSchema: '{\n  "type": "object",\n  "properties": {}\n}',
      });
    }
  }, [open, editingPlugin, form]);

  const handleOk = useCallback(() => {
    form.validateFields().then((values) => {
      onSubmit(values);
      onClose();
    });
  }, [form, onSubmit, onClose]);

  return (
    <Modal
      open={open}
      title={editingPlugin ? t('agent.plugins.edit') : t('agent.plugins.create')}
      onCancel={onClose}
      onOk={handleOk}
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item
          name="name"
          label={t('agent.plugins.name')}
          rules={[{ required: true, message: t('agent.plugins.nameRequired') }]}
        >
          <Input />
        </Form.Item>

        <Form.Item name="description" label={t('agent.plugins.description')}>
          <Input />
        </Form.Item>

        <Form.Item
          name="endpoint"
          label={t('agent.plugins.endpoint')}
          rules={[{ required: true, type: 'url', message: t('agent.plugins.endpointInvalid') }]}
        >
          <Input placeholder="https://api.example.com/tool" />
        </Form.Item>

        <Flexbox horizontal gap={16}>
          <Form.Item name="method" label={t('agent.plugins.method')} style={{ flex: 1 }}>
            <Select
              options={[
                { label: 'GET', value: 'GET' },
                { label: 'POST', value: 'POST' },
              ]}
            />
          </Form.Item>

          <Form.Item name="authType" label={t('agent.plugins.auth')} style={{ flex: 1 }}>
            <Select
              options={[
                { label: t('agent.plugins.auth.none'), value: 'none' },
                { label: t('agent.plugins.auth.bearer'), value: 'bearer' },
                { label: t('agent.plugins.auth.apiKey'), value: 'api-key' },
              ]}
            />
          </Form.Item>
        </Flexbox>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.authType !== cur.authType}>
          {({ getFieldValue }) =>
            getFieldValue('authType') !== 'none' ? (
              <Form.Item name="authValue" label={t('agent.plugins.authValue')}>
                <Input.Password />
              </Form.Item>
            ) : null
          }
        </Form.Item>

        <Form.Item name="inputSchema" label={t('agent.plugins.inputSchema')}>
          <TextArea rows={4} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </Form.Item>

        <Form.Item name="outputSchema" label={t('agent.plugins.outputSchema')}>
          <TextArea rows={4} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </Form.Item>

        <Form.Item name="enabled" label={t('agent.plugins.enabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ── Test Panel ──

interface TestPanelProps {
  plugin: CustomPlugin;
}

function TestPanel({ plugin }: TestPanelProps) {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const testing = useCustomPluginsStore((s) => s.testing[plugin.id] ?? false);
  const testResult = useCustomPluginsStore((s) => s.testResults[plugin.id]);
  const testPlugin = useCustomPluginsStore((s) => s.testPlugin);

  const [input, setInput] = useState(() => {
    try {
      const schema = JSON.parse(plugin.inputSchema);
      return JSON.stringify(schema.example ?? {}, null, 2);
    } catch {
      return '{}';
    }
  });

  const handleTest = useCallback(() => {
    void testPlugin(plugin.id, input);
  }, [testPlugin, plugin.id, input]);

  return (
    <Flexbox gap={12} style={{ padding: `${token.paddingSM}px 0` }}>
      <TextArea
        rows={4}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
        placeholder={t('agent.plugins.testInputPlaceholder')}
      />
      <Button
        type="primary"
        icon={<Play size={14} />}
        loading={testing}
        onClick={handleTest}
      >
        {t('agent.plugins.test')}
      </Button>
      {testResult && (
        <Flexbox
          style={{
            padding: token.paddingSM,
            borderRadius: token.borderRadius,
            background: testResult.success ? token.colorSuccessBg : token.colorErrorBg,
            border: `1px solid ${testResult.success ? token.colorSuccessBorder : token.colorErrorBorder}`,
          }}
        >
          <Flexbox horizontal gap={8} style={{ marginBottom: 4, fontSize: 12 }}>
            <span>
              {t('agent.plugins.testResult')}: {testResult.statusCode ?? 'N/A'}
            </span>
            <span>{testResult.durationMs}ms</span>
          </Flexbox>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              fontFamily: 'monospace',
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {testResult.error ?? testResult.body}
          </pre>
        </Flexbox>
      )}
    </Flexbox>
  );
}

// ── Plugin Card ──

interface PluginCardProps {
  plugin: CustomPlugin;
  onEdit: (plugin: CustomPlugin) => void;
}

function PluginCard({ plugin, onEdit }: PluginCardProps) {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const toggleEnabled = useCustomPluginsStore((s) => s.toggleEnabled);
  const deletePlugin = useCustomPluginsStore((s) => s.deletePlugin);

  const statusColor = plugin.enabled ? token.colorSuccess : token.colorTextDisabled;
  const statusText = plugin.enabled ? t('agent.plugins.enabled') : t('agent.plugins.disabled');

  return (
    <Card
      size="small"
      style={{ width: '100%' }}
      title={
        <Flexbox horizontal align="center" gap={8}>
          <Plug size={14} />
          <span>{plugin.name}</span>
          <Badge color={statusColor} text={statusText} style={{ fontSize: 11 }} />
        </Flexbox>
      }
      extra={
        <Flexbox horizontal gap={4}>
          <Switch
            size="small"
            checked={plugin.enabled}
            onChange={() => toggleEnabled(plugin.id)}
          />
          <Button
            type="text"
            size="small"
            icon={<Edit3 size={14} />}
            onClick={() => onEdit(plugin)}
          />
          <Popconfirm
            title={t('agent.plugins.deleteConfirm')}
            onConfirm={() => deletePlugin(plugin.id)}
          >
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
          </Popconfirm>
        </Flexbox>
      }
    >
      <Flexbox gap={4}>
        <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
          {plugin.method} {plugin.endpoint}
        </span>
        {plugin.description && (
          <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
            {plugin.description}
          </span>
        )}
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'test',
              label: t('agent.plugins.test'),
              children: <TestPanel plugin={plugin} />,
            },
          ]}
        />
      </Flexbox>
    </Card>
  );
}

// ── Main Page ──

export function CustomPluginsPage() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const plugins = useCustomPluginsStore((s) => s.plugins);
  const loadPlugins = useCustomPluginsStore((s) => s.loadPlugins);
  const createPlugin = useCustomPluginsStore((s) => s.createPlugin);
  const updatePlugin = useCustomPluginsStore((s) => s.updatePlugin);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlugin, setEditingPlugin] = useState<CustomPlugin | null>(null);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const handleCreate = useCallback(() => {
    setEditingPlugin(null);
    setModalOpen(true);
  }, []);

  const handleEdit = useCallback((plugin: CustomPlugin) => {
    setEditingPlugin(plugin);
    setModalOpen(true);
  }, []);

  const handleSubmit = useCallback(
    (values: PluginFormValues) => {
      if (editingPlugin) {
        updatePlugin(editingPlugin.id, values);
      } else {
        createPlugin(values);
      }
    },
    [editingPlugin, createPlugin, updatePlugin],
  );

  return (
    <Flexbox
      style={{
        height: '100%',
        padding: token.paddingLG,
        overflow: 'auto',
      }}
    >
      <Flexbox horizontal justify="space-between" align="center" style={{ marginBottom: token.marginLG }}>
        <h2 style={{ margin: 0, fontSize: token.fontSizeHeading4 }}>{t('agent.plugins.title')}</h2>
        <Button type="primary" icon={<Plus size={14} />} onClick={handleCreate}>
          {t('agent.plugins.create')}
        </Button>
      </Flexbox>

      {plugins.length === 0 ? (
        <Empty description={t('agent.plugins.empty')} style={{ marginTop: 80 }} />
      ) : (
        <Flexbox gap={12}>
          {plugins.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} onEdit={handleEdit} />
          ))}
        </Flexbox>
      )}

      <PluginFormModal
        open={modalOpen}
        editingPlugin={editingPlugin}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </Flexbox>
  );
}
