import { useMobileI18n } from '../../app/mobileI18n';

import { MOBILE_EMOJI_CATEGORIES } from './emojiData';
import './emojiPalette.css';

interface EmojiPalettePanelProps {
  /** Most-recently-used emojis, rendered as the first row when non-empty. */
  readonly recent: readonly string[];
  readonly onSelect: (emoji: string) => void;
  /** Restrict the palette to a curated subset (e.g. wire-allowed reactions). */
  readonly allowedEmojis?: readonly string[];
  /** Mark an emoji as currently selected (message reactions). */
  readonly isActive?: (emoji: string) => boolean;
  readonly disabled?: boolean;
}

/**
 * Shared full emoji palette: a "recent" row first, then every category grid.
 * Both the composer insert picker and the message-reaction sheet render this
 * component so the emoji list never drifts between surfaces again.
 */
export function EmojiPalettePanel({
  recent,
  onSelect,
  allowedEmojis,
  isActive,
  disabled = false,
}: EmojiPalettePanelProps) {
  const { t } = useMobileI18n();
  const allowed = allowedEmojis ? new Set(allowedEmojis) : null;
  const visibleRecent = allowed
    ? recent.filter((emoji) => allowed.has(emoji))
    : recent;
  const categories = MOBILE_EMOJI_CATEGORIES
    .map((category) => ({
      ...category,
      emojis: allowed
        ? category.emojis.filter((emoji) => allowed.has(emoji))
        : category.emojis,
    }))
    .filter((category) => category.emojis.length > 0);

  const renderCell = (emoji: string) => {
    const active = isActive?.(emoji) ?? false;
    return (
      <button
        key={emoji}
        type="button"
        className="mobile-emoji-cell"
        data-emoji={emoji}
        aria-label={t('mobile.chat.insertEmoji', { emoji })}
        aria-pressed={isActive ? active : undefined}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(emoji);
        }}
      >
        <span aria-hidden="true">{emoji}</span>
      </button>
    );
  };

  return (
    <div className="mobile-emoji-palette" role="group" aria-label={t('mobile.chat.allEmojis')}>
      {visibleRecent.length > 0 && (
        <section className="mobile-emoji-section">
          <span className="mobile-emoji-section-label">{t('mobile.chat.recentEmojis')}</span>
          <div className="mobile-emoji-grid" data-emoji-section="recent">
            {visibleRecent.map(renderCell)}
          </div>
        </section>
      )}
      {categories.map((category) => (
        <section key={category.id} className="mobile-emoji-section">
          <span className="mobile-emoji-section-label">{t(category.labelKey)}</span>
          <div className="mobile-emoji-grid" data-emoji-section={category.id}>
            {category.emojis.map(renderCell)}
          </div>
        </section>
      ))}
    </div>
  );
}
