import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogBounds, catalogRestAfterFrame, drawerEase, drawerPolicy, resolveDrawerAssembly, northStarVariables } from '@peers-touch/ui';
import { tokenVariables } from '../../../../../packages/ui/tokens/src/index';

const page = readFileSync(new URL('../../pages/SocialChatPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const resizer = readFileSync(new URL('../../../../../packages/ui/web/src/drawer-resizer.tsx', import.meta.url), 'utf8');
const prototypeCss = readFileSync(new URL('../../../../../packages/prototypes/shared/ui-system/chat/chat.css', import.meta.url), 'utf8');

describe('continuous drawer frame allocation', () => {
  it('conserves the stage, bounds catalogue exposure and restores preference without a breakpoint jump', () => {
    for (const preference of [64, 240, 300, 360]) {
      let previousExposure = 0;
      for (let width = 0; width <= 1600; width++) {
        const pose = resolveDrawerAssembly(width, preference, 1, 0);
        expect(pose.exposure + pose.workWidth).toBe(width);
        expect(pose.exposure).toBeLessThanOrEqual(preference);
        expect(pose.exposure - previousExposure).toBeGreaterThanOrEqual(0);
        expect(pose.exposure - previousExposure).toBeLessThanOrEqual(1);
        previousExposure = pose.exposure;
      }
      expect(previousExposure).toBe(preference);
    }
  });

  it('keeps the closed catalogue finite instead of stretching it into the frame', () => {
    for (const width of [390, 480, 719, 720, 721, 800, 1300]) {
      const pose = resolveDrawerAssembly(width, 300, 0, 0);
      expect(pose.paper).toBe(300);
      expect(pose.visibleCatalog).toBe(300);
      expect(pose.mainX).toBeGreaterThanOrEqual(pose.paper);
      const open = resolveDrawerAssembly(width, 300, 1, 0);
      expect(open.mainX + open.workWidth).toBe(width);
    }
  });

  it('shares pressure while keeping complete catalogue controls at the reported widths', () => {
    for (const stage of [493, 615]) {
      const pose = resolveDrawerAssembly(stage, 300, 1, 0);
      expect(pose.visibleCatalog).toBeGreaterThanOrEqual(drawerPolicy.catalog.rows);
      expect(pose.catalogRowsCompact).toBe(false);
      expect(pose.catalogResizeMax).toBeGreaterThanOrEqual(pose.visibleCatalog);
      expect(pose.workWidth).toBeGreaterThanOrEqual(drawerPolicy.work.minimum);
    }
    for (let stage = 64; stage <= 1600; stage++) {
      expect(resolveDrawerAssembly(stage, 360, 1, 0).visibleCatalog).toBeGreaterThanOrEqual(64);
    }
  });

  it('maps a pressed visible edge back to intent without a dead zone or first-pixel jump', () => {
    for (const stage of [328, 493, 615, 900]) {
      for (const navigation of [0, 1]) {
        const pose = resolveDrawerAssembly(stage, 300, navigation, 0);
        for (const delta of [-32, -1, 0, 1, 32]) {
          const boundary = Math.max(pose.catalogResizeMin, Math.min(pose.catalogResizeMax, pose.visibleCatalog + delta));
          expect(resolveDrawerAssembly(stage, boundary, navigation, 0).visibleCatalog).toBeCloseTo(boundary);
        }
      }
    }
  });

  it('uses all reachable catalogue space and restores collapse only after expanded paper fits', () => {
    expect(resolveDrawerAssembly(299, 300, 1, 0).visibleCatalog).toBe(99);
    expect(resolveDrawerAssembly(493, 300, 1, 0).visibleCatalog).toBe(293);
    expect(catalogRestAfterFrame('compact', 299, 300, 300, 1)).toBe('compact');
    expect(catalogRestAfterFrame('compact', 299, 905, 300, 1)).toBe('expanded');
    expect(catalogRestAfterFrame('compact', 905, 900, 300, 1)).toBe('compact');
    expect(catalogBounds(299, 1)).toEqual({ min: 64, max: 99 });
  });

  it('releases identity and tool groups by independent complete-element budgets', () => {
    const row = resolveDrawerAssembly(299, 150, 0, 0);
    expect(row.catalogRowsCompact).toBe(false);
    expect(row.catalogToolsCompact).toBe(true);
    const tools = resolveDrawerAssembly(299, 170, 0, 0);
    expect(tools.catalogRowsCompact).toBe(false);
    expect(tools.catalogToolsCompact).toBe(false);
    expect(resolveDrawerAssembly(299, 100, 0, 0).catalogRowsCompact).toBe(true);
  });

  it('opens an inner task inside its parent without reflowing messages', () => {
    for (const width of [390, 640, 900, 1100, 1600]) {
      const closed = resolveDrawerAssembly(width, 300, 1, 0);
      const opened = resolveDrawerAssembly(width, 300, 1, 1);
      expect(opened.workWidth).toBe(closed.workWidth);
      expect(opened.exposure).toBe(closed.exposure);
      expect(opened.leafWidth).toBeLessThanOrEqual(opened.workWidth);
      expect(opened.leafX).toBe(0);
    }
  });

  it('keeps every unconstrained guide journey monotonic and within the stops', () => {
    let previous = 0;
    for (let frame = 0; frame <= 1000; frame++) {
      const eased = drawerEase(frame / 1000);
      expect(eased).toBeGreaterThanOrEqual(previous);
      expect(eased).toBeLessThanOrEqual(1);
      previous = eased;
    }
    expect(previous).toBeCloseTo(1);
  });

  it('allocates less writing height on a short stage while preserving reading space', () => {
    const short = resolveDrawerAssembly(390, 300, 1, 0, 320);
    const tall = resolveDrawerAssembly(390, 300, 1, 0, 720);
    expect(short.composerBudget).toBeLessThan(tall.composerBudget);
    expect(short.composerBudget).toBeLessThan(short.height - 52);
  });
});

describe('native host admission', () => {
  it('uses the same shared controller and preserves selection on presentation Back', () => {
    expect(page).toContain('useDrawerAssembly');
    expect(page).not.toContain('useMediaQuery');
    const back = page.slice(page.indexOf('const backToCatalog'), page.indexOf('const resetRailWidth'));
    expect(back).toContain('assembly.back()');
    expect(back).not.toContain('selectSession');
    expect(back).not.toContain('cancelDirectOpenIntent');
    expect(page).toContain('data-drawer-catalog');
    expect(page).toContain('data-drawer-work');
    expect(page).toContain('inert={!assembly.open || assembly.navigation < 1}');
  });

  it('clips guide travel without ancestor scrolling or the retired 720/960 pane switches', () => {
    expect(css).toMatch(/\.sc-chat\s*\{[^}]*overflow: clip/);
    expect(css).toContain('transform: translateX(var(--sc-work-x))');
    expect(css).not.toContain("data-narrow='true'");
    expect(css).not.toContain('@media (max-width: 960px)');
    expect(css).toContain("data-available='false'");
  });

  it('keeps the resize indicator to one line and owns pointer/keyboard focus modality', () => {
    // A box-shaped ring on the full-height 10px hit strip reads as two
    // parallel full-height lines; neither host may paint one.
    const resizerBlock = css.slice(css.indexOf('.sc-chat-rail-resizer {'), css.indexOf('.sc-sessions__toolbar'));
    expect(resizerBlock).toContain("data-keyboard-focus='true'] .sc-chat-rail-resizer__line");
    expect(resizerBlock).not.toContain(':focus-visible .sc-chat-rail-resizer__line');
    expect(resizerBlock).not.toMatch(/box-shadow:[^;]*inset/);
    expect(resizerBlock).toContain(".sc-chat-rail-resizer[data-chat-rail-resize]:focus-visible");
    expect(prototypeCss).toContain("data-keyboard-focus='true'] .sk-chat-rail-resizer-line");
    expect(prototypeCss).not.toContain(':focus-visible .sk-chat-rail-resizer-line');
    // The shared component distinguishes pointer-silent focus from keyboard
    // focus explicitly; a blur() workaround would lose keyboard Escape/arrows.
    expect(resizer).toContain('data-keyboard-focus={keyboardFocus}');
    expect(resizer).toContain('pointerFocused');
    expect(resizer).not.toContain('.blur()');
  });
});

describe('approved mineral ash to paper structure', () => {
  it('binds native and prototype to the same exact three role colors', () => {
    const native = tokenVariables('light');
    const prototype = northStarVariables('light', { material: 'flat' });
    for (const [role, expected] of [['frame', '#f1f3f2'], ['catalog', '#f7f8f7'], ['reading', '#fdfefd']]) {
      expect(native[`--pt-${role}`]).toBe(expected);
      expect(prototype[`--pt-${role}`]).toBe(expected);
    }
  });
});
