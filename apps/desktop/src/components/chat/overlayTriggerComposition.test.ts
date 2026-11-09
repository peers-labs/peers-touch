import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overlaysSource = readFileSync(
  new URL('../../../../../packages/ui/web/src/overlays.tsx', import.meta.url),
  'utf8',
);
const feedbackSource = readFileSync(
  new URL('../../../../../packages/ui/web/src/feedback.tsx', import.meta.url),
  'utf8',
);
const composerSource = readFileSync(
  new URL('./ChatComposer.tsx', import.meta.url),
  'utf8',
);

describe('overlay trigger composition (Popover > Tooltip > control)', () => {
  it('makes Tooltip honor the overlay-trigger child contract', () => {
    // Popover/Menu inject an anchor ref and activation props onto their
    // single child. Tooltip must forward them or the nested control has no
    // open path and the panel loses its anchor.
    expect(overlaysSource).toMatch(/export const Tooltip = forwardRef/);
    expect(overlaysSource).toMatch(/<span \{\.\.\.props\}/);
    expect(overlaysSource).toMatch(/onClick=\{onClick\}/);
    expect(overlaysSource).toMatch(/onKeyDown=\{onKeyDown\}/);
    expect(overlaysSource).toMatch(/forwardedRef/);
  });

  it('makes Badge forward the anchor ref injected by Popover/Menu', () => {
    // Badge spreads the injected activation props but a plain function
    // component silently drops the anchor ref, leaving the panel unpositioned.
    expect(feedbackSource).toMatch(/export const Badge = forwardRef/);
    expect(feedbackSource).toMatch(/<span \{\.\.\.props\} ref=\{ref\}/);
  });

  it('keeps the composer emoji control driven by the controlled Popover', () => {
    expect(composerSource).toContain('onOpenChange={setEmojiOpen}');
    expect(composerSource).toContain('actionId="composer-emoji"');
    // The trigger must stay a single Tooltip child carrying the Button, so
    // the injected activation contract reaches the interactive control.
    expect(composerSource).toMatch(/<PtPopover[\s\S]*?<PtTooltip[\s\S]*?actionId="composer-emoji"/);
  });
});
