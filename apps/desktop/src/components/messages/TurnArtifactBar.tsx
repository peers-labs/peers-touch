import { useMemo } from 'react';
import { ActionIcon } from '@lobehub/ui';
import { Cloud, ExternalLink, FileText, HardDrive, MonitorSmartphone } from 'lucide-react';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';
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
  const { token } = theme.useToken();
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
    <Flexbox
      data-pt-agent-turn-artifacts={turnId}
      gap={6}
      style={{ marginBottom: 8 }}
    >
      <Flexbox horizontal align="center" gap={6}>
        <FileText size={14} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>
          {t('agent.turnArtifact.title', { count: turnArtifacts.length })}
        </span>
      </Flexbox>
      {turnArtifacts.map((artifact) => {
        const { Icon, label } = artifactLocation(
          artifact,
          t('agent.portal.artifact.onDevice'),
          t('agent.portal.artifact.stationCopy'),
          t('agent.portal.artifact.originalDevice'),
        );
        return (
          <Flexbox
            key={artifact.id}
            data-pt-agent-turn-artifact={artifact.id}
            data-turn-artifact-turn-id={artifact.turnId}
            horizontal
            align="center"
            gap={8}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 10,
              padding: '6px 10px',
              background: token.colorFillQuaternary,
            }}
          >
            <FileText size={14} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
            <Flexbox style={{ minWidth: 0, flex: 1 }}>
              <Typography.Text
                ellipsis
                style={{ fontSize: 13, color: token.colorText }}
                data-pt-agent-turn-artifact-name
              >
                {artifact.name}
              </Typography.Text>
              <Flexbox horizontal align="center" gap={4}>
                <Icon size={11} style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {label}
                </Typography.Text>
              </Flexbox>
            </Flexbox>
            <ActionIcon
              data-pt-agent-turn-artifact-open={artifact.id}
              icon={<ExternalLink size={14} />}
              size="small"
              title={t('agent.portal.artifact.open')}
              onClick={() => openArtifact(artifact)}
            />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
