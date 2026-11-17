// Source-contract: message attachment container grammar. Desktop uses a
// richer responsive attachment model (large contain previews + caption /
// transfer state), but the container rhythm itself follows the prototype
// .sk-msg-attachments: 8px stack gap, 6px gap from text, no top gap for
// media-only messages.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const contentSource = readFileSync(
  new URL('./message/ChatMessageContent.tsx', import.meta.url),
  'utf8',
);

describe('message attachment container', () => {
  it('is defined exactly once (no later conflicting duplicate rule)', () => {
    // A previous duplicate silently overrode flex-wrap/gap; assert one rule.
    const matches = chatCss.match(/^\.sc-msg-attachments\s*\{/gm) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('stacks attachments vertically with the prototype 8px rhythm and 6px text gap', () => {
    const rule = chatCss.match(/^\.sc-msg-attachments\s*\{([^}]*)\}/m)?.[1] ?? '';
    expect(rule).toContain('display: flex');
    expect(rule).toContain('flex-direction: column');
    expect(rule).toContain('gap: 8px');
    expect(rule).toContain('margin-top: 6px');
  });

  it('drives alignment and rhythm from modifiers, not inline styles', () => {
    expect(contentSource).toContain('sc-msg-attachments--thread');
    expect(contentSource).toContain('sc-msg-attachments--media-only');
    expect(contentSource).not.toContain('style={{');
    const mediaOnly = chatCss.match(/\.sc-msg-attachments--media-only\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(mediaOnly).toContain('margin-top: 0');
    const thread = chatCss.match(/\.sc-msg-attachments--thread\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(thread).toContain('gap: 5px');
  });

  it('reserves a stable image tile so decode never collapses or snaps the row', () => {
    const image = chatCss.match(/\.sc-attachment__image\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(image).toContain('position: relative');
    expect(image).toContain('max-width: min(240px, 100%)');
    expect(image).toContain('border-radius: 6px');
    // The img fills the reserved box absolutely; the 260px cap now lives in
    // useChatImagePreview's contain math (client-chat-core geometry cache).
    const img = chatCss.match(/\.sc-attachment__image img\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(img).toContain('position: absolute');
    expect(img).toContain('inset: 0');
    expect(img).toContain('object-fit: contain');
    expect(img).toContain('opacity: 0');
    expect(chatCss).toContain('.sc-attachment__image img.is-loaded { opacity: 1; }');
    const fallback = chatCss.match(/\.sc-attachment__image-fallback\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(fallback).toContain('position: absolute');
    expect(fallback).toContain('inset: 0');
  });

  it('drives the reserved box from geometry memory and fades in once per decode', () => {
    const hookSource = readFileSync(
      new URL('./useChatImagePreview.ts', import.meta.url),
      'utf8',
    );
    expect(hookSource).toContain('reserveChatImageBox');
    expect(hookSource).toContain('recordChatImageGeometry');
    const itemSource = readFileSync(
      new URL('./AttachmentItem.tsx', import.meta.url),
      'utf8',
    );
    expect(itemSource).toContain("className={imagePreview.loaded ? 'is-loaded' : ''}");
    expect(itemSource).toContain('onLoad={imagePreview.handleLoad}');
  });
});
