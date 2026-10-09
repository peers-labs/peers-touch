import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { stationAvailabilityState } from './StationSelector';

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
  it('uses one URL field with an HTTP placeholder instead of a protocol picker', () => {
    expect(source).toContain("surfaceFixture === 'address'");
    expect(source).toContain("'http://station.local:18280'");
    expect(source).toContain('className="station-field-helper warning"');
    expect(source).toContain('className="station-submit"');
    expect(source).not.toContain('<select');
    expect(source).not.toContain('station-protocol-select');
  });

  it('anchors the surface and preserves a useful one-line address field', () => {
    expect(styles).toMatch(/\.launch-content\s*\{[^}]*flex:\s*1;/s);
    expect(styles).toMatch(/\.launch-panel\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).toMatch(
      /\.station-address-input\s*\{[^}]*height:\s*44px;[^}]*font-size:\s*16px;/s,
    );
    expect(styles).toMatch(
      /\.station-field-helper\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.launch-brand-logo\s*\{[^}]*filter:\s*drop-shadow\(/s,
    );
    expect(styles).not.toMatch(/\.launch-brand-logo\s*\{[^}]*border:/s);
  });

  it('never draws an inner focus frame inside the outer control', () => {
    expect(styles).toContain('.station-address-input:focus-visible');
    expect(styles).toMatch(
      /\.station-url-control\s+\.station-address-input:focus-visible\s*\{[\s\S]*?outline:\s*none\s*!important;/,
    );
  });
});

describe('Station launch visual contract', () => {
  it('keeps the entry task compact and unframed', () => {
    expect(launchSource).toContain('className="launch-content"');
    expect(launchSource).toContain('className="launch-brand-logo"');
    expect(launchSource).toContain('className="launch-panel"');
    expect(launchSource).not.toContain('<Card');
    expect(launchSource).not.toContain('launch-hero');
  });

  it('uses one contextual primary action', () => {
    expect(launchSource).toContain("'common.action.retry'");
    expect(launchSource).toContain('disabled={!activeStation || !activeStationChecked}');
  });

  it('renders Station address as one parent field frame', () => {
    expect(source).toContain('className="station-submit"');
    expect(source).toContain('`station-url-control ${error ? \'error\' : \'\'}');
    expect(source).not.toContain('station-url-divider');
    expect(source).not.toContain('station-protocol-select');
    expect(source).not.toContain('<Tag');
  });
});
