import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { CloudDownload, CloudUpload, ExternalLink, FolderOpen } from 'lucide-react';
import { Alert, theme, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ChatFileArtifact } from '../../../store/chatArtifacts';
import { useChatArtifactStore } from '../../../store/chatArtifacts';
import { useChatStore } from '../../../store/chat';

interface ArtifactDetailViewProps {
  artifact: ChatFileArtifact;
}

export function ArtifactDetailView({ artifact }: ArtifactDetailViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('agent');
  const conversationId = useChatStore((state) => state.currentSessionKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox gap={16} style={{ height: '100%' }}>
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox gap={2} style={{ minWidth: 0 }}>
          <Typography.Text strong ellipsis>{artifact.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {artifact.size.toLocaleString()} bytes · {artifact.sha256.slice(0, 12)}
          </Typography.Text>
        </Flexbox>
        <Flexbox horizontal gap={4}>
          {artifact.localAvailable && (
            <>
              <ActionIcon
                disabled={busy}
                icon={ExternalLink}
                title={t('agent.portal.artifact.open')}
                onClick={() => void run(() => useChatArtifactStore.getState().openLocal(artifact))}
              />
              <ActionIcon
                disabled={busy}
                icon={FolderOpen}
                title={t('agent.portal.artifact.reveal')}
                onClick={() => void run(() => useChatArtifactStore.getState().openLocal(artifact, true))}
              />
              {!artifact.stationObjectRef && (
                <ActionIcon
                  disabled={busy}
                  icon={CloudUpload}
                  title={t('agent.portal.artifact.upload')}
                  onClick={() => void run(() => (
                    useChatArtifactStore.getState().upload(conversationId, artifact.id)
                  ))}
                />
              )}
            </>
          )}
          {artifact.stationObjectRef && (
            <ActionIcon
              disabled={busy}
              icon={CloudDownload}
              title={t('agent.portal.artifact.download')}
              onClick={() => void run(() => useChatArtifactStore.getState().download(artifact.id))}
            />
          )}
        </Flexbox>
      </Flexbox>

      {error && <Alert type="error" showIcon message={error} />}

      <Flexbox
        gap={8}
        style={{
          padding: 12,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadius,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('agent.portal.artifact.source')}
        </Typography.Text>
        <Typography.Text style={{ fontSize: 13 }}>
          {t('agent.portal.artifact.turn', { id: artifact.turnId })}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('agent.portal.artifact.toolCall', { id: artifact.toolCallId })}
        </Typography.Text>
      </Flexbox>

      {!artifact.localAvailable && !artifact.stationObjectRef && (
        <Alert
          type="info"
          showIcon
          message={t('agent.portal.artifact.originalDeviceHelp')}
        />
      )}
    </Flexbox>
  );
}
