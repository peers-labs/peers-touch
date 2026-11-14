import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Switch, Tag, Typography } from 'antd';
import { Plus, RefreshCw } from 'lucide-react';
import { ai, type ModelInfo, type Provider } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import { t } from '../i18n';

const FLAGS = [
  ['streaming', 'streaming'], ['native-tools', 'tools'], ['image-input', 'imageInput'],
  ['reasoning', 'reasoning'], ['image-output', 'imageOutput'],
] as const;
export default function AIModelEditor({ provider }: { provider: Provider }) {
  const models = useAIStore((s) => s.models);
  const refresh = useAIStore((s) => s.refresh);
  const [editing, setEditing] = useState<ModelInfo | 'new' | null>(null);
  const { busy, error, run, current } = useControlPlaneAction(refresh);
  const [form] = Form.useForm();
  const version = (id: string) => models.find((m) => m.model_id === id)?.version ?? 0;
  const edit = (model: ModelInfo | 'new') => {
    form.resetFields();
    form.setFieldsValue(model === 'new' ? { enabled: true, flags: [] } : {
      ...model, flags: FLAGS.filter(([id]) => model.capabilities?.flags[id]).map(([id]) => id),
    });
    setEditing(model);
  };
  const save = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !current() || !editing) return;
    const oldFlags = editing && editing !== 'new' ? editing.capabilities?.flags || {} : {};
    const flags = { ...oldFlags, ...Object.fromEntries(FLAGS.map(([id]) => [id, (values.flags || []).includes(id)])) };
    const body = {
      display_name: values.display_name, enabled: values.enabled,
      context_window: values.context_window, capabilities: { flags },
    };
    const success = await run(() => editing === 'new'
      ? ai.createModel(provider.id, { ...body, model_id: values.id })
      : ai.updateModel(provider.id, (editing as ModelInfo).id, version((editing as ModelInfo).id), body));
    if (success) setEditing(null);
  };
  return (
    <section className="ai-editor-section">
      <div className="ai-section-heading">
        <Typography.Title level={5}>{t('ai.models')}</Typography.Title>
        <div className="ai-actions">
          {!provider.backend_provider_id && provider.adapter_capabilities?.model_discovery && <Button disabled={busy} icon={<RefreshCw size={14} />}
            onClick={() => void run(() => ai.discover(provider.id))}>{t('ai.discoverModels')}</Button>}
          {provider.runtime_kind !== 'cli' && <Button icon={<Plus size={14} />} onClick={() => edit('new')}>{t('ai.addModel')}</Button>}
        </div>
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      {!provider.models.length && <Typography.Paragraph type="secondary">{t(provider.runtime_kind === 'cli' ? 'ai.noCliModels' : 'ai.noModels')}</Typography.Paragraph>}
      {provider.models.map((model) => (
        <div key={model.id} className="ai-model-row">
          <div className="ai-model-label">
            <Typography.Text strong>{model.display_name || model.id}</Typography.Text>
            <Typography.Text type="secondary">{model.id} · {model.context_window ? t('ai.contextSize', { count: model.context_window.toLocaleString() }) : t('ai.noContext')}</Typography.Text>
          </div>
          {provider.runtime_kind !== 'cli' && <Button size="small" onClick={() => edit(model)}>{t('edit')}</Button>}
          {provider.runtime_kind === 'cli' ? <Tag>{t(model.enabled ? 'enabled' : 'disabled')}</Tag> : <>
            <Switch aria-label={t('ai.enableModel', { name: model.display_name || model.id })} checked={model.enabled} disabled={busy}
              onChange={(enabled) => void run(() => ai.updateModel(provider.id, model.id, version(model.id), { enabled }))} />
          </>}
        </div>
      ))}
      <Modal title={t(editing === 'new' ? 'ai.addModel' : 'ai.editModel')} open={!!editing} onCancel={() => setEditing(null)}
        onOk={() => void save()} confirmLoading={busy} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="id" label={t('ai.modelId')} rules={[{ required: true }]}><Input disabled={editing !== 'new'} /></Form.Item>
          <Form.Item name="display_name" label={t('name')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="enabled" label={t('enabled')} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="context_window" label={t('ai.contextWindow')} extra={t('ai.contextWindowHint')}
            rules={[{ required: true, type: 'integer', min: 2, max: 10000000, message: t('ai.invalidContextWindow') }]}>
            <InputNumber min={2} max={10000000} precision={0} />
          </Form.Item>
          <Form.Item name="flags" label={t('ai.capabilities')}><Checkbox.Group options={FLAGS.map(([value, label]) => ({ value, label: t(`ai.flags.${label}`) }))} /></Form.Item>
        </Form>
        {error && <Alert type="error" title={error} />}
      </Modal>
    </section>
  );
}
