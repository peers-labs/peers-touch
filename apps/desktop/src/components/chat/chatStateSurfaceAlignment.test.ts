// Source-contract: transient/state surfaces vs the north-star prototype —
// the peer typing bubble and the recalled-message tombstone tile.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const typingSource = readFileSync(
  new URL('./message/TypingIndicator.tsx', import.meta.url),
  'utf8',
);
const contentSource = readFileSync(
  new URL('./message/ChatMessageContent.tsx', import.meta.url),
  'utf8',
);
const rowSource = readFileSync(
  new URL('./message/ChatMessageRow.tsx', import.meta.url),
  'utf8',
);
const areaSource = readFileSync(
  new URL('./ChatMessageArea.tsx', import.meta.url),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return chatCss.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('typing indicator (north-star .sk-typing-* parity)', () => {
  it('renders a 32px avatar beside the 11/14 tile bubble with 6px tail radius', () => {
    expect(typingSource).toContain('className="sc-typing-row"');
    expect(typingSource).toMatch(/size=\{32\}/);
    const row = rule('.sc-typing-row');
    expect(row).toContain('gap: 9px');
    const bubble = rule('.sc-typing-bubble');
    expect(bubble).toContain('padding: 11px 14px');
    expect(bubble).toContain('border-radius: 16px');
    expect(bubble).toContain('border-bottom-left-radius: 6px');
    expect(bubble).toContain('background: var(--pt-subtle)');
  });

  it('animates three 6px dots with the 1.2s bounce and 0.18/0.36 stagger', () => {
    const dot = rule('.sc-typing-bubble i');
    expect(dot).toContain('width: 6px');
    expect(dot).toContain('height: 6px');
    expect(dot).toContain('animation: sc-typing-dot 1.2s ease-in-out infinite');
    expect(rule('.sc-typing-bubble i:nth-child(2)')).toContain('animation-delay: 0.18s');
    expect(rule('.sc-typing-bubble i:nth-child(3)')).toContain('animation-delay: 0.36s');
    expect(chatCss).toMatch(/translateY\(-3px\)/);
  });
});

describe('recalled message tombstone (north-star .sk-recalled-tombstone parity)', () => {
  it('renders the recalled state as a standalone tile pill element', () => {
    expect(contentSource).toContain('className="sc-recalled-tombstone"');
    expect(contentSource).toContain('data-recalled');
    const tomb = rule('.sc-recalled-tombstone');
    expect(tomb).toContain('font-size: 12px');
    expect(tomb).toContain('font-style: italic');
    expect(tomb).toContain('padding: 5px 11px');
    expect(tomb).toContain('border-radius: 10px');
    expect(tomb).toContain('background: var(--pt-subtle)');
    expect(tomb).toContain('color: var(--pt-muted)');
  });

  it('flattens the outer bubble for recalled rows (transparent, no padding/radius)', () => {
    // The tile lives on its own; the bubble must not paint a second frame.
    expect(rowSource).toContain(
      "padding: serviceOnly || emojiOnlyBare || isRecalled",
    );
    expect(rowSource).toContain(
      "borderRadius: emojiOnlyBare || isRecalled ? 0 : bubbleRadius",
    );
    expect(rowSource).toContain("background: isRecalled ? 'transparent' : bubbleBg");
    expect(rowSource).toContain(
      "border: emojiOnlyBare || isRecalled ? '1px solid transparent' : bubbleBorder",
    );
  });
});

describe('direct-open intent error column', () => {
  it('styles the capped error column via class, not inline layout', () => {
    expect(areaSource).toContain('className="sc-conversation__intent-error"');
    expect(areaSource).toContain('data-chat-conversation-intent-error=');
    expect(areaSource).not.toContain("width: 'min(420px, 100%)'");
    const intentError = rule('.sc-conversation__intent-error');
    expect(intentError).toContain('width: min(420px, 100%)');
    expect(intentError).toContain('flex-direction: column');
    expect(intentError).toContain('gap: 10px');
  });
});
