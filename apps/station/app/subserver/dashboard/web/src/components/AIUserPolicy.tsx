import { useState } from 'react';
import { Alert, Button, Select, Typography } from 'antd';
import { ai, type Policy } from '../api/ai';
import { useAIStore } from '../store/ai';
import { useControlPlaneAction } from '../hooks/useControlPlaneAction';
import AIActorSelect from './AIActorSelect';
import { t } from '../i18n';

export default function AIUserPolicy({ policy }: { policy: Policy }) {
  const [access, setAccess] = useState(policy.ai_user_access);
  const refresh = useAIStore((s) => s.refresh);
  const { busy, error, run } = useControlPlaneAction(refresh);
  return (
    <section className="ai-policy">
      <div>
        <Typography.Text strong>{t('ai.userPolicy')}</Typography.Text>
        <Typography.Paragraph type="secondary">{t('ai.userPolicyHint')}</Typography.Paragraph>
        <div className="ai-actions">
          <Select aria-label={t('ai.userPolicy')} value={access.all_actors ? 'all' : 'selected'}
            options={[{ value: 'all', label: t('ai.allUsers') }, { value: 'selected', label: t('ai.specificUsers') }]}
            onChange={(next) => setAccess({ all_actors: next === 'all', actor_ptids: [] })} />
          {!access.all_actors && <AIActorSelect multiple label={t('ai.specificUsers')} value={access.actor_ptids}
            onChange={(value) => setAccess({ ...access, actor_ptids: value as string[] })} />}
          <Button type="primary" loading={busy} onClick={() => void run(() => ai.setPolicy({ ...policy, ai_user_access: access }))}>{t('ai.saveAccess')}</Button>
        </div>
        {!access.all_actors && !access.actor_ptids.length && <Typography.Text type="warning">{t('ai.noUsersAllowed')}</Typography.Text>}
        {error && <Alert type="error" title={error} />}
      </div>
    </section>
  );
}
