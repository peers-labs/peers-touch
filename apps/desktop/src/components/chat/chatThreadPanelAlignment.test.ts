// Source-contract guards for the Thread surface:
//  - thread rows must pass the sender's stable PTID into the avatar so an
//    avatar-less but known actor paints its initials tile instead of the
//    identity-neutral bot glyph;
//  - the inline preview under a root bubble only opens the standalone Thread
//    panel on an explicit click (it never auto-opens while prefetching).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const threadPanelSource = readFileSync(
  new URL('./ChatThreadPanel.tsx', import.meta.url),
  'utf8',
);
const messageRowSource = readFileSync(
  new URL('./message/ChatMessageRow.tsx', import.meta.url),
  'utf8',
);
const storeSource = readFileSync(
  new URL('../../store/socialChat.ts', import.meta.url),
  'utf8',
);

describe('thread avatar identity (no neutral bot for known avatar-less actors)', () => {
  it('binds the thread row avatar to the sender PTID', () => {
    expect(threadPanelSource).toContain(
      'actorPtid={message.senderPtid}',
    );
    expect(threadPanelSource).toContain('remoteUrl={senderProfile.avatar}');
  });
});

describe('inline thread preview opens the panel only on explicit action', () => {
  it('renders the preview as a button that calls onOpenThread', () => {
    expect(messageRowSource).toContain('role="button"');
    expect(messageRowSource).toContain('onClick={onOpenThread}');
  });

  it('keeps the prefetch action free of any open-panel side effect', () => {
    // prefetchThreadPreviews hydrates threadMessages only; it must never write
    // the open-panel state, otherwise loading a conversation would force the
    // standalone panel open. The functional store test asserts
    // openThreadRootUlid stays null; here we pin the write target to the
    // preview slice and forbid an open-state assignment.
    const prefetchBody = storeSource.slice(
      storeSource.indexOf('prefetchThreadPreviews: async'),
      storeSource.indexOf('markThreadRead: async'),
    );
    expect(prefetchBody).toContain('listThreadMessages');
    expect(prefetchBody).toContain('threadMessages:');
    expect(prefetchBody).not.toMatch(/openThreadRootUlid\s*:/);
  });
});
