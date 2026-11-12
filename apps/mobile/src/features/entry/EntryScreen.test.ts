import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./EntryScreen.tsx', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../../styles.css', import.meta.url),
  'utf8',
);

describe('Mobile Entry surface inventory contracts', () => {
  it('exposes the handshake launch state as an observable product surface', () => {
    expect(source).toContain('{handshake && !gate?.decision ? (');
    expect(source).toContain(
      'data-product-surface="entry.station-handshake"',
    );
  });

  it('exposes scan as a quiet peers-ui IconButton whose touch target is primitive-owned', () => {
    // The IconButton primitive enforces the comfortable touch size on coarse
    // pointers (packages/ui styles.css pointer:coarse rule), so the entry
    // surface no longer carries a 44px app-class override.
    expect(source).toContain('actionId="entry.scan"');
    expect(source).toContain('iconId="scan-line"');
    expect(source).toContain('emphasis="quiet"');
    expect(source).not.toContain('entry-scan-button');
  });

  it('lets a single auth action size to its label instead of clipping it', () => {
    expect(styles).toContain('.auth-actions:has(button:only-child)');
  });

  it('keeps the change-station control at the minimum 44px touch target', () => {
    const rule = styles.match(
      /\.entry-change-station\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(rule).toContain('height: 44px');
  });
});
