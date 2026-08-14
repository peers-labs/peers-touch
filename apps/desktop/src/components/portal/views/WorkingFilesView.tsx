import { useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Empty } from '@lobehub/ui';
import { Tag, Typography, theme } from 'antd';
import { FileText, Image, Code, File, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatStore, type ChatComposerAttachment } from '../../../store/chat';

interface FileEntry {
  attachment: ChatComposerAttachment;
  messageId: string;
  timestamp: number;
}

function fileTypeIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.includes('text') || mimeType.includes('pdf')) return FileText;
  if (mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('typescript')) return Code;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface WorkingFilesViewProps {
  sessionKey: string;
}

export function WorkingFilesView({ sessionKey: _sessionKey }: WorkingFilesViewProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const messages = useChatStore((s) => s.messages);

  const files = useMemo<FileEntry[]>(() => {
    const entries: FileEntry[] = [];
    for (const msg of messages) {
      if (!msg.attachments?.length) continue;
      for (const attachment of msg.attachments) {
        entries.push({
          attachment,
          messageId: msg.id,
          timestamp: msg.timestamp,
        });
      }
    }
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }, [messages]);

  if (files.length === 0) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%', padding: 32 }}>
        <Empty description={t('agent.working.noFiles')} />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8}>
      {files.map((entry) => {
        const IconComponent = fileTypeIcon(entry.attachment.mime_type);
        return (
          <Flexbox
            key={`${entry.messageId}-${entry.attachment.cid}`}
            horizontal
            align="center"
            gap={12}
            style={{
              padding: '10px 12px',
              borderRadius: token.borderRadius,
              background: token.colorBgElevated,
              cursor: entry.attachment.url ? 'pointer' : 'default',
            }}
            onClick={() => {
              if (entry.attachment.url) {
                window.open(entry.attachment.url, '_blank');
              }
            }}
          >
            <IconComponent size={20} color={token.colorTextSecondary} />
            <Flexbox style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text ellipsis style={{ fontSize: 13, fontWeight: 500 }}>
                {entry.attachment.filename}
              </Typography.Text>
              <Flexbox horizontal gap={8} align="center">
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {formatFileSize(entry.attachment.size)}
                </Typography.Text>
                <Tag style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                  {entry.attachment.mime_type.split('/').pop()}
                </Tag>
              </Flexbox>
            </Flexbox>
            {entry.attachment.url && (
              <Download size={14} color={token.colorTextTertiary} />
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
