import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Popconfirm, Select, Switch, Typography } from 'antd';
import { ai, type Provider, type RuntimeConfig } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import { t } from '../i18n';

export default function AIProviderSettings({ provider }: { provider: Provider }) {
  const [form] = Form.useForm();
  const [key, setKey] = useState('');
  const credential = useAIStore((s) => s.credential);
  const refresh = useAIStore((s) => s.refresh);
  const { busy, error, setError, run, current } = useControlPlaneAction(refresh);
  const cli = provider.runtime_kind === 'cli';
  const capabilities = provider.adapter_capabilities;
  const save = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !current()) return;
    let runtime_config: RuntimeConfig | undefined;
    if (cli) {
      try {
        const startup_args = JSON.parse(values.startup_args || '[]');
        const environment = JSON.parse(values.environment || '{}');
        if (!Array.isArray(startup_args) || startup_args.some((arg) => typeof arg !== 'string')
          || !environment || Array.isArray(environment) || typeof environment !== 'object'
          || Object.values(environment).some((value) => typeof value !== 'string')) throw new Error();
        runtime_config = {
          default_model: values.default_model || '',
          startup_args, environment, timeout_seconds: values.timeout_seconds || 0,
        };
      } catch { setError(t('ai.invalidRuntime')); return; }
    }
    await run(() => ai.update(provider.id, provider.version, {
      display_name: values.name, enabled: values.enabled,
      ...(cli ? { runtime_config } : { base_url: values.base_url }),
    }));
  };
  return (
    <div className="ai-editor-section">
      {error && <Alert type="error" showIcon title={error} />}
      <Typography.Title level={5}>{t('ai.configuration')}</Typography.Title>
      <Form form={form} layout="vertical" initialValues={{
        name: provider.name, enabled: provider.enabled, base_url: provider.base_url,
        default_model: provider.runtime_config?.default_model || '',
        startup_args: JSON.stringify(provider.runtime_config?.startup_args || []),
        environment: JSON.stringify(provider.runtime_config?.environment || {}, null, 2),
        timeout_seconds: provider.runtime_config?.timeout_seconds || 0,
      }}>
        <div className="ai-form-grid">
          <Form.Item name="name" label={t('name')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="enabled" label={t('ai.enabledForUsers')} valuePropName="checked"><Switch /></Form.Item>
        </div>
        {!cli && <Form.Item name="base_url" label={t('ai.baseUrl')} rules={[{ required: true }, { type: 'url' }]}><Input placeholder="https://api.example.com/v1" /></Form.Item>}
        {cli && (
          <>
            <Form.Item name="default_model" label={t('ai.defaultModel')}>
              <Select allowClear options={provider.models.map((model) => ({
                value: model.id, label: model.display_name || model.id,
              }))} />
            </Form.Item>
            {capabilities?.startup_args && <Form.Item name="startup_args" label={t('ai.startupArgs')} extra={t('ai.startupHint')}><Input.TextArea rows={2} /></Form.Item>}
            {capabilities?.environment && <Form.Item name="environment" label={t('ai.environment')} extra={t('ai.environmentHint')}><Input.TextArea rows={3} /></Form.Item>}
            {capabilities?.configurable_timeout && <Form.Item name="timeout_seconds" label={t('ai.timeout')}><InputNumber min={0} max={3600} /></Form.Item>}
          </>
        )}
        <Button type="primary" loading={busy} onClick={() => void save()}>{t('ai.saveConfiguration')}</Button>
      </Form>
      <div className="ai-editor-section">
        <Typography.Title level={5}>{t('ai.credential')}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {t(credential?.configured ? 'ai.credentialStored' : 'ai.noCredential')}
          {' '}{t('ai.credentialHint')}
        </Typography.Paragraph>
        <label htmlFor={`credential-${provider.id}`}>{t('ai.apiKey')}</label>
        <Input.Password id={`credential-${provider.id}`} value={key} onChange={(e) => setKey(e.target.value)}
          autoComplete="new-password" placeholder={t('ai.newKey')} />
        <div className="ai-actions">
          <Button disabled={!key.trim() || busy} onClick={() => void run(async () => {
            await ai.setCredential(provider.id, key);
            if (current()) setKey('');
          })}>{t('ai.saveCredential')}</Button>
          {credential?.configured && (
            <Popconfirm title={t('ai.removeCredentialConfirm')} description={t('ai.removeCredentialHint')}
              onConfirm={() => run(() => ai.deleteCredential(provider.id, credential.version))}>
              <Button danger disabled={busy}>{t('ai.removeCredential')}</Button>
            </Popconfirm>
          )}
        </div>
      </div>
      {!provider.builtin && <Popconfirm title={t('ai.deleteConfirm')} description={t('ai.deleteHint')}
        onConfirm={() => run(() => ai.remove(provider.id, provider.version))}>
        <Button danger disabled={busy}>{t('ai.delete')}</Button>
      </Popconfirm>}
    </div>
  );
}
