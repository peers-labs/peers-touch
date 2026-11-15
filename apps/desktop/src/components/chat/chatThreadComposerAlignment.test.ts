// Source-contract: the composer embedded in the thread side sheet follows
// the prototype .sk-thread-composer grammar — the shared parent inset and a
// 7% hairline top border. The modifier class owns padding on that surface.
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

  it('uses the shared parent inset with the prototype 7% hairline top border', () => {
    const rule = chatCss.match(/\.sc-composer--thread\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('padding: var(--pt-composer-outer-inset)');
    expect(rule).toContain(
      'border-top: 1px solid color-mix(in srgb, var(--pt-text) 7%, transparent)',
    );
  });
});
