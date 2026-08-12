import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { X } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import type { AgentAttachmentDraft } from './useAgentAttachmentDrafts';

interface AttachmentStageProps {
  drafts: AgentAttachmentDraft[];
  onRemove: (id: string) => void;
}

/**
 * Renders staged file attachment previews above the textarea.
 * Each draft shows a thumbnail (for images), filename, and remove button.
 */
export function AttachmentStage({ drafts, onRemove }: AttachmentStageProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  if (drafts.length === 0) return null;

  return (
    <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
      {drafts.map((draft) => (
        <Flexbox
          key={draft.id}
          horizontal
          align="center"
          gap={6}
          style={{
            maxWidth: 220,
            padding: '4px 8px 4px 10px',
            borderRadius: 10,
            background: token.colorFillQuaternary,
            opacity: draft.status === 'uploading' ? 0.6 : 1,
          }}
        >
          {draft.previewUrl ? (
            <img
              src={draft.previewUrl}
              alt={draft.name}
              style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }}
            />
          ) : null}
          <span
            style={{
              fontSize: 12,
              color: token.colorTextSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {draft.name}
          </span>
          <ActionIcon
            icon={X}
            size="small"
            title={t('chat.input.attachmentRemove')}
            onClick={() => onRemove(draft.id)}
          />
        </Flexbox>
      ))}
    </Flexbox>
  );
}
