import { describe, expect, it } from 'vitest';

import type { ChatMessage } from './chatMessageModel';
import { foldAdjacentBotEvents } from './botEventFold';

function humanMessage(ulid: string): ChatMessage {
  return { ulid } as unknown as ChatMessage;
}

function botMessage(ulid: string, groupKey: string | undefined): ChatMessage {
  return {
    ulid,
    botEvent: groupKey === undefined ? undefined : { groupKey },
  } as unknown as ChatMessage;
}

describe('foldAdjacentBotEvents', () => {
  it('returns an empty list for empty input', () => {
    expect(foldAdjacentBotEvents([])).toEqual([]);
  });

  it('leaves human messages unfolded', () => {
    const rows = foldAdjacentBotEvents([humanMessage('h1'), humanMessage('h2')]);

    expect(rows.map((row) => [row.message.ulid, row.foldCount])).toEqual([
      ['h1', 1],
      ['h2', 1],
    ]);
  });

  it('folds consecutive bot events sharing a group key into the first event', () => {
    const messages = [
      botMessage('b1', 'task-42'),
      botMessage('b2', 'task-42'),
      botMessage('b3', 'task-42'),
    ];

    const rows = foldAdjacentBotEvents(messages);

    expect(rows).toHaveLength(1);
    expect(rows[0].message.ulid).toBe('b1');
    expect(rows[0].foldCount).toBe(3);
  });

  it('keeps different group keys on separate cards', () => {
    const rows = foldAdjacentBotEvents([
      botMessage('b1', 'task-1'),
      botMessage('b2', 'task-2'),
    ]);

    expect(rows.map((row) => [row.message.ulid, row.foldCount])).toEqual([
      ['b1', 1],
      ['b2', 1],
    ]);
  });

  it('does not fold same-key events separated by another message', () => {
    const rows = foldAdjacentBotEvents([
      botMessage('b1', 'task-1'),
      botMessage('b2', 'task-1'),
      humanMessage('h1'),
      botMessage('b3', 'task-1'),
    ]);

    expect(rows.map((row) => [row.message.ulid, row.foldCount])).toEqual([
      ['b1', 2],
      ['h1', 1],
      ['b3', 1],
    ]);
  });

  it('never folds bot events without a group key', () => {
    const rows = foldAdjacentBotEvents([
      botMessage('b1', undefined),
      botMessage('b2', ''),
      botMessage('b3', '   '),
    ]);

    expect(rows.map((row) => [row.message.ulid, row.foldCount])).toEqual([
      ['b1', 1],
      ['b2', 1],
      ['b3', 1],
    ]);
  });

  it('restarts folding after an unkeyed bot event', () => {
    const rows = foldAdjacentBotEvents([
      botMessage('b1', 'task-1'),
      botMessage('b2', undefined),
      botMessage('b3', 'task-1'),
    ]);

    expect(rows.map((row) => [row.message.ulid, row.foldCount])).toEqual([
      ['b1', 1],
      ['b2', 1],
      ['b3', 1],
    ]);
  });

  it('does not mutate the source list or messages', () => {
    const messages = [botMessage('b1', 'task-1'), botMessage('b2', 'task-1')];

    foldAdjacentBotEvents(messages);

    expect(messages).toHaveLength(2);
    expect(messages[0].ulid).toBe('b1');
  });
});
