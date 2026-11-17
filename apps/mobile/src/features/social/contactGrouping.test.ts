import { describe, expect, it } from 'vitest';

import {
  NON_LETTER_BUCKET,
  contactFirstLetter,
  fullIndexLetters,
  groupContactsByLetter,
  mergeFriendRequestsByRecency,
} from './contactGrouping';

describe('contactFirstLetter', () => {
  it('maps latin names to an uppercase initial', () => {
    expect(contactFirstLetter('alice')).toBe('A');
    expect(contactFirstLetter('Bob')).toBe('B');
    expect(contactFirstLetter('  zoe')).toBe('Z');
  });

  it('maps common Hanzi to their Hanyu Pinyin initial', () => {
    const cases: Array<[string, string]> = [
      ['阿', 'A'], ['白', 'B'], ['陈', 'C'], ['大', 'D'], ['发', 'F'],
      ['高', 'G'], ['好', 'H'], ['机', 'J'], ['李', 'L'], ['马', 'M'],
      ['你', 'N'], ['怕', 'P'], ['七', 'Q'], ['人', 'R'], ['三', 'S'],
      ['他', 'T'], ['王', 'W'], ['西', 'X'], ['一', 'Y'], ['张', 'Z'],
    ];
    for (const [hanzi, letter] of cases) {
      expect(contactFirstLetter(hanzi)).toBe(letter);
    }
  });

  it('falls back to the # bucket for digits, symbols and empty names', () => {
    expect(contactFirstLetter('1Password')).toBe(NON_LETTER_BUCKET);
    expect(contactFirstLetter('😀 smile')).toBe(NON_LETTER_BUCKET);
    expect(contactFirstLetter('')).toBe(NON_LETTER_BUCKET);
    expect(contactFirstLetter('   ')).toBe(NON_LETTER_BUCKET);
  });
});

describe('groupContactsByLetter', () => {
  interface Row {
    id: string;
    name: string;
  }
  const rows: Row[] = [
    { id: '1', name: '王芳' },
    { id: '2', name: 'alice' },
    { id: '3', name: 'Bob' },
    { id: '4', name: '陈晨' },
    { id: '5', name: '阿强' },
    { id: '6', name: '123 group' },
  ];

  it('partitions into A-Z groups with # sorted last', () => {
    const groups = groupContactsByLetter(rows, (row) => row.name);
    const letters = groups.map((group) => group.letter);
    expect(letters[letters.length - 1]).toBe(NON_LETTER_BUCKET);
    expect(letters.slice(0, -1)).toEqual([...letters.slice(0, -1)].sort());
  });

  it('places Hanzi contacts under their pinyin letter alongside latin names', () => {
    const groups = groupContactsByLetter(rows, (row) => row.name);
    const aGroup = groups.find((group) => group.letter === 'A');
    expect(aGroup?.items.map((row) => row.id).sort()).toEqual(['2', '5']);
    const wGroup = groups.find((group) => group.letter === 'W');
    expect(wGroup?.items.map((row) => row.id)).toEqual(['1']);
  });

  it('omits empty letters and keeps the # bucket content', () => {
    const groups = groupContactsByLetter(rows, (row) => row.name);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
    const hashGroup = groups.find((group) => group.letter === NON_LETTER_BUCKET);
    expect(hashGroup?.items.map((row) => row.id)).toEqual(['6']);
  });
});

describe('fullIndexLetters', () => {
  it('ends with the # bucket and contains 27 entries', () => {
    const letters = fullIndexLetters();
    expect(letters).toHaveLength(27);
    expect(letters[26]).toBe(NON_LETTER_BUCKET);
  });
});

describe('mergeFriendRequestsByRecency', () => {
  interface Req {
    id: string;
    at: number;
  }
  const inbound: Req[] = [{ id: 'in-1', at: 100 }, { id: 'in-2', at: 300 }];
  const outgoing: Req[] = [{ id: 'out-1', at: 200 }];

  it('tags direction and orders newest-first across both feeds', () => {
    const merged = mergeFriendRequestsByRecency(inbound, outgoing, (req) => req.at);
    expect(merged.map((entry) => entry.request.id)).toEqual(['in-2', 'out-1', 'in-1']);
    expect(merged.map((entry) => entry.direction)).toEqual(['inbound', 'outbound', 'inbound']);
  });

  it('keeps a stable order for equal timestamps', () => {
    const sameA: Req[] = [{ id: 'a', at: 50 }];
    const sameB: Req[] = [{ id: 'b', at: 50 }];
    const merged = mergeFriendRequestsByRecency(sameA, sameB, (req) => req.at);
    expect(merged.map((entry) => entry.request.id)).toEqual(['a', 'b']);
  });
});
