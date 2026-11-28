import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overlaySource = readFileSync(
  new URL('./SearchOverlay.tsx', import.meta.url),
  'utf8',
);
const returnBarSource = readFileSync(
  new URL('./SearchReturnBar.tsx', import.meta.url),
  'utf8',
);
const stylesheet = readFileSync(
  new URL('../../../../../packages/ui/composite/src/search/search.css', import.meta.url),
  'utf8',
);
const surfaceSource = readFileSync(
  new URL('../../../../../packages/ui/composite/src/search/GlobalSearchSurface.tsx', import.meta.url),
  'utf8',
);

describe('search command palette alignment (composite-promotion adapter)', () => {
  it('does not depend on antd or @lobehub/ui anywhere in the search surface', () => {
    for (const source of [overlaySource, returnBarSource]) {
      expect(source).not.toMatch(/from 'antd'/);
      expect(source).not.toMatch(/@ant-design/);
      expect(source).not.toMatch(/@lobehub/);
      expect(source).not.toMatch(/theme\.useToken/);
    }
  });

  it('delegates DOM rendering to GlobalSearchSurface from @peers-touch/ui-composite', () => {
    // The adapter is a thin port-conversion layer; the composite owns all
    // DOM. Verify the wiring points are intact.
    expect(overlaySource).not.toContain('createPortal');
    expect(overlaySource).not.toMatch(/<Modal/);
    expect(overlaySource).toContain("import { GlobalSearchSurface } from '@peers-touch/ui-composite'");
    expect(overlaySource).toContain('<GlobalSearchSurface');
    // SurfaceHooks injects legacy pt-search-* classes onto composite regions.
    expect(overlaySource).toContain("'pt-search-overlay'");
    expect(overlaySource).toContain("'pt-search-scrim'");
    expect(overlaySource).toContain("'pt-search-panel'");
    // ARIA hooks are delivered through composite; adapter confirms its slot.
    expect(overlaySource).toContain('info:');
    expect(overlaySource).toContain('SearchResultMeta');
  });

  it('uses the peers Popover for the coverage info affordance', () => {
    expect(surfaceSource).toContain('Popover as PeersPopover');
    expect(surfaceSource).toContain('<PeersPopover');
  });

  it('maps the palette surface onto pt tokens in CSS instead of JS antd tokens', () => {
    expect(stylesheet).toContain('background: var(--pt-overlay)');
    expect(stylesheet).toContain('background: var(--pt-primarySubtle)');
    expect(stylesheet).not.toMatch(/ant-modal/);
    expect(stylesheet).toContain('.ptc-search-scrim');
    expect(stylesheet).toContain('.ptc-search-panel');
    expect(overlaySource).not.toContain("import './SearchOverlay.css'");
  });

  it('expresses focus at the input rail hairline, never an offset square outline', () => {
    // north-star global-search spec §6: the embedded input's square outline
    // is suppressed; focus is a hairline color change plus a subtle ring so
    // the field does not paint a heavy double frame.
    expect(stylesheet).toContain('.ptc-search-field:focus-within');
    expect(stylesheet).toContain('border-bottom-color: color-mix(in srgb, var(--pt-primary) 38%, var(--pt-border))');
    expect(stylesheet).not.toMatch(/\.ptc-search-field:focus-within\s*\{[^}]*outline-offset/);
    expect(stylesheet).toContain('.ptc-search-panel .ptc-search-input:focus-visible { outline: none; }');
  });

  it('renders the return bar actions as peers Buttons', () => {
    expect(returnBarSource).toMatch(/import \{ Button \} from '@peers-touch\/ui'/);
    expect(returnBarSource).toContain('actionId="search-return-back"');
    expect(returnBarSource).toContain('actionId="search-return-dismiss"');
    expect(returnBarSource).not.toMatch(/@lobehub/);
  });
});
