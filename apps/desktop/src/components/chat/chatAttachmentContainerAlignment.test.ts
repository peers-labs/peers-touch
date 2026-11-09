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

  it('keeps rich image previews responsive (contain, capped), not fixed tiles', () => {
    const image = chatCss.match(/\.sc-attachment__image\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(image).toContain('max-width: min(240px, 100%)');
    expect(image).toContain('border-radius: 6px');
    const img = chatCss.match(/\.sc-attachment__image img\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(img).toContain('max-height: 260px');
    expect(img).toContain('object-fit: contain');
  });
});
