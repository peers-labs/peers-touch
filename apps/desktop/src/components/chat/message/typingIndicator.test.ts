import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const indicatorSource = readFileSync(new URL('./TypingIndicator.tsx', import.meta.url), 'utf8');
const areaSource = readFileSync(new URL('../ChatMessageArea.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../ui/chat.css', import.meta.url), 'utf8');

describe('typing indicator north-star parity (.sk-typing-row)', () => {
  it('renders an avatar plus a three-dot bubble with a11y label', () => {
    expect(indicatorSource).toContain('SquareAvatar');
    expect(indicatorSource).toContain('sc-typing-row');
    expect(indicatorSource).toContain('sc-typing-bubble');
    expect((indicatorSource.match(/<i \/>/g) ?? []).length).toBe(3);
    expect(indicatorSource).toContain('data-chat-typing-indicator="active"');
  });

  it('mounts inside the message stream only while a peer is typing', () => {
    expect(areaSource).toContain('{peerIsTyping && !isAutomatedConversation && (');
    expect(areaSource).toContain('<TypingIndicator');
  });

  it('is fully token-driven with the staggered bounce keyframes and reduced-motion guard', () => {
    const bubbleRule = css.match(/\.sc-typing-bubble\s*\{[^}]*\}/)?.[0] ?? '';
    expect(bubbleRule).toContain('var(--pt-subtle)');
    expect(css).toMatch(/\.sc-typing-bubble i\s*\{[^}]*animation:\s*sc-typing-dot/);
    expect(css).toMatch(/nth-child\(2\)\s*\{\s*animation-delay:\s*0\.18s/);
    expect(css).toMatch(/nth-child\(3\)\s*\{\s*animation-delay:\s*0\.36s/);
    expect(css).toContain('@keyframes sc-typing-dot');
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*?\.sc-typing-bubble i\s*\{\s*animation:\s*none/);
    // No hardcoded colors for the dots/tile.
    expect(css.match(/sc-typing[\s\S]{0,400}?#[0-9a-fA-F]{3,6}/)).toBeNull();
  });
});
