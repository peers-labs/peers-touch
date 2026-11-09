import { useTranslation } from 'react-i18next';
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
  const removeMention = useMentionStore((s) => s.removeMention);
  const agent = useAgentStore((s) => s.agents.find((a) => a.id === agentId));

  if (!agent) return null;

  const name = agent.title || agent.name;

  return (
    <span className="sc-mention-tag" data-pt-agent-mention-tag={agentId}>
      {agent.avatar ? (
        <span className="sc-mention-tag__avatar">
          <img src={agent.avatar} alt={name} />
        </span>
      ) : (
        <span
          className="sc-mention-tag__avatar"
          style={{ background: agent.backgroundColor || 'var(--pt-primary)' }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="sc-mention-tag__name">{name}</span>
      <button
        type="button"
        className="sc-mention-tag__remove"
        aria-label={name}
        onClick={() => removeMention(agentId)}
      >
        <X size={12} />
      </button>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MentionTagBar — renders all current mention tags in a horizontal row.
// ──────────────────────────────────────────────────────────────────────────────

export function MentionTagBar() {
  const { t } = useTranslation('agent');
  const mentionedAgentIds = useMentionStore((s) => s.mentionedAgentIds);

  if (mentionedAgentIds.length === 0) return null;

  return (
    <div className="sc-mention-tagbar" data-pt-agent-mention-tags>
      <span className="sc-mention-tagbar__label">{t('agent.mentions.title')}</span>
      {mentionedAgentIds.map((id) => (
        <MentionTag key={id} agentId={id} />
      ))}
    </div>
  );
}
