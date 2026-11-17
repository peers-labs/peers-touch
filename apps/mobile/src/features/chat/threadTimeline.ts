import type { SocialMessage } from '../social/socialTypes';

/**
 * Main-timeline thread grouping.
 *
 * A thread must read as one parent card with its replies nested beneath it,
 * not as a stream of flat quote messages (which is the ordinary reply
 * pattern). The wire still delivers thread replies into the conversation
 * history with `threadRootUlid` set, so the presentation layer groups them
 * back under their root before windowing.
 */
export interface ThreadTimelineUnit {
  /** Stable window/anchor key: the root ulid, or the message ulid for an
      orphan reply whose root is not present in the loaded history. */
  readonly key: string;
  readonly root: SocialMessage;
  /** Replies in history order; empty for ordinary messages / orphan replies. */
  readonly replies: ReadonlyArray<SocialMessage>;
  readonly isThread: boolean;
}

interface MutableThreadTimelineUnit extends ThreadTimelineUnit {
  replies: SocialMessage[];
  isThread: boolean;
}

function isThreadReply(message: SocialMessage): boolean {
  return Boolean(message.threadRootUlid && message.threadRootUlid !== message.ulid);
}

/**
 * Group sorted history messages into top-level timeline units.
 *
 * - Ordinary messages and thread roots become one unit each.
 * - Replies whose root is present are nested under the root; the unit keeps
 *   the root's position so the thread never splits across the stream.
 * - A reply whose root is missing from the loaded history degrades to a
 *   standalone unit so the message is never silently hidden.
 */
export function buildThreadTimelineUnits(
  messages: ReadonlyArray<SocialMessage>,
): ThreadTimelineUnit[] {
  const presentIds = new Set(messages.map((message) => message.ulid));
  const units = new Map<string, MutableThreadTimelineUnit>();
  const order: string[] = [];

  const ensureUnit = (key: string, root: SocialMessage): MutableThreadTimelineUnit => {
    const existing = units.get(key);
    if (existing) return existing;
    const unit: MutableThreadTimelineUnit = { key, root, replies: [], isThread: false };
    units.set(key, unit);
    order.push(key);
    return unit;
  };

  for (const message of messages) {
    if (!isThreadReply(message)) {
      // Roots and ordinary messages own their position in the stream.
      ensureUnit(message.ulid, message);
      continue;
    }
    const rootId = message.threadRootUlid as string;
    if (presentIds.has(rootId)) {
      const rootMessage = messages.find((candidate) => candidate.ulid === rootId);
      if (rootMessage) {
        const unit = ensureUnit(rootId, rootMessage);
        unit.isThread = true;
        unit.replies.push(message);
        continue;
      }
    }
    // Orphan reply: root not loaded. Keep it visible as its own row rather
    // than dropping it from the timeline.
    ensureUnit(message.ulid, message);
  }

  return order.map((key) => units.get(key) as ThreadTimelineUnit);
}

/** Resolve any message id to the top-level window key that contains it, so
    scroll/reveal can target a reply nested inside a thread card. */
export function threadTimelineAnchor(
  units: ReadonlyArray<ThreadTimelineUnit>,
  messageUlid: string,
): string {
  for (const unit of units) {
    if (unit.key === messageUlid) return unit.key;
    if (unit.replies.some((reply) => reply.ulid === messageUlid)) return unit.key;
  }
  return messageUlid;
}
