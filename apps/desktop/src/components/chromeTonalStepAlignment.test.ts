// Source-contract: chrome zones (icon rail / level-2 navigation column /
// level-3 content field) separate by a neutral tonal step, never by an opaque
// vertical hairline. This is north-star frame grammar #2 — "Chrome 分区靠材质，
// 不靠发丝线"; a border between chrome columns reads as a backend tile frame.
// Level-2 columns carry the subtle fill, level-3 fields the brightest surface.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../ui/chat.css', import.meta.url), 'utf8');
const northstarCss = readFileSync(new URL('../ui/northstar.css', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function rule(stylesheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('settings scroll lanes share one fixed right boundary', () => {
  it('skins the global scrollbar with a transparent track (no grey gutter box)', () => {
    expect(globalCss).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/);
    expect(globalCss).toMatch(/::-webkit-scrollbar-corner\s*\{[^}]*background:\s*transparent/);
  });

  it('reserves a stable gutter on the settings scroll containers', () => {
    // The single outer settings pane owns the page scrollbar lane; the capped
    // provider picker keeps its own in-well lane. Nested split-pane locking was
    // removed when every tab became one Federation single-scroll column.
    const scrollers = [
      '.sc-settings__sidebar',
      '.sc-settings__scroll',
      '.sc-provider-menu__list',
    ];
    for (const selector of scrollers) {
      expect(rule(northstarCss, selector)).toContain('scrollbar-gutter: stable');
    }
  });

  it('no longer carries the retired split-pane scroll-lock rule', () => {
    expect(northstarCss).not.toContain("data-scroll-lock='true'");
    expect(rule(northstarCss, '.sc-provider-detail')).not.toContain(
      'scrollbar-gutter: stable',
    );
  });
});

describe('level-2 chrome columns use the subtle fill, not a vertical hairline', () => {
  // Match the actual declaration (`border-right:`), not the word in comments.
  const noVerticalHairline = (body: string) =>
    expect(body).not.toMatch(/border-right\s*:/);

  it('paints the chat session column subtle with no border-right', () => {
    const sessions = rule(chatCss, '.sc-sessions');
    expect(sessions).toContain('background: var(--pt-subtle)');
    noVerticalHairline(sessions);
  });

  it('paints the settings sidebar subtle with no border-right', () => {
    const sidebar = rule(northstarCss, '.sc-settings__sidebar');
    expect(sidebar).toContain('background: var(--pt-subtle)');
    noVerticalHairline(sidebar);
  });

  it('paints the provider menu subtle with no border-right', () => {
    const menu = rule(northstarCss, '.sc-provider-layout__menu');
    expect(menu).toContain('background: var(--pt-subtle)');
    noVerticalHairline(menu);
  });

  it('paints the create-group contacts column subtle with no border-right', () => {
    const contacts = rule(chatCss, '.sc-create-group__contacts');
    expect(contacts).toContain('background: var(--pt-subtle)');
    noVerticalHairline(contacts);
  });
});

describe('level-3 content fields are the brightest surface', () => {
  it('keeps the conversation on the white surface material', () => {
    expect(rule(chatCss, '.sc-conversation')).toContain(
      'background: var(--pt-surface)',
    );
  });

  it('keeps the single settings scroll field on surface white', () => {
    // The outer pane is the only level-3 surface; the stacked provider detail
    // is transparent so it reads on that same field instead of painting a
    // second nested white box.
    expect(rule(northstarCss, '.sc-settings__scroll')).toContain(
      'background: var(--pt-surface)',
    );
    expect(rule(northstarCss, '.sc-provider-layout__detail')).toContain(
      'background: transparent',
    );
  });

  it('recesses inset cards to subtle so they still read on the white field', () => {
    expect(rule(northstarCss, '.sc-settings-card')).toContain(
      'background: var(--pt-subtle)',
    );
    expect(rule(northstarCss, '.sc-provider-card')).toContain(
      'background: var(--pt-subtle)',
    );
  });
});
