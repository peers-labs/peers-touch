import { describe, expect, it } from 'vitest';

import { normalizeMessage } from '../social/socialNormalizers';
import { buildThreadTimelineUnits, threadTimelineAnchor } from './threadTimeline';

function message(ulid: string, threadRootUlid = '', content = ulid) {
  return normalizeMessage({
    ulid,
    content,
    threadRootUlid,
    sentAt: { seconds: 0 },
  });
}

describe('buildThreadTimelineUnits', () => {
  it('keeps a flat conversation without threads as one unit per message', () => {
    const units = buildThreadTimelineUnits([message('a'), message('b'), message('c')]);
    expect(units.map((unit) => unit.key)).toEqual(['a', 'b', 'c']);
    expect(units.every((unit) => unit.isThread === false)).toBe(true);
    expect(units.every((unit) => unit.replies.length === 0)).toBe(true);
  });

  it('nests thread replies beneath their root instead of splitting them into rows', () => {
    const root = message('root');
    const replyOne = message('reply-1', 'root');
    const replyTwo = message('reply-2', 'root');
    const units = buildThreadTimelineUnits([root, replyOne, replyTwo]);

    expect(units).toHaveLength(1);
    expect(units[0].key).toBe('root');
    expect(units[0].isThread).toBe(true);
    expect(units[0].root.ulid).toBe('root');
    expect(units[0].replies.map((reply) => reply.ulid)).toEqual(['reply-1', 'reply-2']);
  });

  it('keeps the thread unit at the root position even when ordinary messages follow', () => {
    const units = buildThreadTimelineUnits([
      message('earlier'),
      message('root'),
      message('reply-1', 'root'),
      message('later'),
    ]);
    expect(units.map((unit) => unit.key)).toEqual(['earlier', 'root', 'later']);
    expect(units[1].replies.map((reply) => reply.ulid)).toEqual(['reply-1']);
  });

  it('renders an orphan reply as its own unit when the root is not loaded', () => {
    const orphan = message('reply-x', 'missing-root');
    const units = buildThreadTimelineUnits([message('a'), orphan]);
    expect(units.map((unit) => unit.key)).toEqual(['a', 'reply-x']);
    expect(units[1].isThread).toBe(false);
    expect(units[1].replies).toHaveLength(0);
  });

  it('treats a threadRootUlid pointing at the message itself as a root, not a reply', () => {
    const selfRoot = normalizeMessage({
      ulid: 'self', content: 'self root', threadRootUlid: 'self', sentAt: { seconds: 0 },
    });
    const units = buildThreadTimelineUnits([selfRoot]);
    expect(units).toHaveLength(1);
    expect(units[0].isThread).toBe(false);
  });
});

describe('threadTimelineAnchor', () => {
  it('maps a nested reply id to its root window key', () => {
    const units = buildThreadTimelineUnits([
      message('root'),
      message('reply-1', 'root'),
      message('reply-2', 'root'),
    ]);
    expect(threadTimelineAnchor(units, 'reply-2')).toBe('root');
    expect(threadTimelineAnchor(units, 'root')).toBe('root');
  });

  it('returns the id unchanged when no unit contains it', () => {
    const units = buildThreadTimelineUnits([message('a')]);
    expect(threadTimelineAnchor(units, 'unknown')).toBe('unknown');
  });
});
