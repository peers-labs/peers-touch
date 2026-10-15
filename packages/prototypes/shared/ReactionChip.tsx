import { SmilePlus } from 'lucide-react';
import './reaction-chip.css';

export function ReactionChip({
  emoji,
  count,
  selected = false,
  touch = false,
  label,
  reactionId,
  scope = 'chat',
  className = '',
  onClick,
}: {
  emoji?: string;
  count?: number;
  selected?: boolean;
  touch?: boolean;
  label: string;
  reactionId?: string;
  scope?: 'chat' | 'moment';
  className?: string;
  onClick: () => void;
}) {
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
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span data-reaction-visual className={`prototype-reaction-chip-visual ${emoji ? '' : 'add'}`}>
        {emoji ? <span aria-hidden="true">{emoji}</span> : <SmilePlus size={15} aria-hidden="true" />}
        {count !== undefined && <span className="prototype-reaction-chip-count">{count}</span>}
      </span>
    </button>
  );
}
