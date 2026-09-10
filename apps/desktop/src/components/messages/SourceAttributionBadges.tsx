import { Tag, theme } from 'antd';
import { BookOpen, FileText } from 'lucide-react';
import { Flexbox } from 'react-layout-kit';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../store/chat';

export interface SourceAttribution {
  id: string;
  type: 'knowledge' | 'attachment';
  label: string;
}

export function collectSourceAttributions(
  message: Pick<ChatMessage, 'knowledgeChunks' | 'attachments'>,
): SourceAttribution[] {
  const sources = new Map<string, SourceAttribution>();

  for (const chunk of message.knowledgeChunks ?? []) {
    const id = chunk.resourceId || chunk.chunkId;
    if (!id || sources.has(`knowledge:${id}`)) continue;
    sources.set(`knowledge:${id}`, {
      id,
      type: 'knowledge',
      label: chunk.resourceTitle || chunk.source || id,
    });
  }

  for (const attachment of message.attachments ?? []) {
    const id = attachment.attachment?.attachment_id || attachment.cid;
    if (!id || sources.has(`attachment:${id}`)) continue;
    sources.set(`attachment:${id}`, {
      id,
      type: 'attachment',
      label: attachment.filename || id,
    });
  }

  return [...sources.values()];
}

export function SourceAttributionBadges({
  message,
  onOpenDetails,
}: {
  message: Pick<ChatMessage, 'knowledgeChunks' | 'attachments'>;
  onOpenDetails?: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const sources = collectSourceAttributions(message);

  if (sources.length === 0) return null;

  return (
    <Flexbox
      data-source-badges
      horizontal
      align="center"
      gap={4}
      wrap="wrap"
      style={{ marginTop: 6 }}
    >
      <span style={{ color: token.colorTextTertiary, fontSize: 11 }}>
        {t('chat.message.sources.label')}
      </span>
      {sources.map((source) => {
        const Icon = source.type === 'knowledge' ? BookOpen : FileText;
        return (
          <Tag
            data-source-badge={source.type}
            data-source-id={source.id}
            key={`${source.type}:${source.id}`}
            bordered={false}
            icon={<Icon size={11} />}
            onClick={onOpenDetails}
            style={{
              cursor: onOpenDetails ? 'pointer' : 'default',
              margin: 0,
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {source.label}
          </Tag>
        );
      })}
    </Flexbox>
  );
}
