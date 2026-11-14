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
const chatCss = readFileSync(
  new URL('../../ui/chat.css', import.meta.url),
  'utf8',
);
const attachmentItemSource = readFileSync(
  new URL('./AttachmentItem.tsx', import.meta.url),
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

describe('thread tail pinning keeps the newest reply visible', () => {
  it('reuses the shared tail-pin policy and tracks the viewport scroll state', () => {
    expect(threadPanelSource).toContain('isChatMessageTailPinned');
    expect(threadPanelSource).toContain('tailPinnedRef');
    expect(threadPanelSource).toContain('onScroll={handleThreadScroll}');
  });

  it('pins to the tail in a pre-paint layout effect so sending cannot shake the panel', () => {
    expect(threadPanelSource).toContain('useLayoutEffect');
    expect(threadPanelSource).toContain('if (tailPinnedRef.current) scrollToThreadTail()');
    // An explicit anchor navigation must be able to suspend tail following.
    expect(threadPanelSource).toContain('tailPinnedRef.current = false');
  });

  it('keeps the newest message clear of the composer via the flex scroll viewport', () => {
    const scrollRule = chatCss.match(/\.sc-thread__scroll\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(scrollRule).toContain('flex: 1');
    expect(scrollRule).toContain('min-height: 0');
    expect(scrollRule).toContain('overflow-y: auto');
  });
});

describe('thread panel uses neutral materials, not the iMessage blue', () => {
  it('aliases the thread card to shared pine tokens', () => {
    // Declarations are unique; assert on the full stylesheet rather than
    // regex-scoping, since a smaller `.sc-thread {}` rule appears earlier.
    expect(chatCss).toContain('--thread-card-bg: var(--pt-subtle)');
    expect(chatCss).toContain('--thread-card-inner: var(--pt-surface)');
    expect(chatCss).toContain('--thread-card-divider: var(--pt-border)');
  });

  it('no longer hard-codes the legacy specialty blue hexes', () => {
    expect(chatCss).not.toContain('#d1e3fe');
    expect(chatCss).not.toContain('#b7cefc');
  });
});

describe('image attachments do not render a filename caption', () => {
  it('omits the image name/size caption block while keeping state and visibility badges', () => {
    expect(attachmentItemSource).not.toContain('sc-attachment__image-caption');
    expect(attachmentItemSource).not.toContain('sc-attachment__image-name');
    expect(attachmentItemSource).toContain('sc-attachment__state');
    expect(chatCss).not.toContain('.sc-attachment__image-caption');
  });
});
