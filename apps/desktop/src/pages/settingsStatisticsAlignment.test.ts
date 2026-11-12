// Source-contract: the advanced-group statistics surface follows the
// north-star .sk-stat-card / .sk-heatmap / .sk-rank-card grammar — flat
// hairline cards, pine-primary heat levels, monochrome icons — with no
// leftover antd/GitHub palette hexes.
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

describe('statistics palette discipline', () => {
  it('carries no GitHub-green or antd brand hexes anywhere in SettingsPage', () => {
    // Previous heatmap ramp and summary/rank icon colors.
    for (const hex of ['#9be9a8', '#40c463', '#30a14e', '#216e39', '#52c41a', '#fa8c16', '#722ed1', '#1890ff']) {
      expect(settingsPageSource).not.toContain(hex);
    }
  });

  it('paints heat levels as pine primary washes at the prototype 25/55/100 stops', () => {
    expect(settingsPageSource).toContain(
      "return 'color-mix(in srgb, var(--pt-primary) 25%, transparent)'",
    );
    expect(settingsPageSource).toContain(
      "return 'color-mix(in srgb, var(--pt-primary) 55%, transparent)'",
    );
    expect(settingsPageSource).toContain("return 'var(--pt-primary)'");
    expect(settingsPageSource).toContain("return 'var(--pt-subtle)'");
  });
});

describe('summary stat cards (north-star .sk-stat-card parity)', () => {
  it('uses the flat 12px/8-radius centered card with 20px value and 12px label', () => {
    const cardRule = ruleFor('.sc-stat-card');
    expect(cardRule).toContain('background: transparent');
    expect(cardRule).toContain('border: 1px solid var(--pt-border)');
    expect(cardRule).toContain('border-radius: 8px');
    expect(cardRule).toContain('padding: 12px');
    expect(cardRule).toContain('align-items: center');
    expect(ruleFor('.sc-stat-card__value')).toContain('font-size: 20px');
    expect(ruleFor('.sc-stat-card__label')).toContain('font-size: 12px');
  });

  it('lays the four cards on the prototype 10px grid and renders icon/value/label', () => {
    expect(ruleFor('.sc-stat-grid')).toContain('gap: 10px');
    expect(settingsPageSource).toContain('className="sc-stat-card__icon"');
    expect(settingsPageSource).toContain('className="sc-stat-card__value"');
    expect(settingsPageSource).toContain('className="sc-stat-card__label"');
  });
});

describe('rank cards (north-star .sk-rank-card parity)', () => {
  it('uses the flat 14px/8-radius card with a 13px title', () => {
    const cardRule = ruleFor('.sc-rank-card');
    expect(cardRule).toContain('background: transparent');
    expect(cardRule).toContain('border-radius: 8px');
    expect(cardRule).toContain('padding: 14px');
    expect(ruleFor('.sc-rank-card__title')).toContain('font-size: 13px');
    expect(ruleFor('.sc-rank-card__title')).toContain('margin: 0 0 12px');
  });

  it('renders class-driven 12px rows, muted count and the flat primary track', () => {
    expect(settingsPageSource).toContain('className="sc-rank-card__row-line"');
    expect(ruleFor('.sc-rank-card__row-line')).toContain('font-size: 12px');
    expect(ruleFor('.sc-rank-card__count')).toContain('color: var(--pt-muted)');
    const trackRule = ruleFor('.sc-rank-card__track');
    expect(trackRule).toContain('height: 4px');
    expect(trackRule).toContain('background: var(--pt-subtle)');
    expect(ruleFor('.sc-rank-card__bar')).toContain('background: var(--pt-primary)');
  });

  it('keeps the three-up grid on the prototype 14px gap', () => {
    expect(
      northstarCss.match(/\.sc-stat-grid\[data-columns='3'\]\s*\{[^}]*\}/)?.[0] ?? '',
    ).toContain('gap: 14px');
  });
});
