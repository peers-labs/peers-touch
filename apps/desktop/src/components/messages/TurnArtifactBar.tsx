import { useMemo } from 'react';
import { IconButton } from '@peers-touch/ui';
import { Cloud, FileText, HardDrive, MonitorSmartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatFileArtifact } from '../../store/chatArtifacts';
import { useChatArtifactStore } from '../../store/chatArtifacts';
import { useChatStore } from '../../store/chat';
import { usePortalStore } from '../../store/portal';

const EMPTY_ARTIFACTS: readonly ChatFileArtifact[] = [];

interface TurnArtifactBarProps {
  turnId?: string;
}

function artifactLocation(artifact: ChatFileArtifact, onDeviceLabel: string, stationLabel: string, originalLabel: string) {
  if (artifact.localAvailable) return { Icon: HardDrive, label: onDeviceLabel };
  if (artifact.stationObjectRef) return { Icon: Cloud, label: stationLabel };
  return { Icon: MonitorSmartphone, label: originalLabel };
}

/**
 * Ordinary-user entry point to real TurnArtifact records: each completed turn
 * that produced workspace files lists them inline, and opening a row pushes the
 * Station-truth artifact into the portal detail view. Code-block pseudo-artifacts
 * extracted from message text intentionally do not appear here.
 */
export function TurnArtifactBar({ turnId }: TurnArtifactBarProps) {
  const { t } = useTranslation('agent');
  const conversationId = useChatStore((state) => state.currentSessionKey);
  const conversationArtifacts = useChatArtifactStore((state) => {
    if (!turnId) return EMPTY_ARTIFACTS;
    return state.byConversationId[conversationId] ?? EMPTY_ARTIFACTS;
  });

  const turnArtifacts = useMemo(
    () => conversationArtifacts.filter((artifact) => artifact.turnId === turnId),
    [conversationArtifacts, turnId],
  );

  if (!turnId || turnArtifacts.length === 0) return null;

  const openArtifact = (artifact: ChatFileArtifact) => {
    usePortalStore.getState().openArtifact(artifact);
  };

  return (
    <div className="sc-artifacts" data-pt-agent-turn-artifacts={turnId}>
      <div className="sc-artifacts__head">
        <FileText size={14} className="sc-artifacts__head-icon" />
        <span className="sc-artifacts__title">
          {t('agent.turnArtifact.title', { count: turnArtifacts.length })}
        </span>
      </div>
      {turnArtifacts.map((artifact) => {
        const { Icon, label } = artifactLocation(
          artifact,
          t('agent.portal.artifact.onDevice'),
          t('agent.portal.artifact.stationCopy'),
          t('agent.portal.artifact.originalDevice'),
        );
        return (
          <div
            key={artifact.id}
            className="sc-artifacts__row"
            data-pt-agent-turn-artifact={artifact.id}
            data-turn-artifact-turn-id={artifact.turnId}
          >
            <FileText size={14} className="sc-artifacts__row-icon" />
            <div className="sc-artifacts__row-body">
              <span className="sc-artifacts__name" data-pt-agent-turn-artifact-name>
                {artifact.name}
              </span>
              <span className="sc-artifacts__location">
                <Icon size={11} />
                {label}
              </span>
            </div>
            <IconButton
              actionId={`turn-artifact-open-${artifact.id}`}
              iconId="external-link"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              label={t('agent.portal.artifact.open')}
              data-pt-agent-turn-artifact-open={artifact.id}
              onActivate={() => openArtifact(artifact)}
            />
          </div>
        );
      })}
    </div>
  );
}
