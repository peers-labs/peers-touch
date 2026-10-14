import { ReactionKind } from '../../gen/proto/domain/social/post_pb';

export interface ReactionPresentation {
  readonly kind: ReactionKind;
  readonly emoji: string;
  readonly label: string;
}

export const REACTION_PRESENTATIONS: readonly ReactionPresentation[] = [
  { kind: ReactionKind.REACTION_LIKE, emoji: '\u{1F44D}', label: 'moments.reaction.like' },
  { kind: ReactionKind.REACTION_LOVE, emoji: '\u{2764}\u{FE0F}', label: 'moments.reaction.love' },
  { kind: ReactionKind.REACTION_LAUGH, emoji: '\u{1F602}', label: 'moments.reaction.laugh' },
  { kind: ReactionKind.REACTION_CELEBRATE, emoji: '\u{1F389}', label: 'moments.reaction.celebrate' },
  { kind: ReactionKind.REACTION_WOW, emoji: '\u{1F62E}', label: 'moments.reaction.wow' },
  { kind: ReactionKind.REACTION_CLAP, emoji: '\u{1F44F}', label: 'moments.reaction.clap' },
  { kind: ReactionKind.REACTION_FIRE, emoji: '\u{1F525}', label: 'moments.reaction.fire' },
  { kind: ReactionKind.REACTION_HEART_HANDS, emoji: '\u{1FAF6}', label: 'moments.reaction.heartHands' },
  { kind: ReactionKind.REACTION_THANKS, emoji: '\u{1F64F}', label: 'moments.reaction.thanks' },
  { kind: ReactionKind.REACTION_SAD, emoji: '\u{1F622}', label: 'moments.reaction.sad' },
  { kind: ReactionKind.REACTION_ANGRY, emoji: '\u{1F621}', label: 'moments.reaction.angry' },
  { kind: ReactionKind.REACTION_THINKING, emoji: '\u{1F914}', label: 'moments.reaction.thinking' },
  { kind: ReactionKind.REACTION_HUNDRED, emoji: '\u{1F4AF}', label: 'moments.reaction.hundred' },
  { kind: ReactionKind.REACTION_EYES, emoji: '\u{1F440}', label: 'moments.reaction.eyes' },
  { kind: ReactionKind.REACTION_STRONG, emoji: '\u{1F4AA}', label: 'moments.reaction.strong' },
  { kind: ReactionKind.REACTION_CHECK, emoji: '\u{2705}', label: 'moments.reaction.check' },
];

const PRESENTATION_BY_KIND = new Map(
  REACTION_PRESENTATIONS.map((presentation) => [
    presentation.kind,
    presentation,
  ]),
);

export function reactionPresentation(
  kind: ReactionKind,
): ReactionPresentation {
  return PRESENTATION_BY_KIND.get(kind) ?? REACTION_PRESENTATIONS[0];
}
