import type { MessageMention } from "../../../services/im-service-contract";

/**
 * A group member the composer can insert as an @mention. `displayName` is the
 * canonical actor display name resolved by the store; it is the literal token
 * matched inside the plaintext at send time.
 */
export interface MentionCandidate {
  actorPtid: string;
  displayName: string;
  role: number;
}

const MENTION_QUERY_MAX = 32;
/** Canonical @all token; never localized so every client parses the flag. */
export const MENTION_ALL_TOKEN = "@all";

/**
 * Locate the active `@query` token at the caret. The query may not contain
 * whitespace: mention tokens are inserted as `@Display Name ` so typing a
 * space commits the token and closes the picker.
 */
export function findMentionTrigger(
  text: string,
  caretUtf16: number,
): { start: number; query: string } | null {
  const caret = Math.max(0, Math.min(caretUtf16, text.length));
  const head = text.slice(0, caret);
  const at = head.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(text[at - 1])) return null;
  const query = head.slice(at + 1);
  if (query.length > MENTION_QUERY_MAX || /\s/.test(query)) return null;
  return { start: at, query };
}

function isWordBoundary(text: string, index: number): boolean {
  if (index >= text.length) return true;
  const char = text[index];
  return /\s/.test(char) || /[\p{P}\p{S}]/u.test(char);
}

interface ResolvedRange {
  actorPtid: string;
  displayName: string;
  start: number;
  length: number;
}

/**
 * Resolve the final in-ciphertext mention set from the plaintext about to be
 * sent. Tokens are matched deterministically against the current member
 * snapshot, so offsets never drift while the user edits the draft.
 *
 * Longer display names win on overlap and each actor is mentioned at most
 * once; the shared codec enforces the same non-overlap/uniqueness rules again.
 */
export function buildMentionSet(
  text: string,
  candidates: readonly MentionCandidate[],
  mentionAll: boolean,
): { mentions: MessageMention[]; mentionAll: boolean } {
  const named = candidates
    .filter((candidate) => candidate.displayName.trim().length > 0)
    .map((candidate) => ({
      ...candidate,
      displayName: candidate.displayName.trim(),
    }))
    // Match the longest names first so a short prefix name cannot steal ranges.
    .sort(
      (a, b) =>
        b.displayName.length - a.displayName.length ||
        a.actorPtid.localeCompare(b.actorPtid),
    );

  const occupied: Array<[number, number]> = [];
  const actors = new Set<string>();
  const ranges: ResolvedRange[] = [];
  for (const candidate of named) {
    if (actors.has(candidate.actorPtid)) continue;
    const token = `@${candidate.displayName}`;
    let cursor = 0;
    while (cursor <= text.length - token.length) {
      const at = text.indexOf(token, cursor);
      if (at < 0) break;
      cursor = at + 1;
      const end = at + token.length;
      const beforeOk = at === 0 || /\s/.test(text[at - 1]);
      const afterOk = isWordBoundary(text, end);
      const overlaps = occupied.some(
        ([start, finish]) => at < finish && start < end,
      );
      if (beforeOk && afterOk && !overlaps) {
        ranges.push({
          actorPtid: candidate.actorPtid,
          displayName: candidate.displayName,
          start: at,
          length: token.length,
        });
        occupied.push([at, end]);
        actors.add(candidate.actorPtid);
        break;
      }
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  return {
    mentions: ranges.map((range) => ({
      actorPtid: range.actorPtid,
      offset: range.start,
      length: range.length,
      display: range.displayName,
    })),
    mentionAll,
  };
}

/** Whether the plaintext still contains the canonical @all token at a boundary. */
export function textContainsMentionAll(text: string): boolean {
  let cursor = 0;
  while (cursor <= text.length - MENTION_ALL_TOKEN.length) {
    const at = text.indexOf(MENTION_ALL_TOKEN, cursor);
    if (at < 0) return false;
    const end = at + MENTION_ALL_TOKEN.length;
    const beforeOk = at === 0 || /\s/.test(text[at - 1]);
    if (beforeOk && isWordBoundary(text, end)) return true;
    cursor = at + 1;
  }
  return false;
}
