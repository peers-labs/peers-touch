import { Flexbox } from 'react-layout-kit';
import { theme, Typography, Empty } from 'antd';
import { Code, FileText, GitGraph, Braces } from 'lucide-react';

import type { MessageArtifact } from '../../../store/chat';
import { usePortalStore } from '../../../store/portal';

interface ArtifactListViewProps {
  artifacts: MessageArtifact[];
}

const kindIcon = {
  code: Code,
  document: FileText,
  diagram: GitGraph,
  structured: Braces,
} as const;

export function ArtifactListView({ artifacts }: ArtifactListViewProps) {
  const { token } = theme.useToken();

  if (artifacts.length === 0) {
    return <Empty description="No artifacts yet" style={{ marginTop: 48 }} />;
  }

  return (
    <Flexbox gap={8}>
      {artifacts.map((artifact) => {
        const Icon = kindIcon[artifact.kind] || Code;
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
            <Icon size={16} color={token.colorTextSecondary} />
            <Flexbox style={{ flex: 1, overflow: 'hidden' }}>
              <Typography.Text ellipsis style={{ fontSize: 13, fontWeight: 500 }}>
                {artifact.title || artifact.language || 'Untitled'}
              </Typography.Text>
              {artifact.language && (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {artifact.language} · {artifact.kind}
                </Typography.Text>
              )}
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
