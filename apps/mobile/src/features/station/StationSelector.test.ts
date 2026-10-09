import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  defaultStationAddress,
  stationAvailabilityState,
} from './StationSelector';

const source = readFileSync(
  new URL('./StationSelector.tsx', import.meta.url),
  'utf8',
);
const launchSource = readFileSync(
  new URL('./StationLaunchScreen.tsx', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../App.tsx', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../../styles.css', import.meta.url),
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
    expect(source).toContain('if (!checked) {');
    expect(source).toContain("t('mobile.launch.unknown')");
  });

  it('never presents persisted reachability as a current availability result', () => {
    const persistedOnlineStation = {
      stationPeerId: 'station-a',
      url: 'https://station.example',
      label: 'Station A',
      createdAt: 1,
      lastUsedAt: 2,
      lastCheckedAt: 3,
      online: true,
      identityVerified: true,
    };

    expect(stationAvailabilityState(persistedOnlineStation, false, false)).toBe('unknown');
    expect(stationAvailabilityState(persistedOnlineStation, true, false)).toBe('validating');
    expect(stationAvailabilityState(persistedOnlineStation, false, true)).toBe('online');
    expect(stationAvailabilityState(
      { ...persistedOnlineStation, online: false },
      false,
      true,
    )).toBe('offline');
  });

  it('requires a current identity check before enabling Continue', () => {
    expect(appSource).toContain('await verifyStationIdentity(entry.url)');
    expect(appSource).toContain(
      'online = identity.stationPeerId === entry.stationPeerId',
    );
    expect(appSource).toContain(
      'verifiedStationKeysForSelection.current.clear()',
    );
    expect(launchSource).toContain(
      'disabled={!activeStation || !activeStationChecked}',
    );
    expect(launchSource).toContain("'common.action.retry'");
  });
});

describe('StationSelector layout contract', () => {
  it('keeps HTTP guidance outside the heading and inside the address field flow', () => {
    expect(source).toContain("surfaceFixture === 'address'");
    expect(source).toContain("? 'http'");
    expect(source).toContain("'station.local:18280'");
    expect(source).toContain('className="station-field-helper warning"');
    expect(source).toContain('className="station-submit"');
    expect(source).toContain('rootClassName="station-protocol-sheet-root"');
  });

  it('anchors the card and preserves a useful one-line address field', () => {
    expect(styles).toMatch(/\.launch-hero\s*\{[^}]*flex:\s*1 1 auto;/s);
    expect(styles).toMatch(/\.launch-body\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).toMatch(
      /\.station-protocol-select\s*\{[^}]*min-width:\s*62px;[^}]*height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /\.station-address-input\s*\{[^}]*height:\s*44px;[^}]*font-size:\s*16px;/s,
    );
    expect(styles).toMatch(
      /\.station-field-helper\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.launch-hero-logo\s*\{[^}]*filter:\s*drop-shadow\(/s,
    );
    expect(styles).not.toMatch(/\.launch-hero-logo\s*\{[^}]*border:/s);
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
