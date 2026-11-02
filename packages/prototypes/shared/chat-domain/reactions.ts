/**
 * Reaction vocabulary — the single source of truth shared by chat messages
 * and moments across the desktop and mobile prototypes.
 *
 * Presentation differs per form factor (hover popover vs long-press sheet),
 * but the kind list, emoji mapping and multi-select semantics must not fork:
 * a viewer may hold several kinds at once and tapping a chosen kind removes
 * it. Unknown emoji never silently downgrade to another kind.
 */

export type ReactionKind =
  | 'like' | 'love' | 'laugh' | 'celebrate' | 'wow' | 'clap' | 'fire'
  | 'heartHands' | 'thanks' | 'sad' | 'angry' | 'thinking' | 'hundred'
  | 'eyes' | 'strong' | 'check';

export interface ReactionMeta {
  readonly kind: ReactionKind;
  readonly emoji: string;
  /** i18n key for the human reaction name; surfaces call their own t(). */
  readonly labelKey: string;
}

export const REACTION_CATALOG: readonly ReactionMeta[] = [
  { kind: 'like', emoji: '\u{1F44D}', labelKey: 'reaction.like' },
  { kind: 'love', emoji: '\u{2764}\u{FE0F}', labelKey: 'reaction.love' },
  { kind: 'laugh', emoji: '\u{1F602}', labelKey: 'reaction.laugh' },
  { kind: 'celebrate', emoji: '\u{1F389}', labelKey: 'reaction.celebrate' },
  { kind: 'wow', emoji: '\u{1F62E}', labelKey: 'reaction.wow' },
  { kind: 'clap', emoji: '\u{1F44F}', labelKey: 'reaction.clap' },
  { kind: 'fire', emoji: '\u{1F525}', labelKey: 'reaction.fire' },
  { kind: 'heartHands', emoji: '\u{1FAF6}', labelKey: 'reaction.heartHands' },
  { kind: 'thanks', emoji: '\u{1F64F}', labelKey: 'reaction.thanks' },
  { kind: 'sad', emoji: '\u{1F622}', labelKey: 'reaction.sad' },
  { kind: 'angry', emoji: '\u{1F621}', labelKey: 'reaction.angry' },
  { kind: 'thinking', emoji: '\u{1F914}', labelKey: 'reaction.thinking' },
  { kind: 'hundred', emoji: '\u{1F4AF}', labelKey: 'reaction.hundred' },
  { kind: 'eyes', emoji: '\u{1F440}', labelKey: 'reaction.eyes' },
  { kind: 'strong', emoji: '\u{1F4AA}', labelKey: 'reaction.strong' },
  { kind: 'check', emoji: '\u{2705}', labelKey: 'reaction.check' },
];

/**
 * First row shown in the chat long-press / hover surface: eight high
 * frequency kinds in a stable order. The expanded panel carries the full
 * catalog; it never offers emojis outside {@link REACTION_CATALOG}.
 */
export const QUICK_REACTION_KINDS: readonly ReactionKind[] = [
  'like', 'love', 'laugh', 'celebrate', 'wow', 'clap', 'fire', 'heartHands',
];

export const REACTION_BY_KIND: ReadonlyMap<ReactionKind, ReactionMeta> =
  new Map(REACTION_CATALOG.map(meta => [meta.kind, meta]));

const EMOJI_TO_KIND: ReadonlyMap<string, ReactionKind> =
  new Map(REACTION_CATALOG.map(meta => [meta.emoji, meta.kind]));

/** Localized reaction names — bilingual vocabulary data shared by every surface. */
export const REACTION_LABELS: Readonly<Record<'zh' | 'en', Readonly<Record<ReactionKind, string>>>> = {
  zh: {
    like: '赞', love: '喜欢', laugh: '大笑', celebrate: '庆祝', wow: '惊讶',
    clap: '鼓掌', fire: '火热', heartHands: '比心', thanks: '感谢', sad: '难过',
    angry: '生气', thinking: '想想', hundred: '满分', eyes: '围观',
    strong: '给力', check: '参加',
  },
  en: {
    like: 'Like', love: 'Love', laugh: 'Laugh', celebrate: 'Celebrate', wow: 'Wow',
    clap: 'Clap', fire: 'Fire', heartHands: 'Heart hands', thanks: 'Thanks',
    sad: 'Sad', angry: 'Angry', thinking: 'Thinking', hundred: '100',
    eyes: 'Watching', strong: 'Strong', check: 'Join',
  },
};

export function reactionLabel(kind: ReactionKind, locale: 'zh' | 'en' = 'zh'): string {
  return REACTION_LABELS[locale][kind];
}

export function emojiForKind(kind: ReactionKind): string {
  return REACTION_BY_KIND.get(kind)?.emoji ?? '';
}

/** Strict emoji→kind lookup; unknown emoji return undefined, never a fallback. */
export function kindForEmoji(emoji: string): ReactionKind | undefined {
  return EMOJI_TO_KIND.get(emoji);
}
