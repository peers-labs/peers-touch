import { SmilePlus } from 'lucide-react';

import './reaction-chip.css';

interface ReactionChipProps {
  readonly emoji?: string;
  readonly count?: number;
  readonly selected?: boolean;
  readonly touch?: boolean;
  readonly label: string;
  readonly reactionId?: string;
  readonly scope?: 'chat' | 'moment';
  readonly className?: string;
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly onClick: () => void;
}

export function ReactionChip({
  emoji,
  count,
  selected = false,
  touch = false,
  label,
  reactionId,
  scope = 'chat',
  className = '',
  disabled = false,
  expanded,
  onClick,
}: ReactionChipProps) {
  return (
    <button
      type="button"
      className={`prototype-reaction-chip ${touch ? 'touch' : ''} ${className}`}
      data-reaction-chip={reactionId ?? emoji}
      data-reaction-scope={scope}
      data-reaction-target
      data-chat-reaction-target={scope === 'chat' ? true : undefined}
      data-chat-message-reaction={scope === 'chat' ? emoji : undefined}
      data-moment-reaction={scope === 'moment' ? reactionId : undefined}
      aria-label={label}
      aria-pressed={emoji ? selected : undefined}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span
        data-reaction-visual
        className={`prototype-reaction-chip-visual ${
          emoji ? '' : 'add'
        }`}
      >
        {emoji ? (
          <span aria-hidden="true">{emoji}</span>
        ) : (
          <SmilePlus size={15} aria-hidden="true" />
        )}
        {count !== undefined ? (
          <span className="prototype-reaction-chip-count">{count}</span>
        ) : null}
      </span>
    </button>
  );
}
