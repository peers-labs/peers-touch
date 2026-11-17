/**
 * Contacts grouping helpers — pure, framework-free and fully unit-testable.
 *
 * Alphabet policy (mirrors WeChat):
 *  - Latin leading letter  -> uppercase A-Z bucket.
 *  - Han leading character -> Hanyu Pinyin initial via a compact Unicode
 *    boundary table (no heavy pinyin dependency; covers common GB2312 Hanzi).
 *  - Anything else (digit, emoji, symbol, unmapped Hanzi) -> the '#' bucket,
 *    always sorted last.
 */

export const NON_LETTER_BUCKET = '#';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * First Hanzi whose Pinyin initial is each letter, chosen as the collator-minimal
 * character of its letter bucket. They are strictly increasing under the zh
 * pinyin collator, so a binary search on Collator.compare maps a Hanzi to its
 * Pinyin initial without a heavy pinyin dictionary. Pinyin has no Hanzi
 * starting with I/U/V, so those letters are intentionally absent.
 */
const PINYIN_ANCHORS: ReadonlyArray<readonly [string, string]> = [
  ['A', '阿'], ['B', '八'], ['C', '才'], ['D', '打'], ['E', '额'],
  ['F', '发'], ['G', '改'], ['H', '哈'], ['J', '机'], ['K', '开'],
  ['L', '拉'], ['M', '妈'], ['N', '拿'], ['O', '哦'], ['P', '怕'],
  ['Q', '七'], ['R', '然'], ['S', '撒'], ['T', '他'], ['W', '挖'],
  ['X', '西'], ['Y', '压'], ['Z', '匝'],
];

const pinyinCollator: Intl.Collator | null = (() => {
  try {
    return new Intl.Collator('zh-Hans-CN-u-co-pinyin', { sensitivity: 'base' });
  } catch {
    return null;
  }
})();

function isHanzi(codePoint: number): boolean {
  return codePoint >= 0x4e00 && codePoint <= 0x9fff;
}

function pinyinInitial(hanzi: string): string {
  // Without pinyin collation (very old runtime), Hanzi cannot be bucketed
  // reliably and falls through to the '#' group rather than a wrong letter.
  if (!pinyinCollator) return NON_LETTER_BUCKET;
  let low = 0;
  let high = PINYIN_ANCHORS.length - 1;
  let result = NON_LETTER_BUCKET;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [letter, anchor] = PINYIN_ANCHORS[mid];
    if (pinyinCollator.compare(hanzi, anchor) >= 0) {
      result = letter;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/** Resolve the index letter for a display name. Never returns ''. */
export function contactFirstLetter(name: string): string {
  const trimmed = name.trim();
  const first = trimmed.charAt(0);
  if (!first) return NON_LETTER_BUCKET;
  const codePoint = first.codePointAt(0) ?? 0;
  if (codePoint >= 0x41 && codePoint <= 0x5a) return first; // A-Z
  if (codePoint >= 0x61 && codePoint <= 0x7a) return first.toUpperCase(); // a-z
  if (isHanzi(codePoint)) return pinyinInitial(first);
  return NON_LETTER_BUCKET;
}

export interface ContactLetterGroup<T> {
  readonly letter: string;
  readonly items: readonly T[];
}

/**
 * Partition contacts into A-Z groups followed by the '#' group. Within a group
 * items keep stable alphabetical order by display name (locale-aware, with
 * Hanyu fallback). Empty letters are omitted so the index only lists real ones.
 */
export function groupContactsByLetter<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
): ContactLetterGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const letter = contactFirstLetter(nameOf(item));
    const bucket = buckets.get(letter);
    if (bucket) bucket.push(item);
    else buckets.set(letter, [item]);
  }
  const sorted = [...buckets.entries()].map(([letter, bucketItems]) => ({
    letter,
    items: [...bucketItems].sort((a, b) =>
      nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base', numeric: true })),
  }));
  return sorted.sort((a, b) => {
    if (a.letter === NON_LETTER_BUCKET) return 1;
    if (b.letter === NON_LETTER_BUCKET) return -1;
    return a.letter.localeCompare(b.letter);
  });
}

/** Ordered letters actually present, for rendering the quick index rail. */
export function presentIndexLetters<T>(groups: readonly ContactLetterGroup<T>[]): string[] {
  return groups.map((group) => group.letter);
}

/** Full A-Z + '#' rail (used when a fixed-height index is preferred). */
export function fullIndexLetters(): string[] {
  return [...ALPHABET, NON_LETTER_BUCKET];
}

export type FriendRequestDirection = 'inbound' | 'outbound';

export interface DirectedFriendRequest<T> {
  readonly request: T;
  readonly direction: FriendRequestDirection;
  readonly sortKey: number;
}

/**
 * Merge inbound (received) and outgoing (sent) pending requests into one
 * recency-ordered feed, newest first by the supplied timestamp key. A stable
 * tie-break keeps equal timestamps deterministic.
 */
export function mergeFriendRequestsByRecency<T>(
  inbound: readonly T[],
  outgoing: readonly T[],
  timestampOf: (request: T) => number,
): DirectedFriendRequest<T>[] {
  type Scored = DirectedFriendRequest<T> & { readonly tie: number };
  const scored: Scored[] = [
    ...inbound.map((request, index): Scored => ({
      request, direction: 'inbound', sortKey: timestampOf(request), tie: index,
    })),
    ...outgoing.map((request, index): Scored => ({
      request, direction: 'outbound', sortKey: timestampOf(request), tie: index + inbound.length,
    })),
  ];
  return scored
    .sort((a, b) => (b.sortKey - a.sortKey) || (a.tie - b.tie))
    .map(({ request, direction, sortKey }) => ({ request, direction, sortKey }));
}
