import { isRecalledChatMessage } from '@peers-touch/client-chat-core';

import type {
  ChatMessageCommandOutcome,
  ChatMessageCommandOutcomes,
} from '../../features/chat/messageCommandState';
import {
  messageDeliveryDisplayState,
  messageProjectionMetadata,
} from '../../features/chat/messageProjection';
import type { SocialMessage } from '../../features/social/socialTypes';

export interface ChatMessageClusterEntry {
  readonly message: SocialMessage;
  readonly clusterId: string;
  readonly position: 'single' | 'start' | 'middle' | 'end';
  readonly showAvatar: boolean;
  readonly showMetadata: boolean;
}

export function projectChatMessageClusters(
  messages: readonly SocialMessage[],
  currentUserPtid: string | null,
  commandOutcomes: ChatMessageCommandOutcomes,
): ChatMessageClusterEntry[] {
  let clusterStart = 0;

  return messages.map((message, index) => {
    if (
      index === 0
      || !messagesCanShareCluster(
        messages[index - 1],
        message,
        currentUserPtid,
        commandOutcomes,
      )
    ) {
      clusterStart = index;
    }

    const startsCluster = clusterStart === index;
    const endsCluster = index === messages.length - 1
      || !messagesCanShareCluster(
        message,
        messages[index + 1],
        currentUserPtid,
        commandOutcomes,
      );
    const position = startsCluster
      ? endsCluster
        ? 'single'
        : 'start'
      : endsCluster
        ? 'end'
        : 'middle';

    return {
      message,
      clusterId: messages[clusterStart].ulid,
      position,
      showAvatar: endsCluster,
      showMetadata: endsCluster,
    };
  });
}

function messagesCanShareCluster(
  previous: SocialMessage,
  next: SocialMessage,
  currentUserPtid: string | null,
  commandOutcomes: ChatMessageCommandOutcomes,
): boolean {
  return previous.senderPtid === next.senderPtid
    && !messageRequiresLocalStatus(previous, currentUserPtid, commandOutcomes[previous.ulid])
    && !messageRequiresLocalStatus(next, currentUserPtid, commandOutcomes[next.ulid]);
}

function messageRequiresLocalStatus(
  message: SocialMessage,
  currentUserPtid: string | null,
  commandOutcome: ChatMessageCommandOutcome | undefined,
): boolean {
  if (
    commandOutcome
    || isRecalledChatMessage(message)
    || messageProjectionMetadata(message).moderated
  ) {
    return true;
  }
  if (!currentUserPtid || message.senderPtid !== currentUserPtid) return false;
  return ['sending', 'retrying', 'failed'].includes(
    messageDeliveryDisplayState(message),
  );
}
