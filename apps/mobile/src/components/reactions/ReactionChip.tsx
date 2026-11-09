import type { ButtonHTMLAttributes } from 'react';
import { Icon } from '@peers-touch/ui';

import './reactions.css';

interface ReactionChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly emoji?: string;
  readonly count?: number;
  readonly selected?: boolean;
  readonly label: string;
}

/** Shared reaction capsule inside a full-size touch target. */
export function ReactionChip({
  emoji,
  count,
  selected = false,
  label,
  className = '',
  onClick,
  ...props
}: ReactionChipProps) {
  return (
    <button
      {...props}
      type="button"
      className={`mobile-reaction-chip ${className}`}
      data-reaction-chip={emoji ?? 'add'}
      aria-label={label}
      aria-pressed={emoji ? selected : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span
        className={`mobile-reaction-visual ${emoji ? '' : 'add'}`}
        data-reaction-visual
      >
        {emoji ? (
          <span aria-hidden="true">{emoji}</span>
        ) : (
          <Icon iconId="smile-plus" size={16} />
        )}
        {count !== undefined ? (
          <span className="mobile-reaction-count">{count}</span>
        ) : null}
      </span>
    </button>
  );
}
