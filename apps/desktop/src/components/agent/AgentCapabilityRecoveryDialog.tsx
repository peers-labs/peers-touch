import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Agent } from '../../services/desktop_api';
import { useAgentCapabilityStore } from '../../store/agentCapabilities';
import { AgentCapabilityInventoryPanel } from './AgentCapabilityInventoryPanel';

export default function AgentCapabilityRecoveryDialog({
  agent, capabilityId, permissionKind, requestId, onClose,
}: {
  agent: Agent;
  capabilityId: string;
  permissionKind?: string;
  requestId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('agent');
  const state = useAgentCapabilityStore();
  return (
    <Modal
      open
      title={t('agent.profile.tab.extensions')}
      footer={null}
      width={720}
      onCancel={onClose}
    >
      <AgentCapabilityInventoryPanel
        agentId={agent.id}
        agentVersion={agent.version}
        manifests={state.manifests.filter((item) => item.capabilityId === capabilityId)}
        bindings={(state.bindingsByAgentId[agent.id] ?? []).filter(
          (item) => item.capabilityId === capabilityId,
        )}
        readiness={(state.readinessByAgentId[agent.id]?.capabilities ?? []).filter(
          (item) => item.capabilityId === capabilityId,
        )}
        catalogIssues={state.catalogIssues}
        lastMutationError={state.lastMutationError}
        pendingMutations={state.pendingMutations}
        loading={state.loadingCatalog || Boolean(state.loadingAgentIds[agent.id])}
        loadAgent={state.loadAgent}
        upsertBinding={state.upsertBinding}
        deleteBinding={state.deleteBinding}
        focusCapabilityId={capabilityId}
        focusPermissionKind={permissionKind}
        focusRequestId={requestId}
      />
    </Modal>
  );
}
