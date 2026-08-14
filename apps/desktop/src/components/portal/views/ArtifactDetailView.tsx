import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { Copy, Download } from 'lucide-react';
import { theme, Typography } from 'antd';

import type { MessageArtifact } from '../../../store/chat';

interface ArtifactDetailViewProps {
  artifact: MessageArtifact;
}

export function ArtifactDetailView({ artifact }: ArtifactDetailViewProps) {
  const { token } = theme.useToken();

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content);
  };

  const handleDownload = () => {
    const ext = artifact.language || 'txt';
    const blob = new Blob([artifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title || 'artifact'}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Flexbox gap={12} style={{ height: '100%' }}>
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox horizontal align="center" gap={8}>
          {artifact.language && (
            <Typography.Text
              code
              style={{ fontSize: 12, color: token.colorTextSecondary }}
            >
              {artifact.language}
            </Typography.Text>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {artifact.kind}
          </Typography.Text>
        </Flexbox>
        <Flexbox horizontal gap={4}>
          <ActionIcon icon={Copy} size="small" onClick={handleCopy} />
          <ActionIcon icon={Download} size="small" onClick={handleDownload} />
        </Flexbox>
      </Flexbox>

      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: 12,
          borderRadius: token.borderRadius,
          background: token.colorFillQuaternary,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.6,
          fontFamily: 'var(--font-mono, monospace)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {artifact.content}
      </pre>
    </Flexbox>
  );
}
