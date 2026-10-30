// Framework-agnostic @-mention text model for the Social comment
// composer. Offsets are UTF-16 code units — the same contract the
// Station validates (see social/domain ValidateTypedMentions) — so the
// composer can preflight ranges without a round trip.

export interface SocialMentionWire {
  actorPtid: string;
  offset: number;
  length: number;
  display: string;
}

export interface SocialMentionCandidate {
  actorPtid: string;
  displayName: string;
  username?: string;
  /** Secondary label (home station etc.). */
  label?: string;
}

export interface SocialTextMention {
  actorPtid: string;
  /** UTF-16 offset of the first mention character. */
  offset: number;
  /** UTF-16 length of the rendered mention display. */
  length: number;
  display: string;
}

export interface MentionTrigger {
  /** UTF-16 index of the '@'. */
  start: number;
  /** Query text after '@' up to the caret. */
  query: string;
  /** Caret UTF-16 index. */
  caret: number;
}

export function utf16Length(text: string): number {
  return text.length;
}

/** Read the text at a UTF-16 code-unit range (JS strings are already
 * indexed by UTF-16 units). */
export function sliceUtf16(text: string, start: number, end: number): string {
  return String.fromCharCode(...toCodeUnits(text).slice(start, end));
}

function toCodeUnits(text: string): Uint16Array {
  const units: number[] = [];
  for (let i = 0; i < text.length; i += 1) units.push(text.charCodeAt(i));
  return Uint16Array.from(units);
}

/**
 * Detect an active mention trigger immediately before the caret.
 * A trigger starts at '@' when the preceding character is a mention
 * boundary: start-of-input, whitespace, punctuation such as '(' / '（',
 * or a CJK ideograph (`你好@x`). A Latin letter/digit directly before
 * '@' (an email-like token such as `user@host`) is not a boundary. The
 * token between '@' and the caret must not contain whitespace.
 */
export function findMentionTrigger(
  text: string,
  caretUtf16: number,
): MentionTrigger | null {
  if (caretUtf16 <= 0) return null;
  const units = toCodeUnits(text);
  let index = Math.min(caretUtf16, units.length) - 1;
  while (index >= 0) {
    const code = units[index];
    if (isWhitespaceCode(code)) return null;
    if (code === '@'.charCodeAt(0)) {
      if (index > 0 && !isMentionBoundaryCode(units[index - 1])) return null;
      const queryUnits = units.slice(index + 1, caretUtf16);
      const query = String.fromCharCode(...queryUnits);
      return { start: index, query, caret: caretUtf16 };
    }
    index -= 1;
  }
  return null;
}

function isWhitespaceCode(code: number | undefined): boolean {
  if (code === undefined) return true;
  return code === 0x20 || code === 0x0a || code === 0x09 || code === 0x0d;
}

function isMentionBoundaryCode(code: number | undefined): boolean {
  if (code === undefined) return true;
  if (isWhitespaceCode(code)) return true;
  // ASCII and fullwidth punctuation: ( ) （ ） 「 」 and friends.
  if (
    (code >= 0x21 && code <= 0x2f)
    || (code >= 0x3a && code <= 0x40)
    || (code >= 0x5b && code <= 0x60)
    || (code >= 0x7b && code <= 0x7e)
    || (code >= 0x3000 && code <= 0x303f) // CJK symbols/punctuation
    || (code >= 0xff00 && code <= 0xffef) // halfwidth/fullwidth forms
  ) {
    return true;
  }
  // CJK Hiragana, Katakana, and ideographs allow `你好@x`. A Latin
  // letter/digit directly before '@' is intentionally NOT a boundary
  // so email-like tokens do not open the mention popover.
  return (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff);
}

/**
 * Commit a candidate into the text, replacing the '@query' token with
 * the actor display (prefixed with '@'). A trailing space is inserted so
 * typing continues after the mention. Returns the new text, the new
 * caret UTF-16 index, and the mention range.
 */
export function commitMention(
  text: string,
  trigger: MentionTrigger,
  candidate: Pick<SocialMentionCandidate, 'actorPtid' | 'displayName'>,
): { text: string; caret: number; mention: SocialTextMention } {
  const display = candidate.displayName.startsWith('@')
    ? candidate.displayName
    : `@${candidate.displayName}`;
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.caret);
  const needsSpace = !after.startsWith(' ');
  const inserted = `${display}${needsSpace ? ' ' : ''}`;
  const nextText = `${before}${display}${needsSpace ? ' ' : ''}${after}`;
  const caret = utf16Length(before) + utf16Length(inserted);
  return {
    text: nextText,
    caret,
    mention: {
      actorPtid: candidate.actorPtid,
      offset: utf16Length(before),
      length: utf16Length(display),
      display,
    },
  };
}

/**
 * Keep only mentions whose display still appears at the recorded
 * UTF-16 range. Editing inside/removing text around a mention drops it;
 * a bare '@name' without a committed mention never resolves to an actor.
 */
export function rebaseMentions(
  text: string,
  mentions: SocialTextMention[],
): SocialTextMention[] {
  const units = toCodeUnits(text);
  return mentions.filter((mention) => {
    if (mention.offset < 0 || mention.length <= 0) return false;
    if (mention.offset + mention.length > units.length) return false;
    const slice = String.fromCharCode(
      ...units.slice(mention.offset, mention.offset + mention.length),
    );
    return slice === mention.display;
  });
}

/**
 * Final preflight before submit: dedupe actors, sort by offset, drop
 * invalid ranges. Mirrors the Station's request-side validation.
 */
export function normalizeMentions(
  text: string,
  mentions: SocialTextMention[],
): SocialTextMention[] {
  const valid = rebaseMentions(text, mentions);
  const seen = new Set<string>();
  const deduped = valid.filter((mention) => {
    if (seen.has(mention.actorPtid)) return false;
    seen.add(mention.actorPtid);
    return true;
  });
  deduped.sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < deduped.length; index += 1) {
    const previousEnd = deduped[index - 1]!.offset + deduped[index - 1]!.length;
    if (deduped[index]!.offset < previousEnd) return [];
  }
  return deduped;
}

export function mentionsToWire(mentions: SocialTextMention[]): SocialMentionWire[] {
  return mentions.map((mention) => ({
    actorPtid: mention.actorPtid,
    offset: mention.offset,
    length: mention.length,
    display: mention.display,
  }));
}
