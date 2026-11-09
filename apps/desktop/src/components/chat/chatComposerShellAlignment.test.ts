// Source-contract: the main composer pill follows prototype .sk-composer:
// one bottom-aligned row, 8px symmetric padding, 10px gaps, the embedded
// textarea at 13.5px / 1.55 with the primitive's 4px 12px padding, instant
// auto-grow, a 36px squircle send, and circle tool glyphs. The emoji popover
// is the prototype 312px / 10-column grid.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const composerSource = readFileSync(
  new URL('./ChatComposer.tsx', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const stripped = chatCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockRe = /(?:^|\})([^{}]*)\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(stripped))) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return '';
}

describe('composer pill (north-star .sk-composer parity)', () => {
  it('bottom-aligns tools/input/send with 8px padding and 10px gaps', () => {
    const row = rule('.sc-composer__row');
    expect(row).toContain('align-items: flex-end');
    expect(row).toContain('gap: 10px');
    expect(row).toContain('padding: 8px');
  });

  it('uses the prototype 13.5px / 1.55 textarea with primitive 4px 12px padding', () => {
    const input = rule('.sc-composer__input');
    expect(input).toContain('padding: 4px 12px');
    expect(input).toContain('font-size: 13.5px');
    expect(input).toContain('line-height: 1.55');
  });

  it('does not animate auto-grow heights (prototype grows instantly)', () => {
    expect(composerSource).not.toContain('0.18s ease');
  });

  it('renders tool glyphs as 34px circles and send as a 36px squircle', () => {
    expect(rule('.sc-composer__tool.pt-button')).toContain('border-radius: 999px');
    const send = rule('.sc-composer__send.pt-icon-button');
    expect(send).toContain('width: 36px');
    expect(send).toContain('height: 36px');
    expect(send).toContain('border-radius: var(--pt-radius-md)');
  });
});

describe('composer emoji panel (north-star .sk-emoji-panel parity)', () => {
  it('is a 312px / 10px-inset popover with a 10-column cell grid', () => {
    const panel = rule('.sc-emoji-panel');
    expect(panel).toContain('width: 312px');
    expect(panel).toContain('padding: 10px');
    expect(panel).toContain('gap: 10px');
    const grid = rule('.sc-emoji-panel__grid');
    expect(grid).toContain('grid-template-columns: repeat(10, 1fr)');
    expect(grid).toContain('gap: 2px');
  });

  it('renders cells as 19px text on 7px-radius hover tiles', () => {
    const item = rule('.sc-emoji-panel__item');
    expect(item).toContain('font-size: 19px');
    expect(item).toContain('border-radius: 7px');
    expect(item).toContain('padding: 5px 0');
  });
});
