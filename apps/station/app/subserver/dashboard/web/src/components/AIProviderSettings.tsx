import { useState } from 'react';
import { Alert, Button, Collapse, Form, Input, InputNumber, Popconfirm, Select, Switch, Typography } from 'antd';
import { ai, type Provider, type RuntimeConfig } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import { t } from '../i18n';

function formValues(provider: Provider) {
  return {
    name: provider.name, enabled: provider.enabled, base_url: provider.base_url,
    backend_provider_id: provider.backend_provider_id || '',
    default_model: provider.runtime_config?.default_model || '',
    global_prompt: provider.runtime_config?.global_prompt || '',
    startup_args: (provider.runtime_config?.startup_args || []).join('\n'),
    environment: Object.entries(provider.runtime_config?.environment || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    timeout_seconds: provider.runtime_config?.timeout_seconds || 120,
  };
}

export default function AIProviderSettings({ provider }: { provider: Provider }) {
  const [form] = Form.useForm();
  const [key, setKey] = useState('');
  const [baseline, setBaseline] = useState(provider);
  const providers = useAIStore((s) => s.providers);
  const select = useAIStore((s) => s.select);
  const credential = useAIStore((s) => s.credential);
  const refresh = useAIStore((s) => s.refresh);
  const { busy, error, setError, run, current } = useControlPlaneAction(refresh);
  const cli = provider.runtime_kind === 'cli';
  const capabilities = provider.adapter_capabilities;
  const backendID = Form.useWatch('backend_provider_id', form) ?? baseline.backend_provider_id ?? '';
  const protocol = capabilities?.backend_protocols?.[0];
  const sources = providers.filter((p) => p.runtime_kind === 'http' && p.record_id && p.enabled
    && (protocol === 'responses' ? ['openai', 'openai-compatible'].includes(p.protocol) : p.protocol === protocol));
  const source = sources.find((p) => p.record_id === backendID);
  const adapter = providers.find((p) => p.id === (provider.cli_adapter_id || provider.id));
  const models = backendID ? source?.models || [] : adapter?.models || provider.models;
  const stale = String(provider.version) !== String(baseline.version);
  const save = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values || !current()) return;
    let runtime_config: RuntimeConfig | undefined;
    if (cli) {
      try {
        const startup_args = (values.startup_args || '').split('\n').filter((line: string) => line.trim());
        const environment: Record<string, string> = Object.create(null);
        for (const line of (values.environment || '').split('\n').filter((item: string) => item.trim())) {
          const separator = line.indexOf('=');
          const name = line.slice(0, separator).trim();
          if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || Object.prototype.hasOwnProperty.call(environment, name)) throw new Error();
          environment[name] = line.slice(separator + 1);
        }
        runtime_config = {
          default_model: values.default_model || '',
          global_prompt: values.global_prompt || '',
          startup_args, environment, timeout_seconds: values.timeout_seconds,
        };
      } catch { setError(t('ai.invalidRuntime')); return; }
    }
    await run(async () => {
      const result = await ai.update(provider.id, baseline.version, {
        display_name: values.name, enabled: values.enabled,
        ...(cli ? { runtime_config, backend_provider_id: values.backend_provider_id || '' } : { base_url: values.base_url }),
      });
      if (current()) { setBaseline(result.provider); form.setFieldsValue(formValues(result.provider)); }
    });
  };
  return (
    <div className="ai-editor-section">
      {error && <Alert type="error" showIcon title={error} />}
      {stale && <Alert type="warning" title={t('ai.configurationChanged')}
        action={<Button disabled={busy} onClick={() => { setBaseline(provider); form.setFieldsValue(formValues(provider)); setError(''); }}>{t('ai.reloadConfiguration')}</Button>} />}
      <Form form={form} layout="vertical" initialValues={formValues(baseline)} disabled={busy}>
        <div className="ai-form-grid">
          <Form.Item name="name" label={t('name')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="enabled" label={t('ai.enabledForUsers')} valuePropName="checked"><Switch /></Form.Item>
        </div>
        {!cli && <Form.Item name="base_url" label={t('ai.baseUrl')} rules={[{ required: true }, { type: 'url' }]}><Input placeholder="https://api.example.com/v1" /></Form.Item>}
        {cli && (
          <>
            {!!protocol && <Form.Item name="backend_provider_id" label={t('ai.modelSource')}
              extra={<>
                {t(credential?.configured && !provider.backend_provider_id ? 'ai.removeKeyBeforeSource' : protocol === 'responses' ? 'ai.responsesSourceHint' : 'ai.anthropicSourceHint')}
                {source && <div>{t('ai.sourceGrantHint')}{' '}
                  <Button size="small" type="link" onClick={() => void select(source.id)}>{t('ai.manageSource')}</Button>
                </div>}
              </>}>
              <Select onChange={() => form.setFieldValue('default_model', '')}
                disabled={busy || Boolean(credential?.configured && !provider.backend_provider_id)} options={[
                  { value: '', label: t('ai.vendorAccount') },
                  ...sources.map((p) => ({ value: p.record_id!, label: p.name })),
                  ...(backendID && !source ? [{ value: backendID, label: t('ai.sourceUnavailable'), disabled: true }] : []),
                ]} />
            </Form.Item>}
            <Form.Item name="default_model" label={t('ai.defaultModel')} rules={backendID ? [{ required: true, message: t('ai.chooseModel') }] : []}>
              <Select allowClear showSearch optionFilterProp="label" options={models.map((model) => ({
                value: model.id, label: model.display_name || model.id, disabled: !model.enabled,
              }))} />
            </Form.Item>
            <Collapse ghost items={[{ key: 'runtime', forceRender: true, label: t('ai.advancedConfiguration'), children: <>
              <Form.Item name="global_prompt" label={t('ai.globalPrompt')}><Input.TextArea rows={3} maxLength={32000} /></Form.Item>
              {capabilities?.startup_args && <Form.Item name="startup_args" label={t('ai.startupArgs')} extra={t('ai.startupHint')}><Input.TextArea rows={2} /></Form.Item>}
              {capabilities?.environment && <Form.Item name="environment" label={t('ai.environment')} extra={t('ai.environmentHint')}><Input.TextArea rows={3} /></Form.Item>}
              {capabilities?.configurable_timeout && <Form.Item name="timeout_seconds" label={t('ai.timeout')}
                rules={[{ required: true, type: 'integer', min: 10, max: 3600 }]}><InputNumber min={10} max={3600} precision={0} /></Form.Item>}
            </> }]} />
          </>
        )}
        <Button type="primary" loading={busy} disabled={stale} onClick={() => void save()}>{t('ai.saveConfiguration')}</Button>
      </Form>
      {cli && !backendID && !provider.show_api_key && !provider.api_key_url && !credential?.configured && (
        <Alert type="warning" showIcon title={t('ai.accountConnectionUnavailable')} />
      )}
      {!backendID && !provider.backend_provider_id && (!cli || provider.show_api_key || provider.api_key_url || credential?.configured) && <div className="ai-editor-section">
        <Typography.Title level={5}>{t('ai.credential')}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {t(credential?.configured ? 'ai.credentialStored' : 'ai.noCredential')}
          {' '}{t('ai.credentialHint')}
        </Typography.Paragraph>
        <label htmlFor={`credential-${provider.id}`}>{t('ai.apiKey')}</label>
        <Input.Password id={`credential-${provider.id}`} value={key} onChange={(e) => setKey(e.target.value)}
          autoComplete="new-password" placeholder={t('ai.newKey')} />
        {provider.api_key_url && <Button type="link" href={provider.api_key_url} target="_blank" rel="noopener noreferrer">{t('ai.getKey')}</Button>}
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
      </div>}
      {!provider.builtin && <Popconfirm title={t('ai.deleteConfirm')} description={t('ai.deleteHint')}
        onConfirm={() => run(() => ai.remove(provider.id, provider.version))}>
        <Button danger disabled={busy}>{t('ai.delete')}</Button>
      </Popconfirm>}
    </div>
  );
}
