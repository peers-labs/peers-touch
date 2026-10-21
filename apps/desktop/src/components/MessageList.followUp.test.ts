import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const listSource = readFileSync(new URL('./MessageList.tsx', import.meta.url), 'utf8');
const chipsSource = readFileSync(
  new URL('./chat/FollowUpChips.tsx', import.meta.url),
  'utf8',
);

describe('MessageList follow-up ownership', () => {
  it('keeps a newly projected follow-up row visible at the live tail', () => {
    expect(listSource).toContain('const totalSize = virtualizer.getTotalSize()');
    expect(listSource).toContain(
      'const previousScrollHeightRef = useRef<number | null>(null)',
    );
    expect(listSource).toContain(
      'previousScrollHeight - el.scrollTop - el.clientHeight < 60',
    );
    expect(listSource).toContain('el.scrollTop = el.scrollHeight');
    expect(listSource).toContain('previousScrollHeightRef.current = el.scrollHeight');
    expect(listSource).not.toContain('prevCountRef');
    expect(listSource).not.toContain('isAtBottomRef');
  });

  it('exposes each suggestion through a stable product selector', () => {
    expect(chipsSource).toContain('data-pt-agent-follow-up={suggestion}');
    expect(chipsSource).toContain('data-pt-agent-follow-up-action="add"');
    expect(chipsSource).toContain('data-pt-agent-follow-up-action="send"');
  });
});
