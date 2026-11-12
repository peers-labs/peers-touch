// Source-contract: message bubble metrics must track the north-star prototype
// design-directions.css .sk-msg-bubble grammar (padding 10px 14px, 16px radius
// with the 6px tail corner, body text 13.5px / 1.6).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const policySource = readFileSync(
  new URL('./chatPresentationPolicy.ts', import.meta.url),
  'utf8',
);
const rowSource = readFileSync(
  new URL('./message/ChatMessageRow.tsx', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

describe('message bubble geometry alignment (prototype design-directions)', () => {
  it('pads the main-surface bubble with the prototype 10px 14px inset', () => {
    const mainBlock = policySource.match(/DESKTOP_CHAT_LAYOUT_MAIN[\s\S]*?\};/)?.[0] ?? '';
    expect(mainBlock).toContain("bubblePadding: '10px 14px'");
  });

  it('keeps the 16px corner radius with the 6px tail corner on both sides', () => {
    const mainBlock = policySource.match(/DESKTOP_CHAT_LAYOUT_MAIN[\s\S]*?\};/)?.[0] ?? '';
    // Own: bottom-right tail; peer: bottom-left tail.
    expect(mainBlock).toContain("ownBubbleRadius: '16px 16px 6px 16px'");
    expect(mainBlock).toContain("peerBubbleRadius: '16px 16px 16px 6px'");
  });

  it('sets bubble body text to the prototype 13.5px / 1.6 metrics', () => {
    expect(rowSource).toMatch(/fontSize: compact \? 12 : 13\.5/);
    expect(rowSource).toMatch(/lineHeight: compact \? 1\.5 : 1\.6/);
  });

  it('uses the prototype 32px message avatar with a 9px row gap on the main surface', () => {
    const mainBlock = policySource.match(/DESKTOP_CHAT_LAYOUT_MAIN[\s\S]*?\};/)?.[0] ?? '';
    expect(mainBlock).toContain('avatarSize: 32');
    expect(mainBlock).toContain('avatarGap: 9');
  });

  it('gives group message avatars an 8px tile and direct chats the surface radius', () => {
    expect(rowSource).toContain('const avatarRadius = isGroup ? 8 : layout.avatarRadius;');
    const mainBlock = policySource.match(/DESKTOP_CHAT_LAYOUT_MAIN[\s\S]*?\};/)?.[0] ?? '';
    expect(mainBlock).toContain('avatarRadius: 11');
  });

  it('sets the meta timestamp to the prototype 10.5px tabular size', () => {
    const timeRule = chatCss.match(/\.sc-msg-time\s*\{[^}]*\}/)?.[0] ?? '';
    expect(timeRule).toContain('font-size: 10.5px');
    expect(timeRule).toContain('font-variant-numeric: tabular-nums');
  });
});
