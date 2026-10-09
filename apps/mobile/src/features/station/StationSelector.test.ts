import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { defaultStationAddress } from './StationSelector';

const source = readFileSync(
  new URL('./StationSelector.tsx', import.meta.url),
  'utf8',
);

describe('StationSelector removal contract', () => {
  it('requires an explicit destructive confirmation before removing a Station', () => {
    expect(source).toContain('setPendingRemoval(entry)');
    expect(source).toContain('open={pendingRemoval !== null}');
    expect(source).toContain('onClick={confirmStationRemoval}');
    expect(source).toContain('onCancel={() => setPendingRemoval(null)}');
    expect(source).toContain('className="entry-confirmation-button danger"');
    expect(source).toContain('data-product-surface="entry.station-remove-confirm"');
  });

  it('removes only the Station captured by the confirmation state', () => {
    expect(source).toContain('onRemove(pendingRemoval.stationPeerId)');
    expect(source).not.toContain('onRemove(entry.stationPeerId)');
  });
});

describe('StationSelector reachability states', () => {
  it('keeps an unchecked Station distinct from an active verification', () => {
    expect(source).toContain('if (verifying) {');
    expect(source).toContain("className: 'validating'");
    expect(source).toContain('if (entry.online === undefined) {');
    expect(source).toContain("className: 'unknown'");
    expect(source).toContain("t('mobile.launch.unknown')");
  });
});

describe('StationSelector development defaults', () => {
  it('prefills the configured Station without silently connecting', () => {
    expect(defaultStationAddress('http://10.37.94.156:18132')).toEqual({
      protocol: 'http',
      address: '10.37.94.156:18132',
    });
    expect(defaultStationAddress(undefined)).toEqual({
      protocol: 'https',
      address: '',
    });
  });
});
