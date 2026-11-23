import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const boundarySource = source('./ChatMessageSectionBoundary.tsx');
const pageSource = source('../ChatPage.tsx');
const selectorSource = source('../../features/chat/threadTimeline.ts');
const stylesSource = source('../../styles.css');

describe('Thread presentation contract', () => {
  it('suppresses only the redundant root quote inside the dedicated thread view', () => {
    // A thread reply defaults its quote to the root already pinned at the
    // top, so that quote is dropped; an explicit quote to another reply
    // remains a real cross-reference.
    expect(boundarySource).toContain(
      '!(isThreadView && message.replyToUlid === threadRootUlid)',
    );
  });

  it('windows the main timeline over grouped thread units, not flat replies', () => {
    expect(boundarySource).toContain('buildThreadTimelineUnits(messages)');
    expect(boundarySource).toContain('items={timelineUnits}');
    expect(boundarySource).toContain('renderMessageRow(unit.root, unit.replies)');
  });

  it('renders replies inside the root bubble with avatar, time and an open entry', () => {
    expect(boundarySource).toContain('function MessageThreadPreview');
    expect(boundarySource).toContain('data-message-thread-root');
    expect(boundarySource).toContain('onClick={() => onOpenThread?.(root)}');
    expect(boundarySource).toContain('message-thread-preview__reply');
    // Each reply row carries its own reply time.
    expect(boundarySource).toContain('message-thread-preview__time');
    expect(boundarySource).toContain('formatRelativeTime(messageTimestampMillis(reply), t)');
    // The preview is mounted inside the message bubble, not as a sibling card.
    expect(boundarySource).toContain(
      'className={`message-bubble${bareImageBubble ? \' message-bubble--bare-image\' : \'\'}`}',
    );
    // No side rail / separate surface chrome.
    expect(boundarySource).not.toContain('message-thread-preview__rail');
    expect(boundarySource).not.toContain('message-thread-preview__surface');
  });

  it('wires the thread opener and resolves nested anchors from ChatPage', () => {
    expect(pageSource).toContain('onOpenThread={openMessageThread}');
    expect(pageSource).toContain('threadTimelineAnchor(');
    expect(pageSource).toContain('buildThreadTimelineUnits(history.visible)');
  });

  it('keeps the grouping rules explicit and orphan-safe in the selector', () => {
    expect(selectorSource).toContain('message.threadRootUlid !== message.ulid');
    expect(selectorSource).toContain('Orphan reply');
    expect(selectorSource).toContain('export function threadTimelineAnchor');
  });

  it('styles the thread block as an explicit light panel, never inheriting the dark bubble', () => {
    expect(stylesSource).toMatch(/\.message-thread-preview\s*\{[\s\S]*?background:\s*var\(--pt-subtle\)/);
    expect(stylesSource).toMatch(/\.message-thread-preview\s*\{[\s\S]*?color:\s*var\(--pt-text\)/);
    expect(stylesSource).not.toMatch(/\.message-thread-preview\s*\{[^}]*currentColor/);
    expect(stylesSource).toMatch(/\.message-thread-preview__time\s*\{[\s\S]*?--pt-muted/);
    expect(stylesSource).toMatch(/\.message-thread-preview__open\s*\{/);
    expect(stylesSource).not.toContain('message-thread-preview__rail');
  });

  it('flips the thread-view reply summary to the same side as an own root', () => {
    expect(boundarySource).toContain('thread-replies-divider${mine ? \' is-own\' : \'\'}');
    expect(stylesSource).toMatch(/\.thread-replies-divider\.is-own\s*\{[\s\S]*?row-reverse/);
  });
});
