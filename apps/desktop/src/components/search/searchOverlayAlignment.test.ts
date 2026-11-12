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
  new URL('./SearchOverlay.css', import.meta.url),
  'utf8',
);

describe('search command palette alignment (prototype bespoke shell over peers)', () => {
  it('does not depend on antd or @lobehub/ui anywhere in the search surface', () => {
    for (const source of [overlaySource, returnBarSource]) {
      expect(source).not.toMatch(/from 'antd'/);
      expect(source).not.toMatch(/@ant-design/);
      expect(source).not.toMatch(/@lobehub/);
      expect(source).not.toMatch(/theme\.useToken/);
    }
  });

  it('builds the command palette as a bespoke scrim + panel, like the prototype', () => {
    // The prototype shell uses its own backdrop/panel (peers has no
    // command-palette primitive); the interior listbox stays native.
    // Rendered inline (fixed), not portaled to body, so .pt-ui tokens apply.
    expect(overlaySource).not.toContain('createPortal');
    expect(overlaySource).toContain('className="pt-search-overlay"');
    expect(overlaySource).toContain('className="pt-search-scrim"');
    expect(overlaySource).toContain('className="pt-search-panel"');
    expect(overlaySource).not.toMatch(/<Modal/);
    // Interior ARIA hooks (roving listbox / tabs / searchbox) are preserved.
    expect(overlaySource).toContain('role="searchbox"');
    expect(overlaySource).toContain('data-search-filter');
    expect(overlaySource).toContain('id={`pt-search-row-${index}`}');
  });

  it('uses the peers Popover for the coverage info affordance', () => {
    expect(overlaySource).toContain('Popover as PeersPopover');
    expect(overlaySource).toContain('<PeersPopover');
  });

  it('maps the palette surface onto pt tokens in CSS instead of JS antd tokens', () => {
    expect(stylesheet).toContain('--pt-search-surface: var(--pt-raised)');
    expect(stylesheet).toContain('--pt-search-wash: var(--pt-primarySubtle)');
    expect(stylesheet).not.toMatch(/ant-modal/);
    expect(stylesheet).toContain('.pt-search-scrim');
    expect(stylesheet).toContain('.pt-search-panel');
  });

  it('expresses focus as a hairline + soft ring, never an offset square outline', () => {
    // north-star global-search spec §6: the embedded input's square outline
    // is suppressed; focus is a hairline color change plus a subtle ring so
    // the field does not paint a heavy double frame.
    expect(stylesheet).toContain('.pt-search-field:focus-within');
    expect(stylesheet).toContain('border-color: var(--pt-focus)');
    expect(stylesheet).toContain('box-shadow: 0 0 0 2px var(--pt-primarySubtle)');
    expect(stylesheet).not.toMatch(/\.pt-search-field:focus-within\s*\{[^}]*outline-offset/);
    expect(stylesheet).toContain('.pt-search-field input:focus-visible { outline: none; }');
  });

  it('renders the return bar actions as peers Buttons', () => {
    expect(returnBarSource).toMatch(/import \{ Button \} from '@peers-touch\/ui'/);
    expect(returnBarSource).toContain('actionId="search-return-back"');
    expect(returnBarSource).toContain('actionId="search-return-dismiss"');
    expect(returnBarSource).not.toMatch(/@lobehub/);
  });
});
