import { SmilePlus } from 'lucide-react';
import { theme } from 'antd';
import type { ButtonHTMLAttributes } from 'react';
import './reactions.css';

interface ReactionChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly emoji?: string;
  readonly count?: number;
  readonly selected?: boolean;
  readonly label: string;
}

/** Chat and Moments share one visual capsule inside a full-size touch target. */
export function ReactionChip({
  emoji, count, selected = false, label, className = '', onClick, style, ...props
}: ReactionChipProps) {
  const { token } = theme.useToken();
  return (
    <button
      {...props}
      type="button"
      className={`mobile-reaction-chip ${className}`}
      style={{ color: token.colorText, ...style }}
      data-reaction-chip={emoji ?? 'add'}
      aria-label={label}
      aria-pressed={emoji ? selected : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <span className={`mobile-reaction-visual ${emoji ? '' : 'add'}`} data-reaction-visual>
        {emoji ? <span aria-hidden="true">{emoji}</span> : <SmilePlus size={16} aria-hidden="true" />}
        {count !== undefined && <span className="mobile-reaction-count">{count}</span>}
      </span>
    </button>
  );
}
