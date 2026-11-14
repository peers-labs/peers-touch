// Source-contract: the social chat surface follows the north-star motion
// vocabulary exactly:
//   - list / chip / card rows hover INSTANTLY (prototype .sk-conv-row,
//     .sk-request-card, .sk-file-chip, .sk-forward-row declare no transition);
//   - micro reveals (opacity/transform) use 0.12s ease;
//   - field focus uses 140ms with the .22,1,.36 curve;
//   - icon tiles use 160ms with the same curve (design-directions).
// Desktop-specific surfaces never invent 140/150/200ms ease fades on these
// shared chrome pieces.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

describe('north-star motion vocabulary', () => {
  it('keeps list and chip hover instant like the prototype rows', () => {
    for (const selector of [
      '.sc-session-row',
      '.sc-request-card',
      '.sc-forward__row',
      '.sc-forward__target',
      '.sc-msg-attachment',
      '.sc-attachment__image',
    ]) {
      expect(rule(selector)).not.toContain('transition');
    }
    // Contact rows (including the peers-Button variants) also stay instant.
    expect(rule('.sc-contact-row')).not.toContain('transition');
    expect(rule('.pt-button.sc-contact-row')).toContain('transition: none');
    // File chip details reveal no background/shadow fade either.
    expect(rule('.sc-attachment__file > .sc-attachment-details')).not.toContain('transition');
  });

  it('uses 0.12s ease for hover-revealed micro affordances', () => {
    expect(rule('.sc-thread__actions')).toContain('opacity 0.12s ease');
  });

  it('uses 140ms cubic-bezier(.22,1,.36,1) for search field focus', () => {
    const field = readFileSync(new URL('../../../../../packages/ui/web/src/styles.css', import.meta.url), 'utf8');
    const tokens = readFileSync(new URL('../../../../../packages/ui/tokens/src/index.ts', import.meta.url), 'utf8');
    expect(field).toContain('border-color var(--pt-motion-surface) var(--pt-motion-searchFocus)');
    expect(field).toContain('box-shadow var(--pt-motion-surface) var(--pt-motion-searchFocus)');
    expect(tokens).toContain('surface: 140');
    expect(tokens).toContain("searchFocus: 'cubic-bezier(.22,1,.36,1)'");
    expect(chatCss).not.toMatch(/\.sc-rail-search \.pt-field-frame/);
  });

  it('does not invent 140/150/200ms ease fades on shared list chrome', () => {
    for (const selector of [
      '.sc-session-row',
      '.sc-contact-row',
      '.sc-request-card',
      '.sc-forward__row',
      '.sc-attachment__file',
    ]) {
      expect(rule(selector)).not.toMatch(/0\.1[45]s ease/);
      expect(rule(selector)).not.toContain('0.2s');
    }
  });
});
