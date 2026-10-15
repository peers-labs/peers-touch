import { ReactionKind } from '../../gen/proto/domain/social/post_pb';

/** Presentation mapping only; Station's generated enum remains the wire contract. */
export const MOBILE_REACTION_CHOICES = Object.freeze([
  { kind: ReactionKind.REACTION_LIKE, emoji: '👍' },
  { kind: ReactionKind.REACTION_LOVE, emoji: '❤️' },
  { kind: ReactionKind.REACTION_LAUGH, emoji: '😄' },
  { kind: ReactionKind.REACTION_WOW, emoji: '😮' },
  { kind: ReactionKind.REACTION_CELEBRATE, emoji: '🎉' },
]);
