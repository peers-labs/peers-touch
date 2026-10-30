import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Spin, Switch, Tag, Typography, theme } from 'antd';
import { Plus, RefreshCw } from 'lucide-react';
import { ai } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import AIInstallers from '../components/AIInstallers';
import AIProviderSettings from '../components/AIProviderSettings';
import AIModelEditor from '../components/AIModelEditor';
import AIGrantEditor from '../components/AIGrantEditor';
import PageHeader from '../components/PageHeader';
import { t } from '../i18n';

export default function AIPage() {
  const { token } = theme.useToken();
  const providers = useAIStore((s) => s.providers);
  const policy = useAIStore((s) => s.policy);
  const detail = useAIStore((s) => s.detail);
  const access = useAIStore((s) => s.access);
  const selected = useAIStore((s) => s.selected);
  const error = useAIStore((s) => s.error);
  const loading = useAIStore((s) => s.loading);
  const refresh = useAIStore((s) => s.refresh);
  const select = useAIStore((s) => s.select);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const { busy, error: localError, setError: setLocalError, run, current } = useControlPlaneAction(refresh);
  const [form] = Form.useForm();
  useEffect(() => {
    void refresh();
    let tick = 0;
    const timer = window.setInterval(() => {
      tick++;
      const store = useAIStore.getState();
      if (Object.values(store.installs).some((job) => job.install_state === 'installing') || tick % 8 === 0) void store.pollInstalls();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const changePolicy = async (enabled: boolean) => {
    if (!policy) return;
    await run(() => ai.setPolicy({ ...policy, personal_providers_enabled: enabled }));
  };
  const create = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !current()) return;
    const success = await run(async () => {
      await ai.create(values);
      if (!current()) return;
      setCreating(false); form.resetFields();
    });
    if (success) await select(values.provider_id);
  };
  return (
    <div className="ai-page" style={{ '--ai-border': token.colorBorderSecondary, '--ai-selected': token.colorPrimaryBg } as React.CSSProperties}>
      <PageHeader title={t('ai.title')} subtitle={t('ai.subtitle')} />
      {(error || localError) && <Alert type="error" showIcon title={error || localError}
        action={<Button onClick={() => void refresh()}>{t('refresh')}</Button>} />}
      <div className="ai-policy">
        <div>
          <Typography.Text strong>{t('ai.allowPersonal')}</Typography.Text>
          <Typography.Paragraph type="secondary">{t('ai.personalHint')}</Typography.Paragraph>
        </div>
        <Switch aria-label={t('ai.allowPersonal')} checked={policy?.personal_providers_enabled || false}
          disabled={!policy || busy} onChange={(enabled) => void changePolicy(enabled)} />
      </div>
      <AIInstallers />
      <div className="ai-section-heading">
        <Typography.Title level={5}>{t('ai.shared')}</Typography.Title>
        <div className="ai-actions">
          <Button loading={loading} icon={<RefreshCw size={14} />} onClick={() => void refresh()}>{t('refresh')}</Button>
          <Button icon={<Plus size={14} />} onClick={() => { setLocalError(''); setCreating(true); }}>{t('ai.addProvider')}</Button>
        </div>
      </div>
      <div className="ai-workspace">
        <aside className="ai-provider-list" aria-label={t('ai.shared')}>
          <Input.Search aria-label={t('ai.search')} placeholder={t('ai.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          {providers.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase())).map((p) => (
            <button key={p.id} className="ai-provider-option" aria-pressed={selected === p.id} onClick={() => void select(p.id)}>
              <span><strong>{p.name}</strong><small>{p.runtime_kind === 'cli' ? t('ai.cliAdapter') : p.protocol || t('ai.directModel')}</small></span>
              <Tag color={p.enabled ? 'success' : 'default'}>{t(p.enabled ? 'enabled' : 'disabled')}</Tag>
            </button>
          ))}
          {!providers.length && !loading && <Typography.Text type="secondary">{t('ai.noProviders')}</Typography.Text>}
        </aside>
        <main className="ai-provider-editor">
          {detail ? (
            <div key={`${detail.id}:${detail.version}`}>
              <Typography.Title level={4}>{detail.name}</Typography.Title>
              <Typography.Paragraph type="secondary">{detail.description || detail.id}</Typography.Paragraph>
              <AIProviderSettings provider={detail} />
              <AIModelEditor provider={detail} />
              {access && (Number(detail.version) > 0
                ? <AIGrantEditor key={`${detail.id}:${access.revision}`} provider={detail} access={access} />
                : <Typography.Paragraph type="secondary">{t('ai.configureBeforeGrant')}</Typography.Paragraph>)}
            </div>
          ) : selected && !error ? <Spin /> : <Typography.Text type="secondary">{t('ai.selectProvider')}</Typography.Text>}
        </main>
      </div>
      <Modal title={t('ai.addShared')} open={creating} onCancel={() => setCreating(false)} onOk={() => void create()} confirmLoading={busy}>
        <Form form={form} layout="vertical" initialValues={{ protocol: 'openai' }}>
          <Form.Item name="provider_id" label={t('ai.providerId')} rules={[{ required: true }, { pattern: /^[a-z0-9_-]+$/, message: t('ai.invalidId') }]}><Input /></Form.Item>
          <Form.Item name="display_name" label={t('name')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="protocol" label={t('ai.protocol')}><Select options={[{ value: 'openai', label: t('ai.openaiCompatible') }, { value: 'anthropic', label: 'Anthropic' }]} /></Form.Item>
          <Form.Item name="base_url" label={t('ai.baseUrl')} rules={[{ required: true }, { type: 'url' }]}><Input /></Form.Item>
        </Form>
        {localError && <Alert type="error" title={localError} />}
      </Modal>
    </div>
  );
}
