import { useMobileI18n } from '../../app/mobileI18n';
import { MOBILE_REACTION_CHOICES } from './reactionChoices';
import './reactions.css';

export function ReactionPicker({
  selectedEmojis, disabled = false, onToggle,
}: {
  readonly selectedEmojis: ReadonlySet<string>;
  readonly disabled?: boolean;
  readonly onToggle: (emoji: string) => void;
}) {
  const { t } = useMobileI18n();
  return (
    <div className="mobile-reaction-picker" data-reaction-picker role="group" aria-label={t('mobile.chat.addReaction')}>
      {MOBILE_REACTION_CHOICES.map(({ emoji }) => (
        <button
          key={emoji}
          type="button"
          data-reaction-picker-item={emoji}
          aria-label={t('mobile.chat.reactWith', { reaction: emoji })}
          aria-pressed={selectedEmojis.has(emoji)}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(emoji);
          }}
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );
}
