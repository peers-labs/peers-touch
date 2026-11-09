// Source-contract: the composer embedded in the thread side sheet follows
// the prototype .sk-thread-composer grammar — sheet footer with 10px 12px
// padding and a 7% hairline top border — instead of the main composer's
// outer inset. The modifier class owns padding; no inline padding is passed
// on that surface.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const composerSource = readFileSync(
  new URL('./ChatComposer.tsx', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

describe('thread sheet composer (north-star .sk-thread-composer parity)', () => {
  it('applies the --thread modifier on the desktop-thread visual surface', () => {
    expect(composerSource).toContain("sc-composer${visualSurface === 'desktop-thread' ? ' sc-composer--thread' : ''}");
  });

  it('omits the inline outer padding on the thread surface', () => {
    expect(composerSource).toMatch(/visualSurface === 'desktop-thread'[\s\S]{0,120}\? null/);
    expect(composerSource).toContain(': { padding: visualLayout.composerOuterPadding }');
  });

  it('pads 10px 12px with the prototype 7% hairline top border', () => {
    const rule = chatCss.match(/\.sc-composer--thread\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('padding: 10px 12px');
    expect(rule).toContain(
      'border-top: 1px solid color-mix(in srgb, var(--pt-text) 7%, transparent)',
    );
  });
});
