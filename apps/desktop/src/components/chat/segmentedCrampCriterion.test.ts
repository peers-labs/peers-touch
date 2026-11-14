import { describe, expect, it } from 'vitest';

import { shouldCollapseToIcons } from '@peers-touch/ui';

// The intrinsic labelled width of the Messages/People island is fixed; only
// the container width changes as the user drags the rail.
const REQUIRED_WIDTH = 260;

describe('shouldCollapseToIcons cramp criterion', () => {
  it('keeps full labels while the container fits the intrinsic width', () => {
    expect(shouldCollapseToIcons(REQUIRED_WIDTH, 400)).toBe(false);
    expect(shouldCollapseToIcons(REQUIRED_WIDTH, 260)).toBe(false);
  });

  it('collapses once the container is narrower than the intrinsic width', () => {
    expect(shouldCollapseToIcons(REQUIRED_WIDTH, 200)).toBe(true);
    expect(shouldCollapseToIcons(REQUIRED_WIDTH, 120)).toBe(true);
  });

  it('tolerates a 1px sub-pixel rounding gap without flipping', () => {
    expect(shouldCollapseToIcons(260, 259)).toBe(false);
    expect(shouldCollapseToIcons(260, 258)).toBe(true);
  });

  it('re-expands after re-widening — the reported stuck-icon-only regression', () => {
    // Replay the exact user sequence: wide window → narrow rail → wide again.
    // A stateful/scrollWidth-based probe stranded on icon-only here; a pure
    // width comparison must follow the container in both directions.
    const sequence: Array<[number, boolean]> = [
      [420, false],
      [240, true],
      [150, true],
      [240, true],
      [420, false],
      [520, false],
    ];
    for (const [containerWidth, expected] of sequence) {
      expect(shouldCollapseToIcons(REQUIRED_WIDTH, containerWidth)).toBe(expected);
    }
  });

  it('is symmetric and order-independent for the same width pair', () => {
    const narrow = shouldCollapseToIcons(REQUIRED_WIDTH, 120);
    const wide = shouldCollapseToIcons(REQUIRED_WIDTH, 480);
    expect(narrow).toBe(true);
    expect(wide).toBe(false);
    // Re-evaluating the same widths always yields the same answer.
    expect(shouldCollapseToIcons(REQUIRED_WIDTH, 120)).toBe(narrow);
    expect(shouldCollapseToIcons(REQUIRED_WIDTH, 480)).toBe(wide);
  });
});
