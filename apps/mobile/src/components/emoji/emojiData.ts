/**
 * Single source of truth for mobile emoji presentation.
 *
 * Before this module the composer hard-coded 12 emojis, the message-action
 * sheet hard-coded another 24, and the proto-backed ReactionPicker exposed a
 * third five-emoji set. Every surface now renders from these categories so
 * the picker looks identical wherever it opens.
 */

export interface EmojiCategory {
  readonly id: string;
  /** i18n key for the group header. */
  readonly labelKey: string;
  readonly emojis: readonly string[];
}

export const MOBILE_EMOJI_CATEGORIES: readonly EmojiCategory[] = Object.freeze([
  {
    id: 'smileys',
    labelKey: 'mobile.chat.emojiCategorySmileys',
    emojis: [
      '😀', '😊', '😄', '😁', '😂', '🤣', '😍', '😘',
      '😎', '🤔', '😮', '😢', '😭', '😡', '🥳', '😴',
      '🤯', '😇', '😅', '🙃',
    ],
  },
  {
    id: 'gestures',
    labelKey: 'mobile.chat.emojiCategoryGestures',
    emojis: [
      '👍', '👎', '🙏', '👏', '💪', '🤝', '👌', '✋',
      '🫶', '🤙', '🙌', '👋',
    ],
  },
  {
    id: 'hearts',
    labelKey: 'mobile.chat.emojiCategoryHearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔',
      '💖', '✨', '🔥', '💯',
    ],
  },
  {
    id: 'objects',
    labelKey: 'mobile.chat.emojiCategoryObjects',
    emojis: [
      '🎉', '🎁', '🌹', '🌟', '⭐', '☀️', '🌙', '⚡',
      '🎵', '🍀', '🎂', '🚀', '👀', '✅', '💡',
    ],
  },
]);

/** Flattened full set, de-duplicated, order preserved across categories. */
export const MOBILE_EMOJI_ALL: readonly string[] = Object.freeze(
  MOBILE_EMOJI_CATEGORIES.flatMap((category) => category.emojis)
    .filter((emoji, index, all) => all.indexOf(emoji) === index),
);

/**
 * Wire-allowed message reactions. The on-wire contract is the emoji string
 * itself and must stay identical to desktop ChatMessageActionOverlay, so this
 * is a curated subset of the full palette rather than the whole list.
 */
export const MOBILE_REACTION_EMOJIS: readonly string[] = Object.freeze([
  '👍', '❤️', '😂', '😮', '😢', '🙏',
  '👏', '🎉', '🔥', '💯', '🤔', '👀',
  '🙌', '✨', '✅', '💪', '🤝', '🥳',
  '😍', '😊', '😅', '🤯', '😎', '💡',
]);

/** True when the emoji belongs to the curated reaction set. */
export function isAllowedReaction(emoji: string): boolean {
  return MOBILE_REACTION_EMOJIS.includes(emoji);
}
