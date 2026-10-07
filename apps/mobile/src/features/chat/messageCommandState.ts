import type {
  MessagingCommandStatusProjection,
  MessagingPendingCommandResult,
} from '../../services/mobileCommands';
import type { SocialMessage } from '../social/socialTypes';
import { messageProjectionMetadata } from './messageProjection';

export type ChatMessageCommandKind =
  | 'edit'
  | 'recall'
  | 'hideForActor'
  | 'moderate'
  | 'reaction'
  | 'pin';
export type ChatMessageCommandVisibleState = 'pending' | 'failed' | 'uncertain';

export interface ChatMessageCommandOutcome {
  readonly commandId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly kind: ChatMessageCommandKind;
  readonly state: ChatMessageCommandVisibleState;
  readonly expectedContent?: string;
  readonly reaction?: string;
  readonly remove?: boolean;
  readonly lastErrorCode?: string;
}

export type ChatMessageCommandOutcomes =
  Readonly<Record<string, ChatMessageCommandOutcome>>;

export interface TrackChatMessageCommandInput {
  readonly conversationId: string;
  readonly messageId: string;
  readonly kind: ChatMessageCommandKind;
  readonly submission: MessagingPendingCommandResult;
  readonly expectedContent?: string;
  readonly reaction?: string;
  readonly remove?: boolean;
}

export function trackChatMessageCommand(
  outcomes: ChatMessageCommandOutcomes,
  input: TrackChatMessageCommandInput,
): ChatMessageCommandOutcomes {
  if (
    input.submission.state !== 'pending'
    || !input.submission.commandId
    || input.submission.messageId !== input.messageId
  ) {
    throw new Error('mobile.messaging.commandProjectionInvalid');
  }
  return {
    ...outcomes,
    [input.messageId]: {
      commandId: input.submission.commandId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      kind: input.kind,
      state: 'pending',
      expectedContent: input.expectedContent,
      reaction: input.reaction,
      remove: input.remove,
    },
  };
}

export async function refreshChatMessageCommandOutcomes(
  outcomes: ChatMessageCommandOutcomes,
  messages: ReadonlyArray<SocialMessage>,
  actorPtid: string,
  readStatus: (
    commandId: string,
  ) => Promise<MessagingCommandStatusProjection>,
): Promise<ChatMessageCommandOutcomes> {
  const entries = await Promise.all(
    Object.entries(outcomes).map(async ([messageId, outcome]) => {
      const message = messages.find((candidate) => candidate.ulid === messageId);
      if (isChatMessageCommandProjected(outcome, message, actorPtid)) {
        return [messageId, null] as const;
      }
      try {
        const status = await readStatus(outcome.commandId);
        return [
          messageId,
          outcomeFromStatus(outcome, status),
        ] as const;
      } catch {
        return [
          messageId,
          { ...outcome, state: 'uncertain' as const },
        ] as const;
      }
    }),
  );

  return Object.fromEntries(
    entries.filter(
      (entry): entry is readonly [string, ChatMessageCommandOutcome] =>
        entry[1] !== null,
    ),
  );
}

export function isChatMessageCommandProjected(
  outcome: ChatMessageCommandOutcome,
  message: SocialMessage | undefined,
  actorPtid: string,
): boolean {
  if (outcome.kind === 'hideForActor') return !message;
  if (!message) return false;
  if (message.ulid !== outcome.messageId) return false;
  switch (outcome.kind) {
    case 'edit':
      return Boolean(message.editedAt)
        && message.content === outcome.expectedContent;
    case 'recall':
      return Boolean(message.recalled);
    case 'moderate':
      return messageProjectionMetadata(message).moderated;
    case 'reaction': {
      const present = messageProjectionMetadata(message).reactions.some(
        (reaction) => (
          reaction.actorPtid === actorPtid
          && reaction.reaction === outcome.reaction
        ),
      );
      return outcome.remove ? !present : present;
    }
    case 'pin': {
      const pinnedByPtid = messageProjectionMetadata(message).pinnedByPtid;
      return outcome.remove ? !pinnedByPtid : pinnedByPtid === actorPtid;
    }
  }
}

export function isChatMessageCommandBusy(
  outcome: ChatMessageCommandOutcome | undefined,
): boolean {
  return outcome?.state === 'pending' || outcome?.state === 'uncertain';
}

function outcomeFromStatus(
  outcome: ChatMessageCommandOutcome,
  status: MessagingCommandStatusProjection,
): ChatMessageCommandOutcome {
  if (
    status.commandId !== outcome.commandId
    || status.conversationId !== outcome.conversationId
  ) {
    return {
      ...outcome,
      state: 'uncertain',
      lastErrorCode: 'mobile.messaging.commandProjectionBindingMismatch',
    };
  }
  switch (status.state) {
    case 'failed':
    case 'superseded':
      return {
        ...outcome,
        state: 'failed',
        lastErrorCode: status.lastErrorCode || undefined,
      };
    case 'retry_wait':
    case 'submitted':
      return {
        ...outcome,
        state: 'uncertain',
        lastErrorCode: status.lastErrorCode || undefined,
      };
    case 'pending':
    case 'committed':
      return {
        ...outcome,
        state: 'pending',
        lastErrorCode: status.lastErrorCode || undefined,
      };
  }
}
