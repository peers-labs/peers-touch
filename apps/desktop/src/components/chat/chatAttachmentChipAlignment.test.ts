// Source-contract: attachment open surfaces are single native reset buttons
// matching the prototype .sk-msg-image / .sk-file-chip grammar — one
// clickable tile per attachment with a trailing quiet glyph, never a nested
// pill control. Desktop keeps its richer type/size lines on token styles.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AttachmentItem.tsx', import.meta.url), 'utf8');
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

describe('attachment chips (north-star .sk-file-chip / .sk-msg-image parity)', () => {
  it('renders image, file and video open surfaces as native buttons', () => {
    expect(source).toMatch(/<button[\s\S]*?className=\{?["'`]sc-attachment__image/);
    expect(source).toMatch(/<button[\s\S]*?className=\{`sc-attachment__file/);
    expect(source).toContain('className="sc-attachment__video-details"');
    // The details subcomponent owns no interactive control; the chip button
    // is the single activation target.
    const detailsBody = source.split('function AttachmentDetails')[1]?.split('export function AttachmentItem')[0] ?? '';
    expect(detailsBody).not.toContain('<button');
    expect(source).not.toContain('role={canOpen ? \'button\' : undefined}');
  });

  it('keeps the acceptance open hook on a decorative trailing span', () => {
    expect(source).toMatch(/<span[\s\S]*?data-chat-attachment-open/);
  });

  it('uses the prototype 280/9·11/r12 chip scale and plain 16px icon', () => {
    expect(rule('.sc-attachment__file')).toContain('width: min(280px, 100%)');
    const tile = rule('.sc-attachment__file > .sc-attachment-details');
    expect(tile).toContain('padding: 9px 11px');
    expect(tile).toContain('border-radius: 12px');
    expect(rule('.sc-attachment-details')).toContain('gap: 9px');
    expect(rule('.sc-attachment-details__name')).toContain('font-size: 12.5px');
    expect(rule('.sc-attachment-details__name')).toContain('font-weight: 600');
    expect(rule('.sc-attachment-details__size')).toContain('font-size: 11px');
    expect(source).toContain('<TypeIcon size={16} />');
  });

  it('renders the trailing glyph as a static quiet affordance', () => {
    const open = rule('.sc-attachment-details__open');
    expect(open).toContain('opacity: 0.55');
    expect(open).not.toContain('background:');
    expect(open).not.toContain('border-radius: 999px');
    expect(rule('.sc-attachment-details.is-own .sc-attachment-details__open'))
      .toContain('opacity: 0.7');
  });
});
