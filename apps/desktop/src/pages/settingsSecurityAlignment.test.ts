// Source-contract: the security surfaces follow the north-star settings
// grammar — the recovery phrase is one quiet tile with plain mono word rows
// (.sk-recovery-phrase), and the reset danger zone is the vertical
// .sk-danger-zone card with a single solid danger action.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const northstarCss = readFileSync(
  new URL('../ui/northstar.css', import.meta.url),
  'utf8',
);
const recoverySource = readFileSync(
  new URL('../components/settings/RecoverySettings.tsx', import.meta.url),
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

describe('recovery phrase grid (north-star .sk-recovery-phrase parity)', () => {
  it('renders the 24 words inside one quiet tile, never as individual cards', () => {
    const gridRule = ruleFor('.sc-recovery-phrase__grid');
    expect(gridRule).toContain('grid-template-columns: repeat(4, 1fr)');
    expect(gridRule).toContain('gap: 6px 14px');
    expect(gridRule).toContain('padding: 12px');
    expect(gridRule).toContain('border-radius: 12px');
    expect(gridRule).toContain('background: var(--pt-subtle)');
    // The tile itself carries no hairline; words are borderless rows.
    expect(gridRule).not.toContain('border:');
  });

  it('keeps words as plain baseline mono rows with prototype type scale', () => {
    const wordRule = ruleFor('.sc-recovery-phrase__word');
    expect(wordRule).toContain('align-items: baseline');
    expect(wordRule).not.toContain('background: var(--pt-surface)');
    expect(wordRule).not.toContain('border: 1px solid');

    const indexRule = ruleFor('.sc-recovery-phrase__index');
    expect(indexRule).toContain('font-size: 10px');
    expect(indexRule).toContain('min-width: 16px');
    expect(indexRule).toContain('text-align: right');

    const wordTextRule = ruleFor('.sc-recovery-phrase__word-text .pt-text');
    expect(wordTextRule).toContain('font-size: 12.5px');
    expect(wordTextRule).toContain('color: var(--pt-text)');
  });

  it('composes the phrase display from peers primitives with reveal/copy actions', () => {
    expect(recoverySource).toContain('data-recovery-phrase');
    expect(recoverySource).toMatch(/actionId="recovery-reveal"/);
    expect(recoverySource).toMatch(/actionId="recovery-copy-phrase"/);
  });
});

describe('reset danger zone (north-star .sk-danger-zone parity)', () => {
  it('renders a vertical card with the 30% danger hairline, not a horizontal wash row', () => {
    const zoneRule = ruleFor('.sc-danger');
    expect(zoneRule).toContain('flex-direction: column');
    expect(zoneRule).toContain('align-items: flex-start');
    expect(zoneRule).toContain('padding: 14px 16px');
    expect(zoneRule).toContain('border-radius: 8px');
    expect(zoneRule).toContain(
      'border: 1px solid color-mix(in srgb, var(--pt-danger) 30%, transparent)',
    );
    // The old full-strength border + danger wash backing must be gone.
    expect(zoneRule).not.toContain('border: 1px solid var(--pt-danger)');
    expect(zoneRule).not.toContain('background: color-mix(in srgb, var(--pt-danger) 8%');
  });

  it('uses the prototype title/description header type scale', () => {
    const titleRule = ruleFor('.sc-danger__title');
    expect(titleRule).toContain('font-size: 14.5px');
    expect(titleRule).toContain('font-weight: 650');
    expect(titleRule).toContain('color: var(--pt-danger)');
    const descRule = ruleFor('.sc-danger__desc');
    expect(descRule).toContain('font-size: 12px');
    expect(descRule).toContain('color: var(--pt-muted)');
  });

  it('places one solid 34px danger button under the header', () => {
    const buttonRule = ruleFor('.sc-danger__button.pt-button');
    expect(buttonRule).toContain('height: 34px');
    expect(buttonRule).toContain('padding: 0 14px');
    expect(buttonRule).toContain('border-radius: 10px');
    expect(settingsPageSource).toMatch(
      /<section className="sc-danger"[\s\S]*?actionId="danger-reset-onboarding"[\s\S]*?tone="danger"[\s\S]*?emphasis="primary"/,
    );
  });
});
