import { useState } from 'react';
import { Button, Modal, Typography } from 'antd';
import { ChevronDown } from 'lucide-react';
import type { Agent } from '../../gen/proto/domain/agent/agent_pb';
import { requestSettingsExit } from '../../app/navigation';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';
import { BoundedList } from '../../components/BoundedList';

export function SettingsAgentScope({
  agents, agentId, loading, disabled, onChange,
}: {
  readonly agents: readonly Agent[];
  readonly agentId: string;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onChange: (id: string) => void;
}) {
  const { t } = useMobileI18n();
  const [open, setOpen] = useState(false);
  const agent = agents.find((entry) => entry.agentId === agentId);
  return <>
    <div className="settings-row">
      <Typography.Text>{t('mobile.settings.agent.scope')}</Typography.Text>
      <Button data-agent-select loading={loading} disabled={disabled || agents.length === 0}
        icon={<ChevronDown size={16} />} onClick={() => setOpen(true)}>
        {agent?.title || agent?.name || t('mobile.settings.agent.selectAgent')}
      </Button>
    </div>
    {!loading && agents.length === 0 ? <MobileNotice tone="info">{t('mobile.settings.agent.noAgents')}</MobileNotice> : null}
    <Modal open={open} title={t('mobile.settings.agent.selectAgent')} footer={null}
      onCancel={() => setOpen(false)} destroyOnHidden>
      <BoundedList surfaceKey="settings:agent-scope" items={agents} itemKey={(entry) => entry.agentId} size={40}>
        {(items) => items.map((entry) => <button type="button" key={entry.agentId}
          className="setting-row settings-agent-provider" data-agent-id={entry.agentId}
          aria-pressed={entry.agentId === agentId} onClick={() => {
            setOpen(false);
            requestSettingsExit(() => onChange(entry.agentId));
          }}>
          <Typography.Text>{entry.title || entry.name}</Typography.Text>
        </button>)}
      </BoundedList>
    </Modal>
  </>;
}
