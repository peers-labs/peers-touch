// Source-contract: the Help surface follows the north-star .sk-help-accordion
// grammar — flat hairline-separated groups (no per-group bordered card), a
// 13.5px group title, and flat help rows with a quiet hover wash instead of
// bordered tiles. The expand control stays a peers Button.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const northstarCss = readFileSync(
  new URL('../ui/northstar.css', import.meta.url),
  'utf8',
);
const settingsPageSource = readFileSync(
  new URL('./SettingsPage.tsx', import.meta.url),
  'utf8',
);

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return northstarCss.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('help accordion groups (north-star .sk-help-accordion parity)', () => {
  it('separates groups with hairlines instead of bordered cards', () => {
    const blockRule = ruleFor('.sc-help-accordion__block');
    expect(blockRule).toContain(
      'border-bottom: 1px solid color-mix(in srgb, var(--pt-text) 6%, transparent)',
    );
    expect(blockRule).not.toContain('border-radius: 12px');
    expect(blockRule).not.toContain('background: var(--pt-surface)');
    expect(
      northstarCss.match(
        /\.sc-help-accordion__block:first-child\s*\{[^}]*border-top: 1px solid/,
      )?.[0] ?? '',
    ).toContain('border-top: 1px solid');
    // No inter-group card gap.
    expect(ruleFor('.sc-help-accordion')).not.toContain('gap: 8px');
  });

  it('uses the 10px summary padding and 13.5px group title', () => {
    expect(ruleFor('.sc-help-accordion__header')).toContain('padding: 10px 0');
    expect(ruleFor('.sc-help-accordion__title strong')).toContain('font-size: 13.5px');
  });

  it('drives expand with a peers Button and rotates a leading chevron', () => {
    expect(settingsPageSource).toContain('sc-help-accordion__header');
    expect(settingsPageSource).toMatch(/<Button[\s\S]*?actionId=\{`help-accordion-/);
    expect(settingsPageSource).toContain('aria-expanded={open}');
  });
});

describe('help items (north-star .sk-help-item parity)', () => {
  it('renders flat 9/8 rows with 6px radius and no border/tile background', () => {
    const itemRule = ruleFor('.sc-help-item');
    expect(itemRule).toContain('padding: 9px 8px');
    expect(itemRule).toContain('border-radius: 6px');
    expect(itemRule).toContain('border: 0');
    expect(itemRule).toContain('background: transparent');
  });

  it('reveals only the prototype 4.5% ink wash on hover', () => {
    expect(ruleFor('.sc-help-item:hover')).toContain(
      'background: color-mix(in srgb, var(--pt-text) 4.5%, transparent)',
    );
  });

  it('uses the prototype 13px title / 12px description type scale', () => {
    expect(ruleFor('.sc-help-item__title')).toContain('font-size: 13px');
    expect(ruleFor('.sc-help-item__desc')).toContain('font-size: 12px');
  });

  it('keeps item typography class-driven rather than inline font sizes', () => {
    expect(settingsPageSource).toContain('className="sc-help-item__title"');
    expect(settingsPageSource).toContain('className="sc-help-item__desc"');
    expect(settingsPageSource).not.toMatch(/sc-help-item__title[^"]*"[^>]*style=\{\{[^}]*fontSize/);
  });
});
