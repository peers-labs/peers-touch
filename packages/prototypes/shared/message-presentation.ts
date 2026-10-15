/** Conversation identity policy shared by the Desktop and Mobile prototypes. */
export interface MessagePresentationInput {
  id: string;
  senderId?: string;
  own: boolean;
  timestamp?: number;
  barrier?: boolean;
}

export interface MessagePresentation {
  start: boolean;
  end: boolean;
  showSender: boolean;
}

const CLUSTER_INTERVAL_MS = 5 * 60_000;

export function presentMessageClusters(
  messages: readonly MessagePresentationInput[],
  _group: boolean,
): Map<string, MessagePresentation> {
  const sameCluster = (left?: MessagePresentationInput, right?: MessagePresentationInput) => {
    if (!left || !right || left.barrier || right.barrier
      || !left.senderId || left.senderId !== right.senderId || left.own !== right.own
      || left.timestamp === undefined || right.timestamp === undefined) return false;
    const elapsed = right.timestamp - left.timestamp;
    return elapsed >= 0 && elapsed <= CLUSTER_INTERVAL_MS
      && new Date(left.timestamp).toDateString() === new Date(right.timestamp).toDateString();
  };
  return new Map(messages.map((message, index) => {
    const start = !sameCluster(messages[index - 1], message);
    return [message.id, {
      start,
      end: !sameCluster(message, messages[index + 1]),
      showSender: false,
    }];
  }));
}
