import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Spin, Segmented, Tabs, Typography, theme } from 'antd';
import { Plus, RefreshCw } from 'lucide-react';
import { ai } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import AIProviderSelect from '../components/AIProviderSelect';
import AICLIProfiles from '../components/AICLIProfiles';
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
  const profileDefaults = useAIStore((s) => s.profileDefaults);
  const policy = useAIStore((s) => s.policy);
  const detail = useAIStore((s) => s.detail);
  const access = useAIStore((s) => s.access);
  const selected = useAIStore((s) => s.selected);
  const error = useAIStore((s) => s.error);
  const loading = useAIStore((s) => s.loading);
  const refresh = useAIStore((s) => s.refresh);
  const select = useAIStore((s) => s.select);
  const [creating, setCreating] = useState(false);
  const [method, setMethod] = useState<'http' | 'cli'>('http');
  const [section, setSection] = useState('connection');
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
  const changeMethod = (next: 'http' | 'cli') => {
    setMethod(next);
    const first = providers.find((p) => (p.runtime_kind === 'cli' ? 'cli' : 'http') === next);
    if (first) void select(next === 'cli'
      ? profileDefaults.find((item) => item.cli_adapter_id === (first.cli_adapter_id || first.id))?.provider_id || first.id
      : first.id);
  };
  useEffect(() => {
    if (detail) setMethod(detail.runtime_kind === 'cli' ? 'cli' : 'http');
  }, [detail?.id]);
  useEffect(() => { setSection('connection'); }, [selected]);
  const currentDetail = detail && (detail.runtime_kind === 'cli' ? 'cli' : 'http') === method ? detail : null;
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
      <div className="ai-provider-toolbar">
        <div className="ai-provider-controls">
          <Segmented aria-label={t('ai.connectionMethod')} value={method}
            options={[{ value: 'http', label: t('ai.dmMethod') }, { value: 'cli', label: t('ai.cliMethod') }]}
            onChange={changeMethod} />
          <AIProviderSelect key={method} method={method} />
        </div>
        <div className="ai-actions">
          <Button loading={loading} icon={<RefreshCw size={14} />} onClick={() => void refresh()}
            aria-label={t('refresh')} title={t('refresh')} />
          {method !== 'cli' && <Button icon={<Plus size={14} />} onClick={() => { setLocalError(''); setCreating(true); }}>{t('ai.addProvider')}</Button>}
        </div>
      </div>
      <main className="ai-provider-editor">
        {currentDetail ? (
          <div key={currentDetail.id}>
            {method === 'cli' && <AICLIProfiles provider={currentDetail} />}
            <Tabs activeKey={section} onChange={setSection} items={[
              { key: 'connection', label: t('ai.connection') },
              { key: 'models', label: t('ai.models') },
              { key: 'access', label: t('ai.userAccess') },
              { key: 'verify', label: t('ai.verifyAndUse') },
            ]} />
            <div hidden={section !== 'connection'}>
              <AIProviderSettings provider={currentDetail} />
            </div>
            {section === 'models' && <AIModelEditor provider={currentDetail} />}
            {section === 'access' && access && (Number(currentDetail.version) > 0
              ? <AIGrantEditor key={`${currentDetail.id}:${access.revision}`} provider={currentDetail} access={access} />
              : <Typography.Paragraph type="secondary">{t('ai.configureBeforeGrant')}</Typography.Paragraph>)}
            {section === 'verify' && (Number(currentDetail.version) > 0
              ? <AIModelVerification key={`${currentDetail.id}:${currentDetail.version}:${access?.revision}:${policy?.revision}`} provider={currentDetail} />
              : <Typography.Paragraph type="secondary">{t('ai.configureBeforeGrant')}</Typography.Paragraph>)}
          </div>
        ) : selected && !error && loading ? <Spin /> : <Typography.Text type="secondary">{t('ai.selectProvider')}</Typography.Text>}
      </main>
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
