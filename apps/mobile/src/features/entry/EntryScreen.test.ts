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

  it('keeps the scan action at the minimum 44px touch target', () => {
    const rule = styles.match(
      /\.entry-scan-button\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(rule).toContain('width: 44px');
    expect(rule).toContain('height: 44px');
  });

  it('lets a single auth action size to its label instead of clipping it', () => {
    expect(styles).toContain('.auth-actions:has(button:only-child)');
  });
});
