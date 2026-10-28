import { Flexbox } from 'react-layout-kit';
import { theme, Typography, Empty } from 'antd';
import { Cloud, FileText, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatFileArtifact } from '../../../store/chatArtifacts';
import { usePortalStore } from '../../../store/portal';

interface ArtifactListViewProps {
  artifacts: ChatFileArtifact[];
}

export function ArtifactListView({ artifacts }: ArtifactListViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('agent');

  if (artifacts.length === 0) {
    return <Empty description={t('agent.portal.artifact.empty')} style={{ marginTop: 48 }} />;
  }

  return (
    <Flexbox gap={8}>
      {artifacts.map((artifact) => {
        return (
          <Flexbox
            key={artifact.id}
            horizontal
            align="center"
            gap={10}
            style={{
              padding: '10px 12px',
              borderRadius: token.borderRadius,
              border: `1px solid ${token.colorBorderSecondary}`,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onClick={() => usePortalStore.getState().openArtifact(artifact)}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = token.colorFillQuaternary;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <FileText size={16} color={token.colorTextSecondary} />
            <Flexbox style={{ flex: 1, overflow: 'hidden' }}>
              <Typography.Text ellipsis style={{ fontSize: 13, fontWeight: 500 }}>
                {artifact.name}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {artifact.localAvailable ? <HardDrive size={11} /> : <Cloud size={11} />}
                {' '}
                {artifact.localAvailable
                  ? t('agent.portal.artifact.onDevice')
                  : artifact.stationObjectRef
                    ? t('agent.portal.artifact.stationCopy')
                    : t('agent.portal.artifact.originalDevice')}
              </Typography.Text>
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
