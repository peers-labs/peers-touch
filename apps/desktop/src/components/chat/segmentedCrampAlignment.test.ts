// Source-contract: the shared Segmented island collapses text labels to
// leading icons under spatial squeeze, so a manually narrowed rail never
// clips tab labels. The behavior lives in the @peers-touch/ui base component
// and self-gates on icon-bearing options — text-only groups stay untouched.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const selectionSource = readFileSync(
  new URL('../../../../../packages/ui/web/src/selection.tsx', import.meta.url),
  'utf8',
);
const uiStyles = readFileSync(
  new URL('../../../../../packages/ui/web/src/styles.css', import.meta.url),
  'utf8',
);
const railSource = readFileSync(
  new URL('./ChatSessionList.tsx', import.meta.url),
  'utf8',
);
const northstarStyles = readFileSync(
  new URL('../../ui/northstar.css', import.meta.url),
  'utf8',
);

describe('Segmented icon-only cramp behavior (shared base component)', () => {
  it('exposes autoIconOnly enabled by default and gated on leading icons', () => {
    expect(selectionSource).toMatch(/autoIconOnly\s*=\s*true/);
    // Only groups where every option has a leading icon may collapse.
    expect(selectionSource).toContain('allHaveLeading');
    expect(selectionSource).toContain('const collapseEligible = autoIconOnly && !scrollable && allHaveLeading;');
  });

  it('decides cramp from an off-screen intrinsic-width probe, not live scrollWidth', () => {
    // Regression: flex:1 + min-width:0 keeps host.scrollWidth == clientWidth,
    // so an independent probe that always renders full labels is required;
    // otherwise the group can enter icon-only and never expand back.
    expect(selectionSource).toContain('measureRef');
    expect(selectionSource).toContain('pt-segmented__measure');
    expect(selectionSource).toContain('measureRequiredWidth');
    expect(selectionSource).toMatch(/probe\.scrollWidth/);
    // No stale state caches that can strand the group in icon-only mode.
    expect(selectionSource).not.toContain('naturalWidthRef');
    expect(selectionSource).not.toContain('iconOnlyRef');
  });

  it('computes a state-independent flex budget from parent width minus siblings', () => {
    // Regression: measuring the host's own width self-traps the group — a
    // collapsed host is narrow and a flex:0 0 auto host never shrinks, so both
    // read as "no room". The budget must come from parent content width minus
    // sibling footprints and flex gaps, independent of the host's state.
    expect(selectionSource).toMatch(/host\?\.parentElement/);
    expect(selectionSource).toContain('measureAvailableWidth');
    expect(selectionSource).toContain('siblingFootprint');
    expect(selectionSource).toContain('gapTotal');
    expect(selectionSource).toMatch(/observer\.observe\(parent\)/);
    // The host is deliberately NOT observed: its width changes as a RESULT of
    // collapsing, so observing it adds a self-referential measurement cycle.
    expect(selectionSource).not.toMatch(/observer\.observe\(host\)/);
  });

  it('ships no diagnostic logging in the cramp path', () => {
    // Iron law: no console.* debug statements in committed primitives.
    expect(selectionSource).not.toMatch(/console\.(log|warn|debug|info)/);
  });

  it('wraps labels in a hideable span and marks the collapsed state', () => {
    expect(selectionSource).toContain('pt-segmented__label');
    expect(selectionSource).toContain("data-icon-only={collapsed || undefined}");
    // Icon-only buttons keep an accessible name and a hover tooltip.
    expect(selectionSource).toMatch(/aria-label=\{collapsed \? textLabel/);
    expect(selectionSource).toMatch(/title=\{collapsed \? textLabel/);
  });

  it('keeps the probe off-screen and non-shrinking, and hides only labels via CSS', () => {
    // width:max-content is load-bearing: an absolute probe without it is
    // capped by the width-constrained host and under-reports intrinsic width
    // (measured r=332 vs real ~467), so cramp never fires in narrow windows.
    expect(uiStyles).toContain('.pt-segmented__measure{');
    expect(uiStyles).toMatch(/\.pt-segmented__measure\{[^}]*width:max-content/);
    expect(uiStyles).toMatch(/\.pt-segmented__measure\{[^}]*visibility:hidden/);
    // The probe item must mirror the real .pt-button box model (horizontal
    // padding, icon/label gap, 1px border); a bare span under-counts the
    // intrinsic width by ~140px and cramp never fires in narrow windows.
    expect(uiStyles).toMatch(/\.pt-segmented__measure-item\{[^}]*padding:0 var\(--pt-space-sm\)/);
    expect(uiStyles).toMatch(/\.pt-segmented__measure-item\{[^}]*gap:var\(--pt-space-xs\)/);
    expect(uiStyles).toMatch(/\.pt-segmented__measure-item\{[^}]*border:1px solid transparent/);
    expect(uiStyles).toContain(
      ".pt-segmented[data-icon-only='true'] .pt-segmented__label{display:none}",
    );
    expect(uiStyles).toContain(
      ".pt-segmented[data-icon-only='true']>.pt-button{justify-content:center;gap:0}",
    );
  });

  it('keeps cramp-able groups on a single line instead of wrapping', () => {
    // Regression: at 440pt the buttons wrapped onto two rows instead of
    // collapsing. Only icon-bearing (cramp-able) groups are forced nowrap;
    // text-only groups keep the base flex-wrap:wrap fallback.
    expect(selectionSource).toContain('data-crampable={collapseEligible || undefined}');
    expect(uiStyles).toContain(".pt-segmented[data-crampable='true']{flex-wrap:nowrap}");
    // No diagnostic scaffolding left in the committed primitive.
    expect(selectionSource).not.toContain('crampDebug');
    expect(uiStyles).not.toContain('cramp-debug');
  });

  it('keeps the chat rail tabs eligible by supplying leading icons', () => {
    expect(railSource).toContain('leading: <Icon iconId="message-circle"');
    expect(railSource).toContain('leading: <Icon iconId="users"');
  });

  it('keeps the settings width constraint chain intact so narrowing reaches the island', () => {
    // Regression: without min-width:0 the nowrap island stretched the whole
    // settings column to its content width; the subbar never saw a narrowed
    // window and tabs were clipped instead of collapsing to icons.
    const settingsBlock = northstarStyles.slice(
      northstarStyles.indexOf('.sc-settings {'),
      northstarStyles.indexOf('.sc-settings__body'),
    );
    expect(settingsBlock).toMatch(/\.sc-settings\s*\{[^}]*\bmin-width\s*:\s*0/);
    expect(settingsBlock).toMatch(/\.sc-settings__subbar\s*\{[^}]*\bmin-width\s*:\s*0/);
    // flex:0 0 auto refused to yield; the island must be allowed to shrink.
    expect(settingsBlock).not.toMatch(/\.sc-settings__groups\s*\{[^}]*flex\s*:\s*0\s+0\s+auto/);
    expect(settingsBlock).toMatch(/\.sc-settings__groups\s*\{[^}]*\bmin-width\s*:\s*0/);
  });
});
