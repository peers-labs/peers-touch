import { useTranslation } from 'react-i18next';
import { theme, Tag } from 'antd';
import { Avatar } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { X } from 'lucide-react';

import { useMentionStore } from '../../store/mentions';
import { useAgentStore } from '../../store/agent';

// ──────────────────────────────────────────────────────────────────────────────
// MentionTag — compact badge for a mentioned agent, with remove button.
// Rendered above/inside the chat composer to show active collaborators.
// ──────────────────────────────────────────────────────────────────────────────

interface MentionTagProps {
  agentId: string;
}

export function MentionTag({ agentId }: MentionTagProps) {
  const { token } = theme.useToken();
  const removeMention = useMentionStore((s) => s.removeMention);
  const agent = useAgentStore((s) => s.agents.find((a) => a.id === agentId));

  if (!agent) return null;

  return (
    <Tag
      data-pt-agent-mention-tag={agentId}
      closable
      closeIcon={<X size={12} />}
      onClose={() => removeMention(agentId)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginXXS,
        borderRadius: token.borderRadiusSM,
        paddingInline: token.paddingXS,
        margin: 0,
      }}
    >
      <Avatar
        avatar={agent.avatar || undefined}
        title={agent.title || agent.name}
        size={16}
        shape="circle"
        background={agent.backgroundColor || token.colorPrimary}
      />
      <span style={{ fontSize: token.fontSizeSM }}>
        {agent.title || agent.name}
      </span>
    </Tag>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MentionTagBar — renders all current mention tags in a horizontal row.
// ──────────────────────────────────────────────────────────────────────────────

export function MentionTagBar() {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const mentionedAgentIds = useMentionStore((s) => s.mentionedAgentIds);

  if (mentionedAgentIds.length === 0) return null;

  return (
    <Flexbox
      data-pt-agent-mention-tags
      horizontal
      align="center"
      gap={token.marginXS}
      wrap="wrap"
      style={{ padding: `${token.paddingXXS}px ${token.paddingSM}px` }}
    >
      <span style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}>
        {t('agent.mentions.title')}
      </span>
      {mentionedAgentIds.map((id) => (
        <MentionTag key={id} agentId={id} />
      ))}
    </Flexbox>
  );
}
