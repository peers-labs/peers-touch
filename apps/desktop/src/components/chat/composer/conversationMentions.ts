import type { MessagingMentionIntent } from '../../../services/im-service-contract';

export interface ConversationMentionMember {
  actorPtid: string;
  displayName: string;
  avatar?: string;
}

export interface ConversationMentionSelection {
  actorPtid: string | null;
  display: string;
  start: number;
}

export interface ConversationMentionTrigger {
  start: number;
  end: number;
  query: string;
}

function isWhitespaceBoundary(value: string | undefined): boolean {
  return value === undefined || /\s/u.test(value);
}

function isExactMentionToken(text: string, start: number, token: string): boolean {
  const end = start + token.length;
  return text.slice(start, end) === token
    && isWhitespaceBoundary(text.slice(0, start).slice(-1) || undefined)
    && isWhitespaceBoundary(text.slice(end, end + 1) || undefined);
}

export function detectConversationMentionTrigger(
  text: string,
  cursor: number,
): ConversationMentionTrigger | null {
  const beforeCursor = text.slice(0, cursor);
  const start = beforeCursor.lastIndexOf('@');
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(beforeCursor[start - 1] ?? '')) return null;
  const query = beforeCursor.slice(start + 1);
  if (/\s/.test(query)) return null;
  return { start, end: cursor, query };
}

export function insertConversationMention(
  text: string,
  trigger: ConversationMentionTrigger,
  member: ConversationMentionMember | null,
): {
  text: string;
  cursor: number;
  selection: ConversationMentionSelection;
} {
  const display = member?.displayName.trim() || 'all';
  const token = `@${display}`;
  const suffix = text.slice(trigger.end);
  const separator = suffix !== '' && /^\s/u.test(suffix) ? '' : ' ';
  const nextText = `${text.slice(0, trigger.start)}${token}${separator}${suffix}`;
  return {
    text: nextText,
    cursor: trigger.start + token.length + separator.length,
    selection: {
      actorPtid: member?.actorPtid ?? null,
      display,
      start: trigger.start,
    },
  };
}

export function reconcileConversationMentions(
  text: string,
  selections: readonly ConversationMentionSelection[],
): ConversationMentionSelection[] {
  const used = new Set<number>();
  const result: ConversationMentionSelection[] = [];
  for (const selection of selections) {
    const token = `@${selection.display}`;
    const candidates: number[] = [];
    let start = text.indexOf(token);
    while (start >= 0) {
      if (!used.has(start) && isExactMentionToken(text, start, token)) {
        candidates.push(start);
      }
      start = text.indexOf(token, start + token.length);
    }
    if (candidates.length === 0) continue;
    candidates.sort((left, right) => (
      Math.abs(left - selection.start) - Math.abs(right - selection.start)
      || left - right
    ));
    const matchedStart = candidates[0]!;
    used.add(matchedStart);
    result.push({ ...selection, start: matchedStart });
  }
  return result.sort((left, right) => left.start - right.start);
}

export function conversationMentionDraft(
  text: string,
  selections: readonly ConversationMentionSelection[],
): {
  mentions: MessagingMentionIntent[];
  mentionAll: boolean;
  selections: ConversationMentionSelection[];
} {
  const reconciled = reconcileConversationMentions(text, selections);
  const mentionAll = reconciled.some((selection) => selection.actorPtid === null);
  if (mentionAll) {
    return {
      mentions: [],
      mentionAll: true,
      selections: reconciled.filter((selection) => selection.actorPtid === null).slice(0, 1),
    };
  }
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const mentions = reconciled.flatMap((selection) => {
    if (!selection.actorPtid || seen.has(selection.actorPtid)) return [];
    seen.add(selection.actorPtid);
    const token = `@${selection.display}`;
    return [{
      actorPtid: selection.actorPtid,
      offset: encoder.encode(text.slice(0, selection.start)).length,
      length: encoder.encode(token).length,
      display: selection.display,
    }];
  }).sort((left, right) => left.offset - right.offset || left.actorPtid.localeCompare(right.actorPtid));
  return { mentions, mentionAll: false, selections: reconciled };
}
