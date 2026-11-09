// Source-contract: in-bubble voice notes follow the prototype .sk-voice
// grammar — a paintless flex row INSIDE the message bubble (the bubble owns
// background/radius/padding): 30px circular toggle, 3px seek, 11px/78%
// time, 224px min width. No decorative volume glyph exists in the prototype.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AttachmentItem.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const prototypeCss = readFileSync(
  new URL(
    '../../../../../packages/prototypes/shared/ui-system/chat/chat.css',
    import.meta.url,
  ),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('voice note player (north-star .sk-voice parity)', () => {
  it('paints no bubble chrome of its own — background/radius/padding belong to the parent', () => {
    const voice = rule('.sc-voice');
    expect(voice).not.toContain('background:');
    expect(voice).not.toContain('border-radius:');
    expect(voice).not.toContain('padding:');
    expect(voice).toContain('display: flex');
    expect(voice).toContain('gap: 8px');
    expect(voice).toContain('min-width: 224px');
    expect(css).not.toMatch(/\.sc-voice\.is-own\s*\{[^}]*background/);
  });

  it('hides the driving audio element like the prototype', () => {
    expect(rule('.sc-attachment--voice audio')).toContain('display: none');
    expect(prototypeCss).toMatch(/\.sk-voice audio\s*\{[^}]*display: none/);
  });

  it('uses the 30px circular toggle with 15px glyphs and 3px currentColor seek', () => {
    expect(source).toMatch(/<Play size=\{15\}\s*\/>/);
    expect(source).toMatch(/<Pause size=\{15\}\s*\/>/);
    expect(source).not.toMatch(/<(Play|Pause) size=\{16\}/);
    const toggle = rule('.sc-voice__toggle');
    expect(toggle).toContain('width: 30px');
    expect(toggle).toContain('height: 30px');
    expect(toggle).toContain('border-radius: 50%');
    expect(rule('.sc-voice__seek')).toContain('height: 3px');
  });

  it('renders the time at 11px with 78% inherited color, not a token override', () => {
    const time = rule('.sc-voice__time');
    expect(time).toContain('font-size: 11px');
    expect(time).toContain('opacity: 0.78');
    expect(time).not.toContain('var(--pt-secondary)');
    expect(css).not.toContain('.sc-voice.is-own .sc-voice__time');
  });

  it('has no decorative volume glyph (prototype player is toggle + seek + time only)', () => {
    expect(source).not.toContain('Volume2');
    expect(source).not.toContain('sc-voice__volume');
    expect(source).not.toContain('sc-voice__controls');
  });

  it('keeps the native acceptance and evidence hooks on the player', () => {
    expect(source).toContain('data-chat-voice-note="true"');
    expect(source).toContain('data-chat-voice-toggle');
    expect(source).toContain('data-chat-voice-seek');
    expect(source).toContain('data-chat-voice-retry');
  });
});
