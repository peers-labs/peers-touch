import type { ChatMessage } from './chatMessageModel';

/**
 * One rendered timeline row after collapsing bot events. `foldCount` is the
 * number of consecutive same-group bot service messages the row represents;
 * it is 1 for ordinary messages and for bot events that stand alone.
 */
export interface FoldedChatMessage<T extends ChatMessage = ChatMessage> {
  message: T;
  foldCount: number;
}

/**
 * Resolve the presentation fold key of a bot service message.
 *
 * `group_key` is documented on the wire contract as the fold key:
 * "consecutive ... events sharing it collapse into one card"
 * (model/domain/bot/webhook.proto). A missing/blank key never folds.
 */
function botEventGroupKey(message: ChatMessage): string {
  const key = message.botEvent?.groupKey;
  return typeof key === 'string' ? key.trim() : '';
}

/**
 * Collapse maximal consecutive runs of bot service messages that share a
 * non-empty `group_key` into a single representative row.
 *
 * Presentation-only transform: it never mutates the source list and never
 * touches the store, so unread counts, conversation previews, paging, pins,
 * reactions and search keep per-message fidelity. The representative is the
 * run's FIRST event (the card position/body validated in the bot-inbox
 * prototype); later events only raise the fold count.
 *
 * A human message, a bot event without `group_key`, or a different group key
 * all terminate a run, so same-key events that are not adjacent stay separate.
 * Input must already be in ascending timeline order.
 */
export function foldAdjacentBotEvents<T extends ChatMessage>(
  messages: readonly T[],
): FoldedChatMessage<T>[] {
  const rows: FoldedChatMessage<T>[] = [];

  for (const message of messages) {
    const key = botEventGroupKey(message);
    const previous = rows[rows.length - 1];

    if (key && previous && botEventGroupKey(previous.message) === key) {
      previous.foldCount += 1;
      continue;
    }

    rows.push({ message, foldCount: 1 });
  }

  return rows;
}
