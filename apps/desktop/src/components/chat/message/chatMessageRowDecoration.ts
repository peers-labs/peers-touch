import { socialThreadKey } from '../../../store/socialChat';
import type { ChatMessage } from './chatMessageModel';
import { resolveChatMessageThreadStats } from './chatMessageThreadStats';
import {
  reactionMutationForProjection,
  visibleMessageReactions,
  type MessageReaction,
  type MessageReactionMutation,
} from './messageReactionState';

export interface ChatThreadStats {
  replyCount: number;
  replyIds: string[];
  previewMessages: ChatMessage[];
  unreadCount: number;
}

export interface ReactionMutationHint {
  emoji: string;
  phase: MessageReactionMutation['phase'];
}

export interface ThreadCountSummary {
  replyCount?: number;
  unreadCount?: number;
}

export interface ChatRowDecoration {
  reactionsByUlid: Map<string, MessageReaction[]>;
  reactionMutationsByUlid: Map<string, ReactionMutationHint>;
  threadStatsByUlid: Map<string, ChatThreadStats>;
}

export const EMPTY_MESSAGE_REACTIONS: MessageReaction[] = [];
export const EMPTY_THREAD_STATS: ChatThreadStats = {
  replyCount: 0,
  replyIds: [],
  previewMessages: [],
  unreadCount: 0,
};

function sameReactionList(
  previous: MessageReaction[] | undefined,
  next: MessageReaction[],
): previous is MessageReaction[] {
  if (!previous || previous.length !== next.length) return false;
  return next.every((reaction, index) => {
    const older = previous[index];
    return Boolean(older) && older.actorPtid === reaction.actorPtid && older.emoji === reaction.emoji;
  });
}

function sameStringList(previous: string[], next: string[]): boolean {
  return previous.length === next.length
    && next.every((value, index) => previous[index] === value);
}

function sameMessageIdentityList(previous: ChatMessage[], next: ChatMessage[]): boolean {
  return previous.length === next.length
    && next.every((message, index) => previous[index] === message);
}

function sameThreadStats(previous: ChatThreadStats, next: ChatThreadStats): boolean {
  return previous.replyCount === next.replyCount
    && previous.unreadCount === next.unreadCount
    && sameStringList(previous.replyIds, next.replyIds)
    && sameMessageIdentityList(previous.previewMessages, next.previewMessages);
}

export interface BuildChatRowDecorationInput {
  /** Surface roots the rows render. */
  messages: ChatMessage[];
  /** All projected conversation messages, including inline thread replies. */
  conversationMessages: ChatMessage[];
  previous: ChatRowDecoration | null;
  reactions: Record<string, MessageReaction[]>;
  reactionMutations: Record<string, MessageReactionMutation>;
  currentUserPtid: string | null;
  activeKind: 'friend' | 'group';
  activeConversationId: string;
  threadCounts: Record<string, ThreadCountSummary>;
  /** Projects the loaded thread slice for one root through the store memo. */
  projectThreadMessages: (rootUlid: string) => ChatMessage[];
}

/**
 * Resolves per-row timeline decorations once per input change and reuses the
 * previous reference for rows whose slice did not change. Combined with
 * React.memo on ChatMessageRow this keeps unrelated rows from committing when
 * a single message's reactions / thread data mutate (e.g. while typing with
 * unrelated store fan-out in flight).
 */
export function buildChatRowDecoration(input: BuildChatRowDecorationInput): ChatRowDecoration {
  const {
    messages,
    conversationMessages,
    previous,
    reactions,
    reactionMutations,
    currentUserPtid,
    activeKind,
    activeConversationId,
    threadCounts,
    projectThreadMessages,
  } = input;
  const reactionsByUlid = new Map<string, MessageReaction[]>();
  const reactionMutationsByUlid = new Map<string, ReactionMutationHint>();
  const threadStatsByUlid = new Map<string, ChatThreadStats>();

  for (const message of messages) {
    const rawReactions = reactions[message.ulid] ?? EMPTY_MESSAGE_REACTIONS;
    const mutation = reactionMutationForProjection(
      rawReactions,
      currentUserPtid,
      reactionMutations[message.ulid],
    );
    const nextReactions = [...visibleMessageReactions(rawReactions, mutation)];
    const previousReactions = previous?.reactionsByUlid.get(message.ulid);
    reactionsByUlid.set(
      message.ulid,
      previousReactions && sameReactionList(previousReactions, nextReactions)
        ? previousReactions
        : nextReactions,
    );
    if (mutation) {
      const hint: ReactionMutationHint = { emoji: mutation.emoji, phase: mutation.phase };
      const previousHint = previous?.reactionMutationsByUlid.get(message.ulid);
      reactionMutationsByUlid.set(
        message.ulid,
        previousHint && previousHint.emoji === hint.emoji && previousHint.phase === hint.phase
          ? previousHint
          : hint,
      );
    }

    const threadKey = socialThreadKey(activeKind, activeConversationId, message.ulid);
    const threadSummary = threadCounts[threadKey];
    const resolved = resolveChatMessageThreadStats({
      rootUlid: message.ulid,
      currentMessages: conversationMessages,
      loadedThreadMessages: projectThreadMessages(message.ulid),
      projectedReplyCount: threadSummary?.replyCount,
    });
    const nextStats: ChatThreadStats = {
      ...resolved,
      unreadCount: threadSummary?.unreadCount ?? 0,
    };
    const previousStats = previous?.threadStatsByUlid.get(message.ulid);
    threadStatsByUlid.set(
      message.ulid,
      previousStats && sameThreadStats(previousStats, nextStats) ? previousStats : nextStats,
    );
  }

  return { reactionsByUlid, reactionMutationsByUlid, threadStatsByUlid };
}
