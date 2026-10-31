import { useState } from 'react';
import { Alert, Button, Select, Typography } from 'antd';
import { Plus, Trash2 } from 'lucide-react';
import { ai, type Access, type Grant, type Provider } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import { t } from '../i18n';
import AIActorSelect from './AIActorSelect';

const EMPTY: Grant = { all_actors: true, actor_ptid: '', all_models: true, model_id: '' };
export default function AIGrantEditor({ provider, access }: { provider: Provider; access: Access }) {
  const refresh = useAIStore((s) => s.refresh);
  const [grants, setGrants] = useState(access.grants || []);
  const { busy, error, setError, run } = useControlPlaneAction(refresh);
  const update = (index: number, change: Partial<Grant>) =>
    setGrants((current) => current.map((grant, i) => i === index ? { ...grant, ...change } : grant));
  const save = async () => {
    if (grants.some((g) => !g.all_actors && !g.actor_ptid.trim() || !g.all_models && !g.model_id)) {
      setError(t('ai.invalidGrant')); return;
    }
    await run(() => ai.setAccess({ ...access, grants: grants.map((g) => ({
        ...g, actor_ptid: g.all_actors ? '' : g.actor_ptid.trim(), model_id: g.all_models ? '' : g.model_id,
      })) }));
  };
  return (
    <section className="ai-editor-section">
      <Typography.Title level={5}>{t('ai.access')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('ai.accessHint')}</Typography.Paragraph>
      {error && <Alert type="error" showIcon title={error} />}
      {grants.map((grant, index) => (
        <div key={index} className="ai-grant-row">
          <Select aria-label={t('ai.grantUsers', { index: index + 1 })} value={grant.all_actors ? 'all' : 'actor'}
            options={[{ value: 'all', label: t('ai.allUsers') }, { value: 'actor', label: t('ai.specificUser') }]}
            onChange={(value) => update(index, { all_actors: value === 'all' })} />
          {!grant.all_actors && <AIActorSelect label={t('ai.grantActor', { index: index + 1 })} value={grant.actor_ptid}
            onChange={(value) => update(index, { actor_ptid: value as string })} />}
          <Select aria-label={t('ai.grantModels', { index: index + 1 })} value={grant.all_models ? '*' : grant.model_id || undefined}
            options={[{ value: '*', label: t('ai.allModels') }, ...provider.models.map((m) => ({ value: m.id, label: m.display_name || m.id }))]}
            onChange={(value) => update(index, { all_models: value === '*', model_id: value === '*' ? '' : value })} />
          <Button danger aria-label={t('ai.removeGrant', { index: index + 1 })} icon={<Trash2 size={14} />}
            onClick={() => setGrants((current) => current.filter((_, i) => i !== index))} />
        </div>
      ))}
      <div className="ai-actions">
        <Button icon={<Plus size={14} />} onClick={() => setGrants((current) => [...current, { ...EMPTY }])}>{t('ai.addGrant')}</Button>
        <Button type="primary" loading={busy} onClick={() => void save()}>{t('ai.saveAccess')}</Button>
      </div>
    </section>
  );
}
