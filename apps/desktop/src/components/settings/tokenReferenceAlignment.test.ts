import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Guards against referencing a --pt-* custom property that the token package
// never emits (silent generic fallback). The token emitter writes color keys
// as --pt-<camelKey> and nested groups as --pt-<group>-<key>; --pt-mono is the
// canonical monospace variable (there is no --pt-font-mono).
const northstarCss = readFileSync(
  new URL('../../ui/northstar.css', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(
  new URL('../../ui/chat.css', import.meta.url),
  'utf8',
);
const tokenIndex = readFileSync(
  new URL('../../../../../packages/ui/tokens/src/index.ts', import.meta.url),
  'utf8',
);
const globalCss = readFileSync(
  new URL('../../index.css', import.meta.url),
  'utf8',
);

// Exact-selector rule lookup: a bare-class regex also matches compound
// descendant rules (e.g. `.sk-banner[data-has-image='false']
// .sc-account-banner__action`) that appear earlier in the cascade. Split the
// selector list and accept only blocks declaring the bare selector itself.
function rule(css: string, selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockRe = /(?:^|\})([^{}]*)\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(stripped))) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return '';
}

describe('pt custom-property references resolve to emitted tokens', () => {
  it('never references the undefined --pt-font-mono name', () => {
    expect(northstarCss).not.toContain('--pt-font-mono');
    expect(chatCss).not.toContain('--pt-font-mono');
  });

  it('uses the canonical --pt-mono monospace variable', () => {
    expect(northstarCss).toContain('var(--pt-mono');
    // The emitter defines --pt-mono explicitly.
    expect(tokenIndex).toContain("out['--pt-mono']");
  });

  it('emits the bubble tokens the chat surface depends on', () => {
    expect(tokenIndex).toContain('ownBubble');
    expect(tokenIndex).toContain('peerBubble');
    // The message bubble paints from the presentation policy (inline on
    // .msg-bubble); voice rows must not re-paint their own bubble chrome.
    const messageRow = readFileSync(
      new URL('../chat/message/ChatMessageRow.tsx', import.meta.url),
      'utf8',
    );
    expect(messageRow).toContain('var(--pt-ownBubble)');
    expect(messageRow).toContain('var(--pt-peerBubble)');
  });

  it('renders statistics rank bars with the flat primary token, not an off-palette gradient', () => {
    // Prototype .sk-rank-track i fills with var(--sk-primary); the desktop
    // counterpart must stay on the north-star pine/ink token family.
    const rankBarRule = northstarCss.match(/\.sc-rank-card__bar\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rankBarRule).toContain('var(--pt-primary)');
    expect(rankBarRule).not.toMatch(/linear-gradient|#667eea|#764ba2/);
  });

  it('renders the diagnostics log table on the north-star light surface, not a dark console', () => {
    // Prototype .sk-log-table grammar: surface card, hairline border, muted
    // meta columns. The former hardcoded dark palette must never return.
    const logsBlock = northstarCss.slice(
      northstarCss.indexOf('.sc-logs-title-icon'),
      northstarCss.indexOf('/* MCP settings panel. */'),
    );
    expect(logsBlock).toMatch(/\.sc-logs-console\s*\{[^}]*var\(--pt-surface\)/);
    expect(logsBlock).toMatch(/\.sc-logs-console\s*\{[^}]*var\(--pt-border\)/);
    expect(logsBlock).toMatch(/border-top: 1px solid color-mix\(in srgb, var\(--pt-text\) 6%, transparent\)/);
    expect(logsBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(logsBlock).not.toContain('SFMono-Regular');
  });

  it('puts on-primary ink on colored pills instead of a hardcoded white', () => {
    // The library's own danger-primary buttons use --pt-onPrimary as the
    // on-color text; the skinned unread badge must match that convention.
    const unreadBadgeRule = northstarCss.match(
      /\.ds-rail-entry \.pt-badge:has\(> \.pt-icon-button\) > \.pt-badge-count\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(unreadBadgeRule).toContain('background: var(--pt-danger)');
    expect(unreadBadgeRule).toContain('color: var(--pt-onPrimary)');
    expect(unreadBadgeRule).not.toMatch(/color:\s*#fff/);

    // Avatar/banner edits are corner icon tiles (prototype
    // .sk-identity-avatar-action / .sk-banner-action). They reuse the library
    // FilePicker iconOnly convention: a translucent dark tile with a fixed
    // white glyph, legible over arbitrary photos in every theme.
    const avatarActionRule = rule(northstarCss, '.sc-account-avatar__action');
    expect(avatarActionRule).toContain('background: color-mix(in srgb, #000 34%, transparent)');
    expect(avatarActionRule).toContain('color: #fff');
    expect(avatarActionRule).toContain('right: 6px');
    expect(avatarActionRule).toContain('bottom: 6px');
    const bannerActionRule = rule(northstarCss, '.sc-account-banner__action');
    expect(bannerActionRule).toContain('background: color-mix(in srgb, #000 34%, transparent)');
    expect(bannerActionRule).toContain('color: #fff');
    expect(bannerActionRule).toContain('right: 12px');
    expect(bannerActionRule).toContain('bottom: 12px');
    const whiteDeclarations = northstarCss.match(/color:\s*#fff\b/g) ?? [];
    expect(whiteDeclarations).toHaveLength(2);
  });

  it('drives the settings search highlight with the primary token, not the retired purple', () => {
    expect(globalCss).not.toContain('#667eea');
    expect(globalCss).not.toContain('102, 126, 234');
    const highlightRule = globalCss.match(/\.search-highlight-flash\s*\{[^}]*\}/)?.[0] ?? '';
    expect(highlightRule).toContain('border-color: var(--pt-primary)');
    expect(globalCss).toContain('@keyframes search-highlight');
  });

  it('renders settings cards as flat hairline surfaces, matching the prototype shadowless card', () => {
    const cardRule = northstarCss.match(/\.sc-settings-card\s*\{[^}]*\}/)?.[0] ?? '';
    expect(cardRule).toContain('border-radius: 12px');
    expect(cardRule).toContain('padding: 0 8px');
    expect(cardRule).not.toContain('box-shadow');
  });

  it('gives every settings pane a shared right edge gutter and a stable lane', () => {
    // The scroll layer owns the inset; the column stays padding-free so the
    // two never stack. Left/top/bottom stay at 8px while the right edge gets an
    // explicit content gutter (the transparent scrollbar lane alone let cards
    // crowd the window frame). Both scroll containers consume the same token so
    // their content/scrollbar right edges line up across every settings tab.
    // The gutter token lives on the second .sc-settings cascade block (the
    // alias-token block), so match the block that actually declares it rather
    // than the first .sc-settings layout rule.
    const tokenBlock = northstarCss.match(
      /\.sc-settings\s*\{[^}]*--pt-settings-edge-gutter:\s*16px[^}]*\}/,
    );
    expect(tokenBlock).not.toBeNull();
    const scroll = rule(northstarCss, '.sc-settings__scroll');
    expect(scroll).toContain(
      'padding: 8px var(--pt-settings-edge-gutter) 8px 8px',
    );
    expect(scroll).toContain('scrollbar-gutter: stable');
    // The provider detail now flows inside the same single column, so it adds
    // no horizontal inset of its own — the outer pane owns the edge gutter.
    expect(
      rule(northstarCss, '.sc-provider-detail'),
    ).toContain('padding: 8px 0 24px');
    // The retired split-pane lock must leave no trace.
    expect(northstarCss).not.toContain("data-scroll-lock='true'");
    expect(rule(northstarCss, '.sc-settings-column')).toContain('padding: 0');
    expect(rule(northstarCss, '.sc-settings-card')).toContain('padding: 0 8px');
  });

  it('fills the content width instead of capping and centering the column', () => {
    // A max-width cap plus margin-inline:auto left large dead bands on both
    // sides of every settings card. The column now fills the region; the edge
    // breathing room is owned solely by the scroll layer's right gutter token.
    const columnRule = rule(northstarCss, '.sc-settings-column');
    expect(columnRule).toContain('width: 100%');
    expect(columnRule).not.toContain('max-width');
    expect(columnRule).not.toContain('margin-inline');
  });

  it('gives the settings surface a definite height so its internal scroll chain works', () => {
    // The page host is a position:relative block, not a flex box, so flex:1
    // alone let the surface grow past the viewport and get clipped with no
    // scrollable overflow. height:100% pins it to the host's definite height.
    expect(rule(northstarCss, '.sc-settings')).toContain('height: 100%');
    expect(rule(northstarCss, '.sc-settings__scroll')).toContain('overflow: auto');
  });

  it('sizes L2 sidebar items to the prototype 7px 10px inset instead of the 28px compact default', () => {
    const sidebarRule = northstarCss.match(/\.sc-settings__side\.pt-button\s*\{[^}]*\}/)?.[0] ?? '';
    expect(sidebarRule).toContain('padding: 7px 10px');
    expect(sidebarRule).toContain('min-height: 0');
    expect(sidebarRule).toContain('font-size: 13px');
    expect(sidebarRule).toContain('border-radius: 6px');
  });

  it('declares every consumed --sk-* alias on the .sc-settings cascade root', () => {
    // Ported prototype rules consume var(--sk-*); the aliases exist solely on
    // .sc-settings (SettingsPage root). A consumed-but-undeclared alias would
    // silently fall back to guaranteed-invalid and strip the declaration.
    const aliasBlocks = [...northstarCss.matchAll(/\.sc-settings\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .join('\n');
    expect(aliasBlocks).toContain('--sk-text:');
    const declared = new Set(
      [...aliasBlocks.matchAll(/(--sk-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const consumed = new Set<string>();
    for (const css of [northstarCss, chatCss]) {
      for (const match of css.matchAll(/var\((--sk-[a-z0-9-]+)/g)) {
        consumed.add(match[1]);
      }
    }
    expect(consumed.size).toBeGreaterThan(0);
    for (const name of consumed) {
      expect(declared.has(name)).toBe(true);
    }
  });

  it('mounts every sk-* consumer inside the settings subtree so aliases inherit', () => {
    // The --sk-* cascade root is .sc-settings; components rendering sk-*
    // classes must be settings sections mounted by SettingsPage.
    const srcRoot = new URL('../../', import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
          const source = readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
          if (/\bsk-[a-z][\w-]*/.test(source)) {
            const rel = relative(srcRoot, full);
            if (!rel.startsWith('components/settings/')) offenders.push(rel);
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
