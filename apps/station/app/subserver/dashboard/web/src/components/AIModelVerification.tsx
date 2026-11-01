import { useState } from 'react';
import { Alert, Button, Select, Typography } from 'antd';
import { ai, type Provider } from '../api/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import AIActorSelect from './AIActorSelect';
import { t } from '../i18n';

export default function AIModelVerification({ provider }: { provider: Provider }) {
  const [actor, setActor] = useState('');
  const [model, setModel] = useState('');
  const [verified, setVerified] = useState(false);
  const { busy, error, run, current } = useControlPlaneAction();
  return (
    <section className="ai-editor-section">
      <Typography.Title level={5}>{t('ai.verifyAndUse')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('ai.verifyHint')}</Typography.Paragraph>
      <div className="ai-actions">
        <AIActorSelect label={t('ai.verifyUser')} value={actor} disabled={busy} onChange={(value) => { setActor(value as string); setVerified(false); }} />
        <Select aria-label={t('ai.verifyModel')} placeholder={t('ai.chooseModel')} value={model || undefined}
          disabled={busy}
          options={provider.models.filter((m) => m.enabled && m.type === 'chat').map((m) => ({ value: m.id, label: m.display_name || m.id }))}
          onChange={(next) => { setModel(next); setVerified(false); }} />
        <Button loading={busy} disabled={!actor || !model || !provider.enabled} onClick={() => {
          setVerified(false);
          void run(async () => {
            const result = await ai.verify(provider.id, model, actor);
            if (current()) setVerified(result.response_received);
          });
        }}>{t('ai.verifyCall')}</Button>
      </div>
      {error && <Alert type="error" title={error} />}
      {verified && <Alert type="success" title={t('ai.verifyPassed')} />}
      <Typography.Paragraph>{t('ai.desktopConsumption')}</Typography.Paragraph>
    </section>
  );
}
