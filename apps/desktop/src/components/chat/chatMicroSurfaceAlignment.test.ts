// Source-contract: micro-surface geometry/parity with the north-star prototype
// — forward picker cards, the reaction picker emoji targets, voice-note
// transport controls, and the bot credential curl block.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const northstarCss = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');
const overlaySource = readFileSync(
  new URL('./message/ChatMessageActionOverlay.tsx', import.meta.url),
  'utf8',
);

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('forward picker rows (north-star .sk-forward-row parity)', () => {
  it('renders stacked bordered cards with warm-border hover, not flat wash rows', () => {
    const list = rule(chatCss, '.sc-forward__list');
    expect(list).toContain('gap: 4px');
    expect(list).toContain('max-height: 300px');
    const row = rule(chatCss, '.sc-forward__row');
    expect(row).toContain('gap: 9px');
    expect(row).toContain('padding: 9px 12px');
    expect(row).toContain('border: 1px solid var(--pt-border)');
    expect(row).toContain('border-radius: 10px');
    expect(row).toContain('background: var(--pt-surface)');
    expect(rule(chatCss, '.sc-forward__row:hover')).toContain(
      'border-color: color-mix(in srgb, var(--pt-primary) 40%, transparent)',
    );
    expect(rule(chatCss, '.sc-forward__body strong')).toContain('font-weight: 600');
  });
});

describe('reaction picker emoji (north-star .sk-react-emoji parity)', () => {
  it('uses 34px circular targets with the lift hover motion', () => {
    const emoji = rule(chatCss, '.sc-actionbar .sc-actionbar__emoji');
    expect(emoji).toContain('width: 34px');
    expect(emoji).toContain('height: 34px');
    expect(emoji).toContain('border-radius: 50%');
    expect(emoji).toContain('font-size: 18px');
    expect(rule(chatCss, '.sc-actionbar .sc-actionbar__emoji:hover')).toContain(
      'transform: translateY(-1px) scale(1.12)',
    );
  });

  it('lays the picker grid on matching 34px tracks so cells never overflow', () => {
    expect(overlaySource).toContain('repeat(${REACTION_PICKER_COLUMNS}, 34px)');
    expect(overlaySource).not.toContain('28px');
  });
});

describe('hover action toolbar chrome (north-star .sk-msg-actions-bar parity)', () => {
  it('paints a borderless 999px pill with 2px padding and the prototype float shadow', () => {
    const bar = rule(chatCss, '.sc-actionbar');
    expect(bar).toContain('border-radius: 999px');
    expect(bar).toContain('padding: 2px');
    expect(bar).toContain('gap: 1px');
    expect(bar).toContain('border: 0');
    expect(bar).toContain('background: var(--pt-raised)');
    expect(bar).toContain('box-shadow: 0 4px 14px -6px rgba(28, 46, 32, 0.35)');
  });

  it('uses 26px circular muted glyphs with pine hover, red only on danger hover', () => {
    const btn = rule(chatCss, '.sc-actionbar .sc-actionbar__btn');
    expect(btn).toContain('width: 26px');
    expect(btn).toContain('height: 26px');
    expect(btn).toContain('border-radius: 50%');
    expect(btn).toContain('color: var(--pt-muted)');
    const hover = rule(chatCss, '.sc-actionbar .sc-actionbar__btn:hover');
    expect(hover).toContain('color: var(--pt-primary)');
    const danger = rule(chatCss, '.sc-actionbar .sc-actionbar__btn--danger');
    expect(danger).toContain('color: var(--pt-muted)');
    const dangerHover = rule(
      chatCss,
      '.sc-actionbar .sc-actionbar__btn--danger:hover',
    );
    expect(dangerHover).toContain('#b0413a');
  });

  it('keeps the toolbar gap/padding in the overlay inline frame values', () => {
    expect(overlaySource).toContain('gap: pickerOpen ? 2 : 1');
    expect(overlaySource).toContain('padding: pickerOpen ? 5 : 2');
    expect(overlaySource).toContain('width: 26');
    expect(overlaySource).toContain('height: 26');
  });
});

describe('voice note transport (north-star .sk-voice-* parity)', () => {
  it('uses the 30px circular toggle with 45% disabled state', () => {
    const toggle = rule(chatCss, '.sc-voice__toggle');
    expect(toggle).toContain('width: 30px');
    expect(toggle).toContain('height: 30px');
    expect(toggle).toContain('border-radius: 50%');
    expect(rule(chatCss, '.sc-voice__toggle:disabled')).toContain('opacity: 0.45');
  });

  it('sizes the seek track at 80px/3px and keeps tabular elapsed time', () => {
    const seek = rule(chatCss, '.sc-voice__seek');
    expect(seek).toContain('min-width: 80px');
    expect(seek).toContain('height: 3px');
    expect(rule(chatCss, '.sc-voice__time')).toContain(
      'font-variant-numeric: tabular-nums',
    );
  });
});

describe('bot credential curl (north-star .sk-bot-curl parity)', () => {
  it('renders the hairline-bordered 11.5/1.6 quiet code block', () => {
    const curl = rule(northstarCss, '.sc-bots-curl');
    expect(curl).toContain('padding: 10px 12px');
    expect(curl).toContain('border-radius: 8px');
    expect(curl).toContain('font-size: 11.5px');
    expect(curl).toContain('line-height: 1.6');
    expect(curl).toContain(
      'border: 1px solid color-mix(in srgb, var(--pt-text) 6%, transparent)',
    );
    expect(curl).toContain('background: var(--pt-subtle)');
  });
});
