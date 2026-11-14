import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select } from 'antd';
import { Plus, Star } from 'lucide-react';
import { ai, type Provider } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import { t } from '../i18n';

/** Profiles own model connections; their adapter owns the shared installation. */
export default function AICLIProfiles({ provider }: { provider: Provider }) {
  const providers = useAIStore((s) => s.providers);
  const defaults = useAIStore((s) => s.profileDefaults);
  const select = useAIStore((s) => s.select);
  const refresh = useAIStore((s) => s.refresh);
  const adapter = provider.cli_adapter_id || provider.id;
  const profiles = providers.filter((p) => p.runtime_kind === 'cli' && (p.cli_adapter_id || p.id) === adapter);
  const preference = defaults.find((item) => item.cli_adapter_id === adapter);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const { busy, error, run, current } = useControlPlaneAction(refresh);
  const create = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !current()) return;
    const suffix = [...crypto.getRandomValues(new Uint8Array(12))].map((value) => value.toString(16).padStart(2, '0')).join('');
    const id = `${adapter}-${suffix}`;
    const ok = await run(async () => {
      await ai.create({ provider_id: id, display_name: values.name, protocol: 'cli', base_url: '', cli_adapter_id: adapter });
      if (current()) setCreating(false);
    });
    if (ok) await select(id);
  };
  return <div className="ai-editor-section">
    {error && <Alert type="error" showIcon title={error} />}
    <div className="ai-profile-toolbar">
      <Select aria-label={t('ai.profile')} className="ai-profile-select" value={provider.id}
        onChange={(id) => void select(id)} options={profiles.map((p) => ({
          value: p.id, label: `${p.name}${preference?.provider_id === p.id ? ` · ${t('ai.defaultProfile')}` : ''}`,
        }))} />
      <Button icon={<Plus size={14} />} onClick={() => { form.resetFields(); setCreating(true); }}>{t('ai.addProfile')}</Button>
      <Button icon={<Star size={14} />} loading={busy}
        disabled={Number(provider.version) === 0 || preference?.provider_id === provider.id}
        onClick={() => void run(() => ai.setCLIProfileDefault(adapter, provider.id, preference?.revision || 0))}>
        {t(preference?.provider_id === provider.id ? 'ai.defaultProfile' : 'ai.setDefaultProfile')}
      </Button>
    </div>
    <Modal title={t('ai.addProfile')} open={creating} onCancel={() => setCreating(false)}
      onOk={() => void create()} confirmLoading={busy} destroyOnHidden>
      <Form name="cli-profile-create" form={form} layout="vertical">
        <Form.Item name="name" label={t('ai.profileName')} rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
      </Form>
      {error && <Alert type="error" title={error} />}
    </Modal>
  </div>;
}
