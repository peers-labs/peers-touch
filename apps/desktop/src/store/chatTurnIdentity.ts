import type { ChatMessage } from './chat';

/**
 * Bind the exact optimistic row before considering a snapshot's turn match.
 * A folded snapshot may arrive first; retain its authoritative ID and content
 * while absorbing the now-correlated optimistic projection.
 */
export function bindTurnMessageIdentity(
  messages: ChatMessage[],
  role: ChatMessage['role'],
  optimisticId: string | undefined,
  turnId: string | undefined,
  carryProjection: (target: ChatMessage, source: ChatMessage) => ChatMessage,
): ChatMessage[] {
  if (!turnId) return messages;
  const local = messages.find((message) =>
    message.role === role && message.id === optimisticId,
  );
  if (!local) return messages;
  const bound = { ...local, turnId };
  const authoritative = messages.find((message) =>
    message.role === role && message.turnId === turnId
    && message.id !== optimisticId && !message.id.startsWith('temp-'),
  );
  if (!authoritative) {
    return messages.map((message) => message === local ? bound : message);
  }
  return messages
    .filter((message) => message !== local)
    .map((message) => message === authoritative
      ? carryProjection(authoritative, bound)
      : message);
}
