import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  stationAvailabilityState,
  visibleXConfigSuggestions,
} from './StationSelector';

const source = readFileSync(
  new URL('./StationSelector.tsx', import.meta.url),
  'utf8',
);
const entrySource = readFileSync(
  new URL('../entry/EntryScreen.tsx', import.meta.url),
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
    expect(source).toContain('onActivate={confirmStationRemoval}');
    expect(source).toContain('onDismiss={() => setPendingRemoval(null)}');
    expect(source).toMatch(/actionId="station.remove.confirm"[\s\S]*?tone="danger"/);
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

  it('keeps raw Station authority out of the saved Station row', () => {
    expect(source).not.toContain(
      '<Text type="secondary" className="mobile-truncate">{entry.url}</Text>',
    );
  });

  it('requires a current identity check before enabling Continue', () => {
    expect(appSource).toContain(
      'identity = await verifyStationEntryRuntime(selectedStation)',
    );
    expect(appSource).toContain(
      'verifyBoundStationRoute({',
    );
    expect(appSource).toContain(
      'requireMatchingStationIdentity(selectedStation, identity.stationPeerId)',
    );
    expect(appSource).toContain(
      'verifiedStationKeysForSelection.current.clear()',
    );
    expect(entrySource).toContain(
      "checkedUrls.includes(activeStation?.url ?? '')",
    );
    expect(entrySource).toContain(
      "verifyingUrls.includes(activeStation?.url ?? '')",
    );
  });
});

describe('StationSelector X Config suggestions', () => {
  it('renders suggestions as a separate non-authoritative state', () => {
    expect(source).toContain('data-x-config-seed-id');
    expect(source).toContain('common.stationPicker.suggestions');
    expect(source).toContain('common.stationPicker.suggestionStale');
    expect(source).toContain('availability={!suggestion.actionable || selectingSuggestionId !== null');
  });

  it('removes a suggestion only when a verified route owns the same origin', () => {
    const entries = [{
      stationPeerId: 'station-a',
      url: 'https://station.example',
      label: 'Station A',
      createdAt: 1,
      lastUsedAt: 1,
      routes: [{
        nodePeerId: 'node-a',
        nodeAuthorizationDigest: [],
        authorizationEpoch: 1,
        routeId: 'direct-a',
        routeType: 'direct' as const,
        transport: 'libp2p_http_v1' as const,
        endpointOrigin: 'https://station.example',
        routeGeneration: 1,
        addresses: [],
        sourceRef: 'source-a',
        lastVerifiedAt: 1,
        health: 'available' as const,
      }],
    }];
    const suggestions = [
      {
        seedId: 'station-public',
        kind: 'direct_station' as const,
        displayName: 'Public Station',
        canonicalOrigin: 'https://station.example',
        regions: ['global'],
        freshness: 'current' as const,
        actionable: true,
        sourceSequence: 1,
      },
      {
        seedId: 'relay-public',
        kind: 'relay' as const,
        displayName: 'Public Relay',
        canonicalOrigin: 'https://relay.example',
        regions: ['global'],
        freshness: 'current' as const,
        actionable: true,
        sourceSequence: 1,
      },
    ];

    expect(visibleXConfigSuggestions(entries, suggestions).map((item) => item.seedId))
      .toEqual(['relay-public']);
  });
});

describe('StationSelector layout contract', () => {
  it('uses one URL field with an HTTP placeholder instead of a protocol picker', () => {
    expect(source).toContain("surfaceFixture === 'address'");
    expect(source).toContain("'http://station.local:18280'");
    expect(source).toContain("surfaceFixture === 'address'");
    expect(source).toContain("buildStationUrl(stationUrl)?.startsWith('http://')");
    expect(source).toContain('className="station-field-helper warning"');
    expect(source).toContain('actionId="station.submit"');
    expect(source).not.toContain('<select');
    expect(source).not.toContain('station-protocol-select');
  });

  it('anchors the surface and keeps the 16px input that prevents iOS focus zoom', () => {
    expect(styles).toMatch(
      /\.launch-content\s*\{[^}]*flex:\s*1;[^}]*justify-content:\s*flex-start;/s,
    );
    expect(styles).toMatch(
      /\.launch-content\s*\{[^}]*padding:\s*24px 22px calc\(var\(--safe-area-bottom\) \+ 12px\);/s,
    );
    expect(styles).toMatch(/\.launch-panel\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(styles).toMatch(/\.launch-panel\s*\{[^}]*margin-top:\s*auto;/s);
    // The peers-ui TextField input inherits the global 16px input rule, which
    // stops iOS from auto-zooming on focus; the surface no longer hardcodes it.
    expect(styles).toMatch(
      /input,\s*textarea,\s*select\s*\{[^}]*font-size:\s*16px\s*!important/s,
    );
    expect(styles).toMatch(
      /\.station-field-helper\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.launch-brand-logo\s*\{[^}]*filter:\s*drop-shadow\(/s,
    );
    expect(styles).not.toMatch(/\.launch-brand-logo\s*\{[^}]*border:/s);
  });

  it('lets the peers-ui input primitive own the borderless inner focus chrome', () => {
    expect(styles).not.toContain('.station-address-input');
    expect(styles).not.toContain('.station-submit');
    expect(source).toContain('data-acceptance-id="station-address-input"');
    expect(source).toContain('aria-invalid={error ? true : undefined}');
  });
});

describe('Station entry visual contract', () => {
  it('keeps the entry task compact and unframed', () => {
    expect(entrySource).toContain('className="launch-content"');
    expect(entrySource).toContain('className="launch-brand-logo"');
    expect(entrySource).toContain('className="launch-panel"');
    expect(entrySource).not.toContain('<Card');
    expect(entrySource).not.toContain('launch-hero');
  });

  it('exposes scan as a quiet peers-ui IconButton in the top bar', () => {
    expect(entrySource).toContain('actionId="entry.scan"');
    expect(entrySource).toContain("label={t('mobile.deviceLink.scan')}");
    expect(entrySource).not.toContain('entry-scan-button');
  });

  it('embeds the access gate inline instead of navigating to a separate page', () => {
    expect(entrySource).toContain('<AccessGateHost');
    expect(entrySource).toContain('embedded');
    expect(entrySource).toContain("data-entry-action=\"change-station\"");
  });

  it('renders Station address as one parent field frame', () => {
    expect(source).toContain('actionId="station.submit"');
    expect(source).toContain('className="station-url-field"');
    expect(source).not.toContain('station-url-divider');
    expect(source).not.toContain('station-protocol-select');
    expect(source).not.toContain('<Tag');
  });
});
