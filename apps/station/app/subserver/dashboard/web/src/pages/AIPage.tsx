import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Spin, Segmented, Tag, Typography, theme } from 'antd';
import { Plus, RefreshCw } from 'lucide-react';
import { ai } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import AIProviderInstall from '../components/AIProviderInstall';
import AIUserPolicy from '../components/AIUserPolicy';
import AIModelVerification from '../components/AIModelVerification';
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
  const [method, setMethod] = useState('http');
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
  const changeMethod = (next: string) => {
    setMethod(next);
    const first = providers.find((p) => (p.runtime_kind === 'cli' ? 'cli' : 'http') === next);
    if (first) void select(first.id);
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
      {policy && <AIUserPolicy key={String(policy.revision)} policy={policy} />}
      <div className="ai-section-heading">
        <Typography.Title level={5}>{t('ai.shared')}</Typography.Title>
        <div className="ai-actions">
          <Button loading={loading} icon={<RefreshCw size={14} />} onClick={() => void refresh()}>{t('refresh')}</Button>
          {method !== 'cli' && <Button icon={<Plus size={14} />} onClick={() => { setLocalError(''); setCreating(true); }}>{t('ai.addProvider')}</Button>}
        </div>
      </div>
      <div className="ai-workspace">
        <aside className="ai-provider-list" aria-label={t('ai.shared')}>
          <Typography.Text strong>{t('ai.connectionMethod')}</Typography.Text>
          <Segmented aria-label={t('ai.connectionMethod')} value={method}
            options={[{ value: 'http', label: t('ai.dmMethod') }, { value: 'cli', label: t('ai.cliMethod') }]}
            onChange={changeMethod} />
          <Input.Search aria-label={t('ai.search')} placeholder={t('ai.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          {providers.filter((p) => (p.runtime_kind === 'cli' ? 'cli' : 'http') === method &&
            `${p.name} ${p.id}`.toLowerCase().includes(search.toLowerCase())).map((p) => (
            <button key={p.id} className="ai-provider-option" aria-pressed={selected === p.id} onClick={() => void select(p.id)}>
              <span><strong>{p.name}</strong><small>{p.runtime_kind === 'cli' ? t('ai.cliAdapter') : p.protocol || t('ai.directModel')}</small></span>
              <Tag color={p.enabled ? 'success' : 'default'}>{t(p.enabled ? 'enabled' : 'disabled')}</Tag>
            </button>
          ))}
          {!providers.length && !loading && <Typography.Text type="secondary">{t('ai.noProviders')}</Typography.Text>}
        </aside>
        <main className="ai-provider-editor">
          {detail ? (
            <div key={detail.id}>
              <Typography.Title level={4}>{detail.name}</Typography.Title>
              <Typography.Paragraph type="secondary">{detail.description || detail.id}</Typography.Paragraph>
              <Typography.Paragraph>{t('ai.lifecycle')}</Typography.Paragraph>
              {detail.runtime_kind === 'cli' && <AIProviderInstall provider={detail} />}
              <AIProviderSettings provider={detail} />
              <AIModelEditor provider={detail} />
              {access && (Number(detail.version) > 0
                ? <AIGrantEditor key={`${detail.id}:${access.revision}`} provider={detail} access={access} />
                : <Typography.Paragraph type="secondary">{t('ai.configureBeforeGrant')}</Typography.Paragraph>)}
              {Number(detail.version) > 0 && <AIModelVerification
                key={`${detail.id}:${detail.version}:${access?.revision}:${policy?.revision}`} provider={detail} />}
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
